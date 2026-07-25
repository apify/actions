// Stage 3 of the factory-approve action, and the only place GitHub is written to. Reads the gates
// evidence (stage 1) and the verdict files Claude wrote (stage 2), derives the final verdict
// deterministically, and posts it: approve → approving review as the factory account, locked to the
// reviewed head SHA; reject/error → any stale factory approval is dismissed and the report is posted
// as a NEW comment, with earlier report comments folded as outdated (never edited or deleted). The
// bot never touches the label, never requests changes, never merges, and never edits the PR description.
//
// Usage: node post_verdict.mts --pr <number> [--repo owner/repo] [--out-dir dir]
// Env: GITHUB_TOKEN (legacy PR body cleanup), FACTORY_GITHUB_TOKEN (reviews/comments),
// WORKFLOW_RUN_URL (optional), POLICY_OVERRIDES (optional, must match the prepare step's).

import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import {
    createApprovalReview,
    createIssueComment,
    dismissApprovalsBy,
    errorMessage,
    minimizeOutdatedReports,
    removePrBodyMessage,
} from './github_api.mts';
import { fingerprintMarker } from './fingerprint.mts';
import { resolvePolicy, type Policy } from './policy.mts';
import { REPORT_MARKER, buildVerdictReport } from './report.mts';
import { aggregateVerdicts, parseVerdict, type ReviewerVerdict } from './verdict.mts';

const { values } = parseArgs({
    options: {
        pr: { type: 'string' },
        repo: { type: 'string', default: process.env.GITHUB_REPOSITORY ?? '' },
        'out-dir': { type: 'string', default: join(process.env.RUNNER_TEMP ?? '/tmp', 'factory-approve') },
    },
});

const prNumber = Number(values.pr);
if (!Number.isInteger(prNumber) || prNumber <= 0) {
    console.error('--pr must be a positive integer');
    process.exit(2);
}
if (!values.repo) {
    console.error('--repo (or the GITHUB_REPOSITORY env var) is required');
    process.exit(2);
}
const githubToken = process.env.GITHUB_TOKEN;
const factoryToken = process.env.FACTORY_GITHUB_TOKEN;
if (!githubToken || !factoryToken) {
    console.error('GITHUB_TOKEN and FACTORY_GITHUB_TOKEN are required');
    process.exit(2);
}

const outDir = values['out-dir'];
const { repo } = values;
const runUrl = process.env.WORKFLOW_RUN_URL ?? '';

// Action inputs are fixed for the whole run, so this resolves to the same policy the prepare step
// used. If the overrides are invalid, the prepare step already failed the gates (fail closed) —
// fall back to the defaults here so the error report can still be rendered and posted.
let policy: Policy;
try {
    policy = resolvePolicy(process.env.POLICY_OVERRIDES);
} catch (error) {
    console.warn(`Using the default policy for reporting: ${errorMessage(error)}`);
    policy = resolvePolicy();
}

let gates: any = null;
try {
    gates = JSON.parse(readFileSync(join(outDir, 'gates.json'), 'utf-8'));
} catch (error) {
    console.warn(`Could not read gates.json: ${errorMessage(error)}`);
}

// A skip is a full no-op: nothing is reviewed, posted, dismissed, or folded.
if (gates?.skipReason) {
    console.log(`Skipping PR #${prNumber}: ${gates.skipReason}`);
    process.exit(0);
}

let finalVerdict: 'approve' | 'reject' | 'error' = 'error';
let finalReason = 'The review pipeline crashed before producing a result.';
const reviewerVerdicts: ReviewerVerdict[] = [];

if (gates) {
    const failed = gates.staticChecks.filter((check: any) => !check.pass);
    if (gates.crashMessage) {
        finalVerdict = 'error';
        finalReason = `The review pipeline crashed: ${gates.crashMessage}`;
    } else if (!gates.staticPassed) {
        finalVerdict = 'reject';
        finalReason = `Static checks failed: ${failed.map((check: any) => check.id).join(', ')}.`;
    } else {
        // Every reviewer must have produced a valid approval; a missing or malformed verdict from any
        // of them fails closed.
        const reviewers = gates.reviewers ?? 1;
        for (let index = 1; index <= reviewers; index++) {
            const verdictFile = join(outDir, index === 1 ? 'verdict.json' : `verdict${index}.json`);
            try {
                reviewerVerdicts.push(parseVerdict(readFileSync(verdictFile, 'utf-8'), policy));
            } catch (error) {
                reviewerVerdicts.push({
                    verdict: 'error',
                    reason: `Reviewer ${index} did not produce a valid verdict file (fails closed): ${errorMessage(error)}`,
                });
            }
        }
        const aggregate = aggregateVerdicts(reviewerVerdicts);
        finalVerdict = aggregate.verdict;
        finalReason = aggregate.reason;
    }
}

if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `verdict=${finalVerdict}\n`);
}
console.log(`PR #${prNumber}: ${finalVerdict.toUpperCase()} — ${finalReason}`);

const report = buildVerdictReport({ verdict: finalVerdict, reason: finalReason, gates, reviewerVerdicts, policy, runUrl });
// LLM verdicts are memoized by content fingerprint so an unchanged diff is not re-reviewed. Gates
// failures and errors carry no fingerprint: gates are free to re-run and depend on more than the
// diff (actor, PR state), and a crashed run should always retry.
const memoMarker =
    gates?.fingerprint && gates.staticPassed && (finalVerdict === 'approve' || finalVerdict === 'reject')
        ? `\n\n${fingerprintMarker(finalVerdict, gates.fingerprint)}`
        : '';

// Earlier versions of this action wrote the outcome into the PR description; drop any such block.
await removePrBodyMessage(repo, prNumber, { label: 'FACTORY-APPROVE', token: githubToken });

// Reports from earlier runs describe superseded commits — fold them (never edit or delete them).
const folded = await minimizeOutdatedReports(repo, prNumber, { marker: REPORT_MARKER, token: factoryToken });
if (folded > 0) console.log(`Folded ${folded} outdated report comment(s).`);

if (finalVerdict === 'approve' && gates) {
    // Reviews cannot be minimized like comments, so a superseded factory approval is dismissed
    // instead — the timeline keeps it (struck through) and only the newest approval stays active.
    const superseded = await dismissApprovalsBy(repo, prNumber, {
        login: policy.factoryLogin,
        message: 'Superseded by a newer factory-approve run.',
        token: factoryToken,
    });
    if (superseded > 0) console.log(`Dismissed ${superseded} superseded factory approval(s).`);
    // The approval is the only channel on approve — no comment is posted. It is locked to the
    // reviewed commit (and the workflow's cancel-in-progress supersedes moved-head runs).
    await createApprovalReview(repo, prNumber, {
        commitId: gates.headSha,
        body: `${report}${memoMarker}`,
        token: factoryToken,
    });
    console.log(`Approved PR #${prNumber} at ${gates.headSha}.`);
    process.exit(0);
}

// Non-approval: withdraw any factory approval that no longer reflects the PR, then post the outcome.
const dismissed = await dismissApprovalsBy(repo, prNumber, {
    login: policy.factoryLogin,
    message: 'Stale factory-approve approval: a newer run did not approve the current head.',
    token: factoryToken,
});
if (dismissed > 0) console.log(`Dismissed ${dismissed} stale factory approval(s).`);

await createIssueComment(repo, prNumber, { body: `${report}\n\n${REPORT_MARKER}${memoMarker}`, token: factoryToken });

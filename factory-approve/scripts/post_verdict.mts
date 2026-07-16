// Stage 3 of the factory-approve action, and the only place GitHub is written to. Reads the gates
// evidence (stage 1) and the verdict file(s) Claude wrote (stage 2), derives the final verdict
// deterministically, and posts it. The `factory-approve` label is a human-controlled opt-in flag —
// this script never adds or removes it.
//   approve → approving review as the factory account, locked to the reviewed head SHA.
//   reject / error → any stale factory approval is dismissed and the outcome is written to the PR body.
// The bot never requests changes and never merges.
//
// Usage: node post_verdict.mts --pr <number> [--repo owner/repo] [--out-dir dir]
// Env: GITHUB_TOKEN (PR body updates), FACTORY_GITHUB_TOKEN (approvals/dismissals), WORKFLOW_RUN_URL (optional).

import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { createApprovalReview, dismissApprovalsBy, errorMessage, upsertPrBodyMessage } from './github_api.mts';
import { policy } from './policy.mts';
import { aggregateVerdicts, parseVerdict } from './verdict.mts';

const { values } = parseArgs({
    options: {
        pr: { type: 'string' },
        repo: { type: 'string', default: process.env.GITHUB_REPOSITORY ?? 'apify/apify-core' },
        'out-dir': { type: 'string', default: join(process.env.RUNNER_TEMP ?? '/tmp', 'factory-approve') },
    },
});

const prNumber = Number(values.pr);
if (!Number.isInteger(prNumber) || prNumber <= 0) {
    console.error('--pr must be a positive integer');
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

/** @type {any} */
let gates = null;
try {
    gates = JSON.parse(readFileSync(join(outDir, 'gates.json'), 'utf-8'));
} catch (error) {
    console.warn(`Could not read gates.json: ${errorMessage(error)}`);
}

/** @type {'approve' | 'reject' | 'error'} */
let finalVerdict = 'error';
let finalReason = 'The review pipeline crashed before producing a result.';

if (gates) {
    const failed = gates.staticChecks.filter((/** @type {any} */ check) => !check.pass);
    if (gates.crashMessage) {
        finalVerdict = 'error';
        finalReason = `The review pipeline crashed: ${gates.crashMessage}`;
    } else if (!gates.staticPassed) {
        finalVerdict = 'reject';
        finalReason = `Static checks failed: ${failed.map((/** @type {any} */ check) => check.id).join(', ')}.`;
    } else {
        // Every reviewer must have produced a valid approval; a missing or malformed verdict from any
        // of them fails closed.
        const reviewers = gates.reviewers ?? 1;
        const reviewerVerdicts = [];
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

if (finalVerdict === 'approve' && gates) {
    // The approval is locked to the reviewed commit; if the head has since moved, GitHub keeps the
    // approval tied to that SHA (and the workflow's cancel-in-progress supersedes moved-head runs).
    await createApprovalReview(repo, prNumber, {
        commitId: gates.headSha,
        body: `🏭 Auto-approved by factory-approve: ${finalReason}`,
        token: factoryToken,
    });
    await upsertPrBodyMessage(repo, prNumber, {
        message: `✅ **factory-approve approved this PR** at \`${gates.headSha.slice(0, 9)}\`. ${finalReason}`,
        label: 'FACTORY-APPROVE',
        token: githubToken,
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

const failedChecks = (gates?.staticChecks ?? []).filter((/** @type {any} */ check) => !check.pass);
const failedChecksList = failedChecks
    .map((/** @type {any} */ check) => `- \`${check.id}\`: ${check.details}`)
    .join('\n');
const header =
    finalVerdict === 'reject'
        ? `❌ **factory-approve did not approve this PR.** ${finalReason}`
        : `⚠️ **factory-approve could not finish.** ${finalReason}`;
const retryHint =
    `The \`${policy.label}\` label stays on — the next push re-reviews automatically. Request a human ` +
    `reviewer, or remove the label to take this PR out of the auto-approve lane.`;
const message = [header, failedChecksList, retryHint, runUrl ? `[Workflow run](${runUrl})` : '']
    .filter(Boolean)
    .join('\n\n');

await upsertPrBodyMessage(repo, prNumber, { message, label: 'FACTORY-APPROVE', token: githubToken });

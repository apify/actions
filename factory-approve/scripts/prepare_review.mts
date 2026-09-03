// Stage 1 of the factory-approve action: fetch PR data, run every static safety check, write the
// gates evidence JSON, and — only when all gates pass — emit the prompt and model settings for the
// claude-code-action verdict step via $GITHUB_OUTPUT. It NEVER fails the step: any crash is captured
// into gates.json with staticPassed:false so the post step reports an error verdict (fail closed). It
// needs only read credentials — posting to GitHub happens exclusively in post_verdict.mts.
//
// Usage: node prepare_review.mts --pr <number> [--repo owner/repo] [--actor login] [--out-dir dir]
// Env: GITHUB_TOKEN (required); FACTORY_GITHUB_TOKEN (optional, read:org for the engineers team
// check); POLICY_OVERRIDES (optional JSON policy overrides, see policy.mts).

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { createAllowedUserResolver, hasLabel, runStaticChecks, type CheckResult } from './checks.mts';
import { writeHeadFiles } from './context_files.mts';
import { activeHumanReviews, computeReviewFingerprint, findPriorVerdict, stableStringify } from './fingerprint.mts';
import {
    errorMessage,
    getPullRequest,
    isActiveTeamMember,
    listIssueComments,
    listPullRequestFiles,
    listPullRequestReviews,
} from './github_api.mts';
import { resolvePolicy, type Policy } from './policy.mts';
import { buildReviewerPrompts, type ReviewerPrompt } from './prompt.mts';

// Gates object with safe defaults — base for both runGates and the crash fallback.
function baseGates({ repo, prNumber, actor }: { repo: string; prNumber: number; actor: string | null }) {
    return {
        generatedAt: new Date().toISOString(),
        repo,
        prNumber,
        headSha: '',
        prTitle: '',
        prAuthor: '',
        actor,
        staticChecks: [] as CheckResult[],
        staticPassed: false,
        reviewers: 1,
        // JSON-safe snapshot of the effective policy this run was judged under, for auditability.
        policy: null as Record<string, unknown> | null,
        crashMessage: '',
        // Non-empty when this run should do nothing at all (no LLM, no posting): a human review is
        // active, or the diff is unchanged since the last factory verdict.
        skipReason: '',
        // Non-empty when the factory label is absent from the PR: nothing is reviewed or posted,
        // but any active factory approval is dismissed — an approval must never outlive the label
        // that authorized it (otherwise removing the label would switch the pipeline off while its
        // approval keeps counting toward required reviews for whatever is pushed next).
        dismissReason: '',
        // Fingerprint of the reviewed content; post_verdict embeds it in the verdict it posts.
        fingerprint: '',
    };
}

// Fetches the PR and runs the static checks. Exported for backtest.mts.
export async function runGates({
    repo,
    prNumber,
    actor,
    backtest = false,
    policy,
    tokens,
}: {
    repo: string;
    prNumber: number;
    actor: string | null;
    backtest?: boolean;
    policy: Policy;
    tokens: { github: string; factory?: string };
}) {
    const pr = await getPullRequest(repo, prNumber, tokens.github);
    const files = await listPullRequestFiles(repo, prNumber, tokens.github);
    const reviews = await listPullRequestReviews(repo, prNumber, tokens.github);

    const isAllowedUser = createAllowedUserResolver(policy, { teamToken: tokens.factory, isActiveTeamMember });
    const staticChecks = await runStaticChecks({ policy, pr, files, actor, backtest, isAllowedUser });

    return {
        pr,
        files,
        reviews,
        gates: {
            ...baseGates({ repo, prNumber, actor }),
            headSha: pr.head?.sha ?? '',
            prTitle: pr.title ?? '',
            prAuthor: pr.user?.login ?? '',
            staticChecks,
            staticPassed: staticChecks.every((check) => check.pass),
            reviewers: policy.llm.reviewerModels.length,
        },
    };
}

// Fetches the post-change file contents and builds the per-reviewer prompts in one place, so CI and
// the backtest run byte-identical prompts.
export async function buildReviewerContext({
    repo,
    pr,
    files,
    headSha,
    outDir,
    token,
    policy,
}: {
    repo: string;
    pr: any;
    files: any[];
    headSha: string;
    outDir: string;
    token: string;
    policy: Policy;
}) {
    const headFiles = await writeHeadFiles({ repo, files, headSha, outDir, token });
    return { headFiles, reviewerPrompts: buildReviewerPrompts({ pr, files, policy, headFiles, outDir }) };
}

// Appends a (possibly multiline) output for later workflow steps.
function setStepOutput(name: string, value: string): void {
    const outputPath = process.env.GITHUB_OUTPUT;
    if (!outputPath) return;
    const delimiter = `EOF_${Math.random().toString(36).slice(2)}`;
    appendFileSync(outputPath, `${name}<<${delimiter}\n${value}\n${delimiter}\n`);
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
    const { values } = parseArgs({
        options: {
            pr: { type: 'string' },
            repo: { type: 'string', default: process.env.GITHUB_REPOSITORY ?? '' },
            actor: { type: 'string' },
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

    const outDir = values['out-dir'];
    mkdirSync(outDir, { recursive: true });

    let gates = baseGates({ repo: values.repo, prNumber, actor: values.actor ?? null });
    let reviewers: ReviewerPrompt[] = [];
    let policy: Policy | null = null;

    try {
        const githubToken = process.env.GITHUB_TOKEN;
        if (!githubToken) throw new Error('GITHUB_TOKEN is required');
        policy = resolvePolicy(process.env.POLICY_OVERRIDES);

        const result = await runGates({
            repo: values.repo,
            prNumber,
            actor: values.actor ?? null,
            policy,
            tokens: { github: githubToken, factory: process.env.FACTORY_GITHUB_TOKEN },
        });
        gates = result.gates;
        gates.policy = JSON.parse(stableStringify(policy));

        // Withdraw and stand down when the label is absent (typically an `unlabeled` run, but every
        // run re-checks the live PR). Checked before everything else — the dismissal must happen
        // even when a human review is active or the gates would fail.
        const humans = activeHumanReviews({ pr: result.pr, reviews: result.reviews, factoryLogin: policy.factoryLogin });
        if (!hasLabel(result.pr, policy.label)) {
            gates.dismissReason = `label "${policy.label}" is not present on the PR`;
        } else if (humans.size > 0) {
            // Stand down entirely when a human has reviewed: an approval means the factory has nothing
            // to add, changes-requested means a human owns the review conversation now. Checked before
            // the gates outcome so even a would-be rejection stays silent.
            const states = [...humans.entries()].map(([login, state]) => `${login}: ${state}`);
            gates.skipReason = `human review active (${states.join(', ')})`;
        } else if (gates.staticPassed) {
            // Skip the paid review when the content is unchanged since the last factory verdict. An
            // approve match needs no re-approval (approvals survive pushes, and a manually dismissed
            // one stays dismissed on purpose); a reject comment already describes this exact diff.
            gates.fingerprint = computeReviewFingerprint({ title: gates.prTitle, files: result.files, policy });
            const comments = await listIssueComments(values.repo, prNumber, githubToken);
            const prior = findPriorVerdict({ reviews: result.reviews, comments, factoryLogin: policy.factoryLogin });
            if (prior && prior.fingerprint === gates.fingerprint) {
                gates.skipReason = `content unchanged since the last factory verdict (${prior.verdict})`;
            }
        }

        if (gates.staticPassed && !gates.skipReason && !gates.dismissReason) {
            const context = await buildReviewerContext({
                repo: values.repo,
                pr: result.pr,
                files: result.files,
                headSha: gates.headSha,
                outDir,
                token: githubToken,
                policy,
            });
            reviewers = context.reviewerPrompts;
        }
    } catch (error) {
        // Captured, not thrown: the post step turns a crashed gate run into an `error` verdict (never
        // approves), and the step stays green so the post step runs.
        gates.crashMessage = errorMessage(error);
        gates.staticPassed = false;
        reviewers = [];
    }

    writeFileSync(join(outDir, 'gates.json'), `${JSON.stringify(gates, null, 2)}\n`);

    const gatesPassed = gates.staticPassed && reviewers.length > 0;
    setStepOutput('gates_passed', gatesPassed ? 'true' : 'false');
    if (gatesPassed && policy) {
        // Each reviewer carries its own model; the second Claude step runs only if prompt2 is set.
        setStepOutput('prompt', reviewers[0].prompt);
        setStepOutput('model', reviewers[0].model);
        if (reviewers.length > 1) {
            setStepOutput('prompt2', reviewers[1].prompt);
            setStepOutput('model2', reviewers[1].model);
        }
        setStepOutput('max_turns', String(policy.llm.maxTurns));
    }

    console.log(`PR #${prNumber}${gates.headSha ? ` (${gates.headSha.slice(0, 9)})` : ''}`);
    if (gates.crashMessage) console.log(`CRASHED (fails closed): ${gates.crashMessage}`);
    for (const check of gates.staticChecks) {
        console.log(`  [${check.pass ? 'pass' : 'FAIL'}] ${check.id}: ${check.details}`);
    }
    if (gates.dismissReason) {
        console.log(`STAND DOWN — ${gates.dismissReason}. Factory approvals will be dismissed; nothing else posted.`);
    } else if (gates.skipReason) {
        console.log(`SKIP — ${gates.skipReason}. Nothing will be reviewed or posted.`);
    } else {
        console.log(
            `Static checks ${gates.staticPassed ? 'PASSED' : 'FAILED'}; LLM step will ${gatesPassed ? '' : 'NOT '}run.`,
        );
    }
}

// Stage 1 of the factory-approve action: fetch PR data, run every static safety check, write the
// gates evidence JSON, and — only when all gates pass — emit the prompt and model settings for the
// claude-code-action verdict step via $GITHUB_OUTPUT. It NEVER fails the step: any crash is captured
// into gates.json with staticPassed:false so the post step reports an error verdict (fail closed). It
// needs only read credentials — posting to GitHub happens exclusively in post_verdict.mts.
//
// Usage: node prepare_review.mts --pr <number> [--repo owner/repo] [--actor login] [--out-dir dir]
// Env: GITHUB_TOKEN (required); FACTORY_GITHUB_TOKEN (optional, read:org for the engineers team check).

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { createAllowedUserResolver, runStaticChecks } from './checks.mts';
import { writeHeadFiles } from './context_files.mts';
import {
    errorMessage,
    getPullRequest,
    isActiveTeamMember,
    listPullRequestFiles,
    listPullRequestReviews,
} from './github_api.mts';
import { policy } from './policy.mts';
import { buildReviewerPrompts } from './prompt.mts';

/**
 * Gates object with safe defaults — base for both runGates and the crash fallback.
 * @param {{ repo: string, prNumber: number, actor: string | null }} input
 */
function baseGates({ repo, prNumber, actor }) {
    return {
        generatedAt: new Date().toISOString(),
        repo,
        prNumber,
        headSha: '',
        prTitle: '',
        prAuthor: '',
        actor,
        staticChecks: /** @type {Array<{ id: string, description: string, pass: boolean, details: string }>} */ ([]),
        staticPassed: false,
        reviewers: 1,
        crashMessage: '',
    };
}

/**
 * Fetches the PR and runs the static checks. Exported for backtest.mts.
 * @param {{ repo: string, prNumber: number, actor: string | null, backtest?: boolean, policy: typeof import('./policy.mts').policy, tokens: { github: string, factory?: string } }} input
 */
export async function runGates({ repo, prNumber, actor, backtest = false, policy, tokens }) {
    const pr = await getPullRequest(repo, prNumber, tokens.github);
    const files = await listPullRequestFiles(repo, prNumber, tokens.github);
    const reviews = await listPullRequestReviews(repo, prNumber, tokens.github);

    const isAllowedUser = createAllowedUserResolver(policy, { teamToken: tokens.factory, isActiveTeamMember });
    const staticChecks = await runStaticChecks({ policy, pr, files, reviews, actor, backtest, isAllowedUser });

    return {
        pr,
        files,
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

/**
 * Fetches the post-change file contents and builds the per-reviewer prompts in one place, so CI and
 * the backtest run byte-identical prompts.
 * @param {{ repo: string, pr: any, files: any[], headSha: string, outDir: string, token: string, policy: typeof import('./policy.mts').policy }} input
 */
export async function buildReviewerContext({ repo, pr, files, headSha, outDir, token, policy }) {
    const headFiles = await writeHeadFiles({ repo, files, headSha, outDir, token });
    return { headFiles, reviewerPrompts: buildReviewerPrompts({ pr, files, policy, headFiles, outDir }) };
}

/**
 * Appends a (possibly multiline) output for later workflow steps.
 * @param {string} name
 * @param {string} value
 */
function setStepOutput(name, value) {
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
            repo: { type: 'string', default: process.env.GITHUB_REPOSITORY ?? 'apify/apify-core' },
            actor: { type: 'string' },
            'out-dir': { type: 'string', default: join(process.env.RUNNER_TEMP ?? '/tmp', 'factory-approve') },
        },
    });

    const prNumber = Number(values.pr);
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
        console.error('--pr must be a positive integer');
        process.exit(2);
    }

    const outDir = values['out-dir'];
    mkdirSync(outDir, { recursive: true });

    let gates = baseGates({ repo: values.repo, prNumber, actor: values.actor ?? null });
    /** @type {ReturnType<typeof buildReviewerPrompts>} */
    let reviewers = [];

    try {
        const githubToken = process.env.GITHUB_TOKEN;
        if (!githubToken) throw new Error('GITHUB_TOKEN is required');

        const result = await runGates({
            repo: values.repo,
            prNumber,
            actor: values.actor ?? null,
            policy,
            tokens: { github: githubToken, factory: process.env.FACTORY_GITHUB_TOKEN },
        });
        gates = result.gates;

        if (gates.staticPassed) {
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
    if (gatesPassed) {
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
    console.log(
        `Static checks ${gates.staticPassed ? 'PASSED' : 'FAILED'}; LLM step will ${gatesPassed ? '' : 'NOT '}run.`,
    );
}

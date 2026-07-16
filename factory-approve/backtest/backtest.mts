// Backtests the factory-approve pipeline against recent closed PRs without posting anything to
// GitHub. It replays the exact CI pipeline — static gates, then for gate-passing PRs the same
// dual-reviewer LLM step via the local `claude` CLI (claude-code-action wraps the same CLI) — over
// the last N human-authored PRs, and prints how many would have been auto-approved.
//
// Usage: node backtest.mts [--repo owner/repo] [--last 200] [--output results.jsonl]
// Env: GITHUB_TOKEN (required); FACTORY_GITHUB_TOKEN (recommended — without it the engineer gate
// fails for everyone). Needs the `claude` CLI installed and authenticated; run from a checkout of the
// base branch so Read/Grep context matches CI.

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { errorMessage, listRecentPullRequests } from '../scripts/github_api.mts';
import { policy } from '../scripts/policy.mts';
import { buildReviewerContext, runGates } from '../scripts/prepare_review.mts';
import { aggregateVerdicts } from '../scripts/verdict.mts';
import { runClaudeCliVerdict } from './claude_cli.mts';

const CONCURRENCY = 4;
const REVIEW_TIMEOUT_MS = 600_000;

/**
 * Runs `worker` over every item with at most `poolSize` in flight. JS is single-threaded, so the
 * shared counters need no locking.
 * @template T
 * @param {T[]} items
 * @param {number} poolSize
 * @param {(item: T) => Promise<void>} worker
 */
async function forEachWithConcurrency(items, poolSize, worker) {
    let nextIndex = 0;
    const runners = Array.from({ length: Math.min(poolSize, items.length) }, async () => {
        while (nextIndex < items.length) {
            await worker(items[nextIndex++]);
        }
    });
    await Promise.all(runners);
}

const { values } = parseArgs({
    options: {
        repo: { type: 'string', default: process.env.GITHUB_REPOSITORY ?? 'apify/apify-core' },
        last: { type: 'string', default: '200' },
        output: { type: 'string' },
    },
});

const githubToken = process.env.GITHUB_TOKEN;
if (!githubToken) {
    console.error('GITHUB_TOKEN is required');
    process.exit(2);
}
const limit = Number(values.last);
if (!Number.isInteger(limit) || limit <= 0) {
    console.error('--last must be a positive integer');
    process.exit(2);
}

// Only PRs a human engineer could label: skip bots, the denied service accounts, and release PRs.
const isHumanPr = (/** @type {any} */ pull) =>
    pull.user?.type === 'User' &&
    !pull.user?.login?.includes('[bot]') &&
    !policy.authorGate.deniedUsers.includes(pull.user?.login) &&
    !pull.head?.ref?.startsWith('release/');

const { pulls, scanned } = await listRecentPullRequests(values.repo, {
    token: githubToken,
    limit,
    state: 'closed',
    filter: isHumanPr,
});
console.log(`Backtesting ${pulls.length} closed human PRs from ${values.repo} (scanned ${scanned}).`);

const outDir = join(tmpdir(), 'factory-approve-backtest');
mkdirSync(outDir, { recursive: true });
if (values.output) writeFileSync(values.output, '');

/** @type {Map<string, number>} */
const failureCounts = new Map();
/** @type {Map<string, number>} */
const llmCounts = new Map();
let staticPassCount = 0;
let completed = 0;

await forEachWithConcurrency(pulls, CONCURRENCY, async (pull) => {
    try {
        const { pr, files, gates } = await runGates({
            repo: values.repo,
            prNumber: pull.number,
            actor: null,
            backtest: true,
            policy,
            tokens: { github: githubToken, factory: process.env.FACTORY_GITHUB_TOKEN },
        });
        if (gates.staticPassed) staticPassCount += 1;
        for (const check of gates.staticChecks) {
            if (!check.pass) failureCounts.set(check.id, (failureCounts.get(check.id) ?? 0) + 1);
        }

        /** @type {{ verdict: string, reason: string } | null} */
        let llm = null;
        if (gates.staticPassed) {
            const prDir = join(outDir, `pr-${pull.number}`);
            mkdirSync(prDir, { recursive: true });
            try {
                // Same fetch-then-build as CI, so the backtest runs byte-identical prompts: N
                // independent reviewers, the second adversarial, unanimity required to approve.
                const { reviewerPrompts } = await buildReviewerContext({
                    repo: values.repo,
                    pr,
                    files,
                    headSha: gates.headSha,
                    outDir: prDir,
                    token: githubToken,
                    policy,
                });
                const runs = await Promise.all(
                    reviewerPrompts.map(async ({ verdictPath, prompt, model }) =>
                        runClaudeCliVerdict({
                            prompt,
                            verdictPath,
                            verdictDir: prDir,
                            policy,
                            model,
                            timeoutMs: REVIEW_TIMEOUT_MS,
                        }),
                    ),
                );
                llm = aggregateVerdicts(runs);
            } catch (error) {
                llm = { verdict: 'error', reason: errorMessage(error) };
            }
            llmCounts.set(llm.verdict, (llmCounts.get(llm.verdict) ?? 0) + 1);
        }

        const line = {
            prNumber: pull.number,
            title: pull.title,
            author: pull.user?.login,
            merged: Boolean(pull.merged_at),
            staticPassed: gates.staticPassed,
            failedChecks: gates.staticChecks.filter((check) => !check.pass).map((check) => check.id),
            ...(llm ? { llmVerdict: llm.verdict, llmReason: llm.reason } : {}),
        };
        if (values.output) appendFileSync(values.output, `${JSON.stringify(line)}\n`);
        completed += 1;
        console.log(
            `[${completed}/${pulls.length}] #${pull.number} ${gates.staticPassed ? 'gates-pass' : 'gates-fail'}` +
                `${llm ? ` → llm:${llm.verdict}` : ''} — ${pull.title}`,
        );
    } catch (error) {
        completed += 1;
        console.error(`[${completed}/${pulls.length}] #${pull.number} crashed: ${errorMessage(error)}`);
    }
});

console.log('\n=== Summary ===');
console.log(`PRs analyzed: ${completed}`);
console.log(
    `Passed static gates: ${staticPassCount} (${((staticPassCount / Math.max(completed, 1)) * 100).toFixed(1)}%)`,
);
const counts = ['approve', 'reject', 'error'].map((verdict) => `${verdict} ${llmCounts.get(verdict) ?? 0}`);
console.log(`LLM verdicts on gate-passing PRs: ${counts.join(', ')}`);
console.log('Gate failures by check:');
for (const [id, count] of [...failureCounts.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${id}: ${count}`);
}

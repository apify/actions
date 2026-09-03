// Runs the verdict prompt through the locally installed `claude` CLI. claude-code-action (the CI
// engine) wraps this same CLI, so backtests get the same model, prompt, tool surface, and verdict
// contract as CI. Same fail-closed semantics: no verdict file, an unparseable one, or a CLI failure
// all come back as `error`, which never counts as an approval.

import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';

import { errorMessage } from '../scripts/github_api.mts';
import type { Policy } from '../scripts/policy.mts';
import { parseVerdict, type ReviewerVerdict } from '../scripts/verdict.mts';

type RunProcess = (
    command: string,
    args: string[],
    options: { input: string; timeoutMs: number },
) => Promise<{ status?: number | null; error?: Error; stdout?: string }>;

const defaultRunProcess: RunProcess = async (command, args, { input, timeoutMs }) => {
    return new Promise((promiseResolve) => {
        let settled = false;
        let stdout = '';
        let timer: ReturnType<typeof setTimeout> | undefined;
        const settle = (result: { status?: number | null; error?: Error }) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            promiseResolve({ ...result, stdout });
        };
        const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'ignore'] });
        timer = setTimeout(() => {
            child.kill('SIGKILL');
            settle({ error: new Error(`timed out after ${timeoutMs} ms`) });
        }, timeoutMs);
        child.stdout?.on('data', (chunk) => {
            if (stdout.length < 10_000) stdout += chunk;
        });
        child.on('error', (error) => settle({ error }));
        child.on('close', (status) => settle({ status }));
        child.stdin?.on('error', () => {}); // Swallow EPIPE; error/close already settle the promise.
        child.stdin?.write(input);
        child.stdin?.end();
    });
};

export async function runClaudeCliVerdict({
    prompt,
    verdictPath,
    verdictDir,
    policy,
    model = policy.llm.reviewerModels[0],
    timeoutMs = 600_000,
    runProcess = defaultRunProcess,
}: {
    prompt: string;
    verdictPath: string;
    verdictDir: string;
    policy: Policy;
    model?: string;
    timeoutMs?: number;
    runProcess?: RunProcess;
}): Promise<ReviewerVerdict> {
    rmSync(verdictPath, { force: true });
    const absVerdictDir = resolvePath(verdictDir);
    const absVerdictPath = resolvePath(verdictPath);
    // --add-dir makes the out-of-workspace verdict dir reachable; the Edit() rule is scoped to this
    // reviewer's own verdict file; the doubled slash marks an absolute path. Edit() (not Write())
    // governs the Write tool — mirrors action.yaml so the backtest matches CI.
    const result = await runProcess(
        'claude',
        [
            '-p',
            '--model',
            model,
            '--max-turns',
            String(policy.llm.maxTurns),
            '--add-dir',
            absVerdictDir,
            '--allowedTools',
            `Read,Glob,Grep,Edit(/${absVerdictPath})`,
        ],
        { input: prompt, timeoutMs },
    );
    if (result.error) {
        return { verdict: 'error', reason: `claude CLI failed to run: ${errorMessage(result.error)}` };
    }
    if (!existsSync(verdictPath)) {
        const tail = (result.stdout ?? '').trim().slice(-200);
        return {
            verdict: 'error',
            reason: `claude produced no verdict file (exit ${result.status})${tail ? `; last output: ${tail}` : ''}`,
        };
    }
    try {
        return parseVerdict(readFileSync(verdictPath, 'utf-8'), policy);
    } catch (error) {
        return { verdict: 'error', reason: `invalid verdict file: ${errorMessage(error)}` };
    }
}

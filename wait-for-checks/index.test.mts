import { describe, expect, it, vi } from 'vitest';

import { main } from './index.mts';

type MainArgs = Parameters<typeof main>[0];

// The check runs API returns at most 30 runs per page by default, and a commit can have more.
const PAGE_SIZE = 30;

function makeCheckRuns(count: number, failingIndex?: number) {
    return Array.from({ length: count }, (_, i) => ({
        id: i,
        name: `Checks / Job ${i}`,
        status: 'completed',
        conclusion: i === failingIndex ? 'failure' : 'success',
    }));
}

function makeArgs(checkRuns: ReturnType<typeof makeCheckRuns>) {
    const github = {
        rest: {
            git: { getRef: vi.fn(async () => ({ data: { object: { sha: 'abc1234' } } })) },
            repos: {
                getCommit: vi.fn(async () => ({ data: { sha: 'abc1234', commit: { message: 'fix: something' }, parents: [] } })),
            },
            checks: {
                listForRef: vi.fn(async () => ({
                    data: { total_count: checkRuns.length, check_runs: checkRuns.slice(0, PAGE_SIZE) },
                })),
            },
        },
        paginate: vi.fn(async () => checkRuns),
    };
    const core = { info: vi.fn(), setFailed: vi.fn() };
    const args = {
        github,
        core,
        context: { repo: { owner: 'apify', repo: 'some-repo' } },
        env: { REF: 'master', CHECK_REGEXP: '^Checks', WAIT_INTERVAL: '0', ALLOWED_CONCLUSIONS: 'success,skipped', VERBOSE: 'false' },
    } as unknown as MainArgs;
    return { args, core };
}

describe('wait for checks action', () => {
    it('fails when a check run beyond the first page of results failed', async () => {
        const { args, core } = makeArgs(makeCheckRuns(PAGE_SIZE + 5, PAGE_SIZE + 2));

        await main(args);

        expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('Found: failure'));
    });

    it('passes when all check runs across pages succeeded', async () => {
        const { args, core } = makeArgs(makeCheckRuns(PAGE_SIZE + 5));

        await main(args);

        expect(core.setFailed).not.toHaveBeenCalled();
        expect(core.info).toHaveBeenCalledWith('🎉 All checks passed successfully!');
    });
});

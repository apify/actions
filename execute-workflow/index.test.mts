import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { main } from './index.mts';

type MainArgs = Parameters<typeof main>[0];

const notFound = Object.assign(new Error('Not Found'), { status: 404 });

function makeArgs(getWorkflowRun: () => Promise<unknown>) {
    const listWorkflowRuns = vi
        .fn()
        .mockResolvedValueOnce({ data: { workflow_runs: [] } })
        .mockResolvedValue({ data: { workflow_runs: [{ id: 1, status: 'queued', conclusion: null, html_url: 'url' }] } });
    const github = {
        rest: {
            actions: {
                listRepoWorkflows: { endpoint: { merge: vi.fn() } },
                listWorkflowRuns,
                getWorkflowRun: vi.fn(getWorkflowRun),
            },
        },
        paginate: vi.fn(async () => [{ id: 42, name: 'Release', path: '.github/workflows/release.yaml' }]),
        request: vi.fn(async () => ({})),
    };
    const core = { info: vi.fn(), warning: vi.fn(), setOutput: vi.fn(), setFailed: vi.fn() };
    const args = {
        github,
        core,
        context: { repo: { owner: 'apify', repo: 'some-repo' }, ref: 'refs/heads/master' },
        env: { WORKFLOW: 'release.yaml' },
    } as unknown as MainArgs;
    return { args, core, github };
}

describe('execute workflow action', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('keeps polling when fetching the run status fails transiently', async () => {
        const getWorkflowRun = vi
            .fn()
            .mockRejectedValueOnce(notFound)
            .mockResolvedValue({ data: { id: 1, status: 'completed', conclusion: 'success', html_url: 'url' } });
        const { args, core } = makeArgs(getWorkflowRun);

        const promise = main(args);
        await vi.runAllTimersAsync();
        await promise;

        expect(core.setFailed).not.toHaveBeenCalled();
        expect(core.setOutput).toHaveBeenCalledWith('conclusion', 'success');
    });

    it('fails when fetching the run status keeps failing', async () => {
        const { args, core, github } = makeArgs(async () => {
            throw notFound;
        });

        const promise = main(args);
        await vi.runAllTimersAsync();
        await promise;

        expect(core.setFailed).toHaveBeenCalledWith('Not Found');
        expect(github.rest.actions.getWorkflowRun).toHaveBeenCalledTimes(5);
    });
});

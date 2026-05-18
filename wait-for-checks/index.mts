import type * as Core from '@actions/core';
import { type context as Context, type getOctokit } from '@actions/github';

import * as PackageJSON from '../package.json' with { type: 'json' };

type Octokit = ReturnType<typeof getOctokit>;

type CheckRun = {
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
};

type Commit = {
    sha: string;
    commit: {
        message: string;
    };
    parents: { sha: string }[];
};

const SKIP_CI_PATTERNS = ['[skip ci]', '[ci skip]', '[no ci]', '[skip actions]', '[actions skip]'];
const MAX_PARENT_TRAVERSAL = 100;

function hasSkipCI(message: string): boolean {
    const lowerMessage = message.toLowerCase();
    return SKIP_CI_PATTERNS.some((pattern) => lowerMessage.includes(pattern.toLowerCase()));
}

async function resolveRefToSHA(github: Octokit, owner: string, repo: string, ref: string): Promise<string> {
    try {
        const { data } = await github.rest.git.getRef({
            owner,
            repo,
            ref: ref.replace(/^refs\//, ''),
        });
        return data.object.sha;
    } catch {
        return ref;
    }
}

async function getCommit(github: Octokit, owner: string, repo: string, sha: string): Promise<Commit> {
    const { data } = await github.rest.repos.getCommit({
        owner,
        repo,
        ref: sha,
    });
    return data as Commit;
}

async function findCommitWithoutSkipCI(
    github: Octokit,
    core: typeof Core,
    owner: string,
    repo: string,
    initialSHA: string,
    verbose: boolean,
): Promise<string> {
    let currentSHA = initialSHA;
    let depth = 0;

    while (depth < MAX_PARENT_TRAVERSAL) {
        const commit = await getCommit(github, owner, repo, currentSHA);

        if (verbose) {
            core.info(`🔍 Checking commit ${currentSHA.substring(0, 7)}: ${commit.commit.message.split('\n')[0]}`);
        }

        if (!hasSkipCI(commit.commit.message)) {
            if (currentSHA !== initialSHA) {
                core.info(`✅ Found commit without [skip ci]: ${currentSHA.substring(0, 7)}`);
            }
            return currentSHA;
        }

        if (commit.parents.length > 1) {
            throw new Error(
                `Commit ${currentSHA.substring(0, 7)} is a merge commit with [skip ci]. Cannot determine which parent to follow.`,
            );
        }

        if (commit.parents.length === 0) {
            throw new Error(
                `Reached root commit ${currentSHA.substring(0, 7)} which has [skip ci]. No commits without [skip ci] found.`,
            );
        }

        const parentSHA = commit.parents[0].sha;
        core.info(
            `⚠️  Commit ${currentSHA.substring(0, 7)} has [skip ci], checking parent ${parentSHA.substring(0, 7)}...`,
        );
        currentSHA = parentSHA;
        depth++;
    }

    throw new Error(`Traversed ${MAX_PARENT_TRAVERSAL} commits without finding one without [skip ci]. Giving up.`);
}

export async function main({ github, context, core }: { github: Octokit; context: typeof Context; core: typeof Core }) {
    core.info(`🔍 Wait for Checks Action v${PackageJSON.version}`);
    try {
        const checkName = core.getInput('check-name');
        const checkRegexp = core.getInput('check-regexp');
        const ref = core.getInput('ref');
        const waitInterval = parseInt(core.getInput('wait-interval'), 10);
        const runningWorkflowName = core.getInput('running-workflow-name');
        const allowedConclusionsInput = core.getInput('allowed-conclusions');
        const ignoreChecksInput = core.getInput('ignore-checks');
        const verbose = core.getInput('verbose') === 'true';

        const allowedConclusions = allowedConclusionsInput.split(',').map((c) => c.trim());
        const ignoreChecks = ignoreChecksInput
            .split(',')
            .map((c) => c.trim())
            .filter((c) => c.length > 0);

        const { owner, repo } = context.repo;

        core.info(`📍 Resolving ref: ${ref}`);
        const initialSHA = await resolveRefToSHA(github, owner, repo, ref);
        const targetSHA = await findCommitWithoutSkipCI(github, core, owner, repo, initialSHA, verbose);

        if (targetSHA !== initialSHA) {
            core.info(`🔄 Using commit ${targetSHA.substring(0, 7)} instead of ${initialSHA.substring(0, 7)}`);
        }

        const logChecks = (checks: CheckRun[], message: string): void => {
            if (!verbose) return;

            core.info(message);
            const statuses = [...new Set(checks.map((c) => c.status))];
            statuses.forEach((status) => {
                const statusChecks = checks.filter((c) => c.status === status);
                core.info(`  Checks ${status}: ${statusChecks.map((c) => c.name).join(', ')}`);
            });
        };

        const queryCheckStatus = async (): Promise<CheckRun[]> => {
            const response = await github.rest.checks.listForRef({
                owner,
                repo,
                ref: targetSHA,
            });

            let checks = response.data.check_runs as CheckRun[];
            logChecks(checks, 'Checks running on ref:');

            const filtersToIgnore = [...ignoreChecks];
            if (runningWorkflowName) {
                filtersToIgnore.push(runningWorkflowName);
            }

            checks = checks.filter((check) => !filtersToIgnore.includes(check.name));
            logChecks(checks, 'Checks after ignore checks filter:');

            if (checkName) {
                checks = checks.filter((check) => check.name === checkName);
                logChecks(checks, 'Checks after check-name filter:');
            }

            if (checkRegexp) {
                const regexp = new RegExp(checkRegexp);
                checks = checks.filter((check) => regexp.test(check.name));
                logChecks(checks, 'Checks after regexp filter:');
            }

            return checks;
        };

        const allChecksComplete = (checks: CheckRun[]): boolean => {
            return checks.every((check) => check.status === 'completed');
        };

        const checkConclusionAllowed = (check: CheckRun): boolean => {
            return check.conclusion !== null && allowedConclusions.includes(check.conclusion);
        };

        let checks = await queryCheckStatus();

        const filtersPresent = checkName.length > 0 || checkRegexp.length > 0;
        if (filtersPresent && checks.length === 0) {
            throw new Error('The requested check was never run against this ref, exiting...');
        }

        while (!allChecksComplete(checks)) {
            const plural = checks.length > 1 ? "checks aren't" : "check isn't";
            core.info(`⏳ The requested ${plural} complete yet, will check back in ${waitInterval} seconds...`);
            await new Promise((resolve) => setTimeout(resolve, waitInterval * 1000));
            checks = await queryCheckStatus();
        }

        core.info('✅ Checks completed:');
        checks.forEach((check) => {
            core.info(`  ${check.name}: ${check.status} (${check.conclusion})`);
        });

        const failedChecks = checks.filter((check) => !checkConclusionAllowed(check));
        if (failedChecks.length > 0) {
            const conclusions = failedChecks.map((c) => c.conclusion).join(', ');
            throw new Error(
                `The conclusion of one or more checks were not allowed. Found: ${conclusions}. ` +
                    `Allowed conclusions are: ${allowedConclusions.join(', ')}. ` +
                    `This can be configured with the 'allowed-conclusions' param.`,
            );
        }

        core.info('🎉 All checks passed successfully!');
    } catch (error) {
        const e = error as Error;
        core.setFailed(e.message);
    }
}

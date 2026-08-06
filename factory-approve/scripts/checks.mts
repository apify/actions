// Static checks for the factory-approve pipeline, run before any LLM step. Checks only ever REJECT
// (nothing here can approve), a check that throws counts as failed (fail closed), and all checks
// run even after one fails so the author sees every problem at once.

import { errorMessage } from './github_api.mts';
import { matchingGlob } from './glob_match.mts';
import type { Policy } from './policy.mts';

export type CheckContext = {
    policy: Policy;
    pr: any;
    files: any[];
    actor: string | null; // triggering user; null in backtest mode (no actor to verify)
    backtest: boolean; // when true, live-PR-only checks (open/ready, mergeable) are skipped
    isAllowedUser: AllowedUserResolver;
};

export type CheckResult = { id: string; description: string; pass: boolean; details: string };

export type AllowedUserResolver = (username: string) => Promise<{ allowed: boolean; via: string }>;

type CheckOutcome = { pass: boolean; details: string };

// True when the PR currently carries the given label. The label is the standing opt-in for the
// pipeline: presence is re-checked from the live PR on every run (not from the triggering event),
// so a removal is honored even when it raced with an in-flight run.
export function hasLabel(pr: any, label: string): boolean {
    return ((pr?.labels ?? []) as any[]).some((entry) => entry?.name === label);
}

// Added lines of a unified diff, without the leading `+`. The diff file header is `+++ ` (trailing
// space) — an added line whose own content starts with `++` (e.g. `++counter`) must still be scanned.
export function addedLines(patch: string): string[] {
    return patch
        .split('\n')
        .filter((line) => line.startsWith('+') && !line.startsWith('+++ '))
        .map((line) => line.slice(1));
}

export const staticChecks: {
    id: string;
    description: string;
    run: (ctx: CheckContext) => CheckOutcome | Promise<CheckOutcome>;
}[] = [
    {
        id: 'author-is-human',
        description: 'PR author is a human user account',
        run({ pr }) {
            const login = pr.user?.login ?? '';
            const pass = pr.user?.type === 'User' && !login.includes('[bot]');
            return { pass, details: pass ? `author is ${login}` : `author ${login} is not a human user` };
        },
    },
    {
        id: 'author-allowed',
        description: 'PR author is an allowed engineer',
        async run({ pr, isAllowedUser }) {
            const login = pr.user?.login ?? '';
            const { allowed, via } = await isAllowedUser(login);
            return { pass: allowed, details: `${login}: ${via}` };
        },
    },
    {
        id: 'actor-allowed',
        description: 'Triggering user (labeler/pusher) is an allowed engineer',
        async run({ actor, isAllowedUser }) {
            if (actor === null) return { pass: true, details: 'no triggering actor (backtest mode)' };
            const { allowed, via } = await isAllowedUser(actor);
            return { pass: allowed, details: `${actor}: ${via}` };
        },
    },
    {
        id: 'pr-open-and-ready',
        description: 'PR is open, not a draft, and not merged',
        run({ pr, backtest }) {
            if (backtest) return { pass: true, details: 'skipped (backtest mode)' };
            const problems: string[] = [];
            if (pr.state !== 'open') problems.push(`state is ${pr.state}`);
            if (pr.draft) problems.push('PR is a draft');
            if (pr.merged) problems.push('PR is already merged');
            return { pass: problems.length === 0, details: problems.join('; ') || 'open and ready' };
        },
    },
    {
        id: 'same-repo',
        description: 'PR head branch lives in this repository (no forks)',
        run({ pr }) {
            const pass = pr.head?.repo?.full_name === pr.base?.repo?.full_name;
            return { pass, details: pass ? 'head and base repos match' : `head repo is ${pr.head?.repo?.full_name}` };
        },
    },
    {
        id: 'base-branch',
        description: 'PR targets the allowed base branch',
        run({ pr, policy }) {
            const pass = pr.base?.ref === policy.baseBranch;
            return { pass, details: `base is ${pr.base?.ref}, required ${policy.baseBranch}` };
        },
    },
    {
        id: 'mergeable',
        description: 'PR has no merge conflicts',
        run({ pr, backtest }) {
            if (backtest) return { pass: true, details: 'skipped (backtest mode)' };
            if (pr.mergeable === true) return { pass: true, details: 'mergeable' };
            const details =
                pr.mergeable === false
                    ? 'PR has merge conflicts'
                    : 'GitHub has not finished computing mergeability; re-add the label to retry';
            return { pass: false, details };
        },
    },
    {
        id: 'max-files',
        description: 'Number of changed files is within the limit',
        run({ pr, policy }) {
            const pass = pr.changed_files <= policy.maxChangedFiles;
            return { pass, details: `${pr.changed_files} changed files, limit ${policy.maxChangedFiles}` };
        },
    },
    {
        id: 'max-lines',
        description: 'Total changed lines are within the limit',
        run({ pr, policy }) {
            const total = pr.additions + pr.deletions;
            const pass = total <= policy.maxChangedLines;
            return {
                pass,
                details: `${total} changed lines (+${pr.additions}/-${pr.deletions}), limit ${policy.maxChangedLines}`,
            };
        },
    },
    {
        id: 'file-statuses',
        description: 'Only allowed file operations (modifications, or added test files)',
        run({ files, policy }) {
            const offending = files.filter((file) => {
                if (policy.allowedFileStatuses.includes(file.status)) return false;
                if (file.status === 'added' && matchingGlob(file.filename, policy.allowedAddedFileGlobs)) return false;
                return true;
            });
            return {
                pass: offending.length === 0,
                details: offending.length
                    ? offending.map((file) => `${file.filename} is ${file.status}`).join('; ')
                    : 'all files are modifications or added tests',
            };
        },
    },
    {
        id: 'file-extensions',
        description: 'Only allowed file extensions',
        run({ files, policy }) {
            const offending = files.filter(
                (file) => !policy.allowedExtensions.some((ext) => file.filename.endsWith(ext)),
            );
            return {
                pass: offending.length === 0,
                details: offending.length
                    ? `disallowed extension: ${offending.map((file) => file.filename).join(', ')}`
                    : `all files match ${policy.allowedExtensions.join(', ')}`,
            };
        },
    },
    {
        id: 'deny-globs',
        description: 'No file matches a denied path pattern',
        run({ files, policy }) {
            const offending: string[] = [];
            for (const file of files) {
                for (const path of [file.filename, file.previous_filename].filter(Boolean)) {
                    const glob = matchingGlob(path, policy.denyGlobs);
                    if (glob) offending.push(`${path} matches ${glob}`);
                }
            }
            return { pass: offending.length === 0, details: offending.join('; ') || 'no denied paths' };
        },
    },
    {
        id: 'patch-present',
        description: 'Every changed file has a reviewable text diff',
        run({ files }) {
            const offending = files.filter((file) => typeof file.patch !== 'string' || file.patch.length === 0);
            return {
                pass: offending.length === 0,
                details: offending.length
                    ? `no text diff for ${offending.map((file) => file.filename).join(', ')}`
                    : 'all diffs available',
            };
        },
    },
    {
        id: 'no-risky-content',
        description: 'Added lines contain no risky patterns',
        run({ files, policy }) {
            const offending: string[] = [];
            for (const file of files) {
                if (typeof file.patch !== 'string') continue;
                for (const line of addedLines(file.patch)) {
                    for (const pattern of policy.riskyContentPatterns) {
                        if (pattern.regex.test(line)) {
                            offending.push(`${file.filename}: ${pattern.description} (${pattern.id})`);
                        }
                    }
                }
            }
            return { pass: offending.length === 0, details: [...new Set(offending)].join('; ') || 'no risky content' };
        },
    },
    {
        id: 'pr-title',
        description: 'PR title is a Conventional Commit (scope optional) with no breaking marker',
        run({ pr, policy }) {
            const title = pr.title ?? '';
            if (/^[^:]*!:/.test(title)) {
                return { pass: false, details: 'breaking changes are never auto-approved' };
            }
            const pass = policy.prTitleRegex.test(title);
            return {
                pass,
                details: pass ? 'title matches convention' : `title "${title}" must match type(scope): message`,
            };
        },
    },
];

// Runs every check, never short-circuiting, converting thrown errors into failures.
export async function runStaticChecks(ctx: CheckContext): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    for (const check of staticChecks) {
        try {
            const { pass, details } = await check.run(ctx);
            results.push({ id: check.id, description: check.description, pass, details });
        } catch (error) {
            results.push({
                id: check.id,
                description: check.description,
                pass: false,
                details: `check crashed (fails closed): ${errorMessage(error)}`,
            });
        }
    }
    return results;
}

// Engineer-gate resolver used by the `author-allowed` and `actor-allowed` checks, memoized per
// username. Fails closed: when team membership cannot be verified (missing token, API error) and
// the user is not in `extraUsers`, the user is not allowed.
export function createAllowedUserResolver(
    policy: Policy,
    {
        teamToken,
        isActiveTeamMember,
    }: {
        teamToken?: string;
        isActiveTeamMember: (org: string, team: string, username: string, token: string) => Promise<boolean>;
    },
): AllowedUserResolver {
    const cache = new Map<string, Promise<{ allowed: boolean; via: string }>>();
    const { org, teamSlugs, extraUsers, deniedUsers } = policy.authorGate;

    return async (username) => {
        const cached = cache.get(username);
        if (cached) return cached;

        const result = (async () => {
            if (!username) return { allowed: false, via: 'empty username' };
            if (deniedUsers.includes(username)) return { allowed: false, via: 'explicitly denied' };
            if (extraUsers.includes(username)) return { allowed: true, via: 'extraUsers allowlist' };
            if (!teamToken) {
                return { allowed: false, via: 'no team token available to check membership' };
            }
            for (const teamSlug of teamSlugs) {
                if (await isActiveTeamMember(org, teamSlug, username, teamToken)) {
                    return { allowed: true, via: `member of ${org}/${teamSlug}` };
                }
            }
            return { allowed: false, via: `not a member of ${teamSlugs.map((slug) => `${org}/${slug}`).join(', ')}` };
        })();

        cache.set(username, result);
        return result;
    };
}

import * as fs from 'node:fs/promises';

import type * as Core from '@actions/core';
import type { context as Context } from '@actions/github';
import type { Octokit } from '@octokit/rest';

type GHContext = typeof Context;

const MONGO_METHODS = [
    'find',
    'findOne',
    'findOneAndUpdate',
    'findOneAndDelete',
    'findOneAndReplace',
    'aggregate',
    'countDocuments',
    'estimatedDocumentCount',
    'distinct',
    'watch',
    'updateOne',
    'updateMany',
    'deleteOne',
    'deleteMany',
    'replaceOne',
    'bulkWrite',
];

// Methods invoked on a MongoDB collection that justify an index review. We can't reliably distinguish
// `Users.findOne(...)` from `array.find(x => …)` via a regex alone, so the pre-filter is intentionally
// permissive — any `.method(` in the added lines triggers Claude, which then disambiguates by looking at
// the receiver in the surrounding code.
const MONGO_METHOD_REGEX = new RegExp(String.raw`\.(?:${MONGO_METHODS.join('|')})\s*\(`);

export function parseGlobs(input: string): string[] {
    return input
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

// Translate a path-segment glob (`**`, `*`, `?`) to an anchored RegExp. `**/` collapses to zero-or-more
// path segments so `**/*.ts` matches both `a.ts` and `a/b/c.ts`.
export function globToRegex(pattern: string): RegExp {
    let out = '';
    let i = 0;
    while (i < pattern.length) {
        const c = pattern[i]!;
        if (c === '*' && pattern[i + 1] === '*') {
            if (pattern[i + 2] === '/') {
                out += '(?:.*/)?';
                i += 3;
            } else {
                out += '.*';
                i += 2;
            }
        } else if (c === '*') {
            out += '[^/]*';
            i += 1;
        } else if (c === '?') {
            out += '[^/]';
            i += 1;
        } else if (/[.+^${}()|[\]\\]/.test(c)) {
            out += `\\${c}`;
            i += 1;
        } else {
            out += c;
            i += 1;
        }
    }
    return new RegExp(`^${out}$`);
}

export function matchesAny(filename: string, patterns: RegExp[]): boolean {
    return patterns.some((re) => re.test(filename));
}

// Return the after-state content of every hunk in `patch` that contains at least one addition.
// This includes both `+` lines (the additions themselves) and ` ` context lines from those hunks,
// so a query whose `.findOne(` call sits on an unchanged line gets scanned when a filter field
// is added inside its argument object. Hunks that only contain `-` deletions are skipped — there's
// no after-state query to review.
export function extractAfterStateOfChangedHunks(patch: string): string {
    if (!patch) return '';
    const hunks: { lines: string[]; hasAddition: boolean }[] = [];
    let current: { lines: string[]; hasAddition: boolean } | null = null;
    for (const line of patch.split('\n')) {
        if (line.startsWith('@@')) {
            current = { lines: [], hasAddition: false };
            hunks.push(current);
            continue;
        }
        if (!current) continue;
        if (line.startsWith('+++') || line.startsWith('---')) continue;
        if (line.startsWith('-')) continue;
        if (line.startsWith('+')) {
            current.hasAddition = true;
            current.lines.push(line.slice(1));
        } else if (line.startsWith(' ')) {
            current.lines.push(line.slice(1));
        }
    }
    return hunks
        .filter((h) => h.hasAddition)
        .flatMap((h) => h.lines)
        .join('\n');
}

export function hasMongoCallInDiff(patch: string): boolean {
    if (!patch) return false;
    return MONGO_METHOD_REGEX.test(extractAfterStateOfChangedHunks(patch));
}

interface PreCheckEnv {
    INPUT_PATHS?: string;
    INPUT_PATHS_IGNORE?: string;
    OUTPUT_CHANGED_FILES_PATH?: string;
}

interface PreCheckArgs {
    github: Octokit;
    context: GHContext;
    core: typeof Core;
    env: PreCheckEnv;
}

export async function preCheck({ github, context, core, env }: PreCheckArgs): Promise<void> {
    const pr = context.payload.pull_request;
    if (!pr) {
        core.setFailed('No pull_request payload found in the event. This action only runs on pull_request events.');
        return;
    }

    const includes = parseGlobs(env.INPUT_PATHS ?? '').map(globToRegex);
    const excludes = parseGlobs(env.INPUT_PATHS_IGNORE ?? '').map(globToRegex);
    const outputPath = env.OUTPUT_CHANGED_FILES_PATH;
    if (!outputPath) {
        core.setFailed('OUTPUT_CHANGED_FILES_PATH env var is missing.');
        return;
    }

    const { owner, repo } = context.repo;
    const matched: string[] = [];
    let mongoTouched = false;

    for await (const response of github.paginate.iterator(github.rest.pulls.listFiles, {
        owner,
        repo,
        pull_number: pr.number,
        per_page: 100,
    })) {
        for (const file of response.data) {
            if (file.status === 'removed') continue;
            if (includes.length > 0 && !matchesAny(file.filename, includes)) continue;
            if (excludes.length > 0 && matchesAny(file.filename, excludes)) continue;
            matched.push(file.filename);
            if (!mongoTouched && hasMongoCallInDiff(file.patch ?? '')) {
                mongoTouched = true;
            }
        }
    }

    await fs.writeFile(outputPath, JSON.stringify(matched, null, 2), 'utf8');
    core.setOutput('changed-files', JSON.stringify(matched));

    if (matched.length === 0) {
        core.info('No changed source files matched the paths filter; skipping MongoDB index review.');
        core.setOutput('should-run', 'false');
        return;
    }
    if (!mongoTouched) {
        core.info(
            `Found ${matched.length} changed file(s) but none added MongoDB collection calls; skipping review.`,
        );
        core.setOutput('should-run', 'false');
        return;
    }

    core.info(`MongoDB-related changes detected in ${matched.length} file(s); will run Claude review.`);
    core.setOutput('should-run', 'true');
}

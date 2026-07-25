// Materializes the POST-change version of every changed file into `<outDir>/head_files/` so the
// reviewer can Read complete files instead of judging from diff hunks alone. Contents are fetched
// through the GitHub API as data — the PR is never checked out — and the prompt declares them untrusted.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

import { getFileContentAtRef } from './github_api.mts';

const MAX_FILE_CHARS = 200_000;

export type HeadFiles = { headFilesDir: string; written: string[]; omitted: string[] };

export async function writeHeadFiles({
    repo,
    files,
    headSha,
    outDir,
    token,
    getContent = getFileContentAtRef,
}: {
    repo: string;
    files: any[];
    headSha: string;
    outDir: string;
    token: string;
    getContent?: typeof getFileContentAtRef;
}): Promise<HeadFiles> {
    const headFilesDir = join(outDir, 'head_files');
    mkdirSync(headFilesDir, { recursive: true });
    const written: string[] = [];
    const omitted: string[] = [];

    for (const file of files) {
        const filename = String(file.filename ?? '');
        // Guard the filesystem write against traversal (e.g. `../`) regardless of what the API returned.
        const target = resolve(headFilesDir, filename);
        if (!target.startsWith(resolve(headFilesDir) + sep)) {
            omitted.push(filename);
            continue;
        }
        const content = await getContent(repo, filename, headSha, token);
        if (content === null || content.length > MAX_FILE_CHARS) {
            omitted.push(filename);
            continue;
        }
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, content);
        written.push(filename);
    }
    return { headFilesDir, written, omitted };
}

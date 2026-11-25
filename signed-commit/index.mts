import * as util from 'node:util';
import * as childProcess from 'node:child_process';
import * as fs from 'node:fs/promises';

import type * as Core from '@actions/core';
import type { getOctokit } from '@actions/github';

type Octokit = ReturnType<typeof getOctokit>;

const exec = util.promisify(childProcess.exec);

// The other statuses are ignored:
//   C: should not be produced, as we're using --no-renames,
//   R: same as C,
//   T: file type change (symlink, git submodule) -> this cannot be committed through the API,
//   U: merge conflict,
//   X: unknown - git bug.
export const FILE_STATUS = { ADDED: 'A', DELETED: 'D', MODIFIED: 'M' } as const;

type FileChanges = {
    additions: { path: string; contents: string; }[];
    deletions: { path: string; }[];
};

// Git file modes of the added and modified files, as octal strings (e.g. "100644"), keyed by path.
type FileModes = Record<string, string>;

type GitFileStatus = {
    // octal numbers
    modeBefore: number;
    modeAfter: number;

    shaBefore: string;
    shaAfter: string;
    fileStatus: string;
    filePath: string;
};

const MODE_RW = 0o100644;

// Some repositories use this action to commit a lot of files,
// so the `git diff-index` output is larger than the default 1 MB buffer of `child_process.exec()`.
// We need to increase the buffer size.
const MAX_BUFFER_SIZE = 50 * 1024 * 1024; // 50 MB

/**
 * Since the GitHub API only supports committing file contents, there is no way to specify executable files.
 * This function checks whether the staging area contains only files with valid (rw-r--r--) mode.
 *
 * NOTE: git does not store the actual POSIX file modes. It only stores an executable flag. (for regular files)
 */
export function checkSupportedFileModes(status: GitFileStatus) {
    if (status.fileStatus === FILE_STATUS.ADDED && status.modeAfter !== MODE_RW) {
        throw new Error(`Detected unsupported file mode "${status.modeAfter.toString(8)}": "${status.filePath}". The GitHub API does not provide a way to define custom file modes.`);
    }

    if (status.fileStatus === FILE_STATUS.MODIFIED && status.modeBefore !== status.modeAfter) {
        throw new Error(`Detected file mode change "${status.modeBefore.toString(8)}" -> "${status.modeAfter.toString(8)}": "${status.filePath}". The GitHub API does not provide a way to define custom file modes.`);
    }
}

/**
 * Produces the list of staged files for committing.
 */
export async function status(options: Omit<childProcess.ExecOptions, 'encoding'> = {}): Promise<GitFileStatus[]> {
    const cmd = [
        'git',
        'diff-index',
        '--cached',      // only from the staging area (added files)
        '--no-renames',  // do not track file renames (copy/move) - we only need added / removed
        'HEAD',
    ];

    const stagedFileStatuses = (await exec(cmd.join(' '), { encoding: 'utf8', maxBuffer: MAX_BUFFER_SIZE, ...options })).stdout.trim();

    // see: man git-diff-index(1) - section RAW OUTPUT FORMAT
    return stagedFileStatuses.split('\n')
        .map((line) => {
            const tabSplit = line.split('\t');
            if (tabSplit.length !== 2) {
                return null;
            }

            const [info, filePath] = tabSplit;
            const [modeBefore, modeAfter, shaBefore, shaAfter, fileStatus] = info.split(' ');

            return {
                modeBefore: parseInt(modeBefore.slice(1), 8),
                modeAfter: parseInt(modeAfter, 8),
                shaBefore,
                shaAfter,
                fileStatus,
                filePath,
            };
        })
        .filter((it) => !!it);
}

async function collectFileChanges(): Promise<{ fileChanges: FileChanges; fileModes: FileModes }> {
    const fileChanges: FileChanges = { additions: [], deletions: [] };
    const fileModes: FileModes = {};
    const stagedFiles = await status();

    for (const file of stagedFiles) {
        checkSupportedFileModes(file);
        const { filePath, fileStatus } = file;

        switch (fileStatus) {
            case FILE_STATUS.ADDED:
            case FILE_STATUS.MODIFIED:
                fileChanges.additions.push({
                    path: filePath,
                    contents: await fs.readFile(filePath, { encoding: 'base64' }),
                });
                fileModes[filePath] = file.modeAfter.toString(8);

                break;

            case FILE_STATUS.DELETED:
                fileChanges.deletions.push({ path: filePath });
                break;

            default:
                throw new Error(`unexpected file status "${fileStatus}"`);
        }
    }

    return { fileChanges, fileModes };
}

const RETRY_BASE_DELAY_MS = 1000;

// Each tree request of the Git Data API carries at most this much file content.
// A single GraphQL request with all the files times out (HTTP 504) for commits of tens of MB.
export const MAX_TREE_REQUEST_BYTES = 4 * 1024 * 1024;

type CreateCommitArgs = {
    github: Octokit;
    repo: string;
    branch: string;
    expectedHeadOid: string;
    messageTitle: string;
    messageBody: string;
    fileChanges: FileChanges;
};

async function createCommit({ github, repo, branch, expectedHeadOid, messageTitle, messageBody, fileChanges }: CreateCommitArgs): Promise<string> {
    const response = await github.graphql(`\
        mutation Commit($input: CreateCommitOnBranchInput!) {
            createCommitOnBranch(input: $input) {
                commit {
                    oid
                }
            }
        }
    `, {
        input: {
            fileChanges,
            branch: {
                branchName: branch,
                repositoryNameWithOwner: repo,
            },
            expectedHeadOid,
            message: {
                headline: messageTitle,
                body: messageBody,
            },
        },
    }) as any;

    return response.createCommitOnBranch.commit.oid;
}

type GitTreeEntry = {
    path: string;
    mode: '100644' | '100755' | '040000' | '160000' | '120000';
    type: 'blob';
    sha?: string | null;
    content?: string;
};

function decodeUtf8(base64Contents: string): string | null {
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(base64Contents, 'base64'));
    } catch {
        return null;
    }
}

/**
 * Splits tree entries into groups whose inline file content stays under `MAX_TREE_REQUEST_BYTES`.
 * An entry bigger than the limit gets a group of its own.
 */
function chunkTreeEntries(entries: GitTreeEntry[]): GitTreeEntry[][] {
    const chunks: GitTreeEntry[][] = [];
    let currentChunk: GitTreeEntry[] = [];
    let currentChunkBytes = 0;

    for (const entry of entries) {
        const entryBytes = Buffer.byteLength(entry.content ?? '');
        if (currentChunk.length > 0 && currentChunkBytes + entryBytes > MAX_TREE_REQUEST_BYTES) {
            chunks.push(currentChunk);
            currentChunk = [];
            currentChunkBytes = 0;
        }
        currentChunk.push(entry);
        currentChunkBytes += entryBytes;
    }
    if (currentChunk.length > 0) chunks.push(currentChunk);

    return chunks;
}

/**
 * Creates the commit through the REST Git Data API in several smaller requests, so it works for large commits.
 * Text files are sent inline in tree requests of at most `MAX_TREE_REQUEST_BYTES`, each building on the previous tree.
 * Other files are uploaded as blobs. GitHub signs the commit when the token belongs to a GitHub App
 * (e.g. `GITHUB_TOKEN` or an app installation token). If the commit isn't signed, the branch is left untouched.
 * The branch is only fast-forwarded, so it fails if the branch moved since `expectedHeadOid`.
 */
async function createCommitWithGitDataApi(
    { github, repo, branch, expectedHeadOid, messageTitle, messageBody, fileChanges, fileModes }: CreateCommitArgs & { fileModes: FileModes },
): Promise<string> {
    const [owner, repoName] = repo.split('/');
    const repoParams = { owner, repo: repoName };

    const additionEntries: GitTreeEntry[] = [];
    for (const { path, contents } of fileChanges.additions) {
        const mode = (fileModes[path] ?? '100644') as GitTreeEntry['mode'];
        const textContent = decodeUtf8(contents);
        if (textContent !== null) {
            additionEntries.push({ path, mode, type: 'blob', content: textContent });
            continue;
        }
        const { data: blob } = await github.rest.git.createBlob({ ...repoParams, content: contents, encoding: 'base64' });
        additionEntries.push({ path, mode, type: 'blob', sha: blob.sha });
    }
    const deletionEntries: GitTreeEntry[] = fileChanges.deletions.map(({ path }) => ({ path, mode: '100644', type: 'blob', sha: null }));

    const { data: headCommit } = await github.rest.git.getCommit({ ...repoParams, commit_sha: expectedHeadOid });
    let treeSha = headCommit.tree.sha;
    for (const entries of chunkTreeEntries([...additionEntries, ...deletionEntries])) {
        const { data: tree } = await github.rest.git.createTree({ ...repoParams, base_tree: treeSha, tree: entries });
        treeSha = tree.sha;
    }

    const message = messageBody ? `${messageTitle}\n\n${messageBody}` : messageTitle;
    const { data: commit } = await github.rest.git.createCommit({ ...repoParams, message, tree: treeSha, parents: [expectedHeadOid] });
    if (!commit.verification?.verified) {
        throw new Error(`The commit "${commit.sha}" is not signed (verification reason: "${commit.verification?.reason}"), so "${branch}" was not updated. `
            + 'GitHub only signs commits created through the Git Data API with a GitHub App token, such as GITHUB_TOKEN or an app installation token.');
    }

    await github.rest.git.updateRef({ ...repoParams, ref: `heads/${branch}`, sha: commit.sha, force: false });
    return commit.sha;
}

export async function main({ github, env, core }: { github: Octokit, env: Record<string, string>, core: typeof Core }) {
    const {
        COMMIT_MESSAGE,
        REPO,
        BRANCH,
        ADD = '',
        PULL = '',
        RETRIES = '0',
        USE_GIT_DATA_API = 'false',
    } = env;

    const retries = parseInt(RETRIES, 10);
    if (Number.isNaN(retries) || retries < 0) {
        throw new Error(`'retries' must be a non-negative integer, got "${RETRIES}"`);
    }
    if (retries > 0 && PULL === '') {
        throw new Error(`'retries' is set to ${retries} but 'pull' is empty — retrying requires 'pull' to be set so the action can fetch the new HEAD between attempts.`);
    }

    const commitMessageLines = COMMIT_MESSAGE.split('\n');
    const messageTitle = commitMessageLines[0];
    const messageBody = commitMessageLines.slice(1).join('\n').trim();

    const maxAttempts = retries + 1;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (PULL !== '') {
            const pullCmd = PULL === 'true' ? 'git pull' : `git pull ${PULL}`;
            core.info(`Executing "${pullCmd}" before committing (attempt ${attempt}/${maxAttempts})`);
            const { stdout, stderr } = await exec(pullCmd, { encoding: 'utf8', maxBuffer: MAX_BUFFER_SIZE });
            core.debug(`pull stdout: ${stdout}`);
            core.debug(`pull stderr: ${stderr}`);

            // Check if there are any merge conflicts after the pull.
            const unmerged = (await exec('git ls-files --unmerged', { encoding: 'utf8', maxBuffer: MAX_BUFFER_SIZE })).stdout.trim();
            if (unmerged !== '') {
                throw new Error(`"${pullCmd}" left unmerged paths in the index — refusing to commit files with merge conflicts:\n${unmerged}`);
            }
        }

        if (ADD !== '') {
            await exec(`git add ${ADD}`, { encoding: 'utf8', maxBuffer: MAX_BUFFER_SIZE });
        }

        const expectedHeadOid = (await exec('git rev-parse HEAD', { encoding: 'utf8' })).stdout.trim();
        const { fileChanges, fileModes } = await collectFileChanges();

        // Only log file paths not the base64 encoded file contents.
        const changedPaths = {
            additions: fileChanges.additions.map(({ path }) => path),
            deletions: fileChanges.deletions.map(({ path }) => path),
        };
        core.info(`committing file changes: "${JSON.stringify(changedPaths, null, 4)}"`);

        if (fileChanges.additions.length === 0 && fileChanges.deletions.length === 0) {
            core.info('no staged changes — skipping commit');
            core.setOutput('committed', 'false');
            core.setOutput('commit_sha', expectedHeadOid.slice(0, 7));
            core.setOutput('commit_long_sha', expectedHeadOid);
            return;
        }

        try {
            const commitArgs = {
                github,
                repo: REPO,
                branch: BRANCH,
                expectedHeadOid,
                messageTitle,
                messageBody,
                fileChanges,
            };
            const commitSha = USE_GIT_DATA_API === 'true'
                ? await createCommitWithGitDataApi({ ...commitArgs, fileModes })
                : await createCommit(commitArgs);
            core.info(`successfully pushed commit "${commitSha}"`);

            core.setOutput('commit_sha', commitSha.slice(0, 7));
            core.setOutput('commit_long_sha', commitSha);
            core.setOutput('committed', 'true');
            return;
        } catch (err) {
            if (attempt < maxAttempts) {
                const delayMs = RETRY_BASE_DELAY_MS * (2 ** (attempt - 1));
                core.warning(`commit attempt ${attempt}/${maxAttempts} failed: ${err instanceof Error ? err.message : String(err)} — retrying in ${delayMs}ms`);
                await new Promise((resolve) => { setTimeout(resolve, delayMs); });
                continue;
            }
            throw err;
        }
    }
}

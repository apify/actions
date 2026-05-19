import * as util from 'node:util';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs/promises';
import * as childProcess from 'node:child_process';

import { describe, afterEach, beforeEach, it, expect, vi } from 'vitest';

import { status, FILE_STATUS, checkSupportedFileModes, main } from './index.mts';

const exec = util.promisify(childProcess.exec);

describe('signed commit action', () => {
    let repoDir!: string;
    function doExec(command: string, options: childProcess.ExecOptionsWithStringEncoding = {}) {
        return exec(command, { cwd: repoDir, ...options });
    }

    beforeEach(async () => {
        repoDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apify-actions-test-'));

        await doExec(`\
            git init
            git config user.name "test"
            git config user.email "test@apify.com"

            git commit --no-gpg-sign --allow-empty -m "initial message"
        `);
    });

    afterEach(async () => {
        await fs.rm(repoDir, { recursive: true, force: true });
    });

    it('correctly diffs files', async () => {
        // create some files, so we can modify them in the next step
        await doExec(`\
            echo 'node_modules' > .gitignore
            echo '{}' > package-lock.json

            git add .
            git commit --no-gpg-sign -m "commit with some files"
        `);

        await doExec(`\
            echo "some test content" > new_file     # A
            echo "/*.some_pattern" >> .gitignore    # M
            cp .gitignore .gitignore.bak            # A (copy)
            rm package-lock.json                    # D

            git add .
        `);

        const fileStatuses = await status({ cwd: repoDir });

        const newFileStat = fileStatuses.find(({ filePath }) => filePath === 'new_file');
        expect(newFileStat).toBeTruthy();
        expect(newFileStat!.fileStatus).toEqual(FILE_STATUS.ADDED);
        expect(newFileStat!.modeBefore).toEqual(0);
        expect(newFileStat!.modeAfter).toEqual(0o100644);

        const modifiedFileStat = fileStatuses.find(({ filePath }) => filePath === '.gitignore');
        expect(modifiedFileStat).toBeTruthy();
        expect(modifiedFileStat!.fileStatus).toEqual(FILE_STATUS.MODIFIED);
        expect(modifiedFileStat!.modeBefore).toEqual(modifiedFileStat!.modeAfter);

        const copiedFileStat = fileStatuses.find(({ filePath }) => filePath === '.gitignore.bak');
        expect(copiedFileStat).toBeTruthy();
        expect(copiedFileStat!.fileStatus).toEqual(FILE_STATUS.ADDED);
        expect(copiedFileStat!.modeBefore).toEqual(0);
        expect(copiedFileStat!.modeAfter).toEqual(0o100644);

        const deletedFileStat = fileStatuses.find(({ filePath }) => filePath === 'package-lock.json');
        expect(deletedFileStat).toBeTruthy();
        expect(deletedFileStat!.fileStatus).toEqual(FILE_STATUS.DELETED);
        expect(deletedFileStat!.modeBefore).toEqual(0o100644);
        expect(deletedFileStat!.modeAfter).toEqual(0);
    });

    it('handles paths with whitespace', async () => {
        const fileName = 'file with spaces.txt';

        await doExec(`echo "some content" > '${fileName}'`);
        await doExec(`git add '${fileName}'`);

        const fileStatuses = await status({ cwd: repoDir });
        const theFile = fileStatuses.at(0);
        expect(theFile).toBeTruthy();
        expect(theFile!.fileStatus).toEqual(FILE_STATUS.ADDED);
        expect(theFile!.filePath).toEqual(fileName);
    });

    it('throws when executable files are staged', async () => {
        const executableFile = 'exe-test';

        await fs.writeFile(path.join(repoDir, executableFile), '', { flag: 'w', mode: 0o755 });
        await doExec(`git add ${executableFile}`);

        const statuses = await status({ cwd: repoDir });

        expect(() => statuses.forEach(checkSupportedFileModes)).toThrow();
    });

    it('throws when file is made executable', async () => {
        const theFile = 'test-file';
        const filePath = path.join(repoDir, theFile);

        await fs.writeFile(filePath, '', { flag: 'w', mode: 0o644 });
        await doExec(`\
            git add ${theFile}
            git commit --no-gpg-sign -m "add file as rw"
        `);

        await fs.chmod(filePath, 0o755);
        await doExec(`git add ${theFile}`);

        const statuses = await status({ cwd: repoDir });

        expect(() => statuses.forEach(checkSupportedFileModes)).toThrow();
    });

    it('skips the commit and sets committed=false when nothing is staged', async () => {
        const outputs: Record<string, string> = {};
        const fakeCore = {
            info: () => {},
            setOutput: (name: string, value: string) => { outputs[name] = value; },
        };
        const graphql = vi.fn();
        const fakeGithub = { graphql };

        const headSha = (await doExec('git rev-parse HEAD')).stdout.trim();

        const originalCwd = process.cwd();
        try {
            process.chdir(repoDir);
            await main({
                github: fakeGithub as any,
                core: fakeCore as any,
                env: {
                    COMMIT_MESSAGE: 'chore: nothing',
                    REPO: 'apify/actions',
                    BRANCH: 'main',
                },
            });
        } finally {
            process.chdir(originalCwd);
        }

        expect(graphql).not.toHaveBeenCalled();
        expect(outputs.committed).toEqual('false');
        expect(outputs['commit_sha']).toEqual(headSha.slice(0, 7));
        expect(outputs['commit_long_sha']).toEqual(headSha);
    });

    it('throws when retries > 0 but pull is empty', async () => {
        const fakeCore = { info: () => {}, warning: () => {}, setOutput: () => {} };
        const fakeGithub = { graphql: vi.fn() };

        const originalCwd = process.cwd();
        try {
            process.chdir(repoDir);
            await expect(main({
                github: fakeGithub as any,
                core: fakeCore as any,
                env: {
                    COMMIT_MESSAGE: 'chore: x',
                    REPO: 'apify/actions',
                    BRANCH: 'main',
                    RETRIES: '2',
                    PULL: '',
                },
            })).rejects.toThrow(/retries.*pull/i);
        } finally {
            process.chdir(originalCwd);
        }
    });

    describe('pull before commit', () => {
        let remoteDir!: string;
        let otherCloneDir!: string;

        async function setUpRemote() {
            // Bare "remote" repo + an "other clone" used to push divergent
            // commits, so `git pull` inside `repoDir` has something to fetch.
            remoteDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apify-actions-remote-'));
            otherCloneDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apify-actions-otherclone-'));

            await exec(`\
                git init --bare
                git symbolic-ref HEAD refs/heads/main
            `, { cwd: remoteDir, shell: '/bin/bash' });

            await doExec(`\
                git remote add origin "${remoteDir}"
                git branch -M main
                git push -u origin main
            `);

            await exec(`\
                git clone "${remoteDir}" .
                git config user.name "other"
                git config user.email "other@apify.com"
            `, { cwd: otherCloneDir, shell: '/bin/bash' });
        }

        async function pushRemoteCommit(filePath: string, contents: string, message: string) {
            await fs.writeFile(path.join(otherCloneDir, filePath), contents);
            await exec(`\
                git add '${filePath}'
                git commit --no-gpg-sign -m '${message}'
                git push origin main
            `, { cwd: otherCloneDir, shell: '/bin/bash' });
        }

        afterEach(async () => {
            if (remoteDir) await fs.rm(remoteDir, { recursive: true, force: true });
            if (otherCloneDir) await fs.rm(otherCloneDir, { recursive: true, force: true });
        });

        it('commits staged changes after a successful --rebase --autostash pull', async () => {
            await setUpRemote();

            // Another author pushes an unrelated file to the remote — this
            // makes the local branch behind, so `git pull --rebase` actually
            // has work to do.
            await pushRemoteCommit('remote_file.txt', 'from remote\n', 'remote: add file');

            // Local change that the action would commit. Staged BEFORE the
            // pull, mimicking the composite action's "stage → main()" order.
            await fs.writeFile(path.join(repoDir, 'local_file.txt'), 'from local\n');
            await doExec(`git add local_file.txt`);

            const captured: any[] = [];
            const fakeCore = {
                info: () => {}, warning: () => {}, debug: () => {},
                setOutput: () => {},
            };
            const fakeGithub = {
                graphql: vi.fn(async (_query: string, vars: any) => {
                    captured.push(vars);
                    return { createCommitOnBranch: { commit: { oid: 'a'.repeat(40) } } };
                }),
            };

            const originalCwd = process.cwd();
            try {
                process.chdir(repoDir);
                await main({
                    github: fakeGithub as any,
                    core: fakeCore as any,
                    env: {
                        COMMIT_MESSAGE: 'chore: add local file',
                        REPO: 'apify/actions',
                        BRANCH: 'main',
                        ADD: 'local_file.txt',
                        PULL: '--rebase --autostash',
                    },
                });
            } finally {
                process.chdir(originalCwd);
            }

            expect(fakeGithub.graphql).toHaveBeenCalledOnce();
            const { input: { fileChanges: { additions } } } = captured[0];
            const local = additions.find((a: any) => a.path === 'local_file.txt');
            expect(local, 'autostash-popped change must be re-staged and included in the commit').toBeTruthy();
            expect(Buffer.from(local.contents, 'base64').toString()).toEqual('from local\n');
        });

        it('throws when --rebase --autostash leaves conflicts after pop', async () => {
            // Reproduces the realistic failure mode that motivated the fix:
            // `git pull --rebase --autostash` fast-forwards (or rebases)
            // successfully, but `git stash pop` for the autostashed local
            // changes produces a conflict against the new HEAD. Crucially,
            // git pull EXITS 0 in this case — the index is left with
            // unmerged paths and conflict markers, which would otherwise be
            // committed as-is.
            await setUpRemote();

            // Seed a shared file via the remote.
            await pushRemoteCommit('shared.txt', 'base\n', 'remote: add shared');
            await doExec(`git pull --ff-only`);

            // Remote modifies `shared.txt`.
            await pushRemoteCommit('shared.txt', 'remote version\n', 'remote: modify shared');

            // Locally, the (composite action's) "stage" step stages a
            // conflicting modification to the same file.
            await fs.writeFile(path.join(repoDir, 'shared.txt'), 'local version\n');
            await doExec(`git add shared.txt`);

            const fakeCore = {
                info: () => {}, warning: () => {}, debug: () => {},
                setOutput: () => {},
            };
            const fakeGithub = { graphql: vi.fn() };

            const originalCwd = process.cwd();
            try {
                process.chdir(repoDir);
                await expect(main({
                    github: fakeGithub as any,
                    core: fakeCore as any,
                    env: {
                        COMMIT_MESSAGE: 'chore: stuff',
                        REPO: 'apify/actions',
                        BRANCH: 'main',
                        ADD: 'shared.txt',
                        PULL: '--rebase --autostash',
                    },
                })).rejects.toThrow(/merge conflicts|unmerged/i);
            } finally {
                process.chdir(originalCwd);
            }

            expect(fakeGithub.graphql).not.toHaveBeenCalled();
        });
    });

    it('checks file modes and does not throw when correct', async () => {
        const validModes = [
            0o666,
            0o644,
            0o640,
            0o604,
            0o600,
        ];

        await Promise.all(validModes.map((mode) => {
            return fs.writeFile(
                path.join(repoDir, `test-file-with-mode-${mode.toString(8)}`),
                '',
                { flag: 'w', mode },
            );
        }));

        await doExec('git add .');
        const statuses = await status({ cwd: repoDir });

        expect(() => statuses.map(checkSupportedFileModes)).not.toThrow();
    });
});

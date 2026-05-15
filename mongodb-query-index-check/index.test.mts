import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
    extractAddedLines,
    globToRegex,
    hasMongoCallInDiff,
    matchesAny,
    parseGlobs,
    preCheck,
} from './index.mts';

describe('parseGlobs', () => {
    it('splits, trims, and drops empties', () => {
        expect(parseGlobs('a, b ,c,,d')).toEqual(['a', 'b', 'c', 'd']);
    });

    it('returns empty for empty input', () => {
        expect(parseGlobs('')).toEqual([]);
        expect(parseGlobs('   ')).toEqual([]);
    });
});

describe('globToRegex', () => {
    it('matches a simple extension glob across depths', () => {
        const re = globToRegex('**/*.ts');
        expect(re.test('a.ts')).toBe(true);
        expect(re.test('src/a.ts')).toBe(true);
        expect(re.test('src/sub/dir/a.ts')).toBe(true);
        expect(re.test('a.tsx')).toBe(false);
        expect(re.test('a.js')).toBe(false);
    });

    it('matches an immediate-directory glob', () => {
        const re = globToRegex('*.ts');
        expect(re.test('a.ts')).toBe(true);
        expect(re.test('src/a.ts')).toBe(false);
    });

    it('matches an exact path', () => {
        const re = globToRegex('src/api/users.ts');
        expect(re.test('src/api/users.ts')).toBe(true);
        expect(re.test('src/api/users.tsx')).toBe(false);
        expect(re.test('lib/src/api/users.ts')).toBe(false);
    });

    it('matches a directory-prefix glob', () => {
        const re = globToRegex('src/**/*.ts');
        expect(re.test('src/a.ts')).toBe(true);
        expect(re.test('src/sub/a.ts')).toBe(true);
        expect(re.test('test/a.ts')).toBe(false);
    });

    it('escapes regex special characters', () => {
        const re = globToRegex('foo.bar+baz/file.ts');
        expect(re.test('foo.bar+baz/file.ts')).toBe(true);
        expect(re.test('fooXbar+baz/file.ts')).toBe(false);
    });

    it('treats `**` without trailing slash as cross-segment match', () => {
        const re = globToRegex('**test**');
        expect(re.test('src/some-test-file.ts')).toBe(true);
        expect(re.test('src/test/file.ts')).toBe(true);
        expect(re.test('src/foo.ts')).toBe(false);
    });
});

describe('matchesAny', () => {
    it('returns true if any pattern matches', () => {
        const patterns = ['**/*.ts', '**/*.js'].map(globToRegex);
        expect(matchesAny('src/a.ts', patterns)).toBe(true);
        expect(matchesAny('src/a.js', patterns)).toBe(true);
        expect(matchesAny('src/a.py', patterns)).toBe(false);
    });

    it('returns false for empty pattern list', () => {
        expect(matchesAny('any.thing', [])).toBe(false);
    });
});

describe('extractAddedLines', () => {
    it('returns only `+` lines and strips the leading `+`', () => {
        const patch = [
            '@@ -1,3 +1,4 @@',
            ' context',
            '-removed',
            '+added one',
            '+added two',
            ' more context',
        ].join('\n');
        expect(extractAddedLines(patch)).toBe('added one\nadded two');
    });

    it('skips diff header `+++` lines', () => {
        const patch = ['+++ b/src/file.ts', '@@ -0,0 +1,1 @@', '+const x = 1;'].join('\n');
        expect(extractAddedLines(patch)).toBe('const x = 1;');
    });

    it('returns empty string when no additions', () => {
        const patch = '@@ -1,1 +0,0 @@\n-removed';
        expect(extractAddedLines(patch)).toBe('');
    });
});

describe('hasMongoCallInDiff', () => {
    it('detects an added `.find(` call on a collection', () => {
        const patch = [
            '@@ -1 +1,2 @@',
            ' const user = ',
            '+    await Users.findOne({ _id: userId });',
        ].join('\n');
        expect(hasMongoCallInDiff(patch)).toBe(true);
    });

    it('detects an added `.aggregate(` call', () => {
        const patch = '@@ +1 @@\n+const rows = await Act2Runs.aggregate([{ $match: { userId } }]);';
        expect(hasMongoCallInDiff(patch)).toBe(true);
    });

    it('detects writes that filter (`updateMany`, `deleteOne`, `bulkWrite`)', () => {
        expect(hasMongoCallInDiff('+await Users.updateMany({ removedAt: null }, { $set: { x: 1 } });')).toBe(
            true,
        );
        expect(hasMongoCallInDiff('+await Users.deleteOne({ _id: id });')).toBe(true);
        expect(hasMongoCallInDiff('+await Users.bulkWrite(ops);')).toBe(true);
    });

    it('does not match if the call is only on a removed line', () => {
        const patch = '@@ -1,1 +0,0 @@\n-await Users.findOne({ _id: id });';
        expect(hasMongoCallInDiff(patch)).toBe(false);
    });

    it('returns false for an empty patch', () => {
        expect(hasMongoCallInDiff('')).toBe(false);
    });

    it('does not match obvious unrelated method calls', () => {
        // `array.find` is still ambiguous and may be a false positive — see comment in index.mts.
        // We at least don't match purely non-`.method(` text.
        expect(hasMongoCallInDiff('+const x = 1;\n+const y = something();')).toBe(false);
    });
});

interface FakeFile {
    filename: string;
    status: 'added' | 'modified' | 'renamed' | 'removed';
    patch?: string;
}

function makeFakeGithub(files: FakeFile[]) {
    const listFilesFn = (): unknown => undefined;
    const calls: { fn: unknown; params: Record<string, unknown> }[] = [];
    return {
        calls,
        paginate: {
            // eslint-disable-next-line require-yield
            async *iterator(fn: unknown, params: Record<string, unknown>) {
                calls.push({ fn, params });
                yield { data: files };
            },
        },
        rest: {
            pulls: {
                listFiles: listFilesFn,
            },
        },
    };
}

function makeCore() {
    const outputs: Record<string, string> = {};
    return {
        outputs,
        info: vi.fn(),
        setOutput: vi.fn((k: string, v: string) => {
            outputs[k] = v;
        }),
        setFailed: vi.fn(),
    };
}

describe('preCheck', () => {
    let tmpDir!: string;
    let outputPath!: string;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mongo-index-check-test-'));
        outputPath = path.join(tmpDir, 'changed.json');
    });

    afterEach(async () => {
        await fs.rm(tmpDir, { recursive: true, force: true });
    });

    const context = {
        eventName: 'pull_request',
        payload: { pull_request: { number: 7 } },
        repo: { owner: 'apify', repo: 'apify-core' },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    it('sets should-run=false when no files match the paths filter', async () => {
        const github = makeFakeGithub([
            { filename: 'README.md', status: 'modified', patch: '+changed' },
            { filename: 'package.json', status: 'modified', patch: '+a' },
        ]);
        const core = makeCore();
        await preCheck({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            github: github as any,
            context,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            core: core as any,
            env: {
                INPUT_PATHS: '**/*.ts',
                INPUT_PATHS_IGNORE: '',
                OUTPUT_CHANGED_FILES_PATH: outputPath,
            },
        });
        expect(core.outputs['should-run']).toBe('false');
        expect(core.outputs['changed-files']).toBe('[]');
    });

    it('sets should-run=false when matched files do not touch MongoDB calls', async () => {
        const github = makeFakeGithub([
            {
                filename: 'src/api/users.ts',
                status: 'modified',
                patch: '@@ +1,2 @@\n+function add(a, b) {\n+  return a + b;\n+}',
            },
        ]);
        const core = makeCore();
        await preCheck({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            github: github as any,
            context,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            core: core as any,
            env: {
                INPUT_PATHS: '**/*.ts',
                INPUT_PATHS_IGNORE: '',
                OUTPUT_CHANGED_FILES_PATH: outputPath,
            },
        });
        expect(core.outputs['should-run']).toBe('false');
        expect(JSON.parse(core.outputs['changed-files']!)).toEqual(['src/api/users.ts']);
    });

    it('sets should-run=true and writes file list when MongoDB calls are added', async () => {
        const github = makeFakeGithub([
            {
                filename: 'src/api/users.ts',
                status: 'modified',
                patch: '@@ +1,2 @@\n+const u = await Users.findOne({ _id: id });',
            },
            {
                filename: 'src/api/users.test.ts',
                status: 'modified',
                patch: '@@ +1,2 @@\n+const u = await Users.findOne({ _id: id });',
            },
        ]);
        const core = makeCore();
        await preCheck({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            github: github as any,
            context,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            core: core as any,
            env: {
                INPUT_PATHS: '**/*.ts',
                INPUT_PATHS_IGNORE: '**/*.test.*',
                OUTPUT_CHANGED_FILES_PATH: outputPath,
            },
        });
        expect(core.outputs['should-run']).toBe('true');
        const fileList = JSON.parse(core.outputs['changed-files']!) as string[];
        expect(fileList).toEqual(['src/api/users.ts']);
        const written = JSON.parse(await fs.readFile(outputPath, 'utf8')) as string[];
        expect(written).toEqual(['src/api/users.ts']);

        // The paginate iterator must be invoked with the listFiles function and the PR-scoping params.
        expect(github.calls).toHaveLength(1);
        expect(github.calls[0]!.fn).toBe(github.rest.pulls.listFiles);
        expect(github.calls[0]!.params).toMatchObject({
            owner: 'apify',
            repo: 'apify-core',
            pull_number: 7,
            per_page: 100,
        });
    });

    it('skips removed files', async () => {
        const github = makeFakeGithub([
            {
                filename: 'src/api/old.ts',
                status: 'removed',
                patch: '@@ -1 +0,0 @@\n-await Users.findOne({ _id: id });',
            },
        ]);
        const core = makeCore();
        await preCheck({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            github: github as any,
            context,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            core: core as any,
            env: {
                INPUT_PATHS: '**/*.ts',
                INPUT_PATHS_IGNORE: '',
                OUTPUT_CHANGED_FILES_PATH: outputPath,
            },
        });
        expect(core.outputs['should-run']).toBe('false');
        expect(core.outputs['changed-files']).toBe('[]');
    });

    it('fails when there is no pull_request payload', async () => {
        const github = makeFakeGithub([]);
        const core = makeCore();
        const noPr = { ...context, payload: {} };
        await preCheck({
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            github: github as any,
            context: noPr,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            core: core as any,
            env: {
                INPUT_PATHS: '**/*.ts',
                INPUT_PATHS_IGNORE: '',
                OUTPUT_CHANGED_FILES_PATH: outputPath,
            },
        });
        expect(core.setFailed).toHaveBeenCalledOnce();
    });
});

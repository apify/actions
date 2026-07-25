// Policy for the factory-approve pipeline: thresholds, allowlists, and deny rules used by the
// static checks and the LLM step. The built-in defaults are the generic org-wide baseline;
// consuming repositories tune them through the action's `policy` input, a JSON document resolved
// by `resolvePolicy`. Overrides can tighten anything but only loosen what is explicitly
// loosenable: numeric limits have hard ceilings, the core deny globs and built-in risky-content
// patterns can never be removed, and any invalid override throws (the pipeline fails closed).
// Full design: docs/policy-overrides-spec.md.

import { errorMessage } from './github_api.mts';

export type RiskyContentPattern = { id: string; description: string; regex: RegExp };

export type Policy = {
    label: string;
    factoryLogin: string;
    baseBranch: string;
    maxChangedFiles: number;
    maxChangedLines: number;
    allowedExtensions: string[];
    allowedFileStatuses: string[];
    allowedAddedFileGlobs: string[];
    denyGlobs: string[];
    riskyContentPatterns: RiskyContentPattern[];
    prTitleRegex: RegExp;
    authorGate: {
        org: string;
        teamSlugs: string[];
        extraUsers: string[];
        deniedUsers: string[];
    };
    llm: {
        reviewerModels: string[];
        maxTurns: number;
        maxDiffChars: number;
        maxReasonChars: number;
        maxDetailsChars: number;
    };
};

// Deny globs every repository keeps no matter what it overrides — the supply-chain and workflow
// surface: CI definitions, dependency manifests, lockfiles, env files, images, migrations, secrets.
const coreDenyGlobs = [
    '.github/**',
    '**/package.json',
    '**/pnpm-lock.yaml',
    '**/package-lock.json',
    '**/yarn.lock',
    'pnpm-workspace.yaml',
    '.nvmrc',
    '.npmrc',
    '**/.env*',
    '**/Dockerfile*',
    '**/migrations/**',
    '**/secrets/**',
];

// Built-in risky-content patterns; overrides can add patterns but never remove these. Added lines
// matching any of them reject the PR before the LLM runs. New imports and external URLs are
// deliberately not matched here — the LLM judges those.
const builtInRiskyPatterns: RiskyContentPattern[] = [
    { id: 'dynamic-code', description: 'dynamic code execution', regex: /\beval\s*\(|new\s+Function\s*\(/ },
    {
        id: 'child-process',
        description: 'process or shell execution',
        regex: /\bchild_process\b|\bexecSync\b|\bspawnSync\b|\bexecFileSync\b/,
    },
    { id: 'raw-html', description: 'raw HTML injection', regex: /dangerouslySetInnerHTML|\binnerHTML\s*=/ },
    { id: 'env-access', description: 'environment variable access', regex: /\bprocess\.env\b/ },
    {
        id: 'network-call',
        description: 'network call',
        regex: /\bfetch\s*\(|\baxios\b|\bXMLHttpRequest\b|new\s+WebSocket\s*\(/,
    },
    {
        id: 'cookies-storage',
        description: 'cookie or web storage access',
        regex: /document\.cookie|\blocalStorage\b|\bsessionStorage\b/,
    },
    { id: 'encoded-blob', description: 'long encoded string literal', regex: /['"`][A-Za-z0-9+/=]{60,}['"`]/ },
    {
        id: 'credential-assignment',
        description: 'credential-like assignment',
        regex: /(api[_-]?key|secret|password|private[_-]?key)\s*[:=]/i,
    },
];

// Hard ceilings for the numeric overrides; values above these are config errors, not silent clamps.
const ceilings = {
    maxChangedFiles: 10,
    maxChangedLines: 300,
    maxTurns: 50,
    maxDiffChars: 120_000,
    maxReasonChars: 600,
    maxDetailsChars: 4_000,
};

// The composite action wires exactly two Claude reviewer steps, so two models is the maximum.
const MAX_REVIEWERS = 2;

const defaults = {
    label: 'factory-approve',
    factoryLogin: 'apify-factory',
    baseBranch: 'develop',

    maxChangedFiles: 5,
    maxChangedLines: 100,

    // No `.json`: dependency manifests and configs need a human.
    allowedExtensions: ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx'],
    allowedFileStatuses: ['modified'],
    // Added files are eligible only when they are tests.
    allowedAddedFileGlobs: ['**/*.test.*', '**/*.spec.*', '**/*.cy.*', '**/__tests__/**', '**/test/**', '**/tests/**'],

    // The repo tier of deny globs — replaceable per repo; `coreDenyGlobs` above is always kept.
    denyGlobs: [] as string[],

    // Conventional Commit (scope optional); breaking changes (`!`) are rejected separately.
    prTitleRegex: /^(feat|fix|chore|docs|style|refactor|perf|test|ci|build|revert)(\([^()]+\))?: .+/,

    // Both the PR author and the triggering user must be active members of one of `teamSlugs`
    // (checked with the factory token's `read:org`), or in `extraUsers`. `deniedUsers` are never allowed.
    authorGate: {
        org: 'apify',
        teamSlugs: ['product-engineering'],
        extraUsers: [] as string[],
        deniedUsers: ['apify-factory', 'apify-service-account'],
    },

    llm: {
        // One model per reviewer; array length is the reviewer count. All must approve and the
        // last is adversarial. Different models on purpose: same-model jurors share blind spots.
        reviewerModels: ['claude-sonnet-5', 'claude-opus-4-8'],
        maxTurns: 30,
        // Fail closed if the assembled diff exceeds this (sized for a 100-line PR with long lines).
        maxDiffChars: 60_000,
        maxReasonChars: 300,
        // Longer markdown explanation reviewers attach to rejections, shown collapsed in the report.
        maxDetailsChars: 1_500,
    },
};

const fail = (message: string): never => {
    throw new Error(`invalid policy overrides: ${message}`);
};

function checkKeys(value: Record<string, unknown>, allowed: string[], context: string): void {
    for (const key of Object.keys(value)) {
        if (!allowed.includes(key)) fail(`unknown key "${context}.${key}"`);
    }
}

function asObject(value: unknown, key: string): Record<string, unknown> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) fail(`${key} must be an object`);
    return value as Record<string, unknown>;
}

function asString(value: unknown, key: string): string {
    if (typeof value !== 'string' || value.trim() === '') fail(`${key} must be a non-empty string`);
    return value as string;
}

function asStringArray(value: unknown, key: string, minLength = 0): string[] {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string' || entry.trim() === '')) {
        fail(`${key} must be an array of non-empty strings`);
    }
    const entries = value as string[];
    if (entries.length < minLength) fail(`${key} must have at least ${minLength} entries`);
    return entries;
}

function asBoundedInt(value: unknown, key: keyof typeof ceilings): number {
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        fail(`${key} must be a positive integer`);
    }
    if ((value as number) > ceilings[key]) fail(`${key} is ${value}, above the hard ceiling of ${ceilings[key]}`);
    return value as number;
}

function asRegExp(value: unknown, key: string): RegExp {
    const source = asString(value, key);
    try {
        return new RegExp(source);
    } catch (error) {
        return fail(`${key} does not compile: ${errorMessage(error)}`);
    }
}

function asRiskyPatterns(value: unknown, key: string): RiskyContentPattern[] {
    if (!Array.isArray(value)) fail(`${key} must be an array`);
    return (value as unknown[]).map((entry, index) => {
        const context = `${key}[${index}]`;
        const pattern = asObject(entry, context);
        checkKeys(pattern, ['id', 'description', 'regex'], context);
        return {
            id: asString(pattern.id, `${context}.id`),
            description: asString(pattern.description, `${context}.description`),
            regex: asRegExp(pattern.regex, `${context}.regex`),
        };
    });
}

// Resolves the effective policy from the action's `policy` input (or from no input at all — the
// defaults). Deterministic: the same overrides always produce the same object, and the content
// fingerprint hashes it as a salt, so changing a repo's overrides invalidates its memoized
// verdicts. Throws on any invalid input; callers treat that as a pipeline crash (fail closed).
export function resolvePolicy(overridesJson = ''): Policy {
    let raw: Record<string, unknown> = {};
    const text = overridesJson.trim();
    if (text) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch (error) {
            fail(`not valid JSON: ${errorMessage(error)}`);
        }
        raw = asObject(parsed, 'policy');
    }
    checkKeys(
        raw,
        [
            'label',
            'factoryLogin',
            'baseBranch',
            'maxChangedFiles',
            'maxChangedLines',
            'allowedExtensions',
            'allowedAddedFileGlobs',
            'denyGlobs',
            'denyGlobsAdd',
            'riskyContentPatternsAdd',
            'prTitleRegex',
            'authorGate',
            'llm',
        ],
        'policy',
    );
    const gate = raw.authorGate !== undefined ? asObject(raw.authorGate, 'authorGate') : {};
    checkKeys(gate, ['org', 'teamSlugs', 'extraUsers', 'deniedUsersAdd'], 'authorGate');
    const llm = raw.llm !== undefined ? asObject(raw.llm, 'llm') : {};
    checkKeys(llm, ['reviewerModels', 'maxTurns', 'maxDiffChars', 'maxReasonChars', 'maxDetailsChars'], 'llm');

    const allowedExtensions =
        raw.allowedExtensions !== undefined
            ? asStringArray(raw.allowedExtensions, 'allowedExtensions', 1)
            : defaults.allowedExtensions;
    for (const extension of allowedExtensions) {
        if (!extension.startsWith('.')) fail(`allowedExtensions entry "${extension}" must start with a dot`);
    }

    const factoryLogin = raw.factoryLogin !== undefined ? asString(raw.factoryLogin, 'factoryLogin') : defaults.factoryLogin;
    const reviewerModels =
        llm.reviewerModels !== undefined
            ? asStringArray(llm.reviewerModels, 'llm.reviewerModels', 1)
            : defaults.llm.reviewerModels;
    if (reviewerModels.length > MAX_REVIEWERS) fail(`llm.reviewerModels supports at most ${MAX_REVIEWERS} reviewers`);

    const repoDenyGlobs = raw.denyGlobs !== undefined ? asStringArray(raw.denyGlobs, 'denyGlobs') : defaults.denyGlobs;
    const denyGlobsAdd = raw.denyGlobsAdd !== undefined ? asStringArray(raw.denyGlobsAdd, 'denyGlobsAdd') : [];
    const deniedUsersAdd =
        gate.deniedUsersAdd !== undefined ? asStringArray(gate.deniedUsersAdd, 'authorGate.deniedUsersAdd') : [];
    const riskyAdd =
        raw.riskyContentPatternsAdd !== undefined
            ? asRiskyPatterns(raw.riskyContentPatternsAdd, 'riskyContentPatternsAdd')
            : [];

    return {
        label: raw.label !== undefined ? asString(raw.label, 'label') : defaults.label,
        factoryLogin,
        baseBranch: raw.baseBranch !== undefined ? asString(raw.baseBranch, 'baseBranch') : defaults.baseBranch,
        maxChangedFiles:
            raw.maxChangedFiles !== undefined ? asBoundedInt(raw.maxChangedFiles, 'maxChangedFiles') : defaults.maxChangedFiles,
        maxChangedLines:
            raw.maxChangedLines !== undefined ? asBoundedInt(raw.maxChangedLines, 'maxChangedLines') : defaults.maxChangedLines,
        allowedExtensions,
        allowedFileStatuses: defaults.allowedFileStatuses,
        allowedAddedFileGlobs:
            raw.allowedAddedFileGlobs !== undefined
                ? asStringArray(raw.allowedAddedFileGlobs, 'allowedAddedFileGlobs')
                : defaults.allowedAddedFileGlobs,
        denyGlobs: [...new Set([...coreDenyGlobs, ...repoDenyGlobs, ...denyGlobsAdd])],
        riskyContentPatterns: [...builtInRiskyPatterns, ...riskyAdd],
        prTitleRegex: raw.prTitleRegex !== undefined ? asRegExp(raw.prTitleRegex, 'prTitleRegex') : defaults.prTitleRegex,
        authorGate: {
            org: gate.org !== undefined ? asString(gate.org, 'authorGate.org') : defaults.authorGate.org,
            teamSlugs:
                gate.teamSlugs !== undefined
                    ? asStringArray(gate.teamSlugs, 'authorGate.teamSlugs', 1)
                    : defaults.authorGate.teamSlugs,
            extraUsers:
                gate.extraUsers !== undefined
                    ? asStringArray(gate.extraUsers, 'authorGate.extraUsers')
                    : defaults.authorGate.extraUsers,
            // The factory account can never approve its own PRs, whatever the overrides say.
            deniedUsers: [...new Set([...defaults.authorGate.deniedUsers, ...deniedUsersAdd, factoryLogin])],
        },
        llm: {
            reviewerModels,
            maxTurns: llm.maxTurns !== undefined ? asBoundedInt(llm.maxTurns, 'maxTurns') : defaults.llm.maxTurns,
            maxDiffChars:
                llm.maxDiffChars !== undefined ? asBoundedInt(llm.maxDiffChars, 'maxDiffChars') : defaults.llm.maxDiffChars,
            maxReasonChars:
                llm.maxReasonChars !== undefined
                    ? asBoundedInt(llm.maxReasonChars, 'maxReasonChars')
                    : defaults.llm.maxReasonChars,
            maxDetailsChars:
                llm.maxDetailsChars !== undefined
                    ? asBoundedInt(llm.maxDetailsChars, 'maxDetailsChars')
                    : defaults.llm.maxDetailsChars,
        },
    };
}

// Policy for the factory-approve pipeline: thresholds, allowlists, and deny rules used by the
// static checks and the LLM step. Read from the trusted base-branch checkout, never the PR, so a
// PR cannot loosen its own policy. Tune the pipeline here (keep `label` in sync with the workflow).

export const policy = {
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

    // Never auto-approved. Feature UI dirs (billing/auth UI) are intentionally not listed — the LLM
    // judges those from the diff, so a CSS tweak there can still be approved.
    denyGlobs: [
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
        '**/openapi/**',
        '**/secrets/**',
        'scripts/**',
        'deploy/**',
        'patches/**',
        '**/finances-server/**',
        '**/consts/src/billing/**',
        '**/services/authentication/**',
    ],

    // Added lines matching any of these reject the PR before the LLM runs. New imports and external
    // URLs are left to the LLM (they fired on most clean PRs).
    riskyContentPatterns: [
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
    ],

    // Conventional Commit (scope optional); breaking changes (`!`) are rejected separately.
    prTitleRegex: /^(feat|fix|chore|docs|style|refactor|perf|test|ci|build|revert)(\([^()]+\))?: .+/,

    // Both the PR author and the triggering user must be active members of one of `teamSlugs`
    // (checked with the factory token's `read:org`), or in `extraUsers`. `deniedUsers` are never allowed.
    authorGate: {
        org: 'apify',
        teamSlugs: ['product-engineering'],
        /** @type {string[]} */
        extraUsers: [],
        deniedUsers: ['apify-factory', 'apify-service-account'],
    },

    llm: {
        // One model per reviewer; array length is the reviewer count (the action wires two Claude
        // steps). Both must approve and the second is adversarial. Different models on purpose:
        // same-model jurors share blind spots.
        reviewerModels: ['claude-sonnet-5', 'claude-opus-4-8'],
        maxTurns: 30,
        // Fail closed if the assembled diff exceeds this (sized for a 100-line PR with long lines).
        maxDiffChars: 60_000,
        maxReasonChars: 300,
    },
};

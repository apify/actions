# Spec: per-repo policy overrides for factory-approve

Status: implemented (v1, shipped with the action in apify/actions#35)

## Motivation

`scripts/policy.mts` hard-codes apify-core specifics: base branch `develop`, team
`product-engineering`, and deny globs like `**/finances-server/**` or `scripts/**`. Any other repo
adopting the action (apify-dev-sandbox already runs it) either inherits rules that don't fit its
layout or has to fork the action. Repos need a way to tune the policy from their own workflow file
— without being able to weaken the org-wide safety floor.

## Design principles

1. **Defaults stay safe and central.** The built-in policy is the baseline; a repo with no
   overrides gets exactly today's behavior.
2. **Tighten freely, loosen only where explicitly allowed.** Safety invariants are not exposed at
   all; protective lists are append-only or tiered; numeric limits have hard ceilings.
3. **Trusted source only.** Overrides live in the consuming repo's workflow file. Under
   `pull_request_target` that file always comes from the default branch, so a PR can never
   influence the policy that judges it.
4. **Fail closed on bad config.** Invalid JSON, unknown keys, uncompilable regexes, or
   out-of-range values produce an `error` verdict (never an approval) with the config problem
   named in the report — at zero LLM cost.
5. **Memo-safe.** The fingerprint already hashes the policy as a salt. It will hash the
   *effective* (merged) policy, so any config change automatically invalidates previously stored
   verdicts and forces a fresh review.

## Interface

One new **optional** action input, `policy`, containing a JSON document of overrides:

```yaml
- name: Review and approve or reject
  uses: apify/actions/factory-approve@v1
  with:
    pr-number: ${{ github.event.pull_request.number }}
    actor: ${{ github.actor }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
    factory-github-token: ${{ secrets.APIFY_FACTORY_GITHUB_TOKEN }}
    anthropic-api-key: ${{ secrets.FACTORY_APPROVE_ANTHROPIC_API_KEY }}
    policy: |
      {
        "baseBranch": "main",
        "maxChangedLines": 150,
        "denyGlobs": ["infra/**", "**/billing/**"],
        "denyGlobsAdd": ["docs/legal/**"],
        "authorGate": { "teamSlugs": ["tooling"] }
      }
```

- Parsed with `JSON.parse`. Omitted or empty → built-in defaults, byte-identical to today.
- Why JSON and not YAML (even though the workflow file is YAML): GitHub passes the input to the
  action as a plain string — the workflow's YAML parser does not parse the block — and Node has no
  built-in YAML parser, so YAML would mean vendoring a parser library (a large audit-surface
  increase in a dependency-free security pipeline) or adding a bundling step. JSON also avoids
  YAML's implicit-typing footguns in a policy document (`no` → `false`, etc.). Inside a
  `policy: |` literal block, JSON needs no escaping; the cost is just commas, quotes, and no
  comments in a ~10-line write-once config.
- Why one JSON input instead of ~15 individual inputs: the knobs include nested objects and
  lists that encode poorly as flat strings; a single document validates against one schema and is
  recorded in `gates.json` as one auditable object.
- Why not a config file in the consuming repo (e.g. `.github/factory-approve.json`): it is also
  trusted (base-branch checkout), but it couples policy to the checkout step pointing at the right
  ref, and it splits the setup across two files. The workflow file already grants the tokens; the
  policy belongs next to them. A config file can be added later without breaking this interface.

## Override surface

### Replaceable (shape-validated, no safety tier)

| Key | Default | Validation |
| --- | --- | --- |
| `label` | `factory-approve` | non-empty; must match the workflow's `if:` guard (documented coupling) |
| `factoryLogin` | `apify-factory` | non-empty; always auto-added to `deniedUsers` |
| `baseBranch` | `develop` | non-empty; must equal the ref the workflow checks out (documented coupling) |
| `allowedExtensions` | `.js .jsx .mjs .cjs .ts .tsx` | non-empty, each entry starts with `.` |
| `allowedAddedFileGlobs` | test-file globs | array of globs |
| `prTitleRegex` | Conventional Commit | string compiled with `new RegExp`; the breaking-change (`!:`) rejection stays hard-coded on top |
| `authorGate.org` | `apify` | non-empty |
| `authorGate.teamSlugs` | `['product-engineering']` | non-empty array |
| `authorGate.extraUsers` | `[]` | array of logins (see decision point 4) |
| `llm.reviewerModels` | `claude-sonnet-5`, `claude-opus-4-8` | 1–2 entries; length = reviewer count; the second reviewer is always adversarial (the composite action wires exactly two Claude steps, so two is the hard maximum) |

### Clamped numerics (hard ceilings; exceeding them is a config error, not a silent clamp)

| Key | Default | Ceiling |
| --- | --- | --- |
| `maxChangedFiles` | 5 | 10 |
| `maxChangedLines` | 100 | 300 |
| `llm.maxTurns` | 30 | 50 |
| `llm.maxDiffChars` | 60 000 | 120 000 |
| `llm.maxReasonChars` | 300 | 600 |
| `llm.maxDetailsChars` | 1 500 | 4 000 |

### Tiered: deny globs

The built-in list splits into two tiers in `policy.mts`:

- **Core tier — immutable.** The supply-chain and workflow surface every repo must keep:
  `.github/**`, `**/package.json`, `**/pnpm-lock.yaml`, `**/package-lock.json`, `**/yarn.lock`,
  `pnpm-workspace.yaml`, `.nvmrc`, `.npmrc`, `**/.env*`, `**/Dockerfile*`, `**/migrations/**`,
  `**/secrets/**`.
- **Repo tier — replaceable via `denyGlobs`, default empty.** Repo-specific paths belong to the
  repo's own workflow, not the shared defaults: apify-core passes `**/openapi/**`, `scripts/**`,
  `deploy/**`, `patches/**`, `**/finances-server/**`, `**/consts/src/billing/**`, and
  `**/services/authentication/**` through its `policy` input.
- `denyGlobsAdd` appends on top of whichever repo tier is in effect (convenience so a repo can
  extend the defaults without restating them).

Effective deny list = core tier ∪ repo tier ∪ additions, deduplicated.

### Append-only

| Key | Semantics |
| --- | --- |
| `riskyContentPatternsAdd` | extra `{ id, description, regex }` entries (regex as string); the built-in patterns can never be removed or altered |
| `authorGate.deniedUsersAdd` | extra denied logins; the built-in service accounts and `factoryLogin` are always denied |

### Not overridable (hard invariants)

- The static check set itself — no disabling `author-is-human`, `same-repo`, `pr-open-and-ready`,
  `mergeable`, `patch-present`, or the author/actor gates.
- Unanimity, reviewer short-circuiting, and the adversarial stance of reviewer ≥ 2.
- Fail-closed semantics, the verdict file contract, report format, comment lifecycle
  (new-comment-per-run + folding), fingerprint memoization, and the human-review stand-down.
- The reviewer prompt (see "Out of scope").
- The core deny-glob tier and built-in risky-content patterns.

## Validation and failure mode

- Strict schema, validated in plain code (no dependencies): unknown keys anywhere, wrong types,
  empty required arrays, uncompilable regex strings, and over-ceiling numbers are all errors.
  Silent acceptance of a typo like `"maxChangedLine"` must be impossible.
- A config error is raised in stage 1 (`prepare_review.mts`) and captured the same way crashes
  are today: `crashMessage = 'invalid policy overrides: <detail>'` → the post step reports
  “⚠️ could not finish” with that message and nothing is approved. No LLM step runs.
- The effective policy is written into `gates.json`, so every run records exactly which rules
  judged it.

## Effective-policy resolution

Single deterministic function, `resolvePolicy(overridesJson: string): Policy`:

1. Start from built-in defaults.
2. Apply replaceable fields (shape-checked).
3. Check clamped numerics against ceilings.
4. Union the tiered/append-only lists (core first, dedup).
5. Compile regex strings.
6. Add `factoryLogin` to `deniedUsers`.
7. Freeze and return; the fingerprint salt hashes this object (the existing `stableStringify`
   already serializes RegExp values).

Both stage 1 (`prepare_review.mts`) and stage 3 (`post_verdict.mts`) call `resolvePolicy` on the
same `POLICY_OVERRIDES` env value — action inputs are fixed for the lifetime of a run and the
function is deterministic, so both stages act under the same policy. If resolution fails, stage 1
captures it as a crash (fail closed, no LLM cost) and stage 3 falls back to the defaults so the
error report can still be rendered and posted. For auditability, stage 1 also writes a JSON-safe
snapshot of the effective policy into `gates.json`, so every run records exactly which rules
judged it.

## Implementation sketch

- `scripts/policy.mts` — fold the current object into internal defaults, split `denyGlobs` into
  the two tiers, and export `resolvePolicy()` + the `Policy` type (unchanged in shape for all
  consumers).
- `action.yaml` — new optional `policy` input, passed as env `POLICY_OVERRIDES` to the prepare
  and post steps.
- `scripts/prepare_review.mts` — call `resolvePolicy(process.env.POLICY_OVERRIDES)` inside the
  fail-closed try block; store a JSON-safe snapshot of the effective policy in `gates.json`.
- `scripts/post_verdict.mts` — call the same `resolvePolicy`, falling back to the defaults when
  the overrides are invalid (stage 1 has already failed the gates in that case).
- `backtest/backtest.mts` — new `--policy <file.json>` flag using the same `resolvePolicy`, so a
  repo can backtest its overrides before enabling them.
- Tests — merge semantics per tier, ceiling rejection, unknown-key rejection, regex compilation,
  fail-closed on invalid config, fingerprint change on any override change.
- README — document the input with the table above; state the safety floor explicitly.

## Compatibility

- No `policy` input → behavior identical to today.
- One-time caveat: restructuring `policy.mts` (tier split) changes the policy serialization, which
  changes the fingerprint salt — every stored verdict is invalidated once, so the next push on any
  labeled PR triggers one fresh review. Cheap and self-healing; worth a release-note line.

## Out of scope (candidates for later)

- Custom prompt text or extra REJECT domains (`promptAppendix`). Powerful but easy to get wrong —
  even trusted config can accidentally weaken the injection defenses. Needs its own design pass.
- Reading overrides from a config file in the consuming repo.
- Removing built-in risky patterns or core deny globs.
- Per-path rule variation (different limits for different directories).

## Decision points (resolved)

1. **Reviewer count** — 1–2 reviewers allowed, default 2. A single reviewer halves the cost for
   low-stakes repos; two is the maximum because the composite action wires exactly two Claude
   steps.
2. **Ceiling values** — 10 files / 300 lines / 50 turns / 120k diff chars.
3. **Over-ceiling handling** — hard config error, so misconfiguration is visible instead of
   silently clamped.
4. **`authorGate.extraUsers`** — replaceable. Repo admins control merge rights anyway, and
   `author-is-human` plus the denied-users list still apply.

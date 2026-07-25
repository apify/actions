# Factory approve — auto-approval for trivial PRs

Auto-approves very simple PRs (copy changes, styling, small self-contained tweaks) so they
don't need another engineer's review. Deterministic safety gates run first; only if they all
pass does Claude judge the diff, and only a unanimous `approve` makes the `apify-factory`
account post an approving review. It never requests changes and never merges.

## How to use

Add the `factory-approve` label to a PR against `develop` (you can add it on a draft — it
waits until the PR is ready). The label is a human opt-in flag the bot never touches: while
it's on, every push is re-reviewed; remove it to opt out.

- **Approve** → `apify-factory` posts an approving review, locked to the reviewed commit.
- **Reject / error** → `apify-factory` posts the report as a new PR comment and any stale
  factory approval is dismissed. The label stays on, so the next push re-reviews.

Two situations make a run stand down silently (no review, no comment, no LLM cost):

- **A human review is active** — an approval means the factory has nothing to add; a
  changes-requested means a human owns the review conversation now.
- **The content is unchanged since the last factory verdict** — the diff (with hunk line
  numbers normalized away) and title are fingerprinted into each posted verdict, so
  develop-syncs, rebases, and empty pushes don't trigger a paid re-review. Any real content
  change (including whitespace) produces a new fingerprint and a full review, and policy
  changes invalidate all stored fingerprints.

Every outcome is rendered with the same fixed template (`scripts/report.mts`): status, the
reviewer's one-sentence reason, a gates/reviewers result table with a link to the run, and —
for non-approvals — a collapsed "Details and next steps" section with the rejecting
reviewer's full explanation. Each run folds the previous report comment as outdated instead
of editing or deleting it, so the timeline stays clean and the history stays honest. The bot
never edits the PR description.

## How it works

1. **Static gates** (`scripts/prepare_review.mts`) — all must pass or the PR is rejected
   without calling Claude: trusted author + trigger, open & mergeable, targets `develop`,
   ≤5 files / ≤100 lines, JS/TS only, no denied paths, no risky added lines, Conventional
   Commit title.
2. **LLM verdict** (`anthropics/claude-code-action`, run twice — two independent reviewers,
   the second adversarial; both must approve). Each judges whether the change needs a human
   (databases, security, money, config, public contracts, infra, privacy), is free of
   correctness bugs, and follows the conventions of the surrounding code (naming, formatting,
   established patterns), then writes a strict `{"verdict","reason"}` file. The model can only
   read the code and write its verdict — it cannot touch the PR.
3. **Post** (`scripts/post_verdict.mts`) — the only place GitHub is written to. Approves as
   `apify-factory` (with a separate token), or dismisses stale approvals and posts the report
   as a new comment (folding older report comments as outdated). Fails closed: any crash,
   missing/invalid verdict, or unknown state → no approval.

## Configure

The built-in policy (`scripts/policy.mts`) is the generic org-wide baseline: base `develop`,
≤5 files / ≤100 lines, `.js`/`.ts` only (no `.json`), modifications plus added test files,
Conventional Commit titles, authors and actors from `apify/product-engineering`, and two
reviewers (`claude-sonnet-5` + `claude-opus-4-8`, the second adversarial).

A consuming repository tunes it through the optional `policy` input — a JSON document of
overrides in the workflow file:

```yaml
- uses: apify/actions/factory-approve@v1
  with:
    # ...tokens...
    policy: |
      {
        "baseBranch": "main",
        "denyGlobs": ["infra/**", "**/billing/**"],
        "authorGate": { "teamSlugs": ["tooling"] }
      }
```

Overrides can tighten anything, but can only loosen what is explicitly loosenable:

- **Replaceable**: `label`, `factoryLogin`, `baseBranch`, `allowedExtensions`,
  `allowedAddedFileGlobs`, `prTitleRegex` (as a string), `authorGate.org`, `authorGate.teamSlugs`,
  `authorGate.extraUsers`, `llm.reviewerModels` (1–2 models; the last is adversarial), and
  `denyGlobs` — the repo tier only. A core tier of supply-chain paths (`.github/**`, dependency
  manifests, lockfiles, env files, Dockerfiles, migrations, secrets) is always kept.
- **Clamped**: `maxChangedFiles` (≤10), `maxChangedLines` (≤300), `llm.maxTurns` (≤50),
  `llm.maxDiffChars` (≤120000), `llm.maxReasonChars` (≤600), `llm.maxDetailsChars` (≤4000).
  Values above a ceiling are config errors, not silent clamps.
- **Append-only**: `denyGlobsAdd`, `riskyContentPatternsAdd` (`{ id, description, regex }`, regex
  as a string), `authorGate.deniedUsersAdd`. The built-in patterns and denied accounts can never
  be removed, and `factoryLogin` is always denied.

Everything else — the static check set, unanimity, fail-closed semantics, the report format, the
comment lifecycle — is not configurable. Unknown keys, wrong types, or out-of-range values fail
closed: the run reports "could not finish" and approves nothing, at zero LLM cost. Changing
overrides also changes the review fingerprint, so previously memoized verdicts get a fresh
review. Full design rationale: [docs/policy-overrides-spec.md](docs/policy-overrides-spec.md).

The reviewer's instructions (what needs a human vs. what's approvable) live in
`scripts/prompt.mts` and are deliberately not overridable.

## Setup

1. **Secrets**: `APIFY_FACTORY_GITHUB_TOKEN` (the `apify-factory` account, `repo` + `read:org`)
   and `FACTORY_APPROVE_ANTHROPIC_API_KEY` (Anthropic key).
2. **Label**: create `factory-approve` in the repo.
3. **Branch protection**: confirm one `apify-factory` approval actually makes these PRs
   mergeable, and enable "dismiss stale approvals when new commits are pushed".

## Testing

Replay the whole pipeline (static gates + the dual-reviewer LLM step) over recent human PRs before
rolling out — reads only, posts nothing. Requires the `claude` CLI installed and authenticated; run
it from a `develop` checkout so the reviewer's Read/Grep context matches CI:

```bash
GITHUB_TOKEN=… FACTORY_GITHUB_TOKEN=… \
  node backtest/backtest.mts --repo apify/apify-core --last 200
```

Add `--output results.jsonl` to record a per-PR line for later inspection, and
`--policy overrides.json` to replay the exact JSON document a repo would pass to the `policy`
input before enabling it.

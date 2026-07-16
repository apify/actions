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
- **Reject / error** → the reason is written to the PR body and any stale factory approval is
  dismissed. The label stays on, so the next push re-reviews.

## How it works

1. **Static gates** (`scripts/prepare_review.mts`) — all must pass or the PR is rejected
   without calling Claude: trusted author + trigger, open & mergeable, targets `develop`,
   ≤5 files / ≤100 lines, JS/TS only, no denied paths, no risky added lines, Conventional
   Commit title.
2. **LLM verdict** (`anthropics/claude-code-action`, run twice — two independent reviewers,
   the second adversarial; both must approve). Each judges whether the change needs a human
   (databases, security, money, config, public contracts, infra, privacy) and is free of
   correctness bugs, then writes a strict `{"verdict","reason"}` file. The model can only read
   the code and write its verdict — it cannot touch the PR.
3. **Post** (`scripts/post_verdict.mts`) — the only place GitHub is written to. Approves as
   `apify-factory` (with a separate token), or dismisses stale approvals and writes the reason
   to the PR body. Fails closed: any crash, missing/invalid verdict, or unknown state → no
   approval.

## Configure

Everything is tuned by editing two files directly (this first version has no override inputs):

- **`scripts/policy.mts`** — the deterministic rules: base branch, size limits, allowed
  extensions and file operations, denied paths, risky-content patterns, title convention, who
  may use it, and the reviewer models.
- **`scripts/prompt.mts`** — the reviewer's instructions (what needs a human vs. what's
  approvable), as a plain template literal.

Defaults are deliberately strict: base `develop`, ≤5 files / ≤100 lines, `.js`/`.ts` only (no
`.json`), modifications plus added test files, two reviewers (`claude-sonnet-5` +
`claude-opus-4-8`).

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

Add `--output results.jsonl` to record a per-PR line for later inspection.

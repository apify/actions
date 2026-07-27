# Factory approve — auto-approval for trivial PRs

Auto-approves very simple PRs (copy changes, styling, small self-contained tweaks) so they don't
need another engineer's review. Deterministic safety gates run first; only if they all pass do two
Claude reviewers judge the diff, and only their unanimous approve makes the factory bot account
post an approving review. Everything fails closed — it never requests changes and never merges.

## How to use

Add the `factory-approve` label to a PR (drafts wait until ready). The label is a human opt-in
flag the bot never touches: while it's on, every push is re-reviewed; remove it to opt out.

- Approve → the factory account posts an approving review locked to the reviewed commit.
- Reject / error → the report lands as a new PR comment with a collapsed details section, any
  stale factory approval is dismissed, and older report comments are folded as outdated.

A run stands down silently — no review, no comment, no cost — when a human review is already
active, or when the content is unchanged since the last factory verdict (each verdict embeds a
fingerprint of the title + diff, so develop-syncs, rebases, and empty pushes skip the paid review).

## How it works

1. **Static gates** (`scripts/prepare_review.mts`) — all must pass or the PR is rejected without
   calling Claude: trusted author and actor, open and mergeable, targets the base branch, within
   size limits, JS/TS only, no denied paths, no risky added lines, Conventional Commit title.
2. **Two Claude reviewers** (via `anthropics/claude-code-action`) — the cheaper model first, the
   second adversarial, and a rejection short-circuits. Each judges whether the change needs a
   human, is correct, and follows the conventions of the surrounding code. The model can only
   read code and write its verdict file — it cannot touch the PR, and all PR content enters the
   prompt fenced as untrusted data.
3. **Posting** (`scripts/post_verdict.mts`) — the only place GitHub is written to, as the factory
   account. Any crash or invalid verdict means no approval.

## Usage

```yaml
on:
  pull_request_target: # runs the pipeline from the default branch, out of the PR's reach
    types: [labeled, synchronize, opened, reopened, ready_for_review]
# ... label guard, base-branch checkout, Node setup ...
- uses: apify/actions/factory-approve@main
  with:
    pr-number: ${{ github.event.pull_request.number }}
    actor: ${{ github.actor }}
    github-token: ${{ secrets.GITHUB_TOKEN }}
    factory-github-token: ${{ secrets.APIFY_FACTORY_GITHUB_TOKEN }}
    anthropic-api-key: ${{ secrets.FACTORY_APPROVE_ANTHROPIC_API_KEY }}
    policy: |
      { "denyGlobs": ["infra/**"] }
```

See apify-core's `.github/workflows/factory_approve.yaml` for a complete workflow. The action
exposes a `verdict` output (`approve` / `reject` / `error`).

## Configure

Defaults in `scripts/policy.mts` are the generic org-wide baseline: base `develop`, ≤5 files /
≤150 lines, JS/TS modifications plus added test files, Conventional Commit titles, authors from
`apify/product-engineering`, reviewers `claude-sonnet-5` + `claude-opus-5`.

The optional `policy` input overrides them per repo: label, base branch, size and LLM limits,
allowed extensions, title regex, author gate (org, teams, extra users), reviewer models (1–2),
and the repo tier of `denyGlobs`; `denyGlobsAdd`, `riskyContentPatternsAdd`, and
`authorGate.deniedUsersAdd` append. A core tier of supply-chain deny globs (workflows, manifests,
lockfiles, env files, Dockerfiles, migrations, secrets) and the built-in risky-content patterns
can never be removed. Invalid overrides fail closed as an error verdict at zero LLM cost, and any
policy change invalidates memoized verdicts. The reviewer prompt (`scripts/prompt.mts`) is
deliberately not overridable.

## Setup

1. Secrets: `APIFY_FACTORY_GITHUB_TOKEN` (the factory bot account, `repo` + `read:org`) and
   `FACTORY_APPROVE_ANTHROPIC_API_KEY`.
2. Create the `factory-approve` label.
3. Branch protection: confirm one factory approval makes these PRs mergeable, and enable
   "dismiss stale approvals when new commits are pushed".

## Backtest

Replay the whole pipeline over recent PRs without posting anything (requires the `claude` CLI,
authenticated, run from a base-branch checkout):

```bash
GITHUB_TOKEN=… FACTORY_GITHUB_TOKEN=… \
  node backtest/backtest.mts --repo apify/apify-core --last 200 --policy overrides.json
```

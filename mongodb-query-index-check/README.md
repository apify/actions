# `mongodb-query-index-check` GitHub Action

Reviews a pull request for **MongoDB queries that don't use an appropriate index**. For every changed or new MongoDB call (`.find`, `.findOne`, `.aggregate`, `.update*`, `.delete*`, `.findOneAnd*`, `.countDocuments`, `.distinct`, …) the action:

1. Cross-references the query's filter and sort fields against the canonical index definitions in [`@apify-packages/mongo-indexes`](https://github.com/apify/apify-core/tree/develop/src/packages/mongo-indexes/src) (sparse-fetched from `apify/apify-core@develop`, or read straight from the caller's workspace when the action runs on `apify-core` itself).
2. Invokes [`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action) (recent Opus) to apply an ESR-aware rubric (Equality → Sort → Range) and post inline review comments with severity tags (`🔴 critical`, `🟠 high`, `🟡 medium`, `🟢 low`).
3. Fails the check whenever a finding is reported (unless `request-changes: false`) — useful as a required check in branch protection.

The action runs a cheap pre-filter first (it lists PR files, glob-matches, and grep-checks for MongoDB call patterns in changed hunks) and only invokes Claude when something relevant changed. Repos that never touch MongoDB pay only the GitHub API cost of `pulls.listFiles`.

## Usage

### `apify-core` (the action reads its own workspace)

```yaml
# .github/workflows/mongodb_query_index_check.yaml
name: MongoDB query index check

on:
  pull_request:
    types: [opened, reopened, synchronize, ready_for_review]

jobs:
  check:
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-22.04-arm64
    permissions:
      contents: read
      pull-requests: write
      id-token: write
    steps:
      - uses: actions/checkout@v6
      - uses: apify/actions/mongodb-query-index-check@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

### `apify-proxy`, `apify-web`, … (the action fetches indexes from `apify-core`)

```yaml
# .github/workflows/mongodb_query_index_check.yaml
name: MongoDB query index check

on:
  pull_request:
    types: [opened, reopened, synchronize, ready_for_review]

jobs:
  check:
    if: github.event.pull_request.draft == false
    runs-on: ubuntu-22.04-arm64
    permissions:
      contents: read
      pull-requests: write
      id-token: write
    steps:
      - uses: actions/checkout@v6
      - uses: apify/actions/mongodb-query-index-check@v1
        with:
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          # PAT with `contents: read` on apify/apify-core. The default GITHUB_TOKEN only sees the
          # current repo, so without this the action would fail to fetch the indexes.
          apify-core-token: ${{ secrets.APIFY_CORE_RO_TOKEN }}
```

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `anthropic-api-key` | yes | — | Anthropic API key passed through to `anthropics/claude-code-action`. |
| `github-token` | no | `${{ github.token }}` | Token used to post review comments. |
| `apify-core-token` | no | _(empty)_ | When set, fetches `mongo-indexes` from `apify/apify-core@develop`. When empty, the action assumes it is running on `apify-core` and reads `src/packages/mongo-indexes/src` from the workspace. |
| `max-turns` | no | `100` | Maximum turns Claude may take. The default headroom fits large multi-file PRs; Claude only spends what it needs. |
| `paths` | no | TS/JS source files | Comma-separated globs to include. |
| `request-changes` | no | `true` | When `true`, fail the check on any finding. When `false`, comment only. |

## Outputs

| Name | Description |
| --- | --- |
| `should-run` | `true` when the pre-filter detected MongoDB changes and Claude was invoked, `false` otherwise. |
| `changed-files` | JSON array of files Claude reviewed. |
| `max-severity` | Highest severity found: `none`, `low`, `medium`, `high`, or `critical`. |

## How it works

1. **Validate inputs**: checks the event is `pull_request[_target]`, rejects fork PRs, validates `request-changes`, and seeds `$RESULT_PATH` for the Finalize step.
2. **Pre-filter** (`index.mts` → `preCheck()`): pages through `pulls.listFiles`, applies the `paths` glob and a fixed exclude list (`node_modules`, `dist`, `build`, tests, `mongo-indexes` package itself), and greps for MongoDB collection-method patterns in changed hunks. If nothing matches, the action sets `should-run=false` and exits before spending Anthropic credits.
3. **Source resolution**: either sparse-checkouts `apify/apify-core@develop` (when `apify-core-token` is set) into a workspace subdir, or points at the caller's `src/packages/mongo-indexes/src` directly.
4. **Prompt render**: substitutes the changed-files path, mongo-indexes directory, PR metadata, and request-changes mode into `prompts/review.md` via envsubst.
5. **Claude Code run**: invokes `anthropics/claude-code-action@v1` (recent Opus) with a tight allowlist — GitHub MCP for pull-request read and pending-review tools, `Read`, `Write` (for the result file), and a handful of read-only `Bash(...)` commands.
6. **Finalize**: reads the single-word severity Claude wrote to `${RUNNER_TEMP}/mongo-index-result.txt`. Exits non-zero when `request-changes: true` and Claude reported any finding; otherwise succeeds.

## Severity rubric

| Severity | Symptom |
| --- | --- |
| 🔴 critical | No index covers the query — collection scan. |
| 🟠 high | Index exists but doesn't match: prefix missed, partial-filter incompatible, sort can't use the index, unanchored `$regex` on indexed field. |
| 🟡 medium | Index used but inefficient: low selectivity, likely poor read/return ratio, wrong sort direction, `$or` branch without an index. |
| 🟢 low | Stylistic: tighter partial filter, covered-query opportunity, missing index name. |

Any finding turns the check red unless `request-changes` is set to `false`.

## Limitations

- **Fork PRs are rejected**: the action's Validate step fails fast when `head.repo` differs from `base.repo`. On `pull_request_target` this would otherwise hand a write-capable token to Claude while it analyses attacker-controlled diff content (prompt-injection risk); on `pull_request` it can't authenticate anyway. Internal PRs only.
- **JS array methods**: the pre-filter regex matches `.find(`, `.findOne(`, etc. on any object, so `array.find(x => …)` still triggers Claude to look — Claude then disambiguates by inspecting the receiver. This errs on the side of running more often, never less.
- **Dynamic collection access** (e.g. `db[name].findOne(...)`): Claude is instructed to skip findings where it can't determine the collection reliably.

## Releasing a new version

This action is published as part of the `apify/actions` repo. See the [repo README](../README.md) for the release-please flow.

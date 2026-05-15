# `mongodb-query-index-check` GitHub Action

Reviews a pull request for **MongoDB queries that don't use an appropriate index**. For every changed or new MongoDB call (`.find`, `.findOne`, `.aggregate`, `.update*`, `.delete*`, `.findOneAnd*`, `.countDocuments`, `.distinct`, …) the action:

1. Cross-references the query's filter and sort fields against the canonical index definitions in [`@apify-packages/mongo-indexes`](https://github.com/apify/apify-core/tree/develop/src/packages/mongo-indexes/src) (sparse-fetched from `apify/apify-core`, or loaded from a local path).
2. Invokes [`anthropics/claude-code-action`](https://github.com/anthropics/claude-code-action) to apply an ESR-aware rubric (Equality → Sort → Range) and post inline review comments with severity tags (`🔴 critical`, `🟠 high`, `🟡 medium`, `🟢 low`).
3. Optionally fails the check when findings meet a configurable severity threshold — useful as a required check in branch protection.

The action runs a cheap pre-filter first (it lists PR files, glob-matches, and grep-checks for MongoDB call patterns in added lines) and only invokes Claude when something relevant changed. Repos that never touch MongoDB pay only the GitHub API cost of `pulls.listFiles`.

## When to use

Add this to repos that read or write to the Apify MongoDB cluster — primarily `apify-core`, `apify-proxy`, `apify-web`, but any internal repo that imports a `mongoClient.<Collection>` works.

## Usage

### `apify-core` (uses its own local mongo-indexes)

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
          mongo-indexes-source: local
          mongo-indexes-path: src/packages/mongo-indexes/src
```

### `apify-proxy`, `apify-web`, … (fetches the indexes from `apify-core`)

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
          # PAT with `contents: read` on apify/apify-core (the default GITHUB_TOKEN only sees the current repo).
          apify-core-token: ${{ secrets.APIFY_CORE_RO_TOKEN }}
```

## Inputs

| Name | Required | Default | Description |
| --- | --- | --- | --- |
| `anthropic-api-key` | yes | — | Anthropic API key passed through to `anthropics/claude-code-action`. |
| `github-token` | no | `${{ github.token }}` | Token used to post review comments. |
| `mongo-indexes-source` | no | `apify-core` | `apify-core` (sparse-checkout from `apify/apify-core`) or `local` (use a path in the workspace). |
| `apify-core-ref` | no | `develop` | Ref to fetch when source is `apify-core`. |
| `apify-core-token` | no | _(falls back to `github-token`)_ | Token with `contents: read` on `apify/apify-core`. Required when calling from another repo. |
| `mongo-indexes-path` | conditional | — | Required when source is `local`. Path to the indexes source directory (e.g. `src/packages/mongo-indexes/src`). |
| `claude-model` | no | _(action default)_ | Override the Claude model (e.g. `claude-sonnet-4-6`). |
| `max-turns` | no | `30` | Maximum turns Claude may take. |
| `paths` | no | TS/JS source files | Comma-separated globs to include. |
| `paths-ignore` | no | test/build/vendor/`**/mongo-indexes/**` | Comma-separated globs to exclude. |
| `severity-threshold` | no | `high` | Minimum severity that fails the check (`low`, `medium`, `high`, `critical`). |
| `request-changes` | no | `true` | When `true`, fail the check at the threshold. When `false`, comment only. |
| `extra-prompt` | no | — | Extra instructions appended to the Claude prompt (e.g. "skip files under `src/legacy/**`"). |

## Outputs

| Name | Description |
| --- | --- |
| `should-run` | `true` when the pre-filter detected MongoDB changes and Claude was invoked, `false` otherwise. |
| `changed-files` | JSON array of files Claude reviewed. |
| `max-severity` | Highest severity found: `none`, `low`, `medium`, `high`, or `critical`. |

## How it works

1. **Pre-filter** (`index.mts` → `preCheck()`): pages through `pulls.listFiles`, applies the `paths` / `paths-ignore` globs, and greps for MongoDB collection-method patterns in **added** lines only. If nothing matches, the action sets `should-run=false` and exits before spending any Anthropic credits.
2. **Source resolution**: either sparse-checkouts `apify-core` (just `src/packages/mongo-indexes/src/*`, depth 1) to `${RUNNER_TEMP}/apify-core`, or points at a path inside the workspace.
3. **Prompt render**: substitutes the changed-files path, mongo-indexes directory, PR metadata, and severity policy into `prompts/review.md`.
4. **Claude Code run**: invokes `anthropics/claude-code-action@v1` with a tight allowlist — GitHub MCP for `pull_request_read` and pending-review tools, `Read`, `Write` (for the result file), and a handful of read-only `Bash(...)` commands (`cat`, `grep`, `find`, `ls`, …). Claude reads the diff, reads the relevant `<collection>.ts` files, applies the ESR rubric, and either opens a pending review with inline comments or stays silent.
5. **Finalize**: reads the single-word severity Claude wrote to `${RUNNER_TEMP}/mongo-index-result.txt`. Exits non-zero when `request-changes: true` and the severity meets the threshold; otherwise succeeds.

## Severity rubric

| Severity | Symptom |
| --- | --- |
| 🔴 critical | No index covers the query — collection scan. |
| 🟠 high | Index exists but doesn't match: prefix missed, partial-filter incompatible, sort can't use the index, unanchored `$regex` on indexed field. |
| 🟡 medium | Index used but inefficient: low selectivity, likely poor read/return ratio, wrong sort direction, `$or` branch without an index. |
| 🟢 low | Stylistic: tighter partial filter, covered-query opportunity, missing index name. |

The `severity-threshold` input controls which findings turn the check red.

## Limitations

- **JS array methods**: the pre-filter regex matches `.find(`, `.findOne(`, etc. on any object, so `array.find(x => …)` still triggers Claude to look — Claude then disambiguates by inspecting the receiver. This errs on the side of running more often, never less.
- **Dynamic collection access** (e.g. `db[name].findOne(...)`): Claude is instructed to skip findings where it can't determine the collection reliably.
- **No support for the npm package source yet**: the published `@apify-packages/mongo-indexes` ships compiled `.js` + `.d.ts` and drops the comments that explain each index's intent, which materially degrades the review. If you need this, open an issue and we can add a `package` source that downloads sources from the published GitHub release.

## Releasing a new version

This action is published as part of the `apify/actions` repo. See the [repo README](../README.md) for the release-please flow.

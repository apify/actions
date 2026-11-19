# `get-values` GitHub Action

Get short commit SHA, cleaned branch names and the last commit author from the GitHub context.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/get-values@main
        with:
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `commit-sha` | no |  | Commit SHA |
| `use-merged-pull-request-head` | no | `false` | On non pull request events, use the head commit of the pull request whose merge created the current commit, not the commit itself (`true` / `false`). Fails when there is none. Needs the pull-requests read permission. |
| `github-token` | no | `${{ github.token }}` | GitHub token used to read the commit and, with `use-merged-pull-request-head`, the pull requests |

## Outputs

| Output | Description |
|---|---|
| `short-commit-sha` | Short commit sha |
| `clean-branch-name` | Branch name stripped of non-alphanumeric characters, lowercased, and capped at length of 35 |
| `clean-branch-name-with-suffix` | Branch name stripped of non-alphanumeric characters, lowercased, and capped at length of 24 concatenated with the first 6 hex chars of its SHA-1 |
| `commit-author` | Author of last commit |

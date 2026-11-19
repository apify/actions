# `agents-md-maintenance` GitHub Action

If a PR makes AGENTS.md stale, an agent commits the fix to the PR's branch and comments what it changed.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Notes

```
Recommended usage (the caller owns permissions, concurrency and timeout, which a composite action can't set):

  on:
    pull_request:
      types: [opened, synchronize, reopened, ready_for_review]

  jobs:
    update-agents-md:
      runs-on: ubuntu-latest
      timeout-minutes: 15
      permissions:
        contents: write
        pull-requests: write
      concurrency:
        group: agents-md-${{ github.event.pull_request.number }}
        cancel-in-progress: true
      steps:
        - uses: apify/actions/agents-md-maintenance@main
          with:
            anthropic-api-key: ${{ secrets.YOUR_ANTHROPIC_API_KEY }}
```

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/agents-md-maintenance@main
        with:
          anthropic-api-key: ...
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `anthropic-api-key` | yes |  | Anthropic API key used by the agent |
| `github-token` | no | `${{ github.token }}` | GitHub token used to check out the branch, read the PR and comment |
| `skip-head-ref-prefixes` | no | `release/ hotfix/ sync-` | Don't run on a pull request whose branch name starts with one of these. Separate them with spaces or commas. |
| `skip-authors` | no | `apify-service-account` | Don't run on a pull request opened by one of these users. Separate them with spaces or commas. Accounts ending in `[bot]` are always skipped. |

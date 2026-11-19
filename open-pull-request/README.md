# `open-pull-request` GitHub Action

Open a release pull request with a changelog generated from commits, using apify/release-pr-action.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/open-pull-request@main
        with:
          changelog-scopes: ...
          github-token: ...
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `changelog-scopes` | yes |  | Changelog scopes (i.e { "App": ["app", "application"] }) |
| `base-branch` | no | `master` | Base branch name |
| `github-token` | yes |  | Github token with read/write permission. If you want to trigger GH workflow runs with this you need to provide a real user token, not the default GITHUB_TOKEN. |
| `open-ai-token` | no |  | Open AI token |

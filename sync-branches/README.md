# `sync-branches` GitHub Action

Open and merge a pull request from the current branch to a base branch (e.g. master to develop), with a Slack notification on failure.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/sync-branches@main
        with:
          slack-channel-id: ...
          revision: ...
          slack-token: ...
          github-token: ...
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `slack-channel-id` | yes |  | Slack Channel ID |
| `revision` | yes |  | Tag given to container image |
| `base-branch` | no | `develop` | Branch that will be synchronized with current branch |
| `actor-override` | no |  | Override the author of event |
| `slack-token` | yes |  | Slack API token |
| `github-token` | yes |  | Github token to open, approve and merge the PR (GITHUB_TOKEN cannot open and approve PR). Typically the Apify Service Account token. |

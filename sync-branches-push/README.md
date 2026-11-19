# `sync-branches-push` GitHub Action

Merge the current branch into a base branch (e.g. master into develop) via the GitHub API, with a Slack notification on failure.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/sync-branches-push@main
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
| `git-config-username` | no |  | Git configuration - username (unused, kept for compatibility with the original workflow) |
| `git-config-email` | no |  | Git configuration - email (unused, kept for compatibility with the original workflow) |
| `base-branch` | no | `develop` | Branch that will be synchronized with current branch |
| `actor-override` | no |  | Override the author of event |
| `slack-token` | yes |  | Slack API token |
| `github-token` | yes |  | Github token used to merge. This cannot be GITHUB_TOKEN if the branch is protected. It must be a real github user (or service account) with an exception from branch protection. |

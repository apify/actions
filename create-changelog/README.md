# `create-changelog` GitHub Action

Create a release (changelog, GitHub release, Slack notification) using apify/release-pr-action.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Notes

```
The caller chooses `runs-on` (the original workflow used ubuntu-22.04-arm64).
```

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/create-changelog@main
        with:
          changelog-scopes: ...
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `revision` | no |  | Tag given to container image (shown in the failure message) |
| `changelog-scopes` | yes |  | Changelog scopes (i.e { "App": ["app", "application"] }) |
| `changelog-method` | no | `pull_request_description` | How to fetch changelog |
| `release-name-method` | no | `branch` | How to fetch next release name |
| `slack-channel-id` | no |  | Slack Channel ID for changelog |
| `slack-channel-id-for-failure-msg` | no |  | Slack Channel ID for failure messages |
| `release-name` | no |  | This value overrides release name got from release branch name |
| `release-name-prefix` | no | `v` | Prepend prefix to releaseName |
| `base-branch` | no | `master` | Base branch against which to create pull request |
| `actor-override` | no |  | Override the author of event |
| `slack-token` | no |  | Slack API token |
| `open-ai-token` | no |  | Open AI token |
| `github-token` | no | `${{ github.token }}` | GitHub token |

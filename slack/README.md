# `slack` GitHub Action

Send a Slack message about a job with a status color (blue when started, green on success, red otherwise).

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/slack@main
        with:
          slack-channel-id: ...
          subject: ...
          slack-token: ...
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `slack-channel-id` | yes |  | Slack Channel ID |
| `subject` | yes |  | Subject of message (i.e. deploy, tests,..) |
| `revision` | no |  | Revision (semver, short commit sha,..). Defaults to the short commit SHA. |
| `actor-override` | no |  | Override the author of event |
| `job-status` | no |  | Determines the color and status of message. If omitted blue info message is sent |
| `slack-token` | yes |  | Slack API token |

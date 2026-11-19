# `release-marker` GitHub Action

Mark a release in Grafana and/or Sentry, with a Slack notification on failure.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/release-marker@main
        with:
          revision: ...
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `revision` | yes |  | Revision that will be marked |
| `sentry-org` | no |  | Sentry Organization |
| `sentry-project` | no |  | Sentry project |
| `sentry-environment-frontend` | no |  | Sentry environment (frontend) |
| `sentry-environment-backend` | no |  | Sentry environment (backend) |
| `slack-channel-id` | no |  | Slack Channel ID (notified on failure) |
| `actor-override` | no |  | Override the author of event |
| `environment` | no |  | Environment |
| `grafana-annotation-tag` | no | `default` | Custom annotation tag |
| `sentry-auth-token` | no |  | Sentry authentication token |
| `slack-token` | no |  | Slack API token |
| `grafana-api-token` | no |  | Grafana API token |

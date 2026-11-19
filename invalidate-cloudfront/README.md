# `invalidate-cloudfront` GitHub Action

Invalidate a path of an AWS CloudFront distribution, with a Slack notification on failure.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Notes

```
The caller chooses `runs-on` and `environment` (the environment name becomes part of the OIDC token subject).
With OIDC the caller job needs `permissions: id-token: write` and `contents: read`.
```

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/invalidate-cloudfront@main
        with:
          distribution-id: ...
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `distribution-id` | yes |  | AWS CloudFront distribution ID |
| `path` | no | `/*` | Path to invalidate (i.e /*) |
| `aws-role-arn` | no |  | AWS IAM role ARN |
| `use-oidc` | no | `false` | Whether to use OIDC for assume role (`true` / `false`) |
| `github-oidc-role-arn` | no |  | Github OIDC role ARN |
| `aws-region` | no | `us-east-1` | AWS region |
| `aws-session-duration` | no | `3600` | AWS session duration in seconds |
| `slack-channel-id` | no |  | Slack Channel ID (notified on failure) |
| `actor-override` | no |  | Override the author of event |
| `revision` | no |  | Revision (semver, short commit sha,..) |
| `aws-access-key-id` | no |  | AWS access key ID (when not using OIDC) |
| `aws-secret-access-key` | no |  | AWS secret access key (when not using OIDC) |
| `slack-token` | no |  | Slack API token |

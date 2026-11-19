# `deploy-cloudformation` GitHub Action

Deploy a CloudFormation stack, optionally packaging the template to S3 and notifying Slack.

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
      - uses: apify/actions/deploy-cloudformation@main
        with:
          stack-name: ...
          template-file: ...
          revision: ...
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `aws-role-arn` | no |  | AWS IAM role ARN |
| `use-oidc` | no | `false` | Whether to use OIDC for assume role (`true` / `false`) |
| `github-oidc-role-arn` | no | `arn:aws:iam::031263542130:role/GithubOIDCRole` | Github OIDC role ARN |
| `aws-region` | no | `us-east-1` | AWS region |
| `aws-session-duration` | no | `3600` | AWS session duration in seconds |
| `slack-channel-id` | no |  | Slack Channel ID |
| `actor-override` | no |  | Override the author of event |
| `stack-name` | yes |  | Cloudformation stack name |
| `template-file` | yes |  | Path to cloudformation template file |
| `revision` | yes |  | Revision of change |
| `s3-bucket` | no |  | S3 bucket where templates will be stored |
| `parameters` | no |  | Parameters (plain text or file) for cloudformation template |
| `capabilities` | no |  | Cloudformation stack capabilities |
| `cloudformation-role-arn` | no |  | IAM role ARN assumed by Cloudformation service |
| `additional-parameters` | no |  | Additional parameters of aws cloudformation deploy |
| `aws-access-key-id` | no |  | AWS access key ID (when not using OIDC) |
| `aws-secret-access-key` | no |  | AWS secret access key (when not using OIDC) |
| `slack-token` | no |  | Slack API token |
| `secret-parameters` | no |  | Secret parameters (plain text or file) for cloudformation template. Limited security, scoped per CF stack. |

## Outputs

| Output | Description |
|---|---|
| `stack-outputs` | Stringified json containing outputs of cloudformation stack |

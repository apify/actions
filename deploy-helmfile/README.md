# `deploy-helmfile` GitHub Action

Deploy a helmfile to an EKS cluster, optionally over Tailscale VPN and with Slack notifications.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Notes

```
The caller chooses `runs-on` (the original workflow used ubuntu-22.04-arm64) and `environment`
(the environment name becomes part of the OIDC token subject).
With OIDC the caller job needs `permissions: id-token: write` and `contents: read`.
```

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/deploy-helmfile@main
        with:
          revision: ...
          eks-cluster-name: ...
          helmfile-path: ...
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `aws-role-arn` | no |  | AWS IAM role ARN |
| `use-oidc` | no | `false` | Whether to use OIDC for assume role (`true` / `false`) |
| `github-oidc-role-arn` | no |  | Github OIDC role ARN |
| `aws-region` | no | `us-east-1` | AWS region |
| `aws-session-duration` | no | `3600` | AWS session duration in seconds |
| `revision` | yes |  | Tag given to container image |
| `eks-cluster-name` | yes |  | EKS cluster name |
| `helmfile-path` | yes |  | Path to helmfile.yaml |
| `helmfile-environment` | no |  | Helmfile environment |
| `helmfile-other-args` | no |  | Other helmfile parameters |
| `env-variables` | no |  | Space separated list of environment variables to be set during helmfile apply (e.g. `FOO=bar BAR=foo`) |
| `slack-channel-id` | no |  | Slack Channel ID |
| `actor-override` | no |  | Override the author of event |
| `helmfile-command` | no | `apply --suppress-secrets --suppress-diff` | Command run by helmfile |
| `enable-vpn` | no | `true` | Enable VPN connection (`true` / `false`) |
| `architecture` | no |  | CPU architecture of the runner, `amd64` or `arm64`. Auto-detected from the runner when empty. |
| `eksctl-version` | no | `v0.210.0` | eksctl version |
| `helmfile-version` | no | `v0.171.0` | Helmfile version |
| `helm-diff-version` | no | `v3.9.6` | Helm diff version |
| `tailscale-version` | no | `1.104.4` | Tailscale version |
| `tailscale-ping` | no | `BA6D21AB896DE795C7BF29050D03C3A8.gr7.us-east-1.eks.amazonaws.com` | Tailscale ping target |
| `aws-access-key-id` | no |  | AWS access key ID (when not using OIDC) |
| `aws-secret-access-key` | no |  | AWS secret access key (when not using OIDC) |
| `slack-token` | no |  | Slack API token |
| `ts-oauth-client-id` | no |  | Tailscale OAuth Client ID |
| `ts-oauth-secret` | no |  | Tailscale OAuth Client Secret |

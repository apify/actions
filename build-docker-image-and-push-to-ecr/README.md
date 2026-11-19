# `build-docker-image-and-push-to-ecr` GitHub Action

Build a Docker image with Buildx and push it to an ECR registry, optionally over Tailscale VPN and with Slack notifications.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Notes

```
The caller job chooses `runs-on` and `environment` (the environment name becomes part of the OIDC token subject).
With OIDC the caller job needs `permissions: id-token: write` and `contents: read`.
```

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/build-docker-image-and-push-to-ecr@main
        with:
          image-tag: ...
          repository: ...
          registry: ...
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `aws-role-arn` | no |  | AWS IAM role ARN to chain-assume after the OIDC role. Empty means no chaining. |
| `use-oidc` | no | `false` | Whether to use OIDC for assume role (`true` / `false`) |
| `github-oidc-role-arn` | no |  | GitHub OIDC role ARN |
| `aws-region` | no | `us-east-1` | AWS region |
| `aws-session-duration` | no | `3600` | AWS session duration in seconds |
| `image-tag` | yes |  | Tag given to container image |
| `repository` | yes |  | Container repository |
| `registry` | yes |  | Container registry |
| `docker-file-path` | no | `./deploy/Dockerfile` | Path to Dockerfile |
| `slack-channel-id` | no |  | Slack Channel ID |
| `set-node-version` | no | `true` | Put NODE_VERSION from the nvmrc file to docker build args (`true` / `false`) |
| `nvmrc-path` | no | `.nvmrc` | Path to nvmrc file |
| `docker-build-args` | no | `FOO=BAR` | Values for --build-arg argument, separated by whitespace |
| `docker-context` | no | `.` | Relative path to git context |
| `actor-override` | no |  | Override the author of event |
| `enable-vpn` | no | `false` | Enable VPN connection (`true` / `false`) |
| `tailscale-ping` | no | `BA6D21AB896DE795C7BF29050D03C3A8.gr7.us-east-1.eks.amazonaws.com` | Tailscale ping target |
| `aws-access-key-id` | no |  | AWS access key ID (when not using OIDC) |
| `aws-secret-access-key` | no |  | AWS secret access key (when not using OIDC) |
| `slack-token` | no |  | Slack API token |
| `npm-token` | no |  | Put NPM_TOKEN to docker build args |
| `build-secret-env-vars` | no |  | Secrets passed to build as secret file (comma-separated). See https://docs.docker.com/engine/reference/commandline/buildx_build/#secret |
| `ts-oauth-client-id` | no |  | Tailscale OAuth Client ID |
| `ts-oauth-secret` | no |  | Tailscale OAuth Client Secret |

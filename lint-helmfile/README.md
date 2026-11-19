# `lint-helmfile` GitHub Action

Lint a helmfile.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/lint-helmfile@main
        with:
          helmfile-path: ...
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `helmfile-path` | yes |  | Path to helmfile.yaml |
| `helmfile-environment` | no |  | Helmfile environment |
| `helmfile-other-args` | no |  | Other helmfile parameters |
| `env-variables` | no |  | Space separated list of environment variables to be set during helmfile sync (e.g. `FOO=bar BAR=foo`) |
| `helmfile-version` | no | `v0.171.0` | Helmfile version |
| `architecture` | no |  | CPU architecture of the runner, `amd64` or `arm64`. Auto-detected from the runner when empty. |

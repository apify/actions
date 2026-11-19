# `lint-cloudformation` GitHub Action

Lint CloudFormation templates with cfn-lint.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/lint-cloudformation@main
        with:
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `path` | no | `./deploy/cloudformation/**/*.yaml` | Path to lint |
| `ignore-checks` | no | `W3002` | Codes to ignore (equivalent to --ignore-checks option) |
| `cfn-lint-version` | no | `1.51.4` | cfn-lint version |

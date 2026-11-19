# `lint-gh-actions` GitHub Action

Lint GitHub workflows with actionlint.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/lint-gh-actions@main
        with:
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `extra-args` | no |  | Additional extra arguments for actionlint |
| `actionlint-version` | no | `1.7.12` | actionlint version |

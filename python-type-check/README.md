# `python-type-check` GitHub Action

Run the type check of a Python project for a single Python version (use a job matrix in the caller to cover several).

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/python-type-check@main
        with:
          python-version: ...
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `python-version` | yes |  | Python version to be used. |
| `install-command` | no | `uv run poe install-dev` | Command to install Python dependencies. |
| `type-check-command` | no | `uv run poe type-check` | Command to run type check. |

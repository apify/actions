# `python-docs-check` GitHub Action

Build the docs website of a Python project to check it builds.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/python-docs-check@main
        with:
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `python-version` | no | `3.14` | Python version to use for building docs. |
| `node-version` | no | `24` | Node.js version to use for building docs. |
| `install-command` | no | `uv run poe install-dev` | Command to install Python dependencies. |
| `build-docs-command` | no | `uv run poe build-docs` | Command to build docs website. |
| `apify-signing-token` | no |  | Token for signing Apify packages. |

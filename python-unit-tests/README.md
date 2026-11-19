# `python-unit-tests` GitHub Action

Run Python unit tests for a single Python version and OS (use a job matrix in the caller to cover several).

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Notes

```
Matrix, timeout and fail-fast belong to the caller job, for example:

  jobs:
    unit_tests:
      strategy:
        fail-fast: false
        matrix:
          os: [ubuntu-latest, windows-latest, macos-latest]
          python-version: ["3.10", "3.14"]
      runs-on: ${{ matrix.os }}
      timeout-minutes: 60
      steps:
        - uses: apify/actions/python-unit-tests@main
          with:
            python-version: ${{ matrix.python-version }}
            upload-coverage: ${{ matrix.os == 'ubuntu-latest' && matrix.python-version == '3.14' }}
```

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/python-unit-tests@main
        with:
          python-version: ...
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `python-version` | yes |  | Python version to be used. |
| `upload-coverage` | no | `false` | Whether to upload coverage to Codecov (`true` / `false`). Only effective when `codecov-token` is set (e.g. not for fork PRs). |
| `install-command` | no | `uv run poe install-dev` | Command to install Python dependencies. |
| `run-tests-command` | no | `uv run poe unit-tests-cov` | Command to run unit tests. |
| `tests-concurrency` | no | `auto` | Number of parallel test processes. Uses pytest-xdist numprocesses value. |
| `apify-httpbin-token` | no |  | Token for Apify httpbin service. If provided, uses httpbin.apify.actor, otherwise falls back to httpbin.org. |
| `codecov-token` | no |  | Token for uploading coverage reports to Codecov. |

# `python-integration-tests` GitHub Action

Run Python integration tests for a single Python version (use a job matrix in the caller to cover several).

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Notes

```
Matrix, concurrency and conditions belong to the caller job. The original reusable workflow did:

  concurrency:
    group: integration_tests     # only one run at a time, to avoid exceeding API usage limits of the test user
  jobs:
    integration_tests:
      # Only for PRs from the main repository or for pushes to master.
      if: >-
        (github.event_name == 'pull_request' && github.event.pull_request.head.repo.owner.login == 'apify') ||
        (github.event_name == 'push' && github.ref == 'refs/heads/master')
      strategy:
        matrix:
          os: [ubuntu-latest]
          python-version: ["3.10", "3.14"]
        max-parallel: 1          # no parallel tests to avoid exceeding API limits
      runs-on: ${{ matrix.os }}
      steps:
        - uses: apify/actions/python-integration-tests@main
          with:
            python-version: ${{ matrix.python-version }}
            upload-coverage: ${{ matrix.os == 'ubuntu-latest' && matrix.python-version == '3.14' }}
            ...
```

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/python-integration-tests@main
        with:
          python-version: ...
          apify-test-user-python-sdk-api-token: ...
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `python-version` | yes |  | Python version to be used. |
| `upload-coverage` | no | `false` | Whether to upload coverage to Codecov (`true` / `false`). Only effective when `codecov-token` is set (e.g. not for fork PRs). |
| `install-command` | no | `uv run poe install-dev` | Command to install Python dependencies. |
| `run-tests-command` | no | `uv run poe integration-tests-cov` | Command to run integration tests. |
| `tests-concurrency` | no | `auto` | Number of parallel test processes. Uses pytest-xdist numprocesses value. |
| `apify-test-user-python-sdk-api-token` | yes |  | Apify API token for the primary Python SDK test user. |
| `apify-test-user-2-api-token` | no |  | Apify API token for a secondary test user, used in multi-user scenarios (e.g. sharing restricted storage). |
| `codecov-token` | no |  | Token for uploading coverage reports to Codecov. |

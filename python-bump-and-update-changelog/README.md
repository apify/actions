# `python-bump-and-update-changelog` GitHub Action

Bump the package version in pyproject.toml, write the changelog, and push a signed commit.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/python-bump-and-update-changelog@main
        with:
          version-number: ...
          apify-service-account-github-token: ...
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `python-version` | no | `3.14` | Python version to use |
| `version-number` | yes |  | Version number of the new release (no leading "v") |
| `changelog` | no |  | Deprecated: the complete changelog as a string. Used only when the changelog artifact is missing, and unusable once the changelog grows over 128 KiB. Callers on apify/actions/git-cliff-release v1.4.1 or newer should stop passing it. |
| `changelog-artifact-name` | no | `git-cliff-changelog` | Name of the artifact holding the changelog, as uploaded by apify/actions/git-cliff-release |
| `changelog-path` | no | `CHANGELOG.md` | Path to the changelog file within the repository |
| `apify-service-account-github-token` | yes |  | GitHub token of the Apify service account, used to check out the repository and push the commit |

## Outputs

| Output | Description |
|---|---|
| `changelog-commitish` | Git HEAD after the commit and push |

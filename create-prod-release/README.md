# `create-prod-release` GitHub Action

Create a new release branch, the first step for deployment to staging and production.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Notes

```
Validates the current branch (`develop` for a standard release, `master` for a hotfix), checks there is no pending
release PR, checks `develop` is in sync with the base branch, and creates the release branch with a GitHub App
installation token (the default GITHUB_TOKEN cannot trigger workflows on the new branch).
```

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/create-prod-release@main
        with:
          github-app-id: ${{ vars.RELEASE_APP_ID }}
          github-app-private-key: ${{ secrets.RELEASE_APP_PRIVATE_KEY }}
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `release-branch-prefix` | no | `release` | Prefix used for release branch names |
| `base-branch` | no | `master` | Branch treated as production base (patch releases cut from here) |
| `github-token` | no | `${{ github.token }}` | Token used to list pull requests, releases and compare branches |
| `github-app-id` | yes |  | ID or client ID of the GitHub App used to create the release branch |
| `github-app-private-key` | yes |  | Private key of the GitHub App used to create the release branch |

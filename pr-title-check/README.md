# `pr-title-check` GitHub Action

This action validates pull request titles by checking them for typos (using [typos](https://github.com/crate-ci/typos)) and verifying they follow the [Conventional Commits](https://www.conventionalcommits.org/) format (using [action-semantic-pull-request](https://github.com/amannn/action-semantic-pull-request)).

The action checks out the repository so that any `_typos.toml` configuration present in the repo is respected.

## Usage

```yaml
name: CI (PR)

on:
  pull_request:

permissions:
  contents: read
  pull-requests: read

jobs:
  pr-title-check:
    name: PR title check
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/pr-title-check@main
```

### Inputs

- `github-token` (optional, default `${{ github.token }}`) — Token used by the semantic PR title check to read PR metadata via the GitHub API.

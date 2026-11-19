# `copy-proofread-review` GitHub Action

Proofread the public-facing copy changed in a pull request against Apify's style guide and post inline suggestions.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Notes

```
Rules come from the `apify-proofreader` skill in apify/agent-skills-internal.
The caller owns the trigger, `concurrency` (e.g. group `copy-proofread-review-<PR number>` with cancel-in-progress)
and `timeout-minutes`. The caller job needs:
  permissions:
    contents: read
    issues: write        # remove the trigger label when done
    pull-requests: write # post the review + inline comments
```

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/copy-proofread-review@main
        with:
          paths: ...
          anthropic-api-key: ...
          agent-skills-repo-github-token: ...
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `paths` | yes |  | Newline-separated list of paths (relative to the repo root) whose copy should be reviewed. Everything else in the diff is ignored. |
| `repo-instructions` | no |  | Repo-specific rules for telling copy apart from code, appended to the generic ones. Use it for conventions the model cannot infer, e.g. which argument of a helper holds the human-readable message. |
| `anthropic-api-key` | yes |  | Anthropic API key used by the review agent. |
| `agent-skills-repo-github-token` | yes |  | GitHub token with read access to apify/agent-skills-internal. |
| `github-token` | no | `${{ github.token }}` | GitHub token used to read the PR, post comments and remove the trigger label. |

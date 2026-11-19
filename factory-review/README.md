# `factory-review` GitHub Action

AI review and auto-approval pipeline of apify/ai-developer, run on pull request events.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Notes

```
The review and auto-approval pipeline of apify/ai-developer, called from a short workflow stub in each repository
that opts in. The stub must live in the repository itself: only a workflow GitHub runs there receives every push,
and a push that changes the code has to withdraw the bot's approval.

The pipeline lives in apify/ai-developer, which is internal, and a public repository cannot call an internal
workflow or action. So this action holds only the wiring: it checks ai-developer out with the bot's token and runs
the action from that checkout.

It runs when @apify-factory is requested as a reviewer, and also when the request is withdrawn, the PR goes back to
draft, or a push changes the code, to withdraw the approval with it. In a repository whose factory_auto_review custom
property is true, it also reviews a ready pull request when it opens, reopens, is marked ready or receives a push.
Only apify-factory's own approvals are ever withdrawn.

The caller job owns `runs-on`, `timeout-minutes` (the original used 60) and:
  permissions:
    contents: read
    pull-requests: write
  concurrency:   # Never cancel a running review: the action posts nothing from a cancelled run.
    group: factory-review-job-${{ github.event.pull_request.number }}
    cancel-in-progress: false
```

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/factory-review@main
        with:
          apify-factory-github-token: ...
          anthropic-api-key: ...
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `policy` | no |  | Optional JSON policy overrides for the calling repository (see the ai-developer auto-approve README). |
| `ai-developer-ref` | no | `main` | Ref of apify/ai-developer to run the pipeline from. |
| `github-token` | no | `${{ github.token }}` | GitHub token used to read the review state of the pull request. |
| `apify-factory-github-token` | yes |  | GitHub token of the apify-factory bot. |
| `anthropic-api-key` | yes |  | Anthropic API key used by the review (the ANTHROPIC_API_KEY_APIFY_FACTORY_REVIEW secret). |
| `apify-factory-callback-token` | no |  | Apify token that reaches the factory's core Actor. With `factory-public-url`, each review becomes a run on the factory dashboard. |
| `factory-public-url` | no |  | Public URL of the factory (the organization variable FACTORY_PUBLIC_URL). |

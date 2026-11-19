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
```

## Configuring actionlint

The action does not take extra actionlint arguments. If you need to configure actionlint, for example to declare custom runner labels or config variables, or to ignore some errors, put an `actionlint.yaml` file in the `.github` folder of your repository. actionlint finds it there on its own.

```yaml
# .github/actionlint.yaml
self-hosted-runner:
  labels:
    - my-custom-runner
config-variables:
  - MY_VARIABLE
paths:
  .github/workflows/**/*.yaml:
    ignore:
      - 'property "my_output" is not defined.+'
```

See the [actionlint configuration docs](https://github.com/rhysd/actionlint/blob/main/docs/config.md) for all options.

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `actionlint-version` | no | `1.7.12` | actionlint version |

# `grafana-annotation` GitHub Action

Create a Grafana annotation, or close out an existing one by setting its end time to now.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/grafana-annotation@main
        with:
          grafana-annotation-text: ...
          grafana-api-token: ...
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `grafana-annotation-tags` | no |  | Custom annotation tags, one per line |
| `grafana-annotation-text` | yes |  | Custom annotation text |
| `grafana-annotation-id` | no |  | Annotation Id. When set, the annotation is closed out instead of created. |
| `grafana-api-token` | yes |  | Grafana API token |

## Outputs

| Output | Description |
|---|---|
| `annotation-id` | Annotation Id |

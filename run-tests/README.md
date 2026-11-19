# `run-tests` GitHub Action

Install npm dependencies and run test scripts, with Slack notifications.

Composite-action version of the reusable workflow of the same purpose from `apify/workflows`. Secrets are passed as inputs, and job-level settings (`runs-on`, `environment`, `permissions`, `concurrency`, `timeout-minutes`, matrices) belong to the calling job.

## Usage

```yaml
jobs:
  job:
    runs-on: ubuntu-latest
    steps:
      - uses: apify/actions/run-tests@main
        with:
          npm-scope: ...
          scripts: ...
```

## Inputs

| Input | Required | Default | Description |
|---|---|---|---|
| `node-version-file` | no | `.nvmrc` | Path to node version file |
| `npm-registry-url` | no | `https://npm.pkg.github.com/` | NPM registry url |
| `npm-scope` | yes |  | NPM scope |
| `scripts` | yes |  | Scripts to run after `npm install`, as in package.json (e.g. `npm run build` and `npm run test` on separate lines) |
| `title` | no | `integration tests` | Title displayed in slack message |
| `revision` | no |  | Revision that is being tested (This is strictly informative) |
| `slack-channel-id` | no |  | Slack Channel ID |
| `actor-override` | no |  | Override the author of event |
| `env-variables` | no |  | Space separated list of environment variables to be set during test phase (e.g. `FOO=bar BAR=foo`) |
| `npm-token` | no |  | NPM token |
| `slack-token` | no |  | Slack API token |
| `test-user-api-token` | no |  | API token of test user |

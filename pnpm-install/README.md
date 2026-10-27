# `pnpm-install` Github Action

This action installs dependencies using pnpm. It also caches the whole pnpm store, for faster subsequent installs.

## Usage

```yaml
steps:
  - name: Install pnpm and dependencies
    uses: apify/actions/pnpm-install@1.0.0
```

### Inputs

- `working-directory` (optional, default `.`) — Directory containing `pnpm-lock.yaml`.
- `github-registry-token` (optional) — When set, configures `//npm.pkg.github.com/:_authToken=<token>` in `~/.npmrc` before installing, so private `@<scope>/*` packages published to the GitHub npm registry can be resolved. Pass a token with read access to those packages.

### Example: install with GitHub registry auth

```yaml
steps:
  - name: setup Node.js
    uses: actions/setup-node@v6
    with:
      node-version-file: '.nvmrc'

  - name: Install pnpm and dependencies
    uses: apify/actions/pnpm-install@1.0.0
    with:
      github-registry-token: ${{ secrets.APIFY_SERVICE_ACCOUNT_GITHUB_REGISTRY_TOKEN }}
```

## Windows runners

On Windows the action also points `TMP` and `TEMP` at `RUNNER_TEMP` for the rest of the job. The default temp dir lives on a network-backed disk that is several times slower at small-file writes than the runner's local SSD, which matters for anything that unpacks a project or a `node_modules` tree into the temp dir.

If the job installs Playwright browsers, gate `--with-deps` on Linux. On Windows the flag enables the Media Foundation feature, which takes about three minutes and only adds video codecs:

```yaml
  - name: Install Playwright browsers
    run: pnpm exec playwright install chromium ${{ runner.os == 'Linux' && '--with-deps' || '' }}
```

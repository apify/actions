# `git-cliff-release` Github Action

This action uses conventional commit history to determine the recommended version for a release and generate a changelog and release notes.

## Inputs

- **release_type**: One of `auto` (default), `prerelease`, `patch`, `minor`, `major` and `custom`. `auto` means that the version will be determined based on the commit history, `custom` will use the value of the `custom_version` input parameter, and `patch`, `minor` and `major` allow forcing the bump type. `prerelease` always bumps the patch version - see [Pre-releases](#pre-releases).
- **custom_version**: Optional unless the `release_type` is set to `custom`.
- **cliff_config_path**: Path to a configuration file for git-cliff. If none is given, a built-in configuration will be used.
- **existing_changelog_path**: Path to an existing changelog. If given, the new changelog contents will be prepended to it intelligently.
- **token**: Github token to be used by github CLI (should be relevant for private repositories only)
- **changelog_artifact_name**: Name of the artifact the generated changelog is uploaded as, `git-cliff-changelog` by default. Set it when a single workflow run calls this action more than once.
- **prerelease_id**: Pre-release identifier for `release_type: prerelease` - `alpha`, `beta` (default) or `rc`.
- **prerelease_registry**: Registry to probe for the highest already-published pre-release number - `npm`, `pypi` or `crates`. Empty by default, which skips pre-release version resolution and leaves the `prerelease_number` and `prerelease_version` outputs empty. Setting it also requires `prerelease_package`.
- **prerelease_package**: Name of the package or crate to look up in `prerelease_registry`. Required alongside it.

## Outputs

- **is_prerelease**: For convenience - was the action triggered with release_type = "prerelease"?
- **version_number**: Version number of the new release (no leading "v")
- **tag_name**: Tag name for the new release (with a leading "v")
- **release_notes**: Release notes for the new release
- **changelog**: The complete changelog
- **changelog_artifact_name**: Name of the artifact holding the generated changelog
- **prerelease_id**: The `prerelease_id` input, echoed for convenience
- **prerelease_number**: One more than the highest pre-release number already published for `version_number`
- **prerelease_version**: Semver-flavoured pre-release version for npm and crates.io, e.g. `1.2.4-beta.7`
- **prerelease_version_pep440**: PEP 440-flavoured pre-release version for PyPI, e.g. `1.2.4b7`

## Consuming the changelog

The generated changelog is available in two forms, and only one of them scales:

- The artifact named by the `changelog_artifact_name` output holds it as a single `CHANGELOG.md` file. Download it with `actions/download-artifact` - anywhere in the same workflow run, including inside a reusable workflow - and move it into place.
- The `changelog` output holds it as a string. Action inputs are passed to the action as environment variables, and Linux caps a single environment variable at 128 KiB. A changelog past that size makes the consuming step fail to start with `Argument list too long`, so write the file from the artifact and keep the output for short values such as a release body.

## Pre-releases

`release_type: prerelease` bumps the patch version and leaves `version_number` and `tag_name` bare, because
that is the version the release workflow commits and tags. The pre-release suffix is exposed separately, so
set `prerelease_registry` and `prerelease_package` and publish `prerelease_version` (npm, crates.io) or
`prerelease_version_pep440` (PyPI) instead:

```yaml
- name: Prepare release metadata
  id: metadata
  uses: apify/actions/git-cliff-release@1.0.0
  with:
    release_type: prerelease
    prerelease_registry: npm
    prerelease_package: apify-client
    existing_changelog_path: CHANGELOG.md
- name: Set pre-release version
  run: npm version --no-git-tag-version "${{ steps.metadata.outputs.prerelease_version }}"
- name: Publish
  run: npm publish --tag "${{ steps.metadata.outputs.prerelease_id }}"
```

The number is one more than the highest already published under the same base version and identifier, so it
restarts at `0` on every patch bump and on a switch from `beta` to `rc`. Yanked and deprecated versions still
count - they keep occupying the version namespace. Switching a project to a different `prerelease_id` mid-cycle
is safe; switching `prerelease_registry` is not, because each registry carries its own counter.

Publishing one commit to several registries is out of scope: the probed registry is the only source of truth,
so a second registry that received a publish this one missed will reject the number.

## Example usage

Update the changelog on each push to master so that it contains an up-to-date description of the not-yet-released changes:

```yaml
name: Pre-release

on:
  push:
    branches:
      - master

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Prepare release metadata
        id: metadata
        uses: apify/actions/git-cliff-release@1.0.0
        with:
          release_type: prerelease
      - name: Update CHANGELOG.md
        uses: actions/download-artifact@v8
        with:
          name: ${{ steps.metadata.outputs.changelog_artifact_name }}
          path: .
      - name: Stage changes
        run: git add -A
      - name: Commit changes
        uses: apify/actions/signed-commit@v1.0.0
        with:
          commit-message: "chore(release): Update changelog and package version [skip ci]"
          github-token: ${{ secrets.GITHUB_TOKEN }}
```

Manually trigger a release:

```yaml
name: Release

on:
  workflow_dispatch:
    inputs:
      release_type:
        description: Release type
        required: true
        type: choice
        default: auto
        options:
          - auto
          - patch
          - minor
          - major

jobs:
  test:
    runs-on: ubuntu-latest
    env:
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    steps:
      - name: Checkout
        uses: actions/checkout@v4
      - name: Prepare release metadata
        id: metadata
        uses: apify/actions/git-cliff-release@1.0.0
        with:
          release_type: ${{ inputs.release_type }}
      - name: Update CHANGELOG.md
        uses: actions/download-artifact@v8
        with:
          name: ${{ steps.metadata.outputs.changelog_artifact_name }}
          path: .
      - name: Stage changes
        run: git add -A
      - name: Commit changes
        id: commit
        uses: apify/actions/signed-commit@v1.0.0
        with:
          commit-message: "chore(release): Update changelog and package version [skip ci]"
          github-token: ${{ secrets.GITHUB_TOKEN }}
      - name: Create release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ steps.metadata.outputs.tag_name }}
          name: ${{ steps.metadata.outputs.version_number }}
          target_commitish: ${{ steps.commit.outputs.commit_long_sha }}
          body: ${{ steps.metadata.outputs.release_notes }}
```

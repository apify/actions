# `git-cliff-release` Github Action

This action uses conventional commit history to determine the recommended version for a release and generate a changelog and release notes.

## Inputs

- **release_type**: One of `auto` (default), `patch`, `minor`, `major` and `custom`. `auto` means that the version will be determined based on the commit history, `custom` will use the value of the `custom_version` input parameter, and `patch`, `minor` and `major` allow forcing the bump type.
- **custom_version**: Optional unless the `release_type` is set to `custom`.
- **cliff_config_path**: Path to a configuration file for git-cliff. If none is given, a built-in configuration will be used.
- **existing_changelog_path**: Path to an existing changelog. If given, the new changelog contents will be prepended to it intelligently.
- **token**: Github token to be used by github CLI (should be relevant for private repositories only)
- **changelog_artifact_name**: Name of the artifact the generated changelog is uploaded as, `git-cliff-changelog` by default. Set it when a single workflow run calls this action more than once.

## Outputs

- **is_prerelease**: For convenience - was the action triggered with release_type = "prerelease"?
- **version_number**: Version number of the new release (no leading "v")
- **tag_name**: Tag name for the new release (with a leading "v")
- **release_notes**: Release notes for the new release
- **changelog**: The complete changelog
- **changelog_artifact_name**: Name of the artifact holding the generated changelog

## Consuming the changelog

The generated changelog is available in two forms, and only one of them scales:

- The artifact named by the `changelog_artifact_name` output holds it as a single `CHANGELOG.md` file. Download it with `actions/download-artifact` - anywhere in the same workflow run, including inside a reusable workflow - and move it into place.
- The `changelog` output holds it as a string. Action inputs are passed to the action as environment variables, and Linux caps a single environment variable at 128 KiB. A changelog past that size makes the consuming step fail to start with `Argument list too long`, so write the file from the artifact and keep the output for short values such as a release body.

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

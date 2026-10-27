from __future__ import annotations

import json
import re
import subprocess
import sys
from argparse import ArgumentParser, BooleanOptionalAction
from pathlib import Path
from typing import Any

# A CommonMark code span: a run of backticks, then content, then a run of the same length.
CODE_SPAN = re.compile(r'(?<!`)(`+)(?!`).+?(?<!`)\1(?!`)')

# Characters that MDX parses as JSX or expressions. Docusaurus renders the changelog as MDX, where a stray `<` or `{`
# breaks the docs build.
MDX_SPECIAL = re.compile(r'([<{}])')


def escape_markdown(text: str) -> str:
    """Backslash-escape MDX special characters outside code spans, so the text renders the same on GitHub and in MDX."""
    parts = []
    position = 0

    for code_span in CODE_SPAN.finditer(text):
        parts.append(MDX_SPECIAL.sub(r'\\\1', text[position : code_span.start()]))
        parts.append(code_span.group())
        position = code_span.end()

    parts.append(MDX_SPECIAL.sub(r'\\\1', text[position:]))
    return ''.join(parts)


def load_pr_issues(owner: str, repo: str) -> dict[int, list[int]]:
    output = subprocess.check_output(
        [
            str(Path(__file__).parent / 'fetch_pr_issues.sh'),
            owner,
            repo,
        ]
    )

    try:
        pr_issues = json.loads(output)
    except ValueError:
        print(f'fetch_pr_issues.sh output: {output}')
        raise

    if pr_issues is None:
        return {}

    return {int(key): value for key, value in pr_issues.items()}


def enhance_release(release: dict[str, Any], *, is_release_notes: bool, unreleased_version: str | None) -> None:
    release['extra'] = release['extra'] or {}
    release['extra']['is_release_notes'] = is_release_notes

    if release['version']:
        release['extra']['release_link'] = f'{repo_url}/releases/tag/{release["version"]}'
    elif unreleased_version:
        release['extra']['unreleased_version'] = unreleased_version


def enhance_commit(commit: dict[str, Any], pr_issues: dict[int, list[int]]) -> None:
    commit_remote = commit.get('remote', {})

    pr_number = commit_remote.get('pr_number')
    username = commit_remote.get('username')

    commit['extra'] = commit['extra'] or {}
    commit['extra']['commit_link'] = f'{repo_url}/commit/{commit["id"]}'

    if username:
        commit['extra']['username'] = username

    if pr_number:
        commit['extra']['closed_issues'] = pr_issues.get(pr_number, [])

        pr_link = f'{repo_url}/pull/{pr_number}'
        commit['extra']['pr_link'] = f'([#{pr_number}]({pr_link}))'
        commit['extra']['raw_pr_link'] = f'(#{pr_number})'

        commit['extra']['closed_issue_links'] = [
            f'[#{issue}]({repo_url}/issues/{issue})' for issue in commit['extra']['closed_issues']
        ]


parser = ArgumentParser()
parser.add_argument('--repo', type=str, required=True)
parser.add_argument('--unreleased-version', nargs='?', default=None, type=str)
parser.add_argument('--release-notes', action=BooleanOptionalAction)
parser.add_argument('--no-github', default=False, action='store_true')


if __name__ == '__main__':
    args = parser.parse_args()
    repo_url = f'https://github.com/{args.repo}'
    owner, repo = args.repo.split('/')

    pr_issues = load_pr_issues(owner, repo)
    context = json.load(sys.stdin)

    # `git-cliff --from-context` parses each commit again from `raw_message`, so the subject line is escaped there.
    for release in context:
        for commit in release['commits']:
            subject, newline, rest = commit['raw_message'].partition('\n')
            commit['raw_message'] = escape_markdown(subject) + newline + rest
            commit['message'] = escape_markdown(commit['message'])

    # The newest release heads the changelog. A stable one renders an empty unreleased marker block above itself, so the
    # markers are always present for the next prerelease to splice into.
    if context and not args.release_notes:
        context[0]['extra'] = context[0]['extra'] or {}
        context[0]['extra']['is_changelog_head'] = True

    if not args.no_github:
        for release in context:
            enhance_release(release, is_release_notes=args.release_notes, unreleased_version=args.unreleased_version)

            for commit in release['commits']:
                enhance_commit(commit, pr_issues)

    json.dump(context, sys.stdout)

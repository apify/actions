from __future__ import annotations

import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from argparse import ArgumentParser
from http import HTTPStatus
from typing import Any

USER_AGENT = 'apify/actions git-cliff-release (https://github.com/apify/actions)'

# The first spelling is the normalized one PyPI returns; matching the others PEP 440 accepts costs
# nothing and a miss would silently hand out a number the registry already refuses.
PEP440_SPELLINGS = {
    'alpha': ('a', 'alpha'),
    'beta': ('b', 'beta'),
    'rc': ('rc', 'c', 'pre', 'preview'),
}


def fetch_json(url: str, accept: str = 'application/json') -> dict[str, Any] | None:
    request = urllib.request.Request(url, headers={'User-Agent': USER_AGENT, 'Accept': accept})  # noqa: S310

    try:
        with urllib.request.urlopen(request, timeout=30) as response:  # noqa: S310
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code == HTTPStatus.NOT_FOUND:
            return None  # Nothing published under this name yet.
        raise


def npm_versions(package: str) -> list[str]:
    # A scoped name keeps its leading @ - only the slash is percent-encoded.
    name = urllib.parse.quote(package, safe='@')
    payload = fetch_json(f'https://registry.npmjs.org/{name}')
    return list((payload or {}).get('versions', {}))


def pypi_versions(package: str) -> list[str]:
    # The /pypi/<name>/json endpoint's `releases` key is deprecated in favour of the PEP 691 index,
    # which needs this Accept header or it serves HTML. `versions` is PEP 700 and includes yanks.
    name = urllib.parse.quote(package)
    payload = fetch_json(f'https://pypi.org/simple/{name}/', 'application/vnd.pypi.simple.v1+json')
    return list((payload or {}).get('versions', []))


def crates_versions(package: str) -> list[str]:
    # One request returns every version today, but the endpoint reserves the right to paginate and
    # orders semver-descending, so not following `next_page` would silently truncate at the newest.
    name = urllib.parse.quote(package)
    base_url = f'https://crates.io/api/v1/crates/{name}/versions'
    versions: list[str] = []
    query = ''

    while True:
        payload = fetch_json(f'{base_url}{query}')
        if payload is None:
            return versions

        versions += [version['num'] for version in payload.get('versions', [])]
        query = (payload.get('meta') or {}).get('next_page')
        if not query:
            return versions


def semver_pattern(base_version: str, prerelease_id: str) -> re.Pattern[str]:
    return re.compile(rf'{re.escape(base_version)}-{re.escape(prerelease_id)}\.(?P<number>\d+)')


def pep440_pattern(base_version: str, prerelease_id: str) -> re.Pattern[str]:
    spellings = '|'.join(PEP440_SPELLINGS[prerelease_id])
    return re.compile(rf'{re.escape(base_version)}[-_.]?(?:{spellings})[-_.]?(?P<number>\d+)')


REGISTRIES = {
    'npm': (npm_versions, semver_pattern),
    'pypi': (pypi_versions, pep440_pattern),
    'crates': (crates_versions, semver_pattern),
}


parser = ArgumentParser()
parser.add_argument('--registry', required=True, choices=sorted(REGISTRIES))
parser.add_argument('--package', required=True)
parser.add_argument('--base-version', required=True)
parser.add_argument('--prerelease-id', required=True, choices=sorted(PEP440_SPELLINGS))


if __name__ == '__main__':
    args = parser.parse_args()
    list_versions, build_pattern = REGISTRIES[args.registry]
    versions = list_versions(args.package)

    if args.base_version in versions:
        sys.exit(
            f'{args.package} {args.base_version} is already published to {args.registry}. '
            f'The last stable release is most likely missing its git tag.'
        )

    # Yanked and deprecated versions are counted on purpose - they still occupy the version
    # namespace, so skipping them would hand out a number the registry rejects.
    pattern = build_pattern(args.base_version, args.prerelease_id)
    numbers = [int(match['number']) for version in versions if (match := pattern.fullmatch(version))]
    number = max(numbers, default=-1) + 1

    print(f'prerelease_id={args.prerelease_id}')
    print(f'prerelease_number={number}')
    print(f'prerelease_version={args.base_version}-{args.prerelease_id}.{number}')
    print(f'prerelease_version_pep440={args.base_version}{PEP440_SPELLINGS[args.prerelease_id][0]}{number}')

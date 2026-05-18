#!/usr/bin/env -S uv run --script

# /// script
# requires-python = ">=3.14"
# dependencies = [
#   "rich~=14.0",
#   "typer~=0.19.0",
# ]
# ///

"""Verify that built artifacts (sdist + wheel) in `dist/` install and import correctly.

Designed to run against any Python package built via `uv build` / hatch / similar.
Used both locally and in CI by the `apify/actions/python-package-check` composite action.

Checks performed:

* `dist/` contains exactly one `.whl` and one `.tar.gz`.
* Sdist includes all expected source/data/metadata files and excludes `tests/`, `docs/`, `website/`, `examples/`,
  `.github/`, and `uv.lock`.
* Wheel includes all expected source/data files and a `*.dist-info/METADATA` entry.
* Wheel installs into a fresh venv and the package imports.
* Sdist installs into a fresh venv (forces pip to rebuild the wheel from sdist contents) and the package imports.
"""

from __future__ import annotations

import subprocess
import tarfile
import tempfile
import zipfile
from enum import StrEnum
from pathlib import Path
from typing import Annotated, Literal

import typer
from rich.console import Console

console = Console()


class PackageLayout(StrEnum):
    SRC = 'src'
    FLAT = 'flat'


REQUIRED_METADATA_FILES = (
    'LICENSE',
    'README.md',
    'CHANGELOG.md',
    'CONTRIBUTING.md',
    'pyproject.toml',
)

FORBIDDEN_SDIST_TOPLEVEL_DIRS = (
    'tests',
    'docs',
    'website',
    'examples',
    '.github',
)

FORBIDDEN_SDIST_FILES = ('uv.lock',)


def passed(msg: str) -> None:
    console.print(f'[green]PASS[/green]  {msg}')


def failed(msg: str) -> None:
    console.print(f'[red]FAIL[/red]  {msg}')


def info(msg: str) -> None:
    console.print(f'[dim]      {msg}[/dim]')


def section(title: str) -> None:
    console.print(f'\n[bold]=== {title} ===[/bold]')


def find_artifacts(dist_dir: Path) -> tuple[Path, Path]:
    if not dist_dir.is_dir():
        raise SystemExit(f'dist directory not found: {dist_dir}')
    wheels = sorted(dist_dir.glob('*.whl'))
    sdists = sorted(dist_dir.glob('*.tar.gz'))
    if len(wheels) != 1:
        raise SystemExit(f'Expected exactly one .whl in {dist_dir}, found {len(wheels)}: {wheels}')
    if len(sdists) != 1:
        raise SystemExit(f'Expected exactly one .tar.gz in {dist_dir}, found {len(sdists)}: {sdists}')
    return wheels[0], sdists[0]


def list_sdist_members(sdist: Path) -> list[str]:
    prefix = sdist.name.removesuffix('.tar.gz') + '/'
    with tarfile.open(sdist, 'r:gz') as tar:
        return [m.name.removeprefix(prefix) for m in tar.getmembers() if m.isfile() and m.name.startswith(prefix)]


def list_wheel_members(wheel: Path) -> list[str]:
    with zipfile.ZipFile(wheel) as zf:
        return [n for n in zf.namelist() if not n.endswith('/')]


def collect_repo_files(src_package_dir: Path) -> tuple[list[str], list[str]]:
    """Return (source_files, data_files) relative to the parent of `src_package_dir`.

    The relative-to-parent layout matches both sdist (`src/<pkg>/...`) and wheel (`<pkg>/...`).
    Data files are any non-`.py` file that isn't a compiled artifact or cache.
    """
    if not src_package_dir.is_dir():
        raise SystemExit(f'Source package directory not found: {src_package_dir}')
    src_root = src_package_dir.parent
    source: list[str] = []
    data: list[str] = []
    for path in src_package_dir.rglob('*'):
        if not path.is_file():
            continue
        if '__pycache__' in path.parts or path.suffix in ('.pyc', '.pyo'):
            continue
        rel = path.relative_to(src_root).as_posix()
        if path.suffix == '.py':
            source.append(rel)
        else:
            data.append(rel)
    return sorted(source), sorted(data)


def _preview(items: list[str], limit: int = 5) -> str:
    return ', '.join(items[:limit]) + ('...' if len(items) > limit else '')


def _check_files_present(
    member_set: set[str],
    required: list[str],
    prefix: str,
    label: str,
    category: str,
) -> bool:
    missing = [r for r in required if f'{prefix}{r}' not in member_set]
    if missing:
        failed(f'{label} missing {len(missing)} {category} file(s): {_preview(missing)}')
        return False
    passed(f'{label} has all {len(required)} {category} files')
    return True


def check_sdist_contents(
    members: list[str],
    source_files: list[str],
    data_files: list[str],
    sdist_prefix: str,
) -> bool:
    section('Checking sdist contents')
    member_set = set(members)
    results: list[bool] = []

    for meta in REQUIRED_METADATA_FILES:
        if meta in member_set:
            passed(f'sdist has {meta}')
            results.append(True)
        else:
            failed(f'sdist missing {meta}')
            results.append(False)

    for forbidden in FORBIDDEN_SDIST_TOPLEVEL_DIRS:
        leaked = [m for m in members if m.startswith(f'{forbidden}/')]
        if leaked:
            failed(f'sdist leaked {forbidden}/ files: {_preview(leaked, limit=3)}')
            results.append(False)
        else:
            passed(f'sdist has no {forbidden}/ leak')
            results.append(True)

    for forbidden in FORBIDDEN_SDIST_FILES:
        if forbidden in member_set:
            failed(f'sdist contains forbidden file {forbidden}')
            results.append(False)
        else:
            passed(f'sdist has no {forbidden}')
            results.append(True)

    results.append(_check_files_present(member_set, source_files, sdist_prefix, 'sdist', '.py source'))
    if data_files:
        results.append(_check_files_present(member_set, data_files, sdist_prefix, 'sdist', 'data'))
    return all(results)


def check_wheel_contents(members: list[str], source_files: list[str], data_files: list[str]) -> bool:
    section('Checking wheel contents')
    member_set = set(members)
    results: list[bool] = []

    has_metadata = any(m.endswith('/METADATA') and '.dist-info/' in m for m in members)
    if has_metadata:
        passed('wheel has .dist-info/METADATA')
        results.append(True)
    else:
        failed('wheel missing .dist-info/METADATA')
        results.append(False)

    results.append(_check_files_present(member_set, source_files, '', 'wheel', '.py source'))
    if data_files:
        results.append(_check_files_present(member_set, data_files, '', 'wheel', 'data'))
    return all(results)


def install_and_smoke_test(
    artifact: Path,
    kind: Literal['wheel', 'sdist'],
    venv_dir: Path,
    package_name: str,
    python_version: str,
    extras: str,
    smoke_code: str,
) -> bool:
    section(f'Installing {kind} into fresh venv')
    subprocess.run(['uv', 'venv', '--quiet', '--python', python_version, str(venv_dir)], check=True)
    python = venv_dir / 'bin' / 'python'
    spec = f'{artifact}[{extras}]' if extras else str(artifact)
    res = subprocess.run(
        ['uv', 'pip', 'install', '--quiet', '--python', str(python), spec],
        capture_output=True,
        text=True,
        check=False,
    )
    if res.returncode != 0:
        failed(f'{kind} install failed')
        info(res.stderr.strip() or res.stdout.strip())
        return False
    passed(f'{kind} installed into {venv_dir}')

    base_smoke = f'import {package_name}\nprint(getattr({package_name}, "__version__", "<no __version__>"))\n'
    code = base_smoke + (smoke_code or '')
    res = subprocess.run([str(python), '-c', code], capture_output=True, text=True, check=False)
    if res.returncode != 0:
        failed(f'{kind} import smoke test failed')
        info(res.stderr.strip())
        return False
    version = next(iter(res.stdout.strip().splitlines()), '<unknown>')
    passed(f'{kind} imports OK ({package_name}=={version})')
    return True


def main(
    package: Annotated[str, typer.Option(help='Importable Python package name (e.g. crawlee).')],
    python_version: Annotated[str, typer.Option(help='Python version for verification venvs.')],
    dist_dir: Annotated[Path, typer.Option(help='Directory containing built artifacts.')] = Path('dist'),
    package_layout: Annotated[
        PackageLayout,
        typer.Option(help='Source layout: `src` for `src/<package>/`, `flat` for `<package>/` at the repo root.'),
    ] = PackageLayout.SRC,
    extras: Annotated[str, typer.Option(help='Optional install extras (e.g. all).')] = '',
    smoke_code: Annotated[
        str,
        typer.Option(help='Optional extra Python code to run after `import <package>` in the smoke test.'),
    ] = '',
) -> None:
    if package_layout is PackageLayout.SRC:
        src_path = (Path('src') / package).resolve()
        sdist_prefix = 'src/'
    else:
        src_path = Path(package).resolve()
        sdist_prefix = ''

    wheel, sdist = find_artifacts(dist_dir.resolve())
    info(f'package:  {package}')
    info(f'layout:   {package_layout.value}')
    info(f'src dir:  {src_path}')
    info(f'wheel:    {wheel.name}')
    info(f'sdist:    {sdist.name}')

    sdist_members = list_sdist_members(sdist)
    wheel_members = list_wheel_members(wheel)
    source_files, data_files = collect_repo_files(src_path)
    info(f'sources:  {len(source_files)}')
    info(f'data:     {len(data_files)}')

    results: list[bool] = [
        check_sdist_contents(sdist_members, source_files, data_files, sdist_prefix),
        check_wheel_contents(wheel_members, source_files, data_files),
    ]

    with tempfile.TemporaryDirectory(prefix='verify-built-package-') as tmp:
        tmp_path = Path(tmp)
        results.append(
            install_and_smoke_test(
                wheel,
                'wheel',
                tmp_path / 'venv-wheel',
                package,
                python_version,
                extras,
                smoke_code,
            )
        )
        results.append(
            install_and_smoke_test(
                sdist,
                'sdist',
                tmp_path / 'venv-sdist',
                package,
                python_version,
                extras,
                smoke_code,
            )
        )

    section('Summary')
    if all(results):
        passed('all checks passed')
        return
    failed(f'{sum(1 for r in results if not r)} of {len(results)} check group(s) failed')
    raise typer.Exit(code=1)


if __name__ == '__main__':
    typer.run(main)

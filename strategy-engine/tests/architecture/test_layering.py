"""Dependency rules must be executable rather than declarative."""

import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _run_lint_imports() -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            "-c",
            "from importlinter.cli import lint_imports_command; lint_imports_command()",
        ],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def test_dependency_rule_holds() -> None:
    result = _run_lint_imports()
    assert result.returncode == 0, result.stdout + result.stderr


def test_violation_is_actually_caught(tmp_path: Path) -> None:
    """A contract that catches nothing is worse than having no contract."""
    offender = PROJECT_ROOT / "src/engine/domain/shared/_violation_probe.py"
    offender.write_text("import numpy  # noqa: F401\n", encoding="utf-8")
    try:
        result = _run_lint_imports()
        assert result.returncode != 0, "import-linter allowed numpy in domain"
    finally:
        offender.unlink()

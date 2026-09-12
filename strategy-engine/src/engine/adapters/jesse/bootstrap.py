"""Fail fast when the orchestrator is not running as a Jesse project."""

from __future__ import annotations

import os
from pathlib import Path

REQUIRED_DIRS = ("strategies", "storage")
REQUIRED_ENV_KEYS = (
    "PASSWORD",
    "POSTGRES_HOST",
    "POSTGRES_NAME",
    "POSTGRES_PORT",
    "POSTGRES_USERNAME",
    "POSTGRES_PASSWORD",
    "REDIS_HOST",
    "REDIS_PORT",
)


def _read_env_values(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def assert_jesse_project(cwd: Path | None = None) -> None:
    root = (cwd or Path.cwd()).resolve()
    missing_dirs = [name for name in REQUIRED_DIRS if not (root / name).is_dir()]
    if missing_dirs:
        raise RuntimeError(
            f"{root} is not a Jesse project; missing directories: {missing_dirs}"
        )

    configured_path = Path(os.environ.get("JESSE_ENV_FILE", ".env"))
    env_file = configured_path if configured_path.is_absolute() else root / configured_path
    if not env_file.is_file():
        raise RuntimeError(
            f"{env_file} is missing; docker/render-jesse-env.sh must create it"
        )

    values = _read_env_values(env_file)
    missing_keys = [key for key in REQUIRED_ENV_KEYS if not values.get(key)]
    if missing_keys:
        raise RuntimeError(f"{env_file} has missing or empty keys: {missing_keys}")

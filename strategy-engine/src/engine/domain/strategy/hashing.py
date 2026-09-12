"""Strategy version hashing from source code and parameters."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from engine.domain.shared.hashing import canonical_json, sha256_of


def normalize_source(source: str) -> str:
    """Normalize line endings and insignificant whitespace at end of file."""
    return source.replace("\r\n", "\n").replace("\r", "\n").rstrip()


def strategy_hash(source: str, parameters: Mapping[str, Any]) -> str:
    return sha256_of(normalize_source(source), canonical_json(dict(parameters)))

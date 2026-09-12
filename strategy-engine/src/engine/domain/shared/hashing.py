"""Canonical serialization and hashing primitives for domain identifiers."""

from __future__ import annotations

import hashlib
import json
import struct
from typing import Any

_PART_LENGTH = struct.Struct(">Q")


def canonical_json(value: Any) -> str:
    """Return a deterministic representation of JSON-compatible values.

    Unsupported objects and non-finite floats are rejected instead of being
    stringified into an unstable or non-standard representation.
    """
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        allow_nan=False,
    )


def sha256_of(*parts: str | bytes) -> str:
    """Hash length-prefixed parts so their boundaries cannot collide."""
    digest = hashlib.sha256()
    for part in parts:
        payload = part.encode("utf-8") if isinstance(part, str) else part
        digest.update(_PART_LENGTH.pack(len(payload)))
        digest.update(payload)
    return digest.hexdigest()

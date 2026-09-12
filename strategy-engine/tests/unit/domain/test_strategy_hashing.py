import math

import pytest

from engine.domain.shared.hashing import canonical_json, sha256_of
from engine.domain.strategy.hashing import normalize_source, strategy_hash


def test_hash_is_stable_across_calls() -> None:
    source = "class S:\n    pass\n"
    assert strategy_hash(source, {"a": 1}) == strategy_hash(source, {"a": 1})


def test_parameter_order_does_not_change_hash() -> None:
    source = "class S:\n    pass\n"
    assert strategy_hash(source, {"a": 1, "b": 2}) == strategy_hash(
        source, {"b": 2, "a": 1}
    )


def test_parameter_value_changes_hash() -> None:
    source = "class S:\n    pass\n"
    assert strategy_hash(source, {"a": 1}) != strategy_hash(source, {"a": 2})


def test_line_endings_are_normalized() -> None:
    assert strategy_hash("a = 1\r\nb = 2\r\n", {}) == strategy_hash(
        "a = 1\nb = 2\n", {}
    )


def test_blank_line_inside_source_changes_hash() -> None:
    """Meaningful blank lines inside multiline literals must survive."""
    with_blank = 'DOC = """a\n\nb"""\n'
    without_blank = 'DOC = """a\nb"""\n'
    assert strategy_hash(with_blank, {}) != strategy_hash(without_blank, {})


def test_trailing_whitespace_at_eof_is_ignored() -> None:
    assert normalize_source("a = 1\n\n\n  ") == normalize_source("a = 1")


def test_hash_part_boundaries_are_unambiguous() -> None:
    """Payload bytes may contain the old record-separator byte."""
    assert sha256_of(b"a\x1e", b"b") != sha256_of(b"a", b"\x1eb")


def test_canonical_json_rejects_non_json_values() -> None:
    with pytest.raises(TypeError):
        canonical_json(object())


def test_canonical_json_rejects_non_finite_numbers() -> None:
    with pytest.raises(ValueError):
        canonical_json({"value": math.nan})

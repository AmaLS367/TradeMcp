from engine.domain.strategy.source_policy import validate_source

LONG_ONLY = """
from jesse.strategies import Strategy

class LongOnly(Strategy):
    def should_long(self) -> bool:
        return True
    def go_long(self) -> None:
        self.buy = 1, self.price
"""

SHORT_ONLY = """
from jesse.strategies import Strategy

class ShortOnly(Strategy):
    def should_short(self) -> bool:
        return True
    def go_short(self) -> None:
        self.sell = 1, self.price
"""


def test_long_only_strategy_is_accepted() -> None:
    result = validate_source(LONG_ONLY)
    assert result.valid, result.errors
    assert result.strategy_class_name == "LongOnly"


def test_short_only_strategy_is_accepted() -> None:
    """Short-only strategies are valid Jesse strategies too."""
    result = validate_source(SHORT_ONLY)
    assert result.valid, result.errors
    assert result.strategy_class_name == "ShortOnly"


def test_async_methods_are_detected() -> None:
    source = """
from jesse.strategies import Strategy

class AsyncStrat(Strategy):
    async def should_long(self) -> bool:
        return True
    async def go_long(self) -> None:
        pass
"""
    result = validate_source(source)
    assert "should_long" in result.detected_methods
    assert "go_long" in result.detected_methods


def test_forbidden_import_is_rejected() -> None:
    source = LONG_ONLY + "\nimport os\n"
    result = validate_source(source)
    assert not result.valid
    assert any("os" in error for error in result.errors)


def test_multiple_strategy_classes_are_rejected() -> None:
    """Silently selecting one of several strategies is ambiguous."""
    result = validate_source(LONG_ONLY + SHORT_ONLY)
    assert not result.valid
    assert any(
        "несколько" in error.lower() or "multiple" in error.lower()
        for error in result.errors
    )


def test_missing_entry_pair_is_rejected() -> None:
    source = """
from jesse.strategies import Strategy

class Incomplete(Strategy):
    def should_long(self) -> bool:
        return True
"""
    result = validate_source(source)
    assert not result.valid


def test_syntax_error_is_reported_with_line() -> None:
    result = validate_source("class Broken(:\n")
    assert not result.valid
    assert any("1" in error for error in result.errors)

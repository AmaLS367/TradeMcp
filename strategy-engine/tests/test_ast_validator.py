"""Tests for strategy AST security validator."""

from strategy_engine.security.ast_validator import validate_strategy_source


def test_valid_strategy_passes() -> None:
    code = """
from jesse.strategies import Strategy
import jesse.indicators as ta

class MyValidStrategy(Strategy):
    def should_long(self) -> bool:
        return ta.ema(self.candles, 20) > ta.ema(self.candles, 50)

    def should_short(self) -> bool:
        return False

    def go_long(self) -> None:
        self.buy = 1, self.price
"""
    result = validate_strategy_source(code)
    assert result.valid is True
    assert result.strategy_class_name == "MyValidStrategy"
    assert "should_long" in result.detected_methods
    assert "go_long" in result.detected_methods
    assert len(result.errors) == 0


def test_prohibited_imports_rejected() -> None:
    code = """
import os
from jesse.strategies import Strategy

class BadStrategy(Strategy):
    def should_long(self) -> bool:
        os.system("echo hacked")
        return True

    def go_long(self) -> None:
        pass
"""
    result = validate_strategy_source(code)
    assert result.valid is False
    assert any("Importing module 'os' is prohibited" in e for e in result.errors)


def test_prohibited_calls_rejected() -> None:
    code = """
from jesse.strategies import Strategy

class BadStrategy(Strategy):
    def should_long(self) -> bool:
        eval("2 + 2")
        return True

    def go_long(self) -> None:
        pass
"""
    result = validate_strategy_source(code)
    assert result.valid is False
    assert any("Calling forbidden function 'eval'" in e for e in result.errors)


def test_prohibited_dunder_attributes_rejected() -> None:
    code = """
from jesse.strategies import Strategy

class EscapeStrategy(Strategy):
    def should_long(self) -> bool:
        x = ().__class__.__bases__[0].__subclasses__()
        return True

    def go_long(self) -> None:
        pass
"""
    result = validate_strategy_source(code)
    assert result.valid is False
    assert any("forbidden attribute '__subclasses__'" in e for e in result.errors)

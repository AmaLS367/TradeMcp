from engine.usecases.strategy.validate_strategy import ValidateStrategy

GOOD = """
from jesse.strategies import Strategy

class Good(Strategy):
    def should_long(self) -> bool:
        return True
    def go_long(self) -> None:
        self.buy = 1, self.price
"""


def test_valid_source_gets_a_hash() -> None:
    outcome = ValidateStrategy().execute(GOOD, {"period": 14})

    assert outcome.validation.valid
    assert outcome.validation.strategy_class_name == "Good"
    assert outcome.strategy_hash is not None
    assert len(outcome.strategy_hash) == 64


def test_invalid_source_gets_no_hash() -> None:
    """Invalid strategies must not acquire identities used by nonexistent runs."""
    outcome = ValidateStrategy().execute("import os\n", {})

    assert not outcome.validation.valid
    assert outcome.strategy_hash is None


def test_parameters_affect_the_hash() -> None:
    first = ValidateStrategy().execute(GOOD, {"period": 14}).strategy_hash
    second = ValidateStrategy().execute(GOOD, {"period": 21}).strategy_hash
    assert first != second

import math

from engine.domain.backtest.metrics import clean_float


def test_nan_becomes_none() -> None:
    """Undefined metrics must stay distinguishable from a true zero."""
    assert clean_float(float("nan")) is None


def test_infinity_becomes_none() -> None:
    assert clean_float(math.inf) is None
    assert clean_float(-math.inf) is None


def test_none_stays_none() -> None:
    assert clean_float(None) is None


def test_number_passes_through() -> None:
    assert clean_float(42) == 42.0
    assert clean_float(-0.5) == -0.5


def test_non_numeric_becomes_none() -> None:
    assert clean_float("n/a") is None
    assert clean_float(True) is None

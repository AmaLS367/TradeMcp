from engine.adapters.jesse.backtest import map_equity_curve, map_metrics


def test_profit_factor_comes_from_gross_numbers() -> None:
    """Profit factor and average win/loss ratio are distinct metrics."""
    metrics = map_metrics(
        {
            "gross_profit": 300.0,
            "gross_loss": -100.0,
            "ratio_avg_win_loss": 1.5,
        },
        trades=[],
    )
    assert metrics.profit_factor == 3.0
    assert metrics.payoff_ratio == 1.5


def test_zero_gross_loss_gives_none_not_infinity() -> None:
    metrics = map_metrics({"gross_profit": 300.0, "gross_loss": 0.0}, trades=[])
    assert metrics.profit_factor is None


def test_nan_sharpe_becomes_none() -> None:
    metrics = map_metrics({"sharpe_ratio": float("nan")}, trades=[])
    assert metrics.sharpe is None


def test_counts_are_integers() -> None:
    metrics = map_metrics(
        {
            "total": 7,
            "total_winning_trades": 4,
            "total_losing_trades": 3,
            "longs_count": 5,
            "shorts_count": 2,
        },
        trades=[],
    )
    assert metrics.total_trades == 7
    assert metrics.winning_trades == 4
    assert metrics.losing_trades == 3
    assert metrics.longs_count == 5
    assert metrics.shorts_count == 2


def test_equity_curve_parses_jesse_series_shape() -> None:
    raw = [
        {
            "name": "Portfolio",
            "color": "#818CF8",
            "data": [
                {
                    "time": 1_600_000_000.0,
                    "value": 10_000.0,
                    "color": "#818CF8",
                },
                {
                    "time": 1_600_086_400.0,
                    "value": 10_500.0,
                    "color": "#818CF8",
                },
            ],
        }
    ]
    curve = map_equity_curve(raw)

    assert len(curve) == 2
    assert curve[0].timestamp_ms == 1_600_000_000_000
    assert curve[0].equity == 10_000.0


def test_equity_curve_picks_portfolio_series() -> None:
    raw = [
        {"name": "BTC-USDT", "data": [{"time": 1.0, "value": 1.0}]},
        {"name": "Portfolio", "data": [{"time": 2.0, "value": 2.0}]},
    ]
    curve = map_equity_curve(raw)
    assert len(curve) == 1
    assert curve[0].equity == 2.0


def test_equity_curve_handles_none() -> None:
    assert map_equity_curve(None) == ()

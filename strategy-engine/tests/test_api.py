"""Integration tests for FastAPI endpoints."""

from fastapi.testclient import TestClient

from strategy_engine.main import app

client = TestClient(app)


def test_health_check() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "ok"
    assert data["service"] == "trade-strategy-engine"


def test_validate_strategy_api() -> None:
    code = """
from jesse.strategies import Strategy

class GoodStrat(Strategy):
    def should_long(self) -> bool:
        return True
    def should_short(self) -> bool:
        return False
    def go_long(self) -> None:
        self.buy = 1, self.price
"""
    response = client.post("/api/v1/strategy/validate", json={"source_code": code})
    assert response.status_code == 200
    data = response.json()
    assert data["valid"] is True
    assert data["strategy_class_name"] == "GoodStrat"
    assert data["strategy_hash"] is not None


def test_backtest_api_execution() -> None:
    code = """
from jesse.strategies import Strategy

class AlwaysLongStrat(Strategy):
    def should_long(self) -> bool:
        return True
    def should_short(self) -> bool:
        return False
    def go_long(self) -> None:
        self.buy = 1, self.price
"""
    response = client.post(
        "/api/v1/backtest",
        json={
            "source_code": code,
            "symbol": "BTC/USDT",
            "timeframe": "1h",
            "exchange": "Binance",
            "initial_balance": 10000.0,
            "fee_rate": 0.0006,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert "run_hash" in data
    assert "strategy_hash" in data
    assert "metrics" in data
    assert "net_return" in data["metrics"]
    assert "total_trades" in data["metrics"]

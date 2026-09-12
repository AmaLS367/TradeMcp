from fastapi.testclient import TestClient

from engine.adapters.sandbox.fake_runner import FakeRunner
from engine.domain.backtest.metrics import BacktestMetrics, EquityPoint
from engine.domain.dataset.models import CandleBundle, DatasetRef, DateRange
from engine.domain.runtime.contracts import RunnerError, RunnerResult, RunnerStatus
from engine.entrypoints.api.deps import get_run_backtest
from engine.entrypoints.api.main import create_app
from engine.settings import Settings
from engine.usecases.backtest.run_backtest import EngineVersions, RunBacktest

GOOD = """
from jesse.strategies import Strategy

class Good(Strategy):
    def should_long(self) -> bool:
        return True
    def go_long(self) -> None:
        self.buy = 1, self.price
"""

RANGE = DateRange(1_600_000_000_000, 1_600_086_400_000)

BACKTEST_BODY = {
    "source_code": GOOD,
    "symbol": "BTC-USDT",
    "timeframe": "1h",
    "exchange": "Binance",
    "start_date": "2023-01-01",
    "end_date": "2023-01-02",
}


class _Repo:
    def ensure(self, **kwargs) -> None:
        return None

    def load(self, **kwargs) -> CandleBundle:
        ref = DatasetRef(
            exchange="Binance", symbol="BTC-USDT", timeframe="1h", date_range=RANGE,
            warmup_rows=0, trading_rows=100, columns=6, dtype="float64",
            dataset_hash="d" * 64,
        )
        return CandleBundle(ref=ref, warmup=b"", trading=b"\x02" * 4800)


OK_RESULT = RunnerResult(
    job_id="x", status=RunnerStatus.OK,
    metrics=BacktestMetrics(net_return_percent=12.5, sharpe=None, total_trades=3),
    equity_curve=(EquityPoint(1_600_000_000_000, 10_000.0),),
)


def _client_and_runner(runner_result: RunnerResult) -> tuple[TestClient, FakeRunner]:
    app = create_app(Settings(api_token=None, require_jesse_project=False))
    runner = FakeRunner(runner_result)
    usecase = RunBacktest(_Repo(), runner, EngineVersions("0.2.0", "3.1.3"))
    app.dependency_overrides[get_run_backtest] = lambda: usecase
    return TestClient(app), runner


def _client(runner_result: RunnerResult) -> TestClient:
    return _client_and_runner(runner_result)[0]


def test_health_is_open() -> None:
    assert _client(OK_RESULT).get("/health").json()["status"] == "ok"


def test_validate_returns_hash() -> None:
    response = _client(OK_RESULT).post("/api/v1/strategy/validate", json={"source_code": GOOD})
    body = response.json()

    assert response.status_code == 200
    assert body["valid"] is True
    assert len(body["strategy_hash"]) == 64


def test_backtest_returns_all_hashes_and_nullable_metrics() -> None:
    response = _client(OK_RESULT).post("/api/v1/backtest", json=BACKTEST_BODY)
    body = response.json()

    assert response.status_code == 200, response.text
    assert len(body["run_hash"]) == 64
    assert len(body["dataset_hash"]) == 64
    assert body["metrics"]["sharpe"] is None, "NaN must arrive as null, not 0"
    assert body["metrics"]["net_return_percent"] == 12.5
    assert body["equity_curve"] == [{"timestamp_ms": 1_600_000_000_000, "equity": 10_000.0}]


def test_invalid_source_is_422() -> None:
    response = _client(OK_RESULT).post(
        "/api/v1/backtest",
        json={**BACKTEST_BODY, "source_code": "import os\n"},
    )
    assert response.status_code == 422
    assert response.json()["error"] == "SourceValidationError"


def test_bad_date_range_is_422() -> None:
    client = _client(OK_RESULT)

    reversed_range = client.post(
        "/api/v1/backtest",
        json={**BACKTEST_BODY, "start_date": "2023-01-02", "end_date": "2023-01-01"},
    )
    malformed = client.post(
        "/api/v1/backtest",
        json={**BACKTEST_BODY, "start_date": "01/01/2023"},
    )

    assert reversed_range.status_code == 422
    assert malformed.status_code == 422


def test_slash_symbol_is_normalized() -> None:
    client, runner = _client_and_runner(OK_RESULT)

    response = client.post("/api/v1/backtest", json={**BACKTEST_BODY, "symbol": "btc/usdt"})

    assert response.status_code == 200, response.text
    assert runner.calls[0][0].config.symbol == "BTC-USDT"


def test_short_exchange_name_maps_to_jesse_provider() -> None:
    client, runner = _client_and_runner(OK_RESULT)

    response = client.post("/api/v1/backtest", json={**BACKTEST_BODY, "exchange": "binance"})

    assert response.status_code == 200, response.text
    assert runner.calls[0][0].config.exchange == "Binance Perpetual Futures"


def test_runner_timeout_is_504() -> None:
    timeout_result = RunnerResult(
        job_id="x", status=RunnerStatus.TIMEOUT,
        error=RunnerError(type="RunnerTimeout", message="deadline exceeded"),
    )
    response = _client(timeout_result).post("/api/v1/backtest", json=BACKTEST_BODY)
    assert response.status_code == 504


def test_token_is_required_when_configured() -> None:
    app = create_app(Settings(api_token="s3cret", require_jesse_project=False))
    client = TestClient(app)

    assert client.post("/api/v1/strategy/validate", json={"source_code": GOOD}).status_code == 401
    assert client.get("/health").status_code == 200

    ok = client.post(
        "/api/v1/strategy/validate",
        json={"source_code": GOOD},
        headers={"X-Engine-Token": "s3cret"},
    )
    assert ok.status_code == 200

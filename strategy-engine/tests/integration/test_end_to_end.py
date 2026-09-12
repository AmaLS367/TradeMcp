"""End-to-end guarantees the engine rebuild exists for.

Needs the compose stack with the e2e overlay (publishes the engine on
127.0.0.1:18000 and shortens the runner deadline to 30s). Run from the host:

    GIT_SHA=$(git rev-parse HEAD) docker compose -f docker-compose.yml \\
        -f strategy-engine/docker/compose.e2e.yml up -d --build
    cd strategy-engine
    ENGINE_BASE_URL=http://127.0.0.1:18000 ENGINE_API_TOKEN=<token> \\
        uv run pytest tests/integration/test_end_to_end.py -m integration -v

Candles must be imported first (see README): warmup reaches ~9 days before
start_date, so import from 2022-12-01.
"""

import os

import httpx
import pytest

pytestmark = pytest.mark.integration

BASE_URL = os.environ.get("ENGINE_BASE_URL", "http://127.0.0.1:18000")
TOKEN = os.environ.get("ENGINE_API_TOKEN", "")
HEADERS = {"X-Engine-Token": TOKEN} if TOKEN else {}

# Enters every 24 candles and exits 12 candles later, so a 14-day 1h range
# yields ~14 closed trades. {gate} lets the sandbox tests make trading depend
# on what the strategy could observe from inside the runner.
_TEMPLATE = r'''
from jesse.strategies import Strategy
import jesse.helpers as jh

{prelude}

class Probe(Strategy):
    def should_long(self) -> bool:
        return {gate} and self.index % 24 == 0

    def go_long(self) -> None:
        self.buy = 0.01, self.price

    def should_short(self) -> bool:
        return False

    def go_short(self) -> None:
        pass

    def should_cancel_entry(self) -> bool:
        return True

    def update_position(self) -> None:
        if self.index % 24 == 12:
            self.liquidate()
'''

WORKING = _TEMPLATE.format(prelude="", gate="True")

HANGING = _TEMPLATE.format(
    prelude="def spin() -> bool:\n    while True:\n        pass",
    gate="spin()",
)

# jesse.helpers re-exports os, and the AST policy cannot catch attribute access
# through an allowed module. The positive control proves this vector is live
# (subprocess + python start inside the runner), so the network probe below
# cannot pass vacuously.
SUBPROCESS_WORKS = _TEMPLATE.format(
    prelude=(
        "SIGNAL = jh.os.popen("
        "\"python -c \\\"print('up')\\\" 2>/dev/null\""
        ").read().strip() == 'up'"
    ),
    gate="SIGNAL",
)

NETWORK_REACHABLE = _TEMPLATE.format(
    prelude=(
        "SIGNAL = jh.os.popen("
        "\"python -c \\\"import socket; "
        "socket.create_connection(('1.1.1.1', 53), 2); print('up')\\\" 2>/dev/null\""
        ").read().strip() == 'up'"
    ),
    gate="SIGNAL",
)

# kill(-1) signals every process the caller is allowed to signal. While workers
# shared the server's uid this took the whole runner down.
SIGNALS_EVERYONE = _TEMPLATE.format(prelude="jh.os.kill(-1, 9)", gate="True")

SOCKET_REMOVABLE = _TEMPLATE.format(
    prelude=(
        "try:\n"
        "    jh.os.unlink('/run/engine/runner.sock')\n"
        "    SIGNAL = True\n"
        "except OSError:\n"
        "    SIGNAL = False"
    ),
    gate="SIGNAL",
)

PAYLOAD = {
    "symbol": "BTC-USDT",
    "timeframe": "1h",
    "exchange": "Binance Perpetual Futures",
    "start_date": "2023-01-01",
    "end_date": "2023-01-15",
    "initial_balance": 10_000.0,
    "fee_rate": 0.0006,
}


def _backtest(source: str, **overrides) -> httpx.Response:
    with httpx.Client(timeout=300.0) as client:
        return client.post(
            f"{BASE_URL}/api/v1/backtest",
            json={**PAYLOAD, "source_code": source, **overrides},
            headers=HEADERS,
        )


def _assert_engine_healthy() -> None:
    with httpx.Client(timeout=30.0) as client:
        assert client.get(f"{BASE_URL}/health").json()["status"] == "ok"


def test_identical_requests_are_byte_for_byte_reproducible() -> None:
    """The legacy engine returned equal run_hash values with different metrics
    because it backtested random fake_range_candles."""
    first = _backtest(WORKING)
    second = _backtest(WORKING)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text

    a, b = first.json(), second.json()
    assert a["run_hash"] == b["run_hash"]
    assert a["dataset_hash"] == b["dataset_hash"]
    assert a["metrics"] == b["metrics"], "equal run_hash must mean equal results"
    assert a["equity_curve"] == b["equity_curve"]


def test_equity_curve_is_not_empty() -> None:
    """The legacy parser always returned an empty curve."""
    response = _backtest(WORKING)
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["metrics"]["total_trades"] > 0, "the strategy must close trades"
    assert len(body["equity_curve"]) > 0
    assert body["equity_curve"][0]["timestamp_ms"] > 1_000_000_000_000


def test_infinite_loop_times_out_and_engine_survives() -> None:
    hung = _backtest(HANGING)
    assert hung.status_code == 504, hung.text

    healthy = _backtest(WORKING)
    assert healthy.status_code == 200, "the engine must survive a hung strategy"


def test_sandbox_escape_vector_is_live() -> None:
    response = _backtest(SUBPROCESS_WORKS)

    assert response.status_code == 200, response.text
    assert response.json()["metrics"]["total_trades"] > 0, (
        "control: a subprocess started from strategy code must work, otherwise "
        "the network test below proves nothing"
    )


def test_sandbox_escape_gets_no_network() -> None:
    response = _backtest(NETWORK_REACHABLE)

    assert response.status_code == 200, response.text
    assert response.json()["metrics"]["total_trades"] == 0, (
        "strategy code reached the network from inside the runner"
    )
    _assert_engine_healthy()


def test_sandbox_escape_cannot_signal_the_runner() -> None:
    response = _backtest(SIGNALS_EVERYONE)
    assert response.status_code == 200, response.text

    _assert_engine_healthy()
    follow_up = _backtest(WORKING)
    assert follow_up.status_code == 200, "the runner must survive kill(-1)"


def test_sandbox_escape_cannot_remove_the_runner_socket() -> None:
    response = _backtest(SOCKET_REMOVABLE)

    assert response.status_code == 200, response.text
    assert response.json()["metrics"]["total_trades"] == 0, (
        "strategy code removed the runner socket"
    )
    follow_up = _backtest(WORKING)
    assert follow_up.status_code == 200, follow_up.text


def test_missing_dataset_is_409_not_a_fabricated_result() -> None:
    response = _backtest(WORKING, symbol="NOSUCH-COIN")
    assert response.status_code == 409, response.text

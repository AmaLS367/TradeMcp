# Strategy Engine

Backtests LLM-written Jesse strategies on real candles from Postgres and runs the
untrusted code in a separate, network-less container.

Layers inside `src/engine/` (enforced by `import-linter`):
`domain ← usecases ← adapters ← entrypoints`.

Two processes:

- **orchestrator** (`docker/orchestrator.Dockerfile`) — FastAPI, Jesse project, Postgres/Redis access.
  `uvicorn --factory engine.entrypoints.api.main:create_app`
- **runner** (`docker/runner.Dockerfile`) — `network_mode: none`, read-only root fs, one fresh
  subprocess per run with CPU/memory/time limits. Talks to the orchestrator over a Unix socket
  on the shared `runner_ipc` volume.

## API

All `/api/v1/*` routes require `X-Engine-Token` when `ENGINE_API_TOKEN` is set.

| Route | Purpose |
|---|---|
| `GET /health` | liveness |
| `POST /api/v1/strategy/validate` | static checks + `strategy_hash` |
| `POST /api/v1/backtest` | backtest → `run_hash`, `strategy_hash`, `dataset_hash`, metrics, equity curve |

Metrics that cannot be computed are `null`, never `0`. Missing candles → `409`, runner deadline → `504`,
runner crash → `502`, invalid source → `422`.

## Run

Required in the repo-root `.env`: `STRATEGY_ENGINE_TOKEN`, `JESSE_PASSWORD`, `STRATEGY_POSTGRES_PASSWORD`.

```bash
docker compose up -d --build strategy_engine
# first candle import (hits the exchange, takes minutes)
# -w matters: Jesse binds its database only when cwd is the Jesse project
docker compose exec -w /app/jesse_project strategy_engine python -c \
  "from jesse.research import import_candles; import_candles('Binance Perpetual Futures', 'BTC-USDT', '2022-12-01', show_progressbar=False)"
```

## Test

```bash
uv run pytest                 # unit, contract, architecture (integration is deselected)
uv run lint-imports           # dependency rule
uv run ruff check src tests

# end-to-end, against the compose stack with the test overlay (engine on 127.0.0.1:18000)
docker compose -f docker-compose.yml -f strategy-engine/docker/compose.e2e.yml up -d --build
ENGINE_BASE_URL=http://127.0.0.1:18000 ENGINE_API_TOKEN=<token> \
  uv run pytest tests/integration/test_end_to_end.py -m integration -v
```

# syntax=docker/dockerfile:1
FROM ghcr.io/astral-sh/uv:0.9.16 AS uv_bin

FROM python:3.11-slim-bookworm AS builder
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
COPY --from=uv_bin /uv /uvx /bin/
COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev
COPY . .
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

FROM python:3.11-slim-bookworm AS runtime
# WORKDIR is deliberately NOT a Jesse project: is_jesse_project() looks for
# strategies/ and storage/ in cwd. Without them Jesse opens no DB connection
# and needs no .env. The runner receives candles as bytes over the socket and
# needs neither a database nor a network.
WORKDIR /srv

# The root filesystem is read-only; everything that wants to write (numba
# cache, matplotlib config, $HOME) is pointed at the /tmp tmpfs. One BLAS/OpenMP
# thread per worker keeps address space and pid usage inside the rlimits.
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    HOME=/tmp \
    MPLCONFIGDIR=/tmp/matplotlib \
    NUMBA_CACHE_DIR=/tmp/numba \
    OPENBLAS_NUM_THREADS=1 \
    OMP_NUM_THREADS=1 \
    MKL_NUM_THREADS=1 \
    ENGINE_RUNNER_TRANSPORT=uds \
    ENGINE_RUNNER_SOCKET_PATH=/run/engine/runner.sock

RUN groupadd -g 10001 appuser && useradd -u 10001 -g appuser -s /bin/false appuser
COPY --from=builder --chown=10001:10001 /app /app
RUN mkdir -p /run/engine /srv && chown -R 10001:10001 /run/engine /srv \
    && chmod 0770 /run/engine

# The server needs root (with only CHOWN/KILL/SETUID/SETGID granted by compose)
# to run every worker slot under its own uid starting at the base below; group
# 10001 is what it shares with the orchestrator for the socket.
ENV ENGINE_RUNNER_WORKER_UID_BASE=20000
USER 0:10001
CMD ["python", "-m", "engine.entrypoints.runner.server"]

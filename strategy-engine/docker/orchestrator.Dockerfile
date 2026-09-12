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
WORKDIR /app

# GIT_SHA is part of every run_hash: without it two different engine builds
# would hash identical backtests the same way. Refuse to build without it.
ARG GIT_SHA
RUN case "$GIT_SHA" in \
        ""|unknown) echo "GIT_SHA build arg is required: GIT_SHA=\$(git rev-parse HEAD)" >&2; exit 1 ;; \
    esac
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ENGINE_GIT_SHA=${GIT_SHA} \
    JESSE_PROJECT_DIR=/app/jesse_project \
    MPLCONFIGDIR=/tmp/matplotlib

RUN groupadd -g 10001 appuser && useradd -u 10001 -g appuser -s /bin/false appuser

COPY --from=builder --chown=10001:10001 /app /app
COPY --chmod=0755 docker/render-jesse-env.sh /usr/local/bin/render-jesse-env

# Jesse only enables its database when strategies/ and storage/ exist in cwd.
RUN mkdir -p /app/jesse_project/strategies /app/jesse_project/storage /run/engine \
    && chown -R 10001:10001 /app/jesse_project /run/engine \
    && chmod 0770 /run/engine

USER 10001:10001
EXPOSE 8000
ENTRYPOINT ["render-jesse-env"]
# --factory: nothing runs at import time; create_app() validates the project.
CMD ["uvicorn", "--factory", "engine.entrypoints.api.main:create_app", "--host", "0.0.0.0", "--port", "8000"]

# syntax=docker/dockerfile:1
FROM ghcr.io/astral-sh/uv:0.9.16 AS uv_bin

FROM python:3.11-slim-bookworm AS builder
WORKDIR /app

ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=never

COPY --from=uv_bin /uv /uvx /bin/

COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-install-project --no-dev

COPY . .
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# Final runtime image
FROM python:3.11-slim-bookworm AS runtime
WORKDIR /app

RUN groupadd -g 10001 appuser && \
    useradd -u 10001 -g appuser -s /bin/false appuser

COPY --from=builder /app /app
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

USER appuser

EXPOSE 8000
CMD ["uvicorn", "strategy_engine.main:app", "--host", "0.0.0.0", "--port", "8000"]

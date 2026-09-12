from __future__ import annotations

import re
from functools import lru_cache
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ENGINE_",
        env_file=None,
        extra="ignore",
    )

    runner_transport: Literal["uds", "tcp"] = "uds"
    runner_socket_path: str = "/run/engine/runner.sock"
    runner_host: str = "127.0.0.1"
    runner_port: int = Field(default=8001, ge=0, le=65535)

    runner_timeout_seconds: float = Field(default=120.0, gt=0)
    runner_memory_mb: int = Field(default=512, gt=0)
    runner_max_file_bytes: int = Field(default=0, ge=0)
    max_concurrent_runs: int = Field(default=2, gt=0)
    # When set, each concurrency slot runs its workers as uid/gid base+slot.
    # Requires the runner server to start as root with CHOWN/KILL/SETUID/SETGID.
    runner_worker_uid_base: int | None = Field(default=None, ge=1000)

    api_token: str | None = None
    cors_origins: list[str] = Field(default_factory=list)
    require_jesse_project: bool = True

    engine_version: str = "0.2.0"
    git_sha: str = "unknown"

    @property
    def has_git_sha(self) -> bool:
        return re.fullmatch(r"[0-9a-f]{7,40}", self.git_sha) is not None

    @property
    def full_engine_version(self) -> str:
        return f"{self.engine_version}+{self.git_sha}"


@lru_cache
def get_settings() -> Settings:
    return Settings()

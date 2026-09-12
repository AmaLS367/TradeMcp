"""Socket adapter for the isolated strategy runner.

Production uses a Unix-domain socket so the runner container needs no network
interface. TCP remains available for local development and Windows tests.
"""

from __future__ import annotations

import asyncio
import contextlib

from engine.adapters.sandbox.codec import (
    decode_result,
    encode_job,
    read_frame,
    write_frame,
)
from engine.domain.dataset.models import CandleBundle
from engine.domain.runtime.contracts import RunnerJob, RunnerResult
from engine.domain.shared.errors import RunnerCrashed
from engine.settings import Settings, get_settings

_IO_GRACE_SECONDS = 5.0


class SocketStrategyRunner:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()

    async def run(self, job: RunnerJob, bundle: CandleBundle) -> RunnerResult:
        payload = encode_job(job, bundle)
        timeout = min(
            job.timeout_seconds,
            self._settings.runner_timeout_seconds,
        ) + _IO_GRACE_SECONDS

        try:
            async with asyncio.timeout(timeout):
                return await self._exchange(job, payload)
        except TimeoutError as error:
            raise RunnerCrashed(
                f"runner did not respond within {timeout:g}s"
            ) from error

    async def _exchange(self, job: RunnerJob, payload: bytes) -> RunnerResult:
        try:
            reader, writer = await self._connect()
        except OSError as error:
            raise RunnerCrashed(f"runner unavailable: {error}") from error

        try:
            await write_frame(writer, payload)
            result = decode_result(await read_frame(reader))
        except (asyncio.IncompleteReadError, ConnectionError, OSError) as error:
            raise RunnerCrashed(f"runner connection failed: {error}") from error
        except (TypeError, ValueError) as error:
            raise RunnerCrashed(f"runner returned an invalid response: {error}") from error
        finally:
            writer.close()
            with contextlib.suppress(ConnectionError, OSError):
                await writer.wait_closed()

        if result.job_id != job.job_id:
            raise RunnerCrashed("runner returned a response for a different job")
        return result

    async def _connect(self) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
        if self._settings.runner_transport == "uds":
            return await asyncio.open_unix_connection(
                self._settings.runner_socket_path
            )
        return await asyncio.open_connection(
            self._settings.runner_host,
            self._settings.runner_port,
        )

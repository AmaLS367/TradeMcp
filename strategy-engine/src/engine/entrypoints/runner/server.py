"""Long-lived server for isolated, single-use strategy workers."""

from __future__ import annotations

import asyncio
import contextlib
import math
import os
import signal
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

from engine.adapters.sandbox.codec import (
    decode_job_metadata,
    decode_result,
    encode_result,
    read_frame,
    write_frame,
)
from engine.domain.runtime.contracts import RunnerError, RunnerResult, RunnerStatus
from engine.settings import Settings, get_settings

_IS_POSIX = os.name == "posix"
_WORKER_MODULE = "engine.entrypoints.runner.worker"


def _build_preexec(
    settings: Settings,
    timeout_seconds: float,
) -> Callable[[], None] | None:
    """Build POSIX resource limits for a fresh worker process."""
    if not _IS_POSIX:
        return None

    import resource

    def _apply() -> None:
        memory = settings.runner_memory_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
        cpu = math.ceil(timeout_seconds) + 5
        resource.setrlimit(resource.RLIMIT_CPU, (cpu, cpu))
        resource.setrlimit(resource.RLIMIT_NPROC, (64, 64))
        resource.setrlimit(
            resource.RLIMIT_FSIZE,
            (settings.runner_max_file_bytes, settings.runner_max_file_bytes),
        )

    return _apply


class RunnerServer:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._semaphore = asyncio.Semaphore(self._settings.max_concurrent_runs)
        self._server: asyncio.AbstractServer | None = None
        self._socket_path: Path | None = None

    @property
    def bound_address(self) -> tuple[str, int]:
        assert self._server is not None, "runner server is not running"
        return self._server.sockets[0].getsockname()[:2]

    async def start(self) -> None:
        if self._server is not None:
            raise RuntimeError("runner server is already running")

        if self._settings.runner_transport == "uds":
            path = Path(self._settings.runner_socket_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.unlink(missing_ok=True)
            self._server = await asyncio.start_unix_server(self._handle, path=str(path))
            os.chmod(path, 0o660)
            self._socket_path = path
            return

        self._server = await asyncio.start_server(
            self._handle,
            self._settings.runner_host,
            self._settings.runner_port,
        )

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None
        if self._socket_path is not None:
            self._socket_path.unlink(missing_ok=True)
            self._socket_path = None

    async def serve_forever(self) -> None:
        await self.start()
        assert self._server is not None
        async with self._server:
            await self._server.serve_forever()

    async def _handle(
        self,
        reader: asyncio.StreamReader,
        writer: asyncio.StreamWriter,
    ) -> None:
        try:
            payload = await read_frame(reader)
            async with self._semaphore:
                result_bytes = await self._spawn_worker(payload)
            await write_frame(writer, result_bytes)
        except (asyncio.IncompleteReadError, ConnectionResetError, BrokenPipeError):
            pass
        finally:
            writer.close()
            with contextlib.suppress(ConnectionError, OSError):
                await writer.wait_closed()

    async def _spawn_worker(self, payload: bytes) -> bytes:
        job_id, requested_timeout = decode_job_metadata(payload)
        timeout = min(requested_timeout, self._settings.runner_timeout_seconds)

        try:
            process = await asyncio.create_subprocess_exec(
                sys.executable,
                "-m",
                _WORKER_MODULE,
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                preexec_fn=_build_preexec(self._settings, timeout),
                start_new_session=_IS_POSIX,
                cwd=os.path.abspath(os.sep),
            )
        except (OSError, subprocess.SubprocessError) as error:
            return self._error_result(
                job_id,
                RunnerStatus.RUNTIME_ERROR,
                "RunnerCrashed",
                f"failed to start worker: {error}",
            )

        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(input=payload),
                timeout=timeout,
            )
        except TimeoutError:
            self._kill(process)
            await process.wait()
            return self._error_result(
                job_id,
                RunnerStatus.TIMEOUT,
                "RunnerTimeout",
                f"run exceeded its {timeout:g}s deadline",
            )

        if not stdout:
            status = (
                RunnerStatus.MEMORY_EXCEEDED
                if _IS_POSIX and process.returncode == -signal.SIGKILL
                else RunnerStatus.RUNTIME_ERROR
            )
            return self._error_result(
                job_id,
                status,
                "RunnerCrashed",
                f"worker exited with code {process.returncode}",
                stderr.decode("utf-8", "replace")[-2000:],
            )

        try:
            result = decode_result(stdout)
        except (TypeError, ValueError) as error:
            return self._error_result(
                job_id,
                RunnerStatus.RUNTIME_ERROR,
                "RunnerCrashed",
                f"worker returned an invalid result: {error}",
                stderr.decode("utf-8", "replace")[-2000:],
            )
        if result.job_id != job_id:
            return self._error_result(
                job_id,
                RunnerStatus.RUNTIME_ERROR,
                "RunnerCrashed",
                "worker returned a result for a different job",
            )
        return stdout

    @staticmethod
    def _error_result(
        job_id: str,
        status: RunnerStatus,
        error_type: str,
        message: str,
        traceback_tail: str = "",
    ) -> bytes:
        return encode_result(
            RunnerResult(
                job_id=job_id,
                status=status,
                error=RunnerError(
                    type=error_type,
                    message=message,
                    traceback_tail=traceback_tail,
                ),
            )
        )

    @staticmethod
    def _kill(process: asyncio.subprocess.Process) -> None:
        if _IS_POSIX:
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(process.pid, signal.SIGKILL)
            return
        with contextlib.suppress(ProcessLookupError):
            process.kill()


def main() -> int:
    asyncio.run(RunnerServer().serve_forever())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

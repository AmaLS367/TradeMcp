"""Long-lived server for isolated, single-use strategy workers.

Strategy code is untrusted and reaches ``os`` through allowed packages, so a
network namespace alone is not enough: a worker running as the server's uid
could remove the socket, signal the server or its neighbours, or leave
processes behind. With ``runner_worker_uid_base`` set, the server starts as
root with only CHOWN/KILL/SETUID/SETGID and gives every concurrency slot its
own uid and gid. Workers then cannot signal the server or each other, cannot
enter the socket directory, and everything a slot uid leaves running is
killed before the slot takes its next job.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import math
import os
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from collections.abc import Callable
from dataclasses import dataclass
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

logger = logging.getLogger(__name__)

_IS_POSIX = os.name == "posix"
_WORKER_MODULE = "engine.entrypoints.runner.worker"
_REAP_DEADLINE_SECONDS = 5.0


@dataclass(frozen=True)
class _WorkerIdentity:
    uid: int
    gid: int


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


def _is_live_process_of(pid: int, uid: int) -> bool:
    """Whether ``pid`` is a non-zombie process with ``uid`` as a real/effective/saved uid.

    /proc/<pid>/status is used rather than the /proc/<pid> owner, which a
    process can turn into root by marking itself non-dumpable.
    """
    try:
        with open(f"/proc/{pid}/status", encoding="utf-8", errors="replace") as handle:
            fields = dict(line.split(":", 1) for line in handle if ":" in line)
    except OSError:
        return False
    if fields.get("State", "").strip().startswith("Z"):
        return False
    return str(uid) in fields.get("Uid", "").split()


def _pids_owned_by(uid: int) -> list[int]:
    return [
        int(name)
        for name in os.listdir("/proc")
        if name.isdigit() and _is_live_process_of(int(name), uid)
    ]


def _kill_verified(pid: int, uid: int) -> None:
    """SIGKILL ``pid`` only while it still belongs to ``uid``.

    The pidfd pins the process, so a pid recycled after the /proc scan can
    never redirect the signal to an unrelated process.
    """
    try:
        pidfd = os.pidfd_open(pid)
    except ProcessLookupError:
        return
    try:
        if _is_live_process_of(pid, uid):
            signal.pidfd_send_signal(pidfd, signal.SIGKILL)
    except ProcessLookupError:
        pass
    finally:
        os.close(pidfd)


def _reap_uid(uid: int, deadline_seconds: float = _REAP_DEADLINE_SECONDS) -> bool:
    """Kill every process of a worker uid, including ones that escaped via setsid."""
    give_up_at = time.monotonic() + deadline_seconds
    while pids := _pids_owned_by(uid):
        if time.monotonic() > give_up_at:
            return False
        for pid in pids:
            _kill_verified(pid, uid)
        time.sleep(0.01)
    return True


def _reclaim_tree(root: str) -> None:
    """Take ownership of a worker's scratch tree back so it can be deleted.

    The server has CAP_CHOWN but not CAP_DAC_OVERRIDE: it chowns each entry to
    itself without following symlinks and reopens directories the worker may
    have locked with chmod.
    """
    uid, gid = os.getuid(), os.getgid()
    pending = [root]
    while pending:
        path = pending.pop()
        try:
            os.lchown(path, uid, gid)
            if stat.S_ISDIR(os.lstat(path).st_mode):
                os.chmod(path, 0o700)
                with os.scandir(path) as entries:
                    pending.extend(entry.path for entry in entries)
        except OSError:
            continue


class RunnerServer:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()
        self._slots: asyncio.Queue[int] = asyncio.Queue()
        for slot in range(self._settings.max_concurrent_runs):
            self._slots.put_nowait(slot)
        self._server: asyncio.AbstractServer | None = None
        self._socket_path: Path | None = None

    @property
    def bound_address(self) -> tuple[str, int]:
        assert self._server is not None, "runner server is not running"
        return self._server.sockets[0].getsockname()[:2]

    @property
    def _isolates_workers(self) -> bool:
        return self._settings.runner_worker_uid_base is not None

    async def start(self) -> None:
        if self._server is not None:
            raise RuntimeError("runner server is already running")
        if self._isolates_workers:
            self._check_can_isolate()

        if self._settings.runner_transport == "uds":
            path = Path(self._settings.runner_socket_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            if self._isolates_workers:
                # Worker uids are neither owner nor group of the socket dir, so
                # they cannot reach, remove or replace the socket. The shared
                # group lets the orchestrator connect.
                os.chown(path.parent, os.getuid(), os.getgid())
                os.chmod(path.parent, 0o770)
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

    def _check_can_isolate(self) -> None:
        if not _IS_POSIX or os.geteuid() != 0:
            raise RuntimeError(
                "runner_worker_uid_base requires a POSIX runner started as root "
                "with CAP_CHOWN, CAP_KILL, CAP_SETUID and CAP_SETGID"
            )
        base = self._settings.runner_worker_uid_base
        assert base is not None
        worker_ids = range(base, base + self._settings.max_concurrent_runs)
        if os.getgid() in worker_ids:
            raise RuntimeError("worker uid/gid range overlaps the server's group")

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
            result_bytes = await self._spawn_worker(payload)
            await write_frame(writer, result_bytes)
        except (asyncio.IncompleteReadError, ConnectionResetError, BrokenPipeError):
            pass
        finally:
            writer.close()
            with contextlib.suppress(ConnectionError, OSError):
                await writer.wait_closed()

    def _identity(self, slot: int) -> _WorkerIdentity | None:
        base = self._settings.runner_worker_uid_base
        if base is None:
            return None
        return _WorkerIdentity(uid=base + slot, gid=base + slot)

    async def _spawn_worker(self, payload: bytes) -> bytes:
        slot = await self._slots.get()
        identity = self._identity(slot)
        # Jesse writes storage/logs and storage/backtest-charts relative to cwd,
        # and the runner's root filesystem is read-only. Each run gets a private
        # scratch dir on the /tmp tmpfs, removed afterwards so runs cannot see
        # each other's files. It holds no strategies/ + storage/ pair at start,
        # so Jesse still does not treat it as a project (no DB, no .env).
        run_dir = tempfile.mkdtemp(prefix="engine-run-")
        try:
            if identity is not None:
                # Owned by the slot's worker; the server keeps group access
                # because it chdirs into the dir before dropping privileges.
                # chmod first: without CAP_FOWNER only the owner may chmod.
                os.chmod(run_dir, 0o770)
                os.chown(run_dir, identity.uid, os.getgid())
            return await self._run_worker(payload, run_dir, identity)
        finally:
            if await asyncio.to_thread(self._cleanup, run_dir, identity):
                self._slots.put_nowait(slot)
            else:
                logger.error(
                    "worker slot %d still has live processes after reaping; "
                    "retiring the slot",
                    slot,
                )

    @staticmethod
    def _cleanup(run_dir: str, identity: _WorkerIdentity | None) -> bool:
        reaped = True
        if identity is not None:
            reaped = _reap_uid(identity.uid)
            _reclaim_tree(run_dir)
        shutil.rmtree(run_dir, ignore_errors=True)
        return reaped

    async def _run_worker(
        self,
        payload: bytes,
        run_dir: str,
        identity: _WorkerIdentity | None,
    ) -> bytes:
        job_id, requested_timeout = decode_job_metadata(payload)
        timeout = min(requested_timeout, self._settings.runner_timeout_seconds)

        # Everything that caches is pointed into the run dir, so no state
        # (numba cache, matplotlib config, temp files) outlives the job.
        env = {
            **os.environ,
            "HOME": run_dir,
            "TMPDIR": run_dir,
            "MPLCONFIGDIR": os.path.join(run_dir, ".matplotlib"),
            "NUMBA_CACHE_DIR": os.path.join(run_dir, ".numba"),
        }
        privileges = (
            {}
            if identity is None
            else {"user": identity.uid, "group": identity.gid, "extra_groups": []}
        )

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
                cwd=run_dir,
                env=env,
                **privileges,
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
        # The worker has exited; take down whatever it left in its session.
        # With per-slot uids, _cleanup also catches processes that left it.
        self._kill(process)

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

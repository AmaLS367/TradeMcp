"""Single-use subprocess entrypoint for executing one strategy job.

Standard output is reserved for the binary protocol. User output is redirected
to standard error so it cannot corrupt the encoded result.
"""

from __future__ import annotations

import contextlib
import sys
import traceback

from engine.adapters.jesse.backtest import run_jesse_backtest
from engine.adapters.sandbox.codec import decode_job, encode_result
from engine.domain.runtime.contracts import (
    RunnerError,
    RunnerJob,
    RunnerResult,
    RunnerStatus,
)
from engine.domain.strategy.source_policy import ALLOWED_ROOT_MODULES, validate_source

_TRACEBACK_TAIL_CHARS = 2000
_BLOCKED_BUILTINS = (
    "open",
    "eval",
    "exec",
    "compile",
    "breakpoint",
    "exit",
    "quit",
    "input",
)


def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):
    """Reject obvious disallowed imports before execution.

    This is a quality guard, not the security boundary. The networkless runner
    container introduced by a later task provides that boundary.
    """
    if name.split(".")[0] not in ALLOWED_ROOT_MODULES:
        raise ImportError(f"Import '{name}' is prohibited by policy")
    return __import__(name, globals, locals, fromlist, level)


def _compile_strategy(job: RunnerJob) -> type:
    import builtins

    from jesse.strategies import Strategy

    safe_builtins = dict(vars(builtins))
    for blocked in _BLOCKED_BUILTINS:
        safe_builtins.pop(blocked, None)
    safe_builtins["__import__"] = _safe_import

    namespace: dict = {
        "__builtins__": safe_builtins,
        "Strategy": Strategy,
        "__name__": "strategy",
    }
    exec(job.source_code, namespace)  # noqa: S102 - isolated runner execution
    return namespace[job.strategy_class_name]


def _execute(job: RunnerJob, warmup, trading) -> RunnerResult:
    validation = validate_source(job.source_code)
    if not validation.valid:
        return RunnerResult(
            job_id=job.job_id,
            status=RunnerStatus.INVALID_STRATEGY,
            error=RunnerError(
                type="SourceValidationError",
                message="; ".join(validation.errors),
            ),
        )

    strategy_class = _compile_strategy(job)
    metrics, equity_curve = run_jesse_backtest(
        strategy_class=strategy_class,
        config=job.config,
        warmup=warmup,
        trading=trading,
        parameters=job.parameters,
    )
    return RunnerResult(
        job_id=job.job_id,
        status=RunnerStatus.OK,
        metrics=metrics,
        equity_curve=equity_curve,
    )


def main() -> int:
    payload = sys.stdin.buffer.read()
    job_id = "unknown"
    try:
        job, warmup, trading = decode_job(payload)
        job_id = job.job_id
        with contextlib.redirect_stdout(sys.stderr):
            result = _execute(job, warmup, trading)
    except MemoryError:
        result = RunnerResult(
            job_id=job_id,
            status=RunnerStatus.MEMORY_EXCEEDED,
            error=RunnerError(type="MemoryError", message="memory limit exceeded"),
        )
    except BaseException as error:  # noqa: BLE001 - always return a protocol frame
        result = RunnerResult(
            job_id=job_id,
            status=RunnerStatus.RUNTIME_ERROR,
            error=RunnerError(
                type=type(error).__name__,
                message=str(error)[:500],
                traceback_tail=traceback.format_exc()[-_TRACEBACK_TAIL_CHARS:],
            ),
        )

    sys.stdout.buffer.write(encode_result(result))
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

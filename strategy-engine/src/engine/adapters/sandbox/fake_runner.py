"""Test double for use cases; it provides no process isolation."""

from __future__ import annotations

from engine.domain.dataset.models import CandleBundle
from engine.domain.runtime.contracts import RunnerJob, RunnerResult


class FakeRunner:
    def __init__(self, result: RunnerResult) -> None:
        self._result = result
        self.calls: list[tuple[RunnerJob, CandleBundle]] = []

    async def run(self, job: RunnerJob, bundle: CandleBundle) -> RunnerResult:
        self.calls.append((job, bundle))
        return RunnerResult(
            job_id=job.job_id,
            status=self._result.status,
            metrics=self._result.metrics,
            equity_curve=self._result.equity_curve,
            error=self._result.error,
        )

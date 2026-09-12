# Strategy Engine Clean Architecture Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Перестроить `strategy-engine/` в слоёную архитектуру с исполняемым правилом зависимостей, перевести бэктесты на реальные данные из Postgres и вынести исполнение LLM-кода в контейнер без сети.

**Architecture:** Четыре слоя (`domain ← usecases ← adapters ← entrypoints`) внутри `src/engine/`, каждый разрезан на предметные модули. Два процесса: оркестратор (FastAPI, Jesse в режиме проекта, доступ к Postgres) и раннер (без сети, свежий subprocess на прогон). Общаются кадрированным бинарным протоколом через Unix-сокет.

**Tech Stack:** Python 3.11, FastAPI, Jesse 3.1.3+, numpy, pydantic v2 (только на границе API), uv, pytest, ruff, import-linter, Postgres, Redis, Docker Compose.

**Spec:** `docs/superpowers/specs/2026-09-12-strategy-engine-clean-architecture-design.md`

## Global Constraints

- Python `>=3.11`. Менеджер пакетов — `uv`. Все команды запускаются из `strategy-engine/`.
- **`engine.domain` и `engine.usecases` не импортируют `jesse`, `numpy`, `pydantic`, `fastapi`, `psycopg`.** Проверяется `import-linter` в CI.
- **Pydantic только в `engine/entrypoints/api/schemas/`.** В `domain` — `@dataclass(frozen=True)`.
- **Все `__init__.py` пустые.** Никаких реэкспортов: раннер импортирует `engine.domain.*` и `engine.adapters.sandbox.codec`, и не должен тянуть psycopg или ccxt.
- Свечи между процессами передаются как `bytes` (сырой `float64`), не как JSON.
- Метрики — `float | None`. NaN и inf отображаются в `None`, никогда в `0.0`.
- Имя пакета — `engine`. В `pyproject.toml` обязателен `[tool.uv.build-backend] module-name = "engine"`.
- Старый пакет `src/strategy_engine/` живёт до Task 14 — main остаётся зелёным всё это время.
- TDD: сначала падающий тест, потом минимальная реализация. Коммит в конце каждой задачи.

---

### Task 1: Скелет пакета и исполняемое правило зависимостей

Создаёт пустую слоёную структуру `src/engine/` и настраивает `import-linter`, который с этого момента не даёт архитектуре развалиться. Старый пакет не трогаем.

**Files:**
- Create: `strategy-engine/src/engine/__init__.py` и пустые `__init__.py` во всех подпакетах
- Modify: `strategy-engine/pyproject.toml`
- Create: `strategy-engine/.importlinter`
- Test: `strategy-engine/tests/architecture/test_layering.py`

**Interfaces:**
- Consumes: ничего
- Produces: дерево пакетов `engine.domain.{shared,strategy,dataset,backtest,runtime}`, `engine.usecases.{ports,strategy,dataset,backtest}`, `engine.adapters.{jesse,sandbox}`, `engine.entrypoints.{api,runner}`; команда `uv run lint-imports`

- [x] **Step 1: Создать дерево пакетов с пустыми `__init__.py`**

```bash
cd strategy-engine
for d in \
  src/engine \
  src/engine/domain src/engine/domain/shared src/engine/domain/strategy \
  src/engine/domain/dataset src/engine/domain/backtest src/engine/domain/runtime \
  src/engine/usecases src/engine/usecases/ports src/engine/usecases/strategy \
  src/engine/usecases/dataset src/engine/usecases/backtest \
  src/engine/adapters src/engine/adapters/jesse src/engine/adapters/sandbox \
  src/engine/entrypoints src/engine/entrypoints/api src/engine/entrypoints/api/routers \
  src/engine/entrypoints/api/schemas src/engine/entrypoints/runner \
  tests/architecture tests/unit tests/contract tests/integration
do
  mkdir -p "$d" && touch "$d/__init__.py"
done
rm -f tests/architecture/__init__.py tests/unit/__init__.py tests/contract/__init__.py tests/integration/__init__.py
```

- [x] **Step 2: Настроить сборку на новое имя модуля**

В `strategy-engine/pyproject.toml` добавить секцию сборки и dev-зависимости:

```toml
[tool.uv.build-backend]
module-name = "engine"

[tool.pytest.ini_options]
testpaths = ["tests"]
markers = [
    "integration: requires real Postgres and Jesse (deselected by default)",
]
addopts = "-m 'not integration'"
```

В существующую группу `[dependency-groups] dev` добавить `"import-linter>=2.0"`.

- [x] **Step 3: Написать контракты зависимостей**

Создать `strategy-engine/.importlinter`:

```ini
[importlinter]
root_package = engine
include_external_packages = True

[importlinter:contract:layers]
name = Layers: domain <- usecases <- adapters <- entrypoints
type = layers
layers =
    engine.entrypoints
    engine.adapters
    engine.usecases
    engine.domain

[importlinter:contract:domain-layers]
name = Domain modules form a dependency chain
type = layers
layers =
    engine.domain.runtime
    engine.domain.backtest
    engine.domain.dataset
    engine.domain.strategy
    engine.domain.shared

[importlinter:contract:pure-core]
name = Core domain and usecases are pure of framework dependencies
type = forbidden
source_modules =
    engine.domain
    engine.usecases
forbidden_modules =
    jesse
    numpy
    pydantic
    fastapi
    psycopg
```

- [x] **Step 4: Написать падающий тест на правило зависимостей**

Создать `strategy-engine/tests/architecture/test_layering.py`:

```python
"""Dependency rules must be executable rather than declarative."""

import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]


def _run_lint_imports() -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [
            sys.executable,
            "-c",
            "from importlinter.cli import lint_imports_command; lint_imports_command()",
        ],
        cwd=PROJECT_ROOT,
        capture_output=True,
        text=True,
        check=False,
    )


def test_dependency_rule_holds() -> None:
    result = _run_lint_imports()
    assert result.returncode == 0, result.stdout + result.stderr


def test_violation_is_actually_caught(tmp_path: Path) -> None:
    """A contract that catches nothing is worse than having no contract."""
    offender = PROJECT_ROOT / "src/engine/domain/shared/_violation_probe.py"
    offender.write_text("import numpy  # noqa: F401\n", encoding="utf-8")
    try:
        result = _run_lint_imports()
        assert result.returncode != 0, "import-linter allowed numpy in domain"
    finally:
        offender.unlink()
```

- [x] **Step 5: Запустить тест и убедиться, что он падает**

Run: `cd strategy-engine && uv run pytest tests/architecture -v`
Expected: FAIL — `import-linter` ещё не установлен либо не находит пакет `engine`.

- [x] **Step 6: Установить зависимости и добиться прохождения**

```bash
cd strategy-engine
uv sync
uv run pytest tests/architecture -v
```

Expected: PASS. Если `import-linter` жалуется, что не может импортировать `engine` — проверить, что `uv sync` переустановил проект с `module-name = "engine"`.

- [x] **Step 7: Коммит**

```bash
git add strategy-engine/src/engine strategy-engine/.importlinter \
        strategy-engine/pyproject.toml strategy-engine/uv.lock \
        strategy-engine/tests/architecture
git commit -m "feat(engine): add layered package skeleton with enforced dependency rule"
```

---

### Task 2: Domain — примитивы и модуль strategy

Канонические примитивы хеширования и всё, что касается исходника стратегии: нормализация, `strategy_hash`, AST-политика.

**Files:**
- Create: `strategy-engine/src/engine/domain/shared/errors.py`
- Create: `strategy-engine/src/engine/domain/shared/hashing.py`
- Create: `strategy-engine/src/engine/domain/strategy/models.py`
- Create: `strategy-engine/src/engine/domain/strategy/hashing.py`
- Create: `strategy-engine/src/engine/domain/strategy/source_policy.py`
- Test: `strategy-engine/tests/unit/domain/test_strategy_hashing.py`
- Test: `strategy-engine/tests/unit/domain/test_source_policy.py`

**Interfaces:**
- Consumes: ничего
- Produces:
  - `canonical_json(value: Any) -> str`
  - `sha256_of(*parts: str | bytes) -> str`
  - `EngineError`, `SourceValidationError`, `DatasetUnavailable`, `RunnerTimeout`, `RunnerCrashed`
  - `SourceValidation(valid: bool, strategy_class_name: str | None, errors: tuple[str, ...], detected_methods: tuple[str, ...])`
  - `normalize_source(source: str) -> str`
  - `strategy_hash(source: str, parameters: Mapping[str, Any]) -> str`
  - `validate_source(source: str) -> SourceValidation`
  - `ALLOWED_ROOT_MODULES: frozenset[str]`

- [x] **Step 1: Написать падающие тесты на хеширование**

Создать `strategy-engine/tests/unit/domain/test_strategy_hashing.py`:

```python
from engine.domain.strategy.hashing import normalize_source, strategy_hash


def test_hash_is_stable_across_calls() -> None:
    source = "class S:\n    pass\n"
    assert strategy_hash(source, {"a": 1}) == strategy_hash(source, {"a": 1})


def test_parameter_order_does_not_change_hash() -> None:
    source = "class S:\n    pass\n"
    assert strategy_hash(source, {"a": 1, "b": 2}) == strategy_hash(source, {"b": 2, "a": 1})


def test_parameter_value_changes_hash() -> None:
    source = "class S:\n    pass\n"
    assert strategy_hash(source, {"a": 1}) != strategy_hash(source, {"a": 2})


def test_line_endings_are_normalized() -> None:
    assert strategy_hash("a = 1\r\nb = 2\r\n", {}) == strategy_hash("a = 1\nb = 2\n", {})


def test_blank_line_inside_source_changes_hash() -> None:
    """Старая нормализация выбрасывала пустые строки и порождала коллизии.

    Две стратегии, различающиеся пустой строкой внутри многострочного
    литерала, ведут себя по-разному и обязаны иметь разные хеши.
    """
    with_blank = 'DOC = """a\n\nb"""\n'
    without_blank = 'DOC = """a\nb"""\n'
    assert strategy_hash(with_blank, {}) != strategy_hash(without_blank, {})


def test_trailing_whitespace_at_eof_is_ignored() -> None:
    assert normalize_source("a = 1\n\n\n  ") == normalize_source("a = 1")
```

- [x] **Step 2: Запустить и убедиться, что тесты падают**

Run: `cd strategy-engine && uv run pytest tests/unit/domain/test_strategy_hashing.py -v`
Expected: FAIL с `ModuleNotFoundError: No module named 'engine.domain.strategy.hashing'`

- [x] **Step 3: Реализовать примитивы и хеширование**

`src/engine/domain/shared/hashing.py`:

```python
"""Примитивы канонической сериализации и хеширования.

Единственное место, где определяется, что значит «канонический» — все
доменные хеши обязаны идти через эти две функции.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


def canonical_json(value: Any) -> str:
    """Стабильное представление: сортированные ключи, без лишних пробелов."""
    return json.dumps(
        value,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
        default=str,
    )


def sha256_of(*parts: str | bytes) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part.encode("utf-8") if isinstance(part, str) else part)
        digest.update(b"\x1e")  # разделитель записей, чтобы склейка не давала коллизий
    return digest.hexdigest()
```

`src/engine/domain/shared/errors.py`:

```python
"""Доменные ошибки. Транспорт и HTTP-коды к ним не относятся."""

from __future__ import annotations


class EngineError(Exception):
    """Базовая ошибка движка."""


class SourceValidationError(EngineError):
    def __init__(self, errors: tuple[str, ...]) -> None:
        super().__init__("; ".join(errors))
        self.errors = errors


class DatasetUnavailable(EngineError):
    """Свечей за запрошенный диапазон нет и получить их не удалось."""


class RunnerTimeout(EngineError):
    """Стратегия не уложилась в отведённое время и была снята."""


class RunnerCrashed(EngineError):
    """Раннер завершился аварийно или вернул нечитаемый ответ."""
```

`src/engine/domain/strategy/hashing.py`:

```python
"""Хеш версии стратегии: исходник плюс параметры."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from engine.domain.shared.hashing import canonical_json, sha256_of


def normalize_source(source: str) -> str:
    """Нормализует только незначащие различия.

    Приводит переводы строк к ``\\n`` и обрезает хвостовые пробелы в конце
    файла. Сознательно НЕ выбрасывает пустые строки: внутри docstring или
    многострочного литерала они значимы, и их удаление давало бы одинаковый
    хеш для по-разному ведущих себя стратегий.
    """
    return source.replace("\r\n", "\n").replace("\r", "\n").rstrip()


def strategy_hash(source: str, parameters: Mapping[str, Any]) -> str:
    return sha256_of(normalize_source(source), canonical_json(dict(parameters)))
```

- [x] **Step 4: Запустить тесты хеширования**

Run: `cd strategy-engine && uv run pytest tests/unit/domain/test_strategy_hashing.py -v`
Expected: PASS (6 тестов)

- [x] **Step 5: Написать падающие тесты на AST-политику**

Создать `strategy-engine/tests/unit/domain/test_source_policy.py`:

```python
from engine.domain.strategy.source_policy import validate_source

LONG_ONLY = """
from jesse.strategies import Strategy

class LongOnly(Strategy):
    def should_long(self) -> bool:
        return True
    def go_long(self) -> None:
        self.buy = 1, self.price
"""

SHORT_ONLY = """
from jesse.strategies import Strategy

class ShortOnly(Strategy):
    def should_short(self) -> bool:
        return True
    def go_short(self) -> None:
        self.sell = 1, self.price
"""


def test_long_only_strategy_is_accepted() -> None:
    result = validate_source(LONG_ONLY)
    assert result.valid, result.errors
    assert result.strategy_class_name == "LongOnly"


def test_short_only_strategy_is_accepted() -> None:
    """Старая версия требовала should_long/go_long и ломала short-only."""
    result = validate_source(SHORT_ONLY)
    assert result.valid, result.errors
    assert result.strategy_class_name == "ShortOnly"


def test_async_methods_are_detected() -> None:
    source = """
from jesse.strategies import Strategy

class AsyncStrat(Strategy):
    async def should_long(self) -> bool:
        return True
    async def go_long(self) -> None:
        pass
"""
    result = validate_source(source)
    assert "should_long" in result.detected_methods
    assert "go_long" in result.detected_methods


def test_forbidden_import_is_rejected() -> None:
    source = LONG_ONLY + "\nimport os\n"
    result = validate_source(source)
    assert not result.valid
    assert any("os" in e for e in result.errors)


def test_multiple_strategy_classes_are_rejected() -> None:
    """Молчаливый выбор последнего класса — источник сюрпризов."""
    result = validate_source(LONG_ONLY + SHORT_ONLY)
    assert not result.valid
    assert any("несколько" in e.lower() or "multiple" in e.lower() for e in result.errors)


def test_missing_entry_pair_is_rejected() -> None:
    source = """
from jesse.strategies import Strategy

class Incomplete(Strategy):
    def should_long(self) -> bool:
        return True
"""
    result = validate_source(source)
    assert not result.valid


def test_syntax_error_is_reported_with_line() -> None:
    result = validate_source("class Broken(:\n")
    assert not result.valid
    assert any("1" in e for e in result.errors)
```

- [x] **Step 6: Запустить и убедиться, что тесты падают**

Run: `cd strategy-engine && uv run pytest tests/unit/domain/test_source_policy.py -v`
Expected: FAIL с `ModuleNotFoundError`

- [x] **Step 7: Реализовать модели и AST-политику**

`src/engine/domain/strategy/models.py`:

```python
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class SourceValidation:
    valid: bool
    strategy_class_name: str | None = None
    errors: tuple[str, ...] = ()
    detected_methods: tuple[str, ...] = ()
```

`src/engine/domain/strategy/source_policy.py`:

```python
"""Статическая политика для сгенерированного кода стратегий.

ВАЖНО: это фильтр качества и первая линия обратной связи для агента, а НЕ
граница безопасности. Границей является контейнер раннера без сети с
урезанными правами. Разрешённый модуль вроде ``jesse`` реэкспортирует ``os``,
и никакой список запрещённых атрибутов этого не закроет. Не пытайтесь
превратить этот файл в песочницу.
"""

from __future__ import annotations

import ast

from engine.domain.strategy.models import SourceValidation

ALLOWED_ROOT_MODULES = frozenset(
    {"math", "numpy", "pandas", "jesse", "typing", "dataclasses", "decimal", "statistics"}
)

BLOCKED_CALLS = frozenset(
    {"open", "exec", "eval", "compile", "__import__", "globals", "locals",
     "breakpoint", "exit", "quit", "input", "getattr", "setattr", "delattr", "vars"}
)

FORBIDDEN_ATTRIBUTES = frozenset(
    {"__subclasses__", "__class__", "__bases__", "__builtins__", "__globals__",
     "__code__", "__closure__", "__mro__", "__dict__", "__getattribute__"}
)

ENTRY_PAIRS = (("should_long", "go_long"), ("should_short", "go_short"))


class _StrategyVisitor(ast.NodeVisitor):
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.strategy_classes: list[str] = []
        self.detected_methods: list[str] = []

    def _check_root(self, module_name: str, lineno: int) -> None:
        root = module_name.split(".")[0]
        if root not in ALLOWED_ROOT_MODULES:
            self.errors.append(
                f"Строка {lineno}: импорт '{module_name}' запрещён. "
                f"Разрешены: {sorted(ALLOWED_ROOT_MODULES)}"
            )

    def visit_Import(self, node: ast.Import) -> None:
        for alias in node.names:
            self._check_root(alias.name, node.lineno)
        self.generic_visit(node)

    def visit_ImportFrom(self, node: ast.ImportFrom) -> None:
        if node.level:
            self.errors.append(f"Строка {node.lineno}: относительные импорты запрещены")
        elif node.module:
            self._check_root(node.module, node.lineno)
        self.generic_visit(node)

    def visit_Call(self, node: ast.Call) -> None:
        if isinstance(node.func, ast.Name) and node.func.id in BLOCKED_CALLS:
            self.errors.append(f"Строка {node.lineno}: вызов '{node.func.id}' запрещён")
        self.generic_visit(node)

    def visit_Attribute(self, node: ast.Attribute) -> None:
        if node.attr in FORBIDDEN_ATTRIBUTES:
            self.errors.append(f"Строка {node.lineno}: доступ к '{node.attr}' запрещён")
        self.generic_visit(node)

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        inherits_strategy = any(
            (isinstance(base, ast.Name) and base.id == "Strategy")
            or (isinstance(base, ast.Attribute) and base.attr == "Strategy")
            for base in node.bases
        )
        if inherits_strategy:
            self.strategy_classes.append(node.name)
            for item in node.body:
                if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    self.detected_methods.append(item.name)
        self.generic_visit(node)


def validate_source(source_code: str) -> SourceValidation:
    if not source_code or not source_code.strip():
        return SourceValidation(valid=False, errors=("Исходный код пуст",))

    try:
        tree = ast.parse(source_code)
    except SyntaxError as err:
        return SourceValidation(
            valid=False,
            errors=(f"Синтаксическая ошибка в строке {err.lineno}: {err.msg}",),
        )

    visitor = _StrategyVisitor()
    visitor.visit(tree)
    errors = list(visitor.errors)

    if not visitor.strategy_classes:
        errors.append("Не найден класс, наследующий 'Strategy'")
    elif len(visitor.strategy_classes) > 1:
        errors.append(
            f"Найдено несколько классов-стратегий: {visitor.strategy_classes}. "
            "Оставьте ровно один."
        )

    methods = set(visitor.detected_methods)
    if visitor.strategy_classes and not any(
        should in methods and go in methods for should, go in ENTRY_PAIRS
    ):
        errors.append(
            "Нужна хотя бы одна полная пара точек входа: "
            "should_long+go_long или should_short+go_short"
        )

    return SourceValidation(
        valid=not errors,
        strategy_class_name=visitor.strategy_classes[0] if visitor.strategy_classes else None,
        errors=tuple(errors),
        detected_methods=tuple(visitor.detected_methods),
    )
```

- [x] **Step 8: Запустить все тесты модуля**

Run: `cd strategy-engine && uv run pytest tests/unit tests/architecture -v`
Expected: PASS (все тесты, включая `lint-imports`)

- [x] **Step 9: Коммит**

```bash
git add strategy-engine/src/engine/domain strategy-engine/tests/unit
git commit -m "feat(engine): add domain primitives, strategy hashing and AST policy"
```

---

### Task 3: Domain — модули dataset и backtest

Датасет, метрики и композитный `run_hash`. Здесь чинится подмена `profit_factor` и NaN→0.0.

**Files:**
- Create: `strategy-engine/src/engine/domain/dataset/models.py`
- Create: `strategy-engine/src/engine/domain/dataset/hashing.py`
- Create: `strategy-engine/src/engine/domain/backtest/models.py`
- Create: `strategy-engine/src/engine/domain/backtest/metrics.py`
- Create: `strategy-engine/src/engine/domain/backtest/hashing.py`
- Test: `strategy-engine/tests/unit/domain/test_dataset.py`
- Test: `strategy-engine/tests/unit/domain/test_metrics.py`
- Test: `strategy-engine/tests/unit/domain/test_run_hashing.py`

**Interfaces:**
- Consumes: `canonical_json`, `sha256_of` из Task 2
- Produces:
  - `DateRange(start_ms: int, finish_ms: int)`
  - `DatasetRef(exchange, symbol, timeframe, date_range, warmup_rows, trading_rows, columns, dtype, dataset_hash)`
  - `CandleBundle(ref: DatasetRef, warmup: bytes, trading: bytes)`
  - `dataset_hash(*, exchange, symbol, timeframe, start_ms, finish_ms, warmup_rows, trading_rows, columns, dtype, warmup_bytes, trading_bytes) -> str`
  - `BacktestConfig(exchange, symbol, timeframe, initial_balance, fee_rate, market_type, leverage, leverage_mode, fee_model, slippage_model)`
  - `BacktestMetrics`, `EquityPoint`, `clean_float(value: Any) -> float | None`
  - `run_hash(*, strategy_hash, dataset_hash, engine_version, jesse_version, config, date_range, warmup_rows) -> str`

- [x] **Step 1: Написать падающие тесты датасета**

Создать `strategy-engine/tests/unit/domain/test_dataset.py`:

```python
from engine.domain.dataset.hashing import dataset_hash

BASE = dict(
    exchange="Binance",
    symbol="BTC-USDT",
    timeframe="1m",
    start_ms=1_600_000_000_000,
    finish_ms=1_600_086_400_000,
    warmup_rows=0,
    trading_rows=2,
    columns=6,
    dtype="float64",
)


def test_same_bytes_same_hash() -> None:
    a = dataset_hash(**BASE, warmup_bytes=b"", trading_bytes=b"\x01\x02")
    b = dataset_hash(**BASE, warmup_bytes=b"", trading_bytes=b"\x01\x02")
    assert a == b


def test_different_bytes_same_length_differ() -> None:
    """Старый хеш считался от candles_count и коллизировал на равных длинах."""
    a = dataset_hash(**BASE, warmup_bytes=b"", trading_bytes=b"\x01\x02")
    b = dataset_hash(**BASE, warmup_bytes=b"", trading_bytes=b"\x03\x04")
    assert a != b


def test_warmup_participates_in_hash() -> None:
    a = dataset_hash(**BASE, warmup_bytes=b"", trading_bytes=b"\x01")
    b = dataset_hash(**{**BASE, "warmup_rows": 1}, warmup_bytes=b"\x09", trading_bytes=b"\x01")
    assert a != b


def test_symbol_participates_in_hash() -> None:
    a = dataset_hash(**BASE, warmup_bytes=b"", trading_bytes=b"\x01")
    b = dataset_hash(**{**BASE, "symbol": "ETH-USDT"}, warmup_bytes=b"", trading_bytes=b"\x01")
    assert a != b
```

- [x] **Step 2: Написать падающие тесты метрик**

Создать `strategy-engine/tests/unit/domain/test_metrics.py`:

```python
import math

from engine.domain.backtest.metrics import clean_float


def test_nan_becomes_none() -> None:
    """NaN, отображённый в 0.0, делает «не посчиталось» неотличимым от «ноль»."""
    assert clean_float(float("nan")) is None


def test_infinity_becomes_none() -> None:
    assert clean_float(math.inf) is None
    assert clean_float(-math.inf) is None


def test_none_stays_none() -> None:
    assert clean_float(None) is None


def test_number_passes_through() -> None:
    assert clean_float(42) == 42.0
    assert clean_float(-0.5) == -0.5


def test_non_numeric_becomes_none() -> None:
    assert clean_float("n/a") is None
```

- [x] **Step 3: Написать падающие тесты run_hash**

Создать `strategy-engine/tests/unit/domain/test_run_hashing.py`:

```python
import dataclasses

from engine.domain.backtest.hashing import run_hash
from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import DateRange

CONFIG = BacktestConfig(
    exchange="Binance",
    symbol="BTC-USDT",
    timeframe="1h",
    initial_balance=10_000.0,
    fee_rate=0.0006,
)
RANGE = DateRange(start_ms=1_600_000_000_000, finish_ms=1_600_086_400_000)

BASE = dict(
    strategy_hash="s" * 64,
    dataset_hash="d" * 64,
    engine_version="0.2.0+abc1234",
    jesse_version="3.1.3",
    config=CONFIG,
    date_range=RANGE,
    warmup_rows=200,
)


def test_run_hash_is_deterministic() -> None:
    assert run_hash(**BASE) == run_hash(**BASE)


def test_engine_version_participates() -> None:
    other = {**BASE, "engine_version": "0.3.0+def5678"}
    assert run_hash(**BASE) != run_hash(**other)


def test_dataset_hash_participates() -> None:
    other = {**BASE, "dataset_hash": "e" * 64}
    assert run_hash(**BASE) != run_hash(**other)


def test_fill_model_participates() -> None:
    """Заглушки fee_model/slippage_model уже в хеше, чтобы фаза 2 автоматически
    инвалидировала старые прогоны, а не смешала их с новыми."""
    other = {**BASE, "config": dataclasses.replace(CONFIG, slippage_model="microstructure_v1")}
    assert run_hash(**BASE) != run_hash(**other)


def test_fee_rate_participates() -> None:
    other = {**BASE, "config": dataclasses.replace(CONFIG, fee_rate=0.001)}
    assert run_hash(**BASE) != run_hash(**other)
```

- [x] **Step 4: Запустить и убедиться, что тесты падают**

Run: `cd strategy-engine && uv run pytest tests/unit/domain -v`
Expected: три новых файла падают с `ModuleNotFoundError`, тесты из Task 2 проходят

- [x] **Step 5: Реализовать dataset**

`src/engine/domain/dataset/models.py`:

```python
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class DateRange:
    start_ms: int
    finish_ms: int

    def __post_init__(self) -> None:
        if self.finish_ms <= self.start_ms:
            raise ValueError("finish_ms должен быть строго больше start_ms")


@dataclass(frozen=True)
class DatasetRef:
    exchange: str
    symbol: str
    timeframe: str
    date_range: DateRange
    warmup_rows: int
    trading_rows: int
    columns: int
    dtype: str
    dataset_hash: str


@dataclass(frozen=True)
class CandleBundle:
    """Свечи как непрозрачные байты.

    Ядро никогда не разбирает содержимое — оно передаёт байты от репозитория
    к раннеру. Именно поэтому usecases обходятся без numpy.
    """

    ref: DatasetRef
    warmup: bytes
    trading: bytes
```

`src/engine/domain/dataset/hashing.py`:

```python
from __future__ import annotations

from engine.domain.shared.hashing import canonical_json, sha256_of


def dataset_hash(
    *,
    exchange: str,
    symbol: str,
    timeframe: str,
    start_ms: int,
    finish_ms: int,
    warmup_rows: int,
    trading_rows: int,
    columns: int,
    dtype: str,
    warmup_bytes: bytes,
    trading_bytes: bytes,
) -> str:
    """Хеш от дескриптора И от самих байтов свечей.

    Хеширование по количеству свечей давало коллизии для разных датасетов
    одинаковой длины, поэтому в digest идут сырые float64-байты.
    """
    descriptor = canonical_json(
        {
            "exchange": exchange,
            "symbol": symbol,
            "timeframe": timeframe,
            "start_ms": start_ms,
            "finish_ms": finish_ms,
            "warmup_rows": warmup_rows,
            "trading_rows": trading_rows,
            "columns": columns,
            "dtype": dtype,
        }
    )
    return sha256_of(descriptor, warmup_bytes, trading_bytes)
```

- [x] **Step 6: Реализовать backtest-модели, метрики и run_hash**

`src/engine/domain/backtest/models.py`:

```python
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class BacktestConfig:
    exchange: str
    symbol: str
    timeframe: str
    initial_balance: float
    fee_rate: float
    market_type: str = "futures"
    leverage: int = 1
    leverage_mode: str = "cross"
    # Заглушки до фазы 2. Уже участвуют в run_hash, поэтому появление
    # настоящего симулятора исполнения инвалидирует старые прогоны.
    fee_model: str = "jesse_default"
    slippage_model: str = "jesse_default"
```

`src/engine/domain/backtest/metrics.py`:

```python
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any


def clean_float(value: Any) -> float | None:
    """NaN и inf становятся None, а не нулём.

    «Sharpe не определён» и «Sharpe равен нулю» — разные утверждения, и
    агент, принимающий решения по числам, должен их различать.
    """
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if math.isnan(value) or math.isinf(value):
        return None
    return float(value)


@dataclass(frozen=True)
class EquityPoint:
    timestamp_ms: int
    equity: float


@dataclass(frozen=True)
class BacktestMetrics:
    net_return_percent: float | None = None
    sharpe: float | None = None
    sortino: float | None = None
    calmar: float | None = None
    omega: float | None = None
    max_drawdown_percent: float | None = None
    win_rate: float | None = None
    profit_factor: float | None = None
    payoff_ratio: float | None = None
    expectancy: float | None = None
    starting_balance: float | None = None
    finishing_balance: float | None = None
    total_trades: int = 0
    winning_trades: int = 0
    losing_trades: int = 0
    longs_count: int = 0
    shorts_count: int = 0
    trades: tuple[dict[str, Any], ...] = field(default_factory=tuple)
```

`src/engine/domain/backtest/hashing.py`:

```python
from __future__ import annotations

from dataclasses import asdict

from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import DateRange
from engine.domain.shared.hashing import canonical_json, sha256_of


def run_hash(
    *,
    strategy_hash: str,
    dataset_hash: str,
    engine_version: str,
    jesse_version: str,
    config: BacktestConfig,
    date_range: DateRange,
    warmup_rows: int,
) -> str:
    """Единственная композиция хешей в домене.

    Прогон воспроизводим только вместе с версиями кода, поэтому
    engine_version и jesse_version входят в digest наравне с данными.
    """
    payload = canonical_json(
        {
            "strategy_hash": strategy_hash,
            "dataset_hash": dataset_hash,
            "engine_version": engine_version,
            "jesse_version": jesse_version,
            "config": asdict(config),
            "start_ms": date_range.start_ms,
            "finish_ms": date_range.finish_ms,
            "warmup_rows": warmup_rows,
        }
    )
    return sha256_of(payload)
```

- [x] **Step 7: Запустить все unit-тесты и проверку слоёв**

Run: `cd strategy-engine && uv run pytest tests/unit tests/architecture -v`
Expected: PASS

- [x] **Step 8: Коммит**

```bash
git add strategy-engine/src/engine/domain strategy-engine/tests/unit
git commit -m "feat(engine): add dataset and backtest domain modules with honest metrics"
```

---

### Task 4: Domain runtime и кадрированный кодек

Контракт между процессами и его сериализация. Кодек лежит в `adapters/sandbox/`, потому что ему нужен numpy, а `domain` обязан оставаться без внешних зависимостей. Раннер импортирует кодек напрямую — `entrypoints → adapters` направлено внутрь и правило не нарушает.

**Files:**
- Create: `strategy-engine/src/engine/domain/runtime/contracts.py`
- Create: `strategy-engine/src/engine/domain/runtime/order_intent.py`
- Create: `strategy-engine/src/engine/adapters/sandbox/codec.py`
- Test: `strategy-engine/tests/contract/test_codec.py`

**Interfaces:**
- Consumes: `BacktestConfig`, `BacktestMetrics`, `EquityPoint`, `CandleBundle` из Task 3
- Produces:
  - `RuntimeMode` (`BACKTEST = "backtest"`)
  - `RunnerStatus` (`OK`, `INVALID_STRATEGY`, `TIMEOUT`, `RUNTIME_ERROR`, `MEMORY_EXCEEDED`)
  - `RunnerError(type: str, message: str, traceback_tail: str)`
  - `RunnerJob(job_id, mode, source_code, strategy_class_name, parameters, config, warmup_rows, timeout_seconds)`
  - `RunnerResult(job_id, status, metrics, equity_curve, error)`
  - `StrategyOrderIntent` (контракт фазы 4)
  - `encode_job(job: RunnerJob, bundle: CandleBundle) -> bytes`
  - `decode_job(payload: bytes) -> tuple[RunnerJob, np.ndarray, np.ndarray]`
  - `encode_result(result: RunnerResult) -> bytes`
  - `decode_result(payload: bytes) -> RunnerResult`
  - `read_frame(reader) -> bytes` / `write_frame(writer, payload) -> None` (asyncio)

- [x] **Step 1: Написать падающие тесты кодека**

Создать `strategy-engine/tests/contract/test_codec.py`:

```python
import numpy as np

from engine.adapters.sandbox.codec import (
    decode_job,
    decode_result,
    encode_job,
    encode_result,
)
from engine.domain.backtest.metrics import BacktestMetrics, EquityPoint
from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import CandleBundle, DateRange, DatasetRef
from engine.domain.runtime.contracts import (
    RunnerError,
    RunnerJob,
    RunnerResult,
    RunnerStatus,
    RuntimeMode,
)

CONFIG = BacktestConfig(
    exchange="Binance", symbol="BTC-USDT", timeframe="1h",
    initial_balance=10_000.0, fee_rate=0.0006,
)


def _bundle(warmup: np.ndarray, trading: np.ndarray) -> CandleBundle:
    ref = DatasetRef(
        exchange="Binance", symbol="BTC-USDT", timeframe="1m",
        date_range=DateRange(1_600_000_000_000, 1_600_086_400_000),
        warmup_rows=len(warmup), trading_rows=len(trading),
        columns=6, dtype="float64", dataset_hash="d" * 64,
    )
    return CandleBundle(ref=ref, warmup=warmup.tobytes(), trading=trading.tobytes())


def _job() -> RunnerJob:
    return RunnerJob(
        job_id="job-1",
        mode=RuntimeMode.BACKTEST,
        source_code="class S: pass",
        strategy_class_name="S",
        parameters={"period": 14},
        config=CONFIG,
        warmup_rows=2,
        timeout_seconds=30.0,
    )


def test_job_round_trip_preserves_candles_exactly() -> None:
    warmup = np.arange(12, dtype=np.float64).reshape(2, 6)
    trading = np.arange(100, 118, dtype=np.float64).reshape(3, 6)

    job, decoded_warmup, decoded_trading = decode_job(encode_job(_job(), _bundle(warmup, trading)))

    assert job.job_id == "job-1"
    assert job.parameters == {"period": 14}
    assert job.config == CONFIG
    np.testing.assert_array_equal(decoded_warmup, warmup)
    np.testing.assert_array_equal(decoded_trading, trading)


def test_candles_survive_full_float64_precision() -> None:
    """JSON потерял бы точность — поэтому свечи едут сырыми байтами."""
    trading = np.array([[1.0000000000000002, 2.0, 3.0, 4.0, 5.0, 6.0]], dtype=np.float64)
    warmup = np.empty((0, 6), dtype=np.float64)

    _, _, decoded = decode_job(encode_job(_job(), _bundle(warmup, trading)))

    assert decoded[0, 0].item() == trading[0, 0].item()


def test_empty_warmup_round_trips() -> None:
    warmup = np.empty((0, 6), dtype=np.float64)
    trading = np.ones((1, 6), dtype=np.float64)

    _, decoded_warmup, _ = decode_job(encode_job(_job(), _bundle(warmup, trading)))

    assert decoded_warmup.shape == (0, 6)


def test_ok_result_round_trip() -> None:
    result = RunnerResult(
        job_id="job-1",
        status=RunnerStatus.OK,
        metrics=BacktestMetrics(net_return_percent=12.5, sharpe=None, total_trades=7),
        equity_curve=(EquityPoint(1_600_000_000_000, 10_000.0),),
        error=None,
    )

    decoded = decode_result(encode_result(result))

    assert decoded.status is RunnerStatus.OK
    assert decoded.metrics == result.metrics
    assert decoded.metrics.sharpe is None
    assert decoded.equity_curve == result.equity_curve


def test_error_result_round_trip() -> None:
    result = RunnerResult(
        job_id="job-1",
        status=RunnerStatus.RUNTIME_ERROR,
        metrics=None,
        equity_curve=(),
        error=RunnerError(type="ZeroDivisionError", message="division by zero", traceback_tail="..."),
    )

    decoded = decode_result(encode_result(result))

    assert decoded.status is RunnerStatus.RUNTIME_ERROR
    assert decoded.error == result.error
    assert decoded.metrics is None
```

- [x] **Step 2: Запустить и убедиться, что тесты падают**

Run: `cd strategy-engine && uv run pytest tests/contract -v`
Expected: FAIL с `ModuleNotFoundError: No module named 'engine.adapters.sandbox.codec'`

- [x] **Step 3: Реализовать контракты рантайма**

`src/engine/domain/runtime/contracts.py`:

```python
"""Провод единого рантайма стратегий.

Эти типы пересекают границу процессов: их импортируют и оркестратор, и
изолированный раннер. Когда появится PaperAdapter, он расширит RuntimeMode,
а не заведёт параллельную иерархию.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum

from engine.domain.backtest.metrics import BacktestMetrics, EquityPoint
from engine.domain.backtest.models import BacktestConfig


class RuntimeMode(str, Enum):
    BACKTEST = "backtest"


class RunnerStatus(str, Enum):
    OK = "ok"
    INVALID_STRATEGY = "invalid_strategy"
    TIMEOUT = "timeout"
    RUNTIME_ERROR = "runtime_error"
    MEMORY_EXCEEDED = "memory_exceeded"


@dataclass(frozen=True)
class RunnerError:
    type: str
    message: str
    traceback_tail: str = ""


@dataclass(frozen=True)
class RunnerJob:
    job_id: str
    mode: RuntimeMode
    source_code: str
    strategy_class_name: str
    parameters: dict
    config: BacktestConfig
    warmup_rows: int
    timeout_seconds: float


@dataclass(frozen=True)
class RunnerResult:
    job_id: str
    status: RunnerStatus
    metrics: BacktestMetrics | None = None
    equity_curve: tuple[EquityPoint, ...] = ()
    error: RunnerError | None = None
```

`src/engine/domain/runtime/order_intent.py`:

```python
"""Детерминированный интент ордера.

Пока не производится ничем — контракт закладывается под PaperAdapter и
LiveAdapter фазы 4. Абстрактного confidence здесь намеренно нет: он
порождает галлюцинации у LLM и не проверяем.
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class TakeProfitTarget:
    price: float
    portion: float  # доля позиции, 0.0..1.0


@dataclass(frozen=True)
class StrategyOrderIntent:
    strategy_hash: str
    run_hash: str
    session_id: str

    exchange: str
    symbol: str

    side: str  # "buy" | "sell"
    type: str  # "market" | "limit" | "stop"

    quantity: float
    price: float | None = None

    reduce_only: bool = False
    post_only: bool = False

    stop_loss: float | None = None
    take_profits: tuple[TakeProfitTarget, ...] = ()

    generated_at_ms: int = 0
    candle_timestamp_ms: int = 0

    signal: str = ""
    indicators: dict[str, float] = field(default_factory=dict)
```

- [x] **Step 4: Реализовать кодек**

`src/engine/adapters/sandbox/codec.py`:

```python
"""Кадрированный бинарный протокол оркестратор ↔ раннер.

Формат кадра:
    [8 байт длины заголовка, big-endian][JSON-заголовок][warmup bytes][trading bytes]

Свечи едут сырыми float64-байтами, а не в JSON: полмиллиона баров — это
около 24 МБ, в JSON вышло бы под сотню с потерей точности на сериализации.

Живёт в adapters, а не в domain, потому что требует numpy. Раннер импортирует
этот модуль напрямую — entrypoints → adapters направлено внутрь.
"""

from __future__ import annotations

import asyncio
import dataclasses
import json
import struct

import numpy as np

from engine.domain.backtest.metrics import BacktestMetrics, EquityPoint
from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import CandleBundle
from engine.domain.runtime.contracts import (
    RunnerError,
    RunnerJob,
    RunnerResult,
    RunnerStatus,
    RuntimeMode,
)

_HEADER_LEN = struct.Struct(">Q")
_FRAME_LEN = struct.Struct(">Q")


def encode_job(job: RunnerJob, bundle: CandleBundle) -> bytes:
    header = json.dumps(
        {
            "job_id": job.job_id,
            "mode": job.mode.value,
            "source_code": job.source_code,
            "strategy_class_name": job.strategy_class_name,
            "parameters": job.parameters,
            "config": dataclasses.asdict(job.config),
            "warmup_rows": job.warmup_rows,
            "timeout_seconds": job.timeout_seconds,
            "columns": bundle.ref.columns,
            "dtype": bundle.ref.dtype,
            "warmup_bytes": len(bundle.warmup),
            "trading_bytes": len(bundle.trading),
        }
    ).encode("utf-8")
    return _HEADER_LEN.pack(len(header)) + header + bundle.warmup + bundle.trading


def decode_job(payload: bytes) -> tuple[RunnerJob, np.ndarray, np.ndarray]:
    (header_len,) = _HEADER_LEN.unpack_from(payload, 0)
    start = _HEADER_LEN.size
    header = json.loads(payload[start : start + header_len])
    start += header_len

    columns = header["columns"]
    dtype = np.dtype(header["dtype"])

    warmup_end = start + header["warmup_bytes"]
    warmup = np.frombuffer(payload[start:warmup_end], dtype=dtype).reshape(-1, columns)
    trading_end = warmup_end + header["trading_bytes"]
    trading = np.frombuffer(payload[warmup_end:trading_end], dtype=dtype).reshape(-1, columns)

    job = RunnerJob(
        job_id=header["job_id"],
        mode=RuntimeMode(header["mode"]),
        source_code=header["source_code"],
        strategy_class_name=header["strategy_class_name"],
        parameters=header["parameters"],
        config=BacktestConfig(**header["config"]),
        warmup_rows=header["warmup_rows"],
        timeout_seconds=header["timeout_seconds"],
    )
    # np.frombuffer отдаёт read-only view на неизменяемые bytes, а Jesse копирует
    # массивы через np.copy — но на всякий случай отдаём владеющие копии.
    return job, np.array(warmup, dtype=dtype), np.array(trading, dtype=dtype)


def encode_result(result: RunnerResult) -> bytes:
    return json.dumps(
        {
            "job_id": result.job_id,
            "status": result.status.value,
            "metrics": dataclasses.asdict(result.metrics) if result.metrics else None,
            "equity_curve": [dataclasses.asdict(p) for p in result.equity_curve],
            "error": dataclasses.asdict(result.error) if result.error else None,
        }
    ).encode("utf-8")


def decode_result(payload: bytes) -> RunnerResult:
    data = json.loads(payload)
    metrics = data.get("metrics")
    if metrics is not None:
        metrics = BacktestMetrics(
            **{**metrics, "trades": tuple(metrics.get("trades", ()))}
        )
    error = data.get("error")
    return RunnerResult(
        job_id=data["job_id"],
        status=RunnerStatus(data["status"]),
        metrics=metrics,
        equity_curve=tuple(EquityPoint(**p) for p in data.get("equity_curve", [])),
        error=RunnerError(**error) if error else None,
    )


async def write_frame(writer: asyncio.StreamWriter, payload: bytes) -> None:
    writer.write(_FRAME_LEN.pack(len(payload)))
    writer.write(payload)
    await writer.drain()


async def read_frame(reader: asyncio.StreamReader) -> bytes:
    raw_len = await reader.readexactly(_FRAME_LEN.size)
    (length,) = _FRAME_LEN.unpack(raw_len)
    return await reader.readexactly(length)
```

- [x] **Step 5: Запустить контрактные тесты**

Run: `cd strategy-engine && uv run pytest tests/contract tests/unit tests/architecture -v`
Expected: PASS

- [x] **Step 6: Коммит**

```bash
git add strategy-engine/src/engine strategy-engine/tests/contract
git commit -m "feat(engine): add runtime contracts and framed binary codec"
```

---

### Task 5: Порты и юзкейс валидации стратегии

Определяет границы, через которые ядро говорит с миром, и первый сквозной юзкейс.

**Files:**
- Create: `strategy-engine/src/engine/usecases/ports/candles.py`
- Create: `strategy-engine/src/engine/usecases/ports/runner.py`
- Create: `strategy-engine/src/engine/usecases/strategy/validate_strategy.py`
- Create: `strategy-engine/src/engine/adapters/sandbox/fake_runner.py`
- Test: `strategy-engine/tests/unit/usecases/test_validate_strategy.py`

**Interfaces:**
- Consumes: `SourceValidation`, `validate_source`, `strategy_hash`, `CandleBundle`, `DateRange`, `RunnerJob`, `RunnerResult`
- Produces:
  - `CandleRepository` Protocol: `ensure(exchange, symbol, date_range) -> None`, `load(*, exchange, symbol, timeframe, date_range, warmup_candles_num) -> CandleBundle`
  - `StrategyRunner` Protocol: `async run(job: RunnerJob, bundle: CandleBundle) -> RunnerResult`
  - `ValidateStrategy.execute(source_code: str, parameters: Mapping[str, Any]) -> ValidatedStrategy`
  - `ValidatedStrategy(validation: SourceValidation, strategy_hash: str | None)`
  - `FakeRunner(result: RunnerResult)` с атрибутами `.calls: list[tuple[RunnerJob, CandleBundle]]`

- [ ] **Step 1: Написать падающий тест юзкейса**

Создать `strategy-engine/tests/unit/usecases/test_validate_strategy.py`:

```python
from engine.usecases.strategy.validate_strategy import ValidateStrategy

GOOD = """
from jesse.strategies import Strategy

class Good(Strategy):
    def should_long(self) -> bool:
        return True
    def go_long(self) -> None:
        self.buy = 1, self.price
"""


def test_valid_source_gets_a_hash() -> None:
    outcome = ValidateStrategy().execute(GOOD, {"period": 14})

    assert outcome.validation.valid
    assert outcome.validation.strategy_class_name == "Good"
    assert outcome.strategy_hash is not None
    assert len(outcome.strategy_hash) == 64


def test_invalid_source_gets_no_hash() -> None:
    """Хеш невалидной стратегии не должен существовать — иначе на него
    начнут ссылаться прогоны, которых не было."""
    outcome = ValidateStrategy().execute("import os\n", {})

    assert not outcome.validation.valid
    assert outcome.strategy_hash is None


def test_parameters_affect_the_hash() -> None:
    a = ValidateStrategy().execute(GOOD, {"period": 14}).strategy_hash
    b = ValidateStrategy().execute(GOOD, {"period": 21}).strategy_hash
    assert a != b
```

- [ ] **Step 2: Запустить и убедиться, что тест падает**

Run: `cd strategy-engine && uv run pytest tests/unit/usecases -v`
Expected: FAIL с `ModuleNotFoundError`

- [ ] **Step 3: Реализовать порты**

`src/engine/usecases/ports/candles.py`:

```python
from __future__ import annotations

from typing import Protocol

from engine.domain.dataset.models import CandleBundle, DateRange


class CandleRepository(Protocol):
    """Источник исторических свечей.

    Реализация отдаёт свечи байтами, поэтому слой юзкейсов обходится без
    numpy и не зависит от способа хранения.
    """

    def ensure(self, *, exchange: str, symbol: str, date_range: DateRange) -> None:
        """Гарантирует наличие непрерывного 1m-ряда за диапазон.

        Поднимает DatasetUnavailable, если данных нет и догрузить не удалось.
        """
        ...

    def load(
        self,
        *,
        exchange: str,
        symbol: str,
        timeframe: str,
        date_range: DateRange,
        warmup_candles_num: int,
    ) -> CandleBundle:
        ...
```

`src/engine/usecases/ports/runner.py`:

```python
from __future__ import annotations

from typing import Protocol

from engine.domain.dataset.models import CandleBundle
from engine.domain.runtime.contracts import RunnerJob, RunnerResult


class StrategyRunner(Protocol):
    """Исполнитель стратегии в изолированном окружении."""

    async def run(self, job: RunnerJob, bundle: CandleBundle) -> RunnerResult:
        ...
```

- [ ] **Step 4: Реализовать юзкейс и фейковый раннер**

`src/engine/usecases/strategy/validate_strategy.py`:

```python
from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from engine.domain.strategy.hashing import strategy_hash
from engine.domain.strategy.models import SourceValidation
from engine.domain.strategy.source_policy import validate_source


@dataclass(frozen=True)
class ValidatedStrategy:
    validation: SourceValidation
    strategy_hash: str | None


class ValidateStrategy:
    def execute(
        self, source_code: str, parameters: Mapping[str, Any] | None = None
    ) -> ValidatedStrategy:
        validation = validate_source(source_code)
        if not validation.valid:
            return ValidatedStrategy(validation=validation, strategy_hash=None)
        return ValidatedStrategy(
            validation=validation,
            strategy_hash=strategy_hash(source_code, parameters or {}),
        )
```

`src/engine/adapters/sandbox/fake_runner.py`:

```python
"""Раннер-дублёр для тестов юзкейсов. Никакой изоляции не даёт."""

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
```

- [ ] **Step 5: Запустить тесты**

Run: `cd strategy-engine && uv run pytest tests/unit tests/contract tests/architecture -v`
Expected: PASS

- [ ] **Step 6: Коммит**

```bash
git add strategy-engine/src/engine strategy-engine/tests/unit
git commit -m "feat(engine): add ports and strategy validation use case"
```

---

### Task 6: Адаптер Jesse — вызов бэктеста и разбор результата

Единственное место, где живёт знание о формате результата Jesse. Здесь чинятся `equity_curve`, `profit_factor` и передача гиперпараметров.

**Files:**
- Create: `strategy-engine/src/engine/adapters/jesse/backtest.py`
- Test: `strategy-engine/tests/unit/adapters/test_jesse_mapping.py`
- Test: `strategy-engine/tests/integration/test_jesse_backtest.py`

**Interfaces:**
- Consumes: `BacktestConfig`, `BacktestMetrics`, `EquityPoint`, `clean_float`
- Produces:
  - `map_metrics(raw: dict, trades: list[dict]) -> BacktestMetrics`
  - `map_equity_curve(raw: list | None) -> tuple[EquityPoint, ...]`
  - `jesse_config(config: BacktestConfig, warmup_rows: int) -> dict`
  - `jesse_routes(config: BacktestConfig, strategy_class: type) -> list[dict]`
  - `run_jesse_backtest(*, strategy_class, config, warmup, trading, parameters) -> tuple[BacktestMetrics, tuple[EquityPoint, ...]]`

- [ ] **Step 1: Написать падающие тесты маппинга**

Создать `strategy-engine/tests/unit/adapters/test_jesse_mapping.py`:

```python
from engine.adapters.jesse.backtest import map_equity_curve, map_metrics


def test_profit_factor_comes_from_gross_numbers() -> None:
    """Раньше profit_factor подменяли на ratio_avg_win_loss — это payoff ratio."""
    metrics = map_metrics(
        {"gross_profit": 300.0, "gross_loss": -100.0, "ratio_avg_win_loss": 1.5},
        trades=[],
    )
    assert metrics.profit_factor == 3.0
    assert metrics.payoff_ratio == 1.5


def test_zero_gross_loss_gives_none_not_infinity() -> None:
    metrics = map_metrics({"gross_profit": 300.0, "gross_loss": 0.0}, trades=[])
    assert metrics.profit_factor is None


def test_nan_sharpe_becomes_none() -> None:
    metrics = map_metrics({"sharpe_ratio": float("nan")}, trades=[])
    assert metrics.sharpe is None


def test_counts_are_integers() -> None:
    metrics = map_metrics(
        {"total": 7, "total_winning_trades": 4, "total_losing_trades": 3,
         "longs_count": 5, "shorts_count": 2},
        trades=[],
    )
    assert metrics.total_trades == 7
    assert metrics.winning_trades == 4
    assert metrics.losing_trades == 3
    assert metrics.longs_count == 5
    assert metrics.shorts_count == 2


def test_equity_curve_parses_jesse_series_shape() -> None:
    """Jesse отдаёт [{name, data:[{time, value}]}], а не [[ts, equity]].

    Старый парсер ждал списки и молча возвращал пустую кривую.
    """
    raw = [
        {
            "name": "Portfolio",
            "color": "#818CF8",
            "data": [
                {"time": 1_600_000_000.0, "value": 10_000.0, "color": "#818CF8"},
                {"time": 1_600_086_400.0, "value": 10_500.0, "color": "#818CF8"},
            ],
        }
    ]
    curve = map_equity_curve(raw)

    assert len(curve) == 2
    assert curve[0].timestamp_ms == 1_600_000_000_000
    assert curve[0].equity == 10_000.0


def test_equity_curve_picks_portfolio_series() -> None:
    raw = [
        {"name": "BTC-USDT", "data": [{"time": 1.0, "value": 1.0}]},
        {"name": "Portfolio", "data": [{"time": 2.0, "value": 2.0}]},
    ]
    curve = map_equity_curve(raw)
    assert len(curve) == 1
    assert curve[0].equity == 2.0


def test_equity_curve_handles_none() -> None:
    """Jesse возвращает None, когда не было ни одной закрытой сделки."""
    assert map_equity_curve(None) == ()
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `cd strategy-engine && uv run pytest tests/unit/adapters -v`
Expected: FAIL с `ModuleNotFoundError`

- [ ] **Step 3: Реализовать адаптер**

`src/engine/adapters/jesse/backtest.py`:

```python
"""Единственное место, где живёт знание о форматах Jesse.

Маппинг ключей закреплён характеризационными тестами: апгрейд Jesse не
должен молча переименовать метрику.
"""

from __future__ import annotations

from typing import Any

import numpy as np

from engine.domain.backtest.metrics import BacktestMetrics, EquityPoint, clean_float
from engine.domain.backtest.models import BacktestConfig


def map_metrics(raw: dict[str, Any], trades: list[dict[str, Any]]) -> BacktestMetrics:
    gross_profit = clean_float(raw.get("gross_profit"))
    gross_loss = clean_float(raw.get("gross_loss"))
    profit_factor = None
    if gross_profit is not None and gross_loss:
        profit_factor = clean_float(gross_profit / abs(gross_loss))

    return BacktestMetrics(
        net_return_percent=clean_float(raw.get("net_profit_percentage")),
        sharpe=clean_float(raw.get("sharpe_ratio")),
        sortino=clean_float(raw.get("sortino_ratio")),
        calmar=clean_float(raw.get("calmar_ratio")),
        omega=clean_float(raw.get("omega_ratio")),
        max_drawdown_percent=clean_float(raw.get("max_drawdown")),
        win_rate=clean_float(raw.get("win_rate")),
        profit_factor=profit_factor,
        payoff_ratio=clean_float(raw.get("ratio_avg_win_loss")),
        expectancy=clean_float(raw.get("expectancy")),
        starting_balance=clean_float(raw.get("starting_balance")),
        finishing_balance=clean_float(raw.get("finishing_balance")),
        total_trades=int(raw.get("total") or 0),
        winning_trades=int(raw.get("total_winning_trades") or 0),
        losing_trades=int(raw.get("total_losing_trades") or 0),
        longs_count=int(raw.get("longs_count") or 0),
        shorts_count=int(raw.get("shorts_count") or 0),
        trades=tuple(trades or ()),
    )


def map_equity_curve(raw: list[dict[str, Any]] | None) -> tuple[EquityPoint, ...]:
    if not raw:
        return ()

    series = next((s for s in raw if s.get("name") == "Portfolio"), raw[0])
    points = []
    for point in series.get("data", []):
        time_seconds = clean_float(point.get("time"))
        equity = clean_float(point.get("value"))
        if time_seconds is None or equity is None:
            continue
        points.append(EquityPoint(timestamp_ms=int(time_seconds * 1000), equity=equity))
    return tuple(points)


def jesse_config(config: BacktestConfig, warmup_rows: int) -> dict[str, Any]:
    return {
        "starting_balance": config.initial_balance,
        "fee": config.fee_rate,
        "type": config.market_type,
        "futures_leverage": config.leverage,
        "futures_leverage_mode": config.leverage_mode,
        "exchange": config.exchange,
        "warm_up_candles": warmup_rows,
    }


def jesse_routes(config: BacktestConfig, strategy_class: type) -> list[dict[str, Any]]:
    return [
        {
            "exchange": config.exchange,
            "symbol": config.symbol,
            "timeframe": config.timeframe,
            "strategy": strategy_class,
        }
    ]


def run_jesse_backtest(
    *,
    strategy_class: type,
    config: BacktestConfig,
    warmup: np.ndarray,
    trading: np.ndarray,
    parameters: dict[str, Any],
) -> tuple[BacktestMetrics, tuple[EquityPoint, ...]]:
    from jesse.research import backtest

    key = f"{config.exchange}-{config.symbol}"
    entry = {"exchange": config.exchange, "symbol": config.symbol}

    result = backtest(
        config=jesse_config(config, warmup_rows=len(warmup)),
        routes=jesse_routes(config, strategy_class),
        data_routes=[],
        candles={key: {**entry, "candles": trading}},
        warmup_candles={key: {**entry, "candles": warmup}} if len(warmup) else None,
        # Гиперпараметры передаются аргументом. Присваивание strategy_class.hp
        # не работает: в Jesse hp — атрибут экземпляра, создаваемый в __init__.
        hyperparameters=parameters or None,
        generate_equity_curve=True,
    )

    return (
        map_metrics(result.get("metrics") or {}, result.get("trades") or []),
        map_equity_curve(result.get("equity_curve")),
    )
```

- [ ] **Step 4: Запустить unit-тесты маппинга**

Run: `cd strategy-engine && uv run pytest tests/unit/adapters -v`
Expected: PASS (7 тестов)

- [ ] **Step 5: Написать интеграционный тест на передачу гиперпараметров**

Создать `strategy-engine/tests/integration/test_jesse_backtest.py`:

```python
"""Проверка, что Jesse действительно применяет переданные гиперпараметры.

Прежняя реализация делала strategy_class.hp = parameters, что молча ничего
не меняло: параметры влияли на strategy_hash, но не на результат.
"""

import numpy as np
import pytest

from engine.adapters.jesse.backtest import run_jesse_backtest
from engine.domain.backtest.models import BacktestConfig

pytestmark = pytest.mark.integration

SOURCE = """
from jesse.strategies import Strategy

class Parameterized(Strategy):
    def hyperparameters(self):
        return [{'name': 'qty', 'type': int, 'min': 1, 'max': 10, 'default': 1}]

    def should_long(self) -> bool:
        return self.index == 10

    def go_long(self) -> None:
        self.buy = self.hp['qty'], self.price

    def should_short(self) -> bool:
        return False
"""


def _strategy_class() -> type:
    from jesse.strategies import Strategy

    namespace: dict = {"Strategy": Strategy}
    exec(SOURCE, namespace)  # noqa: S102 — тестовый код, не пользовательский
    return namespace["Parameterized"]


def _config() -> BacktestConfig:
    return BacktestConfig(
        exchange="Binance", symbol="BTC-USDT", timeframe="1m",
        initial_balance=10_000.0, fee_rate=0.0,
    )


def test_hyperparameters_change_the_result() -> None:
    from jesse.research import fake_range_candles

    candles = fake_range_candles(400)
    empty = np.empty((0, 6), dtype=np.float64)
    cls = _strategy_class()

    small, _ = run_jesse_backtest(
        strategy_class=cls, config=_config(), warmup=empty,
        trading=candles, parameters={"qty": 1},
    )
    large, _ = run_jesse_backtest(
        strategy_class=cls, config=_config(), warmup=empty,
        trading=candles, parameters={"qty": 5},
    )

    assert small.net_return_percent != large.net_return_percent, (
        "гиперпараметры не доехали до стратегии"
    )
```

- [ ] **Step 6: Запустить интеграционный тест**

Run: `cd strategy-engine && uv run pytest tests/integration/test_jesse_backtest.py -m integration -v`
Expected: PASS. Если падает с равными результатами — проверить, что `hyperparameters` действительно передаётся в `backtest()`, а не присваивается классу.

- [ ] **Step 7: Коммит**

```bash
git add strategy-engine/src/engine/adapters strategy-engine/tests
git commit -m "feat(engine): add jesse backtest adapter with correct metric and equity mapping"
```

---

### Task 7: Воркер раннера

Процесс, который в изоляции компилирует стратегию и прогоняет бэктест. Читает кадр со stdin, пишет кадр в stdout.

**Files:**
- Create: `strategy-engine/src/engine/entrypoints/runner/worker.py`
- Test: `strategy-engine/tests/integration/test_runner_worker.py`

**Interfaces:**
- Consumes: `decode_job`, `encode_result`, `run_jesse_backtest`, `validate_source`
- Produces: исполняемый модуль `python -m engine.entrypoints.runner.worker`; читает кадр `encode_job(...)` со stdin, пишет `encode_result(...)` в stdout; логи и трейсбеки — в stderr

- [ ] **Step 1: Написать падающий тест воркера**

Создать `strategy-engine/tests/integration/test_runner_worker.py`:

```python
"""Воркер запускается как настоящий подпроцесс — так же, как в бою."""

import subprocess
import sys

import numpy as np
import pytest

from engine.adapters.sandbox.codec import decode_result, encode_job
from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import CandleBundle, DateRange, DatasetRef
from engine.domain.runtime.contracts import RunnerJob, RunnerStatus, RuntimeMode

pytestmark = pytest.mark.integration

GOOD = """
from jesse.strategies import Strategy

class Good(Strategy):
    def should_long(self) -> bool:
        return self.index == 10
    def go_long(self) -> None:
        self.buy = 1, self.price
    def should_short(self) -> bool:
        return False
"""

EXPLODING = """
from jesse.strategies import Strategy

class Boom(Strategy):
    def should_long(self) -> bool:
        return 1 / 0
    def go_long(self) -> None:
        pass
"""


def _bundle(trading: np.ndarray) -> CandleBundle:
    ref = DatasetRef(
        exchange="Binance", symbol="BTC-USDT", timeframe="1m",
        date_range=DateRange(int(trading[0, 0]), int(trading[-1, 0]) + 60_000),
        warmup_rows=0, trading_rows=len(trading),
        columns=6, dtype="float64", dataset_hash="d" * 64,
    )
    return CandleBundle(ref=ref, warmup=b"", trading=trading.tobytes())


def _job(source: str, class_name: str) -> RunnerJob:
    return RunnerJob(
        job_id="job-1", mode=RuntimeMode.BACKTEST, source_code=source,
        strategy_class_name=class_name, parameters={},
        config=BacktestConfig(
            exchange="Binance", symbol="BTC-USDT", timeframe="1m",
            initial_balance=10_000.0, fee_rate=0.0,
        ),
        warmup_rows=0, timeout_seconds=60.0,
    )


def _run_worker(payload: bytes) -> subprocess.CompletedProcess[bytes]:
    return subprocess.run(
        [sys.executable, "-m", "engine.entrypoints.runner.worker"],
        input=payload, capture_output=True, timeout=180,
    )


def test_worker_returns_metrics_for_valid_strategy() -> None:
    from jesse.research import fake_range_candles

    proc = _run_worker(encode_job(_job(GOOD, "Good"), _bundle(fake_range_candles(300))))
    assert proc.returncode == 0, proc.stderr.decode()

    result = decode_result(proc.stdout)
    assert result.status is RunnerStatus.OK
    assert result.metrics is not None


def test_worker_reports_runtime_error_without_crashing() -> None:
    from jesse.research import fake_range_candles

    proc = _run_worker(encode_job(_job(EXPLODING, "Boom"), _bundle(fake_range_candles(300))))
    assert proc.returncode == 0, "воркер обязан вернуть кадр, а не упасть"

    result = decode_result(proc.stdout)
    assert result.status is RunnerStatus.RUNTIME_ERROR
    assert result.error is not None
    assert "ZeroDivisionError" in result.error.type


def test_worker_rejects_source_failing_policy() -> None:
    from jesse.research import fake_range_candles

    bad = GOOD + "\nimport os\n"
    proc = _run_worker(encode_job(_job(bad, "Good"), _bundle(fake_range_candles(300))))

    result = decode_result(proc.stdout)
    assert result.status is RunnerStatus.INVALID_STRATEGY


def test_worker_keeps_stdout_clean_for_the_protocol() -> None:
    """Печать из стратегии обязана уходить в stderr, иначе кадр повредится."""
    from jesse.research import fake_range_candles

    noisy = GOOD.replace(
        "    def go_long(self) -> None:\n        self.buy = 1, self.price",
        "    def go_long(self) -> None:\n        print('noise from strategy')\n"
        "        self.buy = 1, self.price",
    )
    proc = _run_worker(encode_job(_job(noisy, "Good"), _bundle(fake_range_candles(300))))

    result = decode_result(proc.stdout)
    assert result.status is RunnerStatus.OK
    assert b"noise from strategy" in proc.stderr
```

- [ ] **Step 2: Запустить и убедиться, что тесты падают**

Run: `cd strategy-engine && uv run pytest tests/integration/test_runner_worker.py -m integration -v`
Expected: FAIL — модуль воркера не существует

- [ ] **Step 3: Реализовать воркер**

`src/engine/entrypoints/runner/worker.py`:

```python
"""Одноразовый процесс исполнения стратегии.

Читает один кадр задания со stdin, пишет один кадр результата в stdout и
завершается. Свежий интерпретатор на каждый прогон — это и есть гарантия,
что состояние одной стратегии не протекает в следующую.

ВАЖНО: stdout занят протоколом. Любая печать из пользовательского кода
перенаправляется в stderr, иначе кадр результата будет повреждён.
"""

from __future__ import annotations

import contextlib
import io
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


def _safe_import(name, globals=None, locals=None, fromlist=(), level=0):  # noqa: A002
    """Первая линия: отсекает очевидные импорты до запуска.

    Не является границей безопасности — ею служит контейнер без сети.
    """
    if name.split(".")[0] not in ALLOWED_ROOT_MODULES:
        raise ImportError(f"Импорт '{name}' запрещён политикой")
    return __import__(name, globals, locals, fromlist, level)


def _compile_strategy(job: RunnerJob) -> type:
    import builtins

    from jesse.strategies import Strategy

    safe_builtins = dict(vars(builtins))
    for blocked in ("open", "eval", "exec", "compile", "breakpoint", "exit", "quit", "input"):
        safe_builtins.pop(blocked, None)
    safe_builtins["__import__"] = _safe_import

    namespace: dict = {"__builtins__": safe_builtins, "Strategy": Strategy, "__name__": "strategy"}
    exec(job.source_code, namespace)  # noqa: S102 — изоляция обеспечена контейнером
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
        # Всё, что стратегия печатает, уходит в stderr: stdout принадлежит протоколу.
        with contextlib.redirect_stdout(sys.stderr):
            result = _execute(job, warmup, trading)
    except MemoryError:
        result = RunnerResult(
            job_id=job_id,
            status=RunnerStatus.MEMORY_EXCEEDED,
            error=RunnerError(type="MemoryError", message="превышен лимит памяти"),
        )
    except BaseException as err:  # noqa: BLE001 — воркер обязан вернуть кадр всегда
        result = RunnerResult(
            job_id=job_id,
            status=RunnerStatus.RUNTIME_ERROR,
            error=RunnerError(
                type=type(err).__name__,
                message=str(err)[:500],
                traceback_tail=traceback.format_exc()[-_TRACEBACK_TAIL_CHARS:],
            ),
        )

    sys.stdout.buffer.write(encode_result(result))
    sys.stdout.buffer.flush()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 4: Запустить тесты воркера**

Run: `cd strategy-engine && uv run pytest tests/integration/test_runner_worker.py -m integration -v`
Expected: PASS (4 теста)

- [ ] **Step 5: Коммит**

```bash
git add strategy-engine/src/engine/entrypoints strategy-engine/tests/integration
git commit -m "feat(engine): add single-shot strategy runner worker process"
```

---

### Task 8: Сервер раннера — изоляция, лимиты, таймаут

Долгоживущий процесс в контейнере без сети. Слушает сокет, на каждое задание форкает свежий воркер под ресурсными лимитами и снимает его по таймауту.

**Files:**
- Create: `strategy-engine/src/engine/settings.py`
- Create: `strategy-engine/src/engine/entrypoints/runner/server.py`
- Test: `strategy-engine/tests/integration/test_runner_server.py`

**Interfaces:**
- Consumes: `read_frame`, `write_frame`, `decode_result`, `encode_result`, контракты рантайма
- Produces:
  - `Settings` (pydantic-settings) с полями `runner_transport`, `runner_socket_path`, `runner_host`, `runner_port`, `runner_timeout_seconds`, `runner_memory_mb`, `runner_max_file_bytes`, `max_concurrent_runs`, `api_token`, `cors_origins`, `engine_version`, `git_sha`
  - `get_settings() -> Settings` (кэшируется)
  - `RunnerServer(settings).serve_forever()`; исполняемый модуль `python -m engine.entrypoints.runner.server`

- [ ] **Step 1: Написать падающий тест сервера**

Создать `strategy-engine/tests/integration/test_runner_server.py`:

```python
"""Сервер поднимается по-настоящему, клиент ходит по настоящему сокету."""

import asyncio

import numpy as np
import pytest

from engine.adapters.sandbox.codec import decode_result, encode_job, read_frame, write_frame
from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import CandleBundle, DateRange, DatasetRef
from engine.domain.runtime.contracts import RunnerJob, RunnerStatus, RuntimeMode
from engine.entrypoints.runner.server import RunnerServer
from engine.settings import Settings

pytestmark = pytest.mark.integration

FAST = """
from jesse.strategies import Strategy

class Fast(Strategy):
    def should_long(self) -> bool:
        return self.index == 10
    def go_long(self) -> None:
        self.buy = 1, self.price
    def should_short(self) -> bool:
        return False
"""

HANGING = """
from jesse.strategies import Strategy

class Hanging(Strategy):
    def should_long(self) -> bool:
        while True:
            pass
    def go_long(self) -> None:
        pass
"""


def _bundle(trading: np.ndarray) -> CandleBundle:
    ref = DatasetRef(
        exchange="Binance", symbol="BTC-USDT", timeframe="1m",
        date_range=DateRange(int(trading[0, 0]), int(trading[-1, 0]) + 60_000),
        warmup_rows=0, trading_rows=len(trading),
        columns=6, dtype="float64", dataset_hash="d" * 64,
    )
    return CandleBundle(ref=ref, warmup=b"", trading=trading.tobytes())


def _job(source: str, class_name: str, timeout: float) -> RunnerJob:
    return RunnerJob(
        job_id="job-1", mode=RuntimeMode.BACKTEST, source_code=source,
        strategy_class_name=class_name, parameters={},
        config=BacktestConfig(
            exchange="Binance", symbol="BTC-USDT", timeframe="1m",
            initial_balance=10_000.0, fee_rate=0.0,
        ),
        warmup_rows=0, timeout_seconds=timeout,
    )


@pytest.fixture
def settings(tmp_path) -> Settings:
    return Settings(
        runner_transport="tcp",
        runner_host="127.0.0.1",
        runner_port=0,
        runner_timeout_seconds=10.0,
    )


async def _ask(server: RunnerServer, job: RunnerJob, bundle: CandleBundle):
    host, port = server.bound_address
    reader, writer = await asyncio.open_connection(host, port)
    try:
        await write_frame(writer, encode_job(job, bundle))
        return decode_result(await read_frame(reader))
    finally:
        writer.close()
        await writer.wait_closed()


@pytest.mark.asyncio
async def test_server_runs_a_backtest(settings: Settings) -> None:
    from jesse.research import fake_range_candles

    server = RunnerServer(settings)
    await server.start()
    try:
        result = await _ask(server, _job(FAST, "Fast", 60.0), _bundle(fake_range_candles(300)))
    finally:
        await server.stop()

    assert result.status is RunnerStatus.OK
    assert result.metrics is not None


@pytest.mark.asyncio
async def test_infinite_loop_is_killed_and_server_survives(settings: Settings) -> None:
    """Прежняя реализация вешала весь сервис: CPU-bound код шёл в event loop
    без таймаута, и while True убивал движок навсегда."""
    from jesse.research import fake_range_candles

    candles = fake_range_candles(300)
    server = RunnerServer(settings)
    await server.start()
    try:
        hung = await _ask(server, _job(HANGING, "Hanging", 3.0), _bundle(candles))
        assert hung.status is RunnerStatus.TIMEOUT

        # Сервис обязан обслужить следующий запрос как ни в чём не бывало.
        healthy = await _ask(server, _job(FAST, "Fast", 60.0), _bundle(candles))
        assert healthy.status is RunnerStatus.OK
    finally:
        await server.stop()
```

- [ ] **Step 2: Добавить pytest-asyncio и запустить тест**

```bash
cd strategy-engine
uv add --dev pytest-asyncio
```

В `pyproject.toml` в `[tool.pytest.ini_options]` добавить `asyncio_mode = "auto"`.

Run: `cd strategy-engine && uv run pytest tests/integration/test_runner_server.py -m integration -v`
Expected: FAIL — `engine.settings` и `engine.entrypoints.runner.server` не существуют

- [ ] **Step 3: Реализовать настройки**

`src/engine/settings.py`:

```python
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ENGINE_", env_file=None, extra="ignore")

    # Транспорт до раннера. В compose — uds (контейнер без сети вообще),
    # tcp остаётся для локальной разработки вне Docker.
    runner_transport: str = "uds"
    runner_socket_path: str = "/run/engine/runner.sock"
    runner_host: str = "127.0.0.1"
    runner_port: int = 8001

    runner_timeout_seconds: float = 120.0
    runner_memory_mb: int = 512
    runner_max_file_bytes: int = 0  # 0 = стратегии запрещено писать файлы
    max_concurrent_runs: int = 2

    api_token: str | None = None
    cors_origins: list[str] = []

    # Оркестратор обязан стартовать из Jesse-проекта, иначе Jesse молча
    # отключит БД. Выключается только в тестах, которые не ходят в Postgres.
    require_jesse_project: bool = True

    engine_version: str = "0.2.0"
    git_sha: str = "unknown"

    @property
    def full_engine_version(self) -> str:
        return f"{self.engine_version}+{self.git_sha}"


@lru_cache
def get_settings() -> Settings:
    return Settings()
```

- [ ] **Step 4: Реализовать сервер раннера**

`src/engine/entrypoints/runner/server.py`:

```python
"""Сервер изолированного раннера.

Живёт в контейнере без сетевых интерфейсов и общается с оркестратором через
Unix-сокет на общем volume. На каждое задание форкает НОВЫЙ процесс воркера:
свежий интерпретатор — это и есть гарантия, что состояние одного прогона не
протекает в следующий.
"""

from __future__ import annotations

import asyncio
import contextlib
import os
import signal
import sys
from pathlib import Path

from engine.adapters.sandbox.codec import (
    decode_result,
    encode_result,
    read_frame,
    write_frame,
)
from engine.domain.runtime.contracts import RunnerError, RunnerResult, RunnerStatus
from engine.settings import Settings, get_settings

_IS_POSIX = sys.platform != "win32"
_WORKER_MODULE = "engine.entrypoints.runner.worker"


def _build_preexec(settings: Settings):
    """Ресурсные лимиты и отдельная process group для надёжного kill."""
    if not _IS_POSIX:
        return None

    import resource

    def _apply() -> None:
        os.setsid()  # своя group — SIGKILL накрывает и потомков стратегии
        memory = settings.runner_memory_mb * 1024 * 1024
        resource.setrlimit(resource.RLIMIT_AS, (memory, memory))
        cpu = int(settings.runner_timeout_seconds) + 5
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

    @property
    def bound_address(self) -> tuple[str, int]:
        assert self._server is not None, "сервер не запущен"
        return self._server.sockets[0].getsockname()[:2]

    async def start(self) -> None:
        if self._settings.runner_transport == "uds":
            path = Path(self._settings.runner_socket_path)
            path.parent.mkdir(parents=True, exist_ok=True)
            if path.exists():
                path.unlink()
            self._server = await asyncio.start_unix_server(self._handle, path=str(path))
            os.chmod(path, 0o660)
        else:
            self._server = await asyncio.start_server(
                self._handle, self._settings.runner_host, self._settings.runner_port
            )

    async def stop(self) -> None:
        if self._server is not None:
            self._server.close()
            await self._server.wait_closed()
            self._server = None

    async def serve_forever(self) -> None:
        await self.start()
        assert self._server is not None
        async with self._server:
            await self._server.serve_forever()

    async def _handle(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        try:
            payload = await read_frame(reader)
            async with self._semaphore:
                result_bytes = await self._spawn_worker(payload)
            await write_frame(writer, result_bytes)
        except (asyncio.IncompleteReadError, ConnectionResetError):
            pass
        finally:
            writer.close()

    async def _spawn_worker(self, payload: bytes) -> bytes:
        timeout = self._settings.runner_timeout_seconds
        process = await asyncio.create_subprocess_exec(
            sys.executable,
            "-m",
            _WORKER_MODULE,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            preexec_fn=_build_preexec(self._settings),
            cwd="/",  # вне Jesse-проекта: is_jesse_project() ложно, БД не открывается
        )

        try:
            stdout, stderr = await asyncio.wait_for(
                process.communicate(input=payload), timeout=timeout
            )
        except asyncio.TimeoutError:
            self._kill(process)
            await process.wait()
            return encode_result(
                RunnerResult(
                    job_id="unknown",
                    status=RunnerStatus.TIMEOUT,
                    error=RunnerError(
                        type="RunnerTimeout",
                        message=f"прогон снят по таймауту {timeout} с",
                    ),
                )
            )

        if not stdout:
            return encode_result(
                RunnerResult(
                    job_id="unknown",
                    status=RunnerStatus.MEMORY_EXCEEDED
                    if process.returncode == -signal.SIGKILL
                    else RunnerStatus.RUNTIME_ERROR,
                    error=RunnerError(
                        type="RunnerCrashed",
                        message=f"воркер завершился с кодом {process.returncode}",
                        traceback_tail=stderr.decode("utf-8", "replace")[-2000:],
                    ),
                )
            )

        # Проверяем, что кадр читается: повреждённый ответ лучше поймать здесь.
        decode_result(stdout)
        return stdout

    @staticmethod
    def _kill(process: asyncio.subprocess.Process) -> None:
        """SIGKILL по всей process group: стратегия могла наплодить потомков."""
        if _IS_POSIX:
            with contextlib.suppress(ProcessLookupError, PermissionError):
                os.killpg(os.getpgid(process.pid), signal.SIGKILL)
            return
        with contextlib.suppress(ProcessLookupError):
            process.kill()


def main() -> int:
    asyncio.run(RunnerServer().serve_forever())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

- [ ] **Step 5: Запустить тесты сервера**

Run: `cd strategy-engine && uv run pytest tests/integration/test_runner_server.py -m integration -v`
Expected: PASS (2 теста). Тест с `while True` должен занять около 3 секунд и вернуть `TIMEOUT`.

- [ ] **Step 6: Коммит**

```bash
git add strategy-engine/src/engine strategy-engine/pyproject.toml \
        strategy-engine/uv.lock strategy-engine/tests/integration
git commit -m "feat(engine): add runner server with resource limits and watchdog timeout"
```

---

### Task 9: Клиентский адаптер раннера

Реализация порта `StrategyRunner` поверх сокета.

**Files:**
- Create: `strategy-engine/src/engine/adapters/sandbox/uds_runner.py`
- Test: `strategy-engine/tests/integration/test_uds_runner.py`

**Interfaces:**
- Consumes: `Settings`, кодек, `StrategyRunner` Protocol
- Produces: `SocketStrategyRunner(settings)` с методом `async run(job, bundle) -> RunnerResult`

- [ ] **Step 1: Написать падающий тест**

Создать `strategy-engine/tests/integration/test_uds_runner.py`:

```python
import asyncio

import numpy as np
import pytest

from engine.adapters.sandbox.uds_runner import SocketStrategyRunner
from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import CandleBundle, DateRange, DatasetRef
from engine.domain.runtime.contracts import RunnerJob, RunnerStatus, RuntimeMode
from engine.domain.shared.errors import RunnerCrashed
from engine.entrypoints.runner.server import RunnerServer
from engine.settings import Settings

pytestmark = pytest.mark.integration

FAST = """
from jesse.strategies import Strategy

class Fast(Strategy):
    def should_long(self) -> bool:
        return self.index == 10
    def go_long(self) -> None:
        self.buy = 1, self.price
    def should_short(self) -> bool:
        return False
"""


def _bundle(trading: np.ndarray) -> CandleBundle:
    ref = DatasetRef(
        exchange="Binance", symbol="BTC-USDT", timeframe="1m",
        date_range=DateRange(int(trading[0, 0]), int(trading[-1, 0]) + 60_000),
        warmup_rows=0, trading_rows=len(trading), columns=6,
        dtype="float64", dataset_hash="d" * 64,
    )
    return CandleBundle(ref=ref, warmup=b"", trading=trading.tobytes())


def _job() -> RunnerJob:
    return RunnerJob(
        job_id="job-1", mode=RuntimeMode.BACKTEST, source_code=FAST,
        strategy_class_name="Fast", parameters={},
        config=BacktestConfig(
            exchange="Binance", symbol="BTC-USDT", timeframe="1m",
            initial_balance=10_000.0, fee_rate=0.0,
        ),
        warmup_rows=0, timeout_seconds=60.0,
    )


async def test_client_and_server_speak_the_same_protocol() -> None:
    from jesse.research import fake_range_candles

    settings = Settings(runner_transport="tcp", runner_host="127.0.0.1", runner_port=0)
    server = RunnerServer(settings)
    await server.start()
    host, port = server.bound_address
    try:
        runner = SocketStrategyRunner(
            Settings(runner_transport="tcp", runner_host=host, runner_port=port)
        )
        result = await runner.run(_job(), _bundle(fake_range_candles(300)))
    finally:
        await server.stop()

    assert result.status is RunnerStatus.OK


async def test_unreachable_runner_raises_runner_crashed() -> None:
    runner = SocketStrategyRunner(
        Settings(runner_transport="tcp", runner_host="127.0.0.1", runner_port=1)
    )
    with pytest.raises(RunnerCrashed):
        await runner.run(_job(), _bundle(np.ones((2, 6), dtype=np.float64)))
```

- [ ] **Step 2: Запустить и убедиться, что тест падает**

Run: `cd strategy-engine && uv run pytest tests/integration/test_uds_runner.py -m integration -v`
Expected: FAIL с `ModuleNotFoundError`

- [ ] **Step 3: Реализовать клиент**

`src/engine/adapters/sandbox/uds_runner.py`:

```python
"""Клиент изолированного раннера.

Поддерживает два транспорта: Unix-сокет (в compose, контейнер без сети) и
TCP (локальная разработка вне Docker, в том числе Windows).
"""

from __future__ import annotations

import asyncio

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


class SocketStrategyRunner:
    def __init__(self, settings: Settings | None = None) -> None:
        self._settings = settings or get_settings()

    async def run(self, job: RunnerJob, bundle: CandleBundle) -> RunnerResult:
        try:
            reader, writer = await self._connect()
        except OSError as err:
            raise RunnerCrashed(f"раннер недоступен: {err}") from err

        try:
            await write_frame(writer, encode_job(job, bundle))
            return decode_result(await read_frame(reader))
        except (asyncio.IncompleteReadError, ConnectionResetError, ValueError) as err:
            raise RunnerCrashed(f"повреждённый ответ раннера: {err}") from err
        finally:
            writer.close()
            try:
                await writer.wait_closed()
            except OSError:
                pass

    async def _connect(self) -> tuple[asyncio.StreamReader, asyncio.StreamWriter]:
        if self._settings.runner_transport == "uds":
            return await asyncio.open_unix_connection(self._settings.runner_socket_path)
        return await asyncio.open_connection(
            self._settings.runner_host, self._settings.runner_port
        )
```

- [ ] **Step 4: Запустить тесты**

Run: `cd strategy-engine && uv run pytest tests/integration/test_uds_runner.py -m integration -v`
Expected: PASS (2 теста)

- [ ] **Step 5: Коммит**

```bash
git add strategy-engine/src/engine/adapters/sandbox strategy-engine/tests/integration
git commit -m "feat(engine): add socket strategy runner client adapter"
```

---

### Task 10: Репозиторий свечей на Postgres и юзкейс подготовки данных

Единственный мост к нативному хранилищу Jesse. Здесь окончательно удаляется путь со случайными свечами.

**Files:**
- Create: `strategy-engine/src/engine/adapters/jesse/bootstrap.py`
- Create: `strategy-engine/src/engine/adapters/jesse/candles.py`
- Create: `strategy-engine/src/engine/usecases/dataset/ensure_dataset.py`
- Test: `strategy-engine/tests/unit/usecases/test_ensure_dataset.py`
- Test: `strategy-engine/tests/integration/test_jesse_candles.py`

**Interfaces:**
- Consumes: `CandleRepository` Protocol, `DateRange`, `CandleBundle`, `DatasetRef`, `dataset_hash`, `DatasetUnavailable`
- Produces:
  - `assert_jesse_project() -> None`
  - `JesseCandleRepository()` реализующий `CandleRepository`
  - `EnsureDataset(candles: CandleRepository).execute(*, exchange, symbol, timeframe, date_range, warmup_candles_num) -> CandleBundle`

- [ ] **Step 1: Написать падающий unit-тест юзкейса на фейковом репозитории**

Создать `strategy-engine/tests/unit/usecases/test_ensure_dataset.py`:

```python
import pytest

from engine.domain.dataset.models import CandleBundle, DateRange, DatasetRef
from engine.domain.shared.errors import DatasetUnavailable
from engine.usecases.dataset.ensure_dataset import EnsureDataset

RANGE = DateRange(1_600_000_000_000, 1_600_086_400_000)


def _bundle() -> CandleBundle:
    ref = DatasetRef(
        exchange="Binance", symbol="BTC-USDT", timeframe="1m", date_range=RANGE,
        warmup_rows=0, trading_rows=2, columns=6, dtype="float64", dataset_hash="d" * 64,
    )
    return CandleBundle(ref=ref, warmup=b"", trading=b"\x00" * 96)


class _Repo:
    def __init__(self, bundle: CandleBundle | None, ensure_error: Exception | None = None):
        self.bundle = bundle
        self.ensure_error = ensure_error
        self.ensure_calls = 0

    def ensure(self, *, exchange, symbol, date_range) -> None:
        self.ensure_calls += 1
        if self.ensure_error:
            raise self.ensure_error

    def load(self, **kwargs) -> CandleBundle:
        assert self.bundle is not None
        return self.bundle


def test_ensure_runs_before_load() -> None:
    repo = _Repo(_bundle())

    result = EnsureDataset(repo).execute(
        exchange="Binance", symbol="BTC-USDT", timeframe="1m",
        date_range=RANGE, warmup_candles_num=0,
    )

    assert repo.ensure_calls == 1
    assert result.ref.dataset_hash == "d" * 64


def test_missing_data_surfaces_as_dataset_unavailable() -> None:
    """Никакого молчаливого фолбэка на случайные свечи."""
    repo = _Repo(None, ensure_error=DatasetUnavailable("нет данных"))

    with pytest.raises(DatasetUnavailable):
        EnsureDataset(repo).execute(
            exchange="Binance", symbol="BTC-USDT", timeframe="1m",
            date_range=RANGE, warmup_candles_num=0,
        )
```

- [ ] **Step 2: Запустить и убедиться, что тест падает**

Run: `cd strategy-engine && uv run pytest tests/unit/usecases/test_ensure_dataset.py -v`
Expected: FAIL с `ModuleNotFoundError`

- [ ] **Step 3: Реализовать юзкейс**

`src/engine/usecases/dataset/ensure_dataset.py`:

```python
from __future__ import annotations

from engine.domain.dataset.models import CandleBundle, DateRange
from engine.usecases.ports.candles import CandleRepository


class EnsureDataset:
    """Гарантирует наличие датасета и отдаёт его байты.

    Отдельный юзкейс, а не шаг внутри бэктеста: первый импорт по новому
    символу идёт в биржу и занимает минуты, поэтому позже он выносится в
    явный инструмент подготовки данных.
    """

    def __init__(self, candles: CandleRepository) -> None:
        self._candles = candles

    def execute(
        self,
        *,
        exchange: str,
        symbol: str,
        timeframe: str,
        date_range: DateRange,
        warmup_candles_num: int,
    ) -> CandleBundle:
        self._candles.ensure(exchange=exchange, symbol=symbol, date_range=date_range)
        return self._candles.load(
            exchange=exchange,
            symbol=symbol,
            timeframe=timeframe,
            date_range=date_range,
            warmup_candles_num=warmup_candles_num,
        )
```

- [ ] **Step 4: Реализовать bootstrap и репозиторий**

`src/engine/adapters/jesse/bootstrap.py`:

```python
"""Проверка окружения Jesse на старте оркестратора.

Jesse включает работу с БД только если в рабочей директории есть `strategies/`
и `storage/` (см. jesse.helpers.is_jesse_project), а `.env` читается ФАЙЛОМ на
импорте jesse.services.env — переменных окружения недостаточно. Если файла нет
или он пуст, Jesse делает os._exit(1) без внятного сообщения. Поэтому
проверяем всё сами и падаем понятно.
"""

from __future__ import annotations

import os
from pathlib import Path

REQUIRED_DIRS = ("strategies", "storage")
REQUIRED_ENV_KEYS = ("POSTGRES_HOST", "POSTGRES_NAME", "POSTGRES_USERNAME", "PASSWORD")


def assert_jesse_project(cwd: Path | None = None) -> None:
    root = cwd or Path.cwd()

    missing_dirs = [d for d in REQUIRED_DIRS if not (root / d).is_dir()]
    if missing_dirs:
        raise RuntimeError(
            f"{root} не является Jesse-проектом: нет каталогов {missing_dirs}. "
            "Оркестратор обязан стартовать из jesse_project/."
        )

    env_file = Path(os.environ.get("JESSE_ENV_FILE", root / ".env"))
    if not env_file.is_file() or not env_file.read_text(encoding="utf-8").strip():
        raise RuntimeError(
            f"{env_file} отсутствует или пуст. Jesse читает .env файлом, а не из "
            "переменных окружения — его рендерит docker/render-jesse-env.sh."
        )

    content = env_file.read_text(encoding="utf-8")
    missing_keys = [k for k in REQUIRED_ENV_KEYS if f"{k}=" not in content]
    if missing_keys:
        raise RuntimeError(f"В {env_file} не хватает ключей: {missing_keys}")
```

`src/engine/adapters/jesse/candles.py`:

```python
"""Свечи из нативного хранилища Jesse (Postgres)."""

from __future__ import annotations

import numpy as np

from engine.domain.dataset.hashing import dataset_hash
from engine.domain.dataset.models import CandleBundle, DateRange, DatasetRef
from engine.domain.shared.errors import DatasetUnavailable


def _to_date(timestamp_ms: int) -> str:
    import datetime as dt

    return dt.datetime.fromtimestamp(timestamp_ms / 1000, tz=dt.timezone.utc).strftime("%Y-%m-%d")


class JesseCandleRepository:
    def ensure(self, *, exchange: str, symbol: str, date_range: DateRange) -> None:
        from jesse.research import get_candles, import_candles

        try:
            get_candles(
                exchange, symbol, "1m",
                date_range.start_ms, date_range.finish_ms,
                warmup_candles_num=0, caching=False, is_for_jesse=True,
            )
            return
        except Exception:  # noqa: BLE001 — отсутствие данных Jesse сигналит по-разному
            pass

        try:
            import_candles(exchange, symbol, _to_date(date_range.start_ms), show_progressbar=False)
        except Exception as err:  # noqa: BLE001
            raise DatasetUnavailable(
                f"не удалось загрузить свечи {symbol} на {exchange}: {err}"
            ) from err

    def load(
        self,
        *,
        exchange: str,
        symbol: str,
        timeframe: str,
        date_range: DateRange,
        warmup_candles_num: int,
    ) -> CandleBundle:
        from jesse.research import get_candles

        try:
            warmup, trading = get_candles(
                exchange, symbol, "1m",
                date_range.start_ms, date_range.finish_ms,
                warmup_candles_num=warmup_candles_num,
                caching=False, is_for_jesse=True,
            )
        except Exception as err:  # noqa: BLE001
            raise DatasetUnavailable(
                f"свечи {symbol} {timeframe} за диапазон недоступны: {err}"
            ) from err

        if trading is None or len(trading) == 0:
            raise DatasetUnavailable(f"пустой датасет для {symbol} за запрошенный диапазон")

        warmup = np.ascontiguousarray(
            warmup if warmup is not None else np.empty((0, trading.shape[1])),
            dtype=np.float64,
        )
        trading = np.ascontiguousarray(trading, dtype=np.float64)

        warmup_bytes = warmup.tobytes()
        trading_bytes = trading.tobytes()

        ref = DatasetRef(
            exchange=exchange,
            symbol=symbol,
            timeframe=timeframe,
            date_range=date_range,
            warmup_rows=int(len(warmup)),
            trading_rows=int(len(trading)),
            columns=int(trading.shape[1]),
            dtype="float64",
            dataset_hash=dataset_hash(
                exchange=exchange,
                symbol=symbol,
                timeframe=timeframe,
                start_ms=date_range.start_ms,
                finish_ms=date_range.finish_ms,
                warmup_rows=int(len(warmup)),
                trading_rows=int(len(trading)),
                columns=int(trading.shape[1]),
                dtype="float64",
                warmup_bytes=warmup_bytes,
                trading_bytes=trading_bytes,
            ),
        )
        return CandleBundle(ref=ref, warmup=warmup_bytes, trading=trading_bytes)
```

- [ ] **Step 5: Написать интеграционный тест репозитория**

Создать `strategy-engine/tests/integration/test_jesse_candles.py`:

```python
"""Требует поднятого Postgres с импортированными свечами BTC-USDT.

Запускать из каталога jesse_project/ (см. Task 13):
    cd strategy-engine/jesse_project && uv run pytest ../tests/integration -m integration
"""

import datetime as dt

import pytest

from engine.adapters.jesse.candles import JesseCandleRepository
from engine.domain.dataset.models import DateRange
from engine.domain.shared.errors import DatasetUnavailable

pytestmark = pytest.mark.integration


def _ms(year: int, month: int, day: int) -> int:
    return int(dt.datetime(year, month, day, tzinfo=dt.timezone.utc).timestamp() * 1000)


def test_loaded_dataset_is_hash_stable() -> None:
    repo = JesseCandleRepository()
    date_range = DateRange(_ms(2023, 1, 1), _ms(2023, 1, 3))

    first = repo.load(
        exchange="Binance", symbol="BTC-USDT", timeframe="1h",
        date_range=date_range, warmup_candles_num=0,
    )
    second = repo.load(
        exchange="Binance", symbol="BTC-USDT", timeframe="1h",
        date_range=date_range, warmup_candles_num=0,
    )

    assert first.ref.dataset_hash == second.ref.dataset_hash
    assert first.trading == second.trading
    assert first.ref.trading_rows > 0


def test_warmup_changes_the_dataset_hash() -> None:
    repo = JesseCandleRepository()
    date_range = DateRange(_ms(2023, 1, 2), _ms(2023, 1, 3))

    without = repo.load(
        exchange="Binance", symbol="BTC-USDT", timeframe="1h",
        date_range=date_range, warmup_candles_num=0,
    )
    with_warmup = repo.load(
        exchange="Binance", symbol="BTC-USDT", timeframe="1h",
        date_range=date_range, warmup_candles_num=210,
    )

    assert without.ref.dataset_hash != with_warmup.ref.dataset_hash
    assert with_warmup.ref.warmup_rows > 0


def test_unknown_symbol_raises_dataset_unavailable() -> None:
    repo = JesseCandleRepository()
    with pytest.raises(DatasetUnavailable):
        repo.load(
            exchange="Binance", symbol="NOSUCH-COIN", timeframe="1h",
            date_range=DateRange(_ms(2023, 1, 1), _ms(2023, 1, 2)),
            warmup_candles_num=0,
        )
```

- [ ] **Step 6: Запустить unit-тесты (интеграционные пойдут в Task 13, когда поднимется Postgres)**

Run: `cd strategy-engine && uv run pytest tests/unit tests/contract tests/architecture -v`
Expected: PASS

- [ ] **Step 7: Коммит**

```bash
git add strategy-engine/src/engine strategy-engine/tests
git commit -m "feat(engine): add jesse candle repository and dataset preparation use case"
```

---

### Task 11: Юзкейс бэктеста

Сборка всего вместе: валидация, датасет, хеши, раннер. Тестируется на фейковых портах, без Postgres и Jesse.

**Files:**
- Create: `strategy-engine/src/engine/usecases/backtest/run_backtest.py`
- Test: `strategy-engine/tests/unit/usecases/test_run_backtest.py`

**Interfaces:**
- Consumes: `ValidateStrategy`, `EnsureDataset`, `StrategyRunner`, `run_hash`, `SourceValidationError`, `RunnerTimeout`, `RunnerCrashed`
- Produces:
  - `EngineVersions(engine: str, jesse: str)`
  - `BacktestCommand(source_code, parameters, config, date_range, warmup_candles_num, timeout_seconds)`
  - `BacktestOutcome(strategy_hash, dataset_ref, run_hash, metrics, equity_curve)`
  - `RunBacktest(candles, runner, versions).execute(command) -> BacktestOutcome`

- [ ] **Step 1: Написать падающий тест**

Создать `strategy-engine/tests/unit/usecases/test_run_backtest.py`:

```python
import pytest

from engine.adapters.sandbox.fake_runner import FakeRunner
from engine.domain.backtest.metrics import BacktestMetrics, EquityPoint
from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import CandleBundle, DateRange, DatasetRef
from engine.domain.runtime.contracts import RunnerError, RunnerResult, RunnerStatus
from engine.domain.shared.errors import RunnerTimeout, SourceValidationError
from engine.usecases.backtest.run_backtest import (
    BacktestCommand,
    EngineVersions,
    RunBacktest,
)

GOOD = """
from jesse.strategies import Strategy

class Good(Strategy):
    def should_long(self) -> bool:
        return True
    def go_long(self) -> None:
        self.buy = 1, self.price
"""

RANGE = DateRange(1_600_000_000_000, 1_600_086_400_000)
CONFIG = BacktestConfig(
    exchange="Binance", symbol="BTC-USDT", timeframe="1h",
    initial_balance=10_000.0, fee_rate=0.0006,
)
VERSIONS = EngineVersions(engine="0.2.0+abc1234", jesse="3.1.3")


def _bundle(dataset_hash: str = "d" * 64) -> CandleBundle:
    ref = DatasetRef(
        exchange="Binance", symbol="BTC-USDT", timeframe="1h", date_range=RANGE,
        warmup_rows=10, trading_rows=100, columns=6, dtype="float64",
        dataset_hash=dataset_hash,
    )
    return CandleBundle(ref=ref, warmup=b"\x01" * 480, trading=b"\x02" * 4800)


class _Repo:
    def __init__(self, bundle: CandleBundle) -> None:
        self.bundle = bundle

    def ensure(self, **kwargs) -> None:
        return None

    def load(self, **kwargs) -> CandleBundle:
        return self.bundle


def _ok_runner() -> FakeRunner:
    return FakeRunner(
        RunnerResult(
            job_id="x",
            status=RunnerStatus.OK,
            metrics=BacktestMetrics(net_return_percent=12.5, total_trades=3),
            equity_curve=(EquityPoint(1_600_000_000_000, 10_000.0),),
        )
    )


def _command() -> BacktestCommand:
    return BacktestCommand(
        source_code=GOOD, parameters={"period": 14}, config=CONFIG,
        date_range=RANGE, warmup_candles_num=10, timeout_seconds=60.0,
    )


async def test_successful_run_returns_all_three_hashes() -> None:
    usecase = RunBacktest(_Repo(_bundle()), _ok_runner(), VERSIONS)

    outcome = await usecase.execute(_command())

    assert len(outcome.strategy_hash) == 64
    assert outcome.dataset_ref.dataset_hash == "d" * 64
    assert len(outcome.run_hash) == 64
    assert outcome.metrics.net_return_percent == 12.5


async def test_same_inputs_give_the_same_run_hash() -> None:
    a = await RunBacktest(_Repo(_bundle()), _ok_runner(), VERSIONS).execute(_command())
    b = await RunBacktest(_Repo(_bundle()), _ok_runner(), VERSIONS).execute(_command())
    assert a.run_hash == b.run_hash


async def test_different_dataset_gives_different_run_hash() -> None:
    """Раньше run_hash считался от candles_count и не замечал подмены данных."""
    a = await RunBacktest(_Repo(_bundle("d" * 64)), _ok_runner(), VERSIONS).execute(_command())
    b = await RunBacktest(_Repo(_bundle("e" * 64)), _ok_runner(), VERSIONS).execute(_command())
    assert a.run_hash != b.run_hash


async def test_invalid_source_never_reaches_the_runner() -> None:
    runner = _ok_runner()
    usecase = RunBacktest(_Repo(_bundle()), runner, VERSIONS)
    command = BacktestCommand(
        source_code="import os\n", parameters={}, config=CONFIG,
        date_range=RANGE, warmup_candles_num=0, timeout_seconds=60.0,
    )

    with pytest.raises(SourceValidationError):
        await usecase.execute(command)

    assert runner.calls == []


async def test_runner_timeout_becomes_domain_error() -> None:
    runner = FakeRunner(
        RunnerResult(
            job_id="x", status=RunnerStatus.TIMEOUT,
            error=RunnerError(type="RunnerTimeout", message="снят по таймауту"),
        )
    )
    usecase = RunBacktest(_Repo(_bundle()), runner, VERSIONS)

    with pytest.raises(RunnerTimeout):
        await usecase.execute(_command())


async def test_parameters_reach_the_runner() -> None:
    runner = _ok_runner()
    await RunBacktest(_Repo(_bundle()), runner, VERSIONS).execute(_command())

    job, bundle = runner.calls[0]
    assert job.parameters == {"period": 14}
    assert job.strategy_class_name == "Good"
    assert bundle.ref.dataset_hash == "d" * 64
```

- [ ] **Step 2: Запустить и убедиться, что тест падает**

Run: `cd strategy-engine && uv run pytest tests/unit/usecases/test_run_backtest.py -v`
Expected: FAIL с `ModuleNotFoundError`

- [ ] **Step 3: Реализовать юзкейс**

`src/engine/usecases/backtest/run_backtest.py`:

```python
from __future__ import annotations

import uuid
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

from engine.domain.backtest.hashing import run_hash
from engine.domain.backtest.metrics import BacktestMetrics, EquityPoint
from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import DateRange, DatasetRef
from engine.domain.runtime.contracts import (
    RunnerJob,
    RunnerStatus,
    RuntimeMode,
)
from engine.domain.shared.errors import (
    RunnerCrashed,
    RunnerTimeout,
    SourceValidationError,
)
from engine.usecases.dataset.ensure_dataset import EnsureDataset
from engine.usecases.ports.candles import CandleRepository
from engine.usecases.ports.runner import StrategyRunner
from engine.usecases.strategy.validate_strategy import ValidateStrategy


@dataclass(frozen=True)
class EngineVersions:
    engine: str
    jesse: str


@dataclass(frozen=True)
class BacktestCommand:
    source_code: str
    parameters: Mapping[str, Any]
    config: BacktestConfig
    date_range: DateRange
    warmup_candles_num: int
    timeout_seconds: float


@dataclass(frozen=True)
class BacktestOutcome:
    strategy_hash: str
    dataset_ref: DatasetRef
    run_hash: str
    metrics: BacktestMetrics
    equity_curve: tuple[EquityPoint, ...] = field(default_factory=tuple)


class RunBacktest:
    def __init__(
        self,
        candles: CandleRepository,
        runner: StrategyRunner,
        versions: EngineVersions,
    ) -> None:
        self._ensure_dataset = EnsureDataset(candles)
        self._validate = ValidateStrategy()
        self._runner = runner
        self._versions = versions

    async def execute(self, command: BacktestCommand) -> BacktestOutcome:
        validated = self._validate.execute(command.source_code, command.parameters)
        if not validated.validation.valid or validated.strategy_hash is None:
            raise SourceValidationError(validated.validation.errors)

        bundle = self._ensure_dataset.execute(
            exchange=command.config.exchange,
            symbol=command.config.symbol,
            timeframe=command.config.timeframe,
            date_range=command.date_range,
            warmup_candles_num=command.warmup_candles_num,
        )

        computed_run_hash = run_hash(
            strategy_hash=validated.strategy_hash,
            dataset_hash=bundle.ref.dataset_hash,
            engine_version=self._versions.engine,
            jesse_version=self._versions.jesse,
            config=command.config,
            date_range=command.date_range,
            warmup_rows=bundle.ref.warmup_rows,
        )

        job = RunnerJob(
            job_id=str(uuid.uuid4()),
            mode=RuntimeMode.BACKTEST,
            source_code=command.source_code,
            strategy_class_name=validated.validation.strategy_class_name or "",
            parameters=dict(command.parameters),
            config=command.config,
            warmup_rows=bundle.ref.warmup_rows,
            timeout_seconds=command.timeout_seconds,
        )

        result = await self._runner.run(job, bundle)

        if result.status is RunnerStatus.TIMEOUT:
            raise RunnerTimeout(result.error.message if result.error else "таймаут прогона")
        if result.status is RunnerStatus.INVALID_STRATEGY:
            raise SourceValidationError(
                (result.error.message,) if result.error else ("стратегия отклонена раннером",)
            )
        if result.status is not RunnerStatus.OK or result.metrics is None:
            raise RunnerCrashed(
                result.error.message if result.error else f"статус раннера: {result.status}"
            )

        return BacktestOutcome(
            strategy_hash=validated.strategy_hash,
            dataset_ref=bundle.ref,
            run_hash=computed_run_hash,
            metrics=result.metrics,
            equity_curve=result.equity_curve,
        )
```

- [ ] **Step 4: Запустить тесты**

Run: `cd strategy-engine && uv run pytest tests/unit tests/contract tests/architecture -v`
Expected: PASS

- [ ] **Step 5: Коммит**

```bash
git add strategy-engine/src/engine/usecases strategy-engine/tests/unit
git commit -m "feat(engine): add backtest use case wiring validation, dataset and runner"
```

---

### Task 12: HTTP-слой

FastAPI, схемы, композиционный корень, отображение ошибок, аутентификация, CORS.

**Files:**
- Create: `strategy-engine/src/engine/entrypoints/api/schemas/strategy.py`
- Create: `strategy-engine/src/engine/entrypoints/api/schemas/backtest.py`
- Create: `strategy-engine/src/engine/entrypoints/api/errors.py`
- Create: `strategy-engine/src/engine/entrypoints/api/deps.py`
- Create: `strategy-engine/src/engine/entrypoints/api/routers/health.py`
- Create: `strategy-engine/src/engine/entrypoints/api/routers/strategy.py`
- Create: `strategy-engine/src/engine/entrypoints/api/routers/backtest.py`
- Create: `strategy-engine/src/engine/entrypoints/api/main.py`
- Test: `strategy-engine/tests/unit/api/test_api.py`

**Interfaces:**
- Consumes: `RunBacktest`, `ValidateStrategy`, `Settings`, доменные ошибки
- Produces:
  - `create_app(settings: Settings | None = None) -> FastAPI`
  - зависимости `get_run_backtest()`, `get_validate_strategy()`, `require_token()` — переопределяемые через `app.dependency_overrides`
  - `app` — экземпляр для `uvicorn engine.entrypoints.api.main:app`

- [ ] **Step 1: Написать падающий тест API**

Создать `strategy-engine/tests/unit/api/test_api.py`:

```python
import pytest
from fastapi.testclient import TestClient

from engine.adapters.sandbox.fake_runner import FakeRunner
from engine.domain.backtest.metrics import BacktestMetrics, EquityPoint
from engine.domain.dataset.models import CandleBundle, DateRange, DatasetRef
from engine.domain.runtime.contracts import RunnerError, RunnerResult, RunnerStatus
from engine.entrypoints.api.deps import get_run_backtest
from engine.entrypoints.api.main import create_app
from engine.settings import Settings
from engine.usecases.backtest.run_backtest import EngineVersions, RunBacktest

GOOD = """
from jesse.strategies import Strategy

class Good(Strategy):
    def should_long(self) -> bool:
        return True
    def go_long(self) -> None:
        self.buy = 1, self.price
"""

RANGE = DateRange(1_600_000_000_000, 1_600_086_400_000)


class _Repo:
    def ensure(self, **kwargs) -> None:
        return None

    def load(self, **kwargs) -> CandleBundle:
        ref = DatasetRef(
            exchange="Binance", symbol="BTC-USDT", timeframe="1h", date_range=RANGE,
            warmup_rows=0, trading_rows=100, columns=6, dtype="float64",
            dataset_hash="d" * 64,
        )
        return CandleBundle(ref=ref, warmup=b"", trading=b"\x02" * 4800)


def _client(runner_result: RunnerResult) -> TestClient:
    app = create_app(Settings(api_token=None, require_jesse_project=False))
    usecase = RunBacktest(_Repo(), FakeRunner(runner_result), EngineVersions("0.2.0", "3.1.3"))
    app.dependency_overrides[get_run_backtest] = lambda: usecase
    return TestClient(app)


OK_RESULT = RunnerResult(
    job_id="x", status=RunnerStatus.OK,
    metrics=BacktestMetrics(net_return_percent=12.5, sharpe=None, total_trades=3),
    equity_curve=(EquityPoint(1_600_000_000_000, 10_000.0),),
)


def test_health_is_open() -> None:
    assert _client(OK_RESULT).get("/health").json()["status"] == "ok"


def test_validate_returns_hash() -> None:
    response = _client(OK_RESULT).post("/api/v1/strategy/validate", json={"source_code": GOOD})
    body = response.json()

    assert response.status_code == 200
    assert body["valid"] is True
    assert len(body["strategy_hash"]) == 64


def test_backtest_returns_all_hashes_and_nullable_metrics() -> None:
    response = _client(OK_RESULT).post(
        "/api/v1/backtest",
        json={
            "source_code": GOOD, "symbol": "BTC-USDT", "timeframe": "1h",
            "exchange": "Binance", "start_date": "2023-01-01", "end_date": "2023-01-02",
        },
    )
    body = response.json()

    assert response.status_code == 200
    assert len(body["run_hash"]) == 64
    assert len(body["dataset_hash"]) == 64
    assert body["metrics"]["sharpe"] is None, "NaN обязан приезжать как null, не как 0"
    assert body["metrics"]["net_return_percent"] == 12.5


def test_invalid_source_is_422() -> None:
    response = _client(OK_RESULT).post(
        "/api/v1/backtest",
        json={"source_code": "import os\n", "start_date": "2023-01-01", "end_date": "2023-01-02"},
    )
    assert response.status_code == 422


def test_runner_timeout_is_504() -> None:
    timeout_result = RunnerResult(
        job_id="x", status=RunnerStatus.TIMEOUT,
        error=RunnerError(type="RunnerTimeout", message="снят по таймауту"),
    )
    response = _client(timeout_result).post(
        "/api/v1/backtest",
        json={"source_code": GOOD, "start_date": "2023-01-01", "end_date": "2023-01-02"},
    )
    assert response.status_code == 504


def test_token_is_required_when_configured() -> None:
    app = create_app(Settings(api_token="s3cret", require_jesse_project=False))
    client = TestClient(app)

    assert client.post("/api/v1/strategy/validate", json={"source_code": GOOD}).status_code == 401

    ok = client.post(
        "/api/v1/strategy/validate",
        json={"source_code": GOOD},
        headers={"X-Engine-Token": "s3cret"},
    )
    assert ok.status_code == 200
```

- [ ] **Step 2: Запустить и убедиться, что тест падает**

Run: `cd strategy-engine && uv run pytest tests/unit/api -v`
Expected: FAIL с `ModuleNotFoundError`

- [ ] **Step 3: Реализовать схемы**

`src/engine/entrypoints/api/schemas/strategy.py`:

```python
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class ValidateStrategyRequest(BaseModel):
    source_code: str = Field(..., description="Python-исходник Jesse-стратегии")
    parameters: dict[str, Any] = Field(default_factory=dict)


class ValidateStrategyResponse(BaseModel):
    valid: bool
    strategy_hash: str | None = None
    strategy_class_name: str | None = None
    errors: list[str] = Field(default_factory=list)
    detected_methods: list[str] = Field(default_factory=list)
```

`src/engine/entrypoints/api/schemas/backtest.py`:

```python
from __future__ import annotations

from typing import Any

from pydantic import BaseModel, Field


class BacktestRequest(BaseModel):
    source_code: str
    parameters: dict[str, Any] = Field(default_factory=dict)
    symbol: str = "BTC-USDT"
    timeframe: str = "1h"
    exchange: str = "Binance"
    start_date: str = Field(..., description="YYYY-MM-DD, включительно")
    end_date: str = Field(..., description="YYYY-MM-DD, исключительно")
    initial_balance: float = 10_000.0
    fee_rate: float = 0.0006
    warmup_candles_num: int = Field(210, ge=0, le=5000)


class MetricsResponse(BaseModel):
    net_return_percent: float | None = None
    sharpe: float | None = None
    sortino: float | None = None
    calmar: float | None = None
    omega: float | None = None
    max_drawdown_percent: float | None = None
    win_rate: float | None = None
    profit_factor: float | None = None
    payoff_ratio: float | None = None
    expectancy: float | None = None
    starting_balance: float | None = None
    finishing_balance: float | None = None
    total_trades: int = 0
    winning_trades: int = 0
    losing_trades: int = 0
    longs_count: int = 0
    shorts_count: int = 0


class EquityPointResponse(BaseModel):
    timestamp_ms: int
    equity: float


class DatasetResponse(BaseModel):
    exchange: str
    symbol: str
    timeframe: str
    start_ms: int
    finish_ms: int
    warmup_rows: int
    trading_rows: int


class BacktestResponse(BaseModel):
    run_hash: str
    strategy_hash: str
    dataset_hash: str
    dataset: DatasetResponse
    metrics: MetricsResponse
    equity_curve: list[EquityPointResponse] = Field(default_factory=list)
```

- [ ] **Step 4: Реализовать ошибки, зависимости и роутеры**

`src/engine/entrypoints/api/errors.py`:

```python
"""Единственное место, где домен встречается с HTTP."""

from __future__ import annotations

import uuid

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from engine.domain.shared.errors import (
    DatasetUnavailable,
    RunnerCrashed,
    RunnerTimeout,
    SourceValidationError,
)

_STATUS_BY_ERROR = {
    SourceValidationError: 422,
    DatasetUnavailable: 409,
    RunnerTimeout: 504,
    RunnerCrashed: 502,
}


def register_error_handlers(app: FastAPI) -> None:
    for error_type, status_code in _STATUS_BY_ERROR.items():

        def _make(status: int):
            async def _handler(_: Request, exc: Exception) -> JSONResponse:
                detail = getattr(exc, "errors", None) or [str(exc)]
                return JSONResponse(
                    status_code=status,
                    content={"error": type(exc).__name__, "detail": list(detail)},
                )

            return _handler

        app.add_exception_handler(error_type, _make(status_code))

    @app.exception_handler(Exception)
    async def _unexpected(_: Request, exc: Exception) -> JSONResponse:
        request_id = str(uuid.uuid4())
        # Трейсбек наружу не отдаём — только идентификатор для поиска в логах.
        return JSONResponse(
            status_code=500,
            content={"error": "InternalError", "request_id": request_id},
        )
```

`src/engine/entrypoints/api/deps.py`:

```python
from __future__ import annotations

from functools import lru_cache

from fastapi import Header, HTTPException, Request

from engine.adapters.jesse.candles import JesseCandleRepository
from engine.adapters.sandbox.uds_runner import SocketStrategyRunner
from engine.settings import get_settings
from engine.usecases.backtest.run_backtest import EngineVersions, RunBacktest
from engine.usecases.strategy.validate_strategy import ValidateStrategy


@lru_cache
def _versions() -> EngineVersions:
    from importlib.metadata import version

    settings = get_settings()
    try:
        jesse_version = version("jesse")
    except Exception:  # noqa: BLE001
        jesse_version = "unknown"
    return EngineVersions(engine=settings.full_engine_version, jesse=jesse_version)


def get_validate_strategy() -> ValidateStrategy:
    return ValidateStrategy()


def get_run_backtest() -> RunBacktest:
    """Композиционный корень: единственное место сборки адаптеров в юзкейс."""
    return RunBacktest(
        candles=JesseCandleRepository(),
        runner=SocketStrategyRunner(get_settings()),
        versions=_versions(),
    )


async def require_token(
    request: Request, x_engine_token: str | None = Header(default=None)
) -> None:
    """Настройки берутся из app.state, а не из глобального кэша.

    Иначе приложение, собранное с явными Settings (в тестах и при нескольких
    конфигурациях), проверяло бы токен из переменных окружения.
    """
    expected = request.app.state.settings.api_token
    if expected and x_engine_token != expected:
        raise HTTPException(status_code=401, detail="неверный или отсутствующий X-Engine-Token")
```

`src/engine/entrypoints/api/routers/health.py`:

```python
from __future__ import annotations

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": "trade-strategy-engine"}
```

`src/engine/entrypoints/api/routers/strategy.py`:

```python
from __future__ import annotations

from fastapi import APIRouter, Depends

from engine.entrypoints.api.deps import get_validate_strategy, require_token
from engine.entrypoints.api.schemas.strategy import (
    ValidateStrategyRequest,
    ValidateStrategyResponse,
)
from engine.usecases.strategy.validate_strategy import ValidateStrategy

router = APIRouter(prefix="/api/v1/strategy", dependencies=[Depends(require_token)])


@router.post("/validate", response_model=ValidateStrategyResponse)
async def validate_strategy(
    request: ValidateStrategyRequest,
    usecase: ValidateStrategy = Depends(get_validate_strategy),
) -> ValidateStrategyResponse:
    outcome = usecase.execute(request.source_code, request.parameters)
    return ValidateStrategyResponse(
        valid=outcome.validation.valid,
        strategy_hash=outcome.strategy_hash,
        strategy_class_name=outcome.validation.strategy_class_name,
        errors=list(outcome.validation.errors),
        detected_methods=list(outcome.validation.detected_methods),
    )
```

`src/engine/entrypoints/api/routers/backtest.py`:

```python
from __future__ import annotations

import dataclasses
import datetime as dt

from fastapi import APIRouter, Depends, Request

from engine.domain.backtest.models import BacktestConfig
from engine.domain.dataset.models import DateRange
from engine.entrypoints.api.deps import get_run_backtest, require_token
from engine.entrypoints.api.schemas.backtest import (
    BacktestRequest,
    BacktestResponse,
    DatasetResponse,
    EquityPointResponse,
    MetricsResponse,
)
from engine.usecases.backtest.run_backtest import BacktestCommand, RunBacktest

router = APIRouter(prefix="/api/v1", dependencies=[Depends(require_token)])


def _to_ms(date_str: str) -> int:
    parsed = dt.datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=dt.timezone.utc)
    return int(parsed.timestamp() * 1000)


@router.post("/backtest", response_model=BacktestResponse)
async def run_backtest(
    body: BacktestRequest,
    request: Request,
    usecase: RunBacktest = Depends(get_run_backtest),
) -> BacktestResponse:
    config = BacktestConfig(
        exchange=body.exchange,
        symbol=body.symbol,
        timeframe=body.timeframe,
        initial_balance=body.initial_balance,
        fee_rate=body.fee_rate,
    )
    outcome = await usecase.execute(
        BacktestCommand(
            source_code=body.source_code,
            parameters=body.parameters,
            config=config,
            date_range=DateRange(_to_ms(body.start_date), _to_ms(body.end_date)),
            warmup_candles_num=body.warmup_candles_num,
            timeout_seconds=request.app.state.settings.runner_timeout_seconds,
        )
    )

    ref = outcome.dataset_ref
    return BacktestResponse(
        run_hash=outcome.run_hash,
        strategy_hash=outcome.strategy_hash,
        dataset_hash=ref.dataset_hash,
        dataset=DatasetResponse(
            exchange=ref.exchange,
            symbol=ref.symbol,
            timeframe=ref.timeframe,
            start_ms=ref.date_range.start_ms,
            finish_ms=ref.date_range.finish_ms,
            warmup_rows=ref.warmup_rows,
            trading_rows=ref.trading_rows,
        ),
        metrics=MetricsResponse(
            **{
                k: v
                for k, v in dataclasses.asdict(outcome.metrics).items()
                if k != "trades"
            }
        ),
        equity_curve=[
            EquityPointResponse(timestamp_ms=p.timestamp_ms, equity=p.equity)
            for p in outcome.equity_curve
        ],
    )
```

`src/engine/entrypoints/api/main.py`:

```python
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from engine.adapters.jesse.bootstrap import assert_jesse_project
from engine.entrypoints.api.errors import register_error_handlers
from engine.entrypoints.api.routers import backtest, health, strategy
from engine.settings import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()

    # Падаем на старте с внятным сообщением, а не на первом бэктесте: Jesse
    # включает БД только по наличию strategies/ и storage/ в cwd, а .env
    # читает файлом. Ошибка здесь дешевле, чем загадочный os._exit(1) внутри.
    if settings.require_jesse_project:
        assert_jesse_project()

    app = FastAPI(
        title="TradeMCP Strategy Engine",
        version=settings.engine_version,
        description="Квант-исследование и исполнение стратегий на Jesse",
    )
    app.state.settings = settings

    # Движок не браузерный: по умолчанию CORS закрыт. Прежняя пара
    # allow_origins=["*"] с allow_credentials=True вдобавок невалидна.
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=settings.cors_origins,
            allow_credentials=True,
            allow_methods=["POST", "GET"],
            allow_headers=["*"],
        )

    app.include_router(health.router)
    app.include_router(strategy.router)
    app.include_router(backtest.router)
    register_error_handlers(app)
    return app


app = create_app()
```

- [ ] **Step 5: Запустить тесты API**

Run: `cd strategy-engine && uv run pytest tests/unit tests/contract tests/architecture -v`
Expected: PASS (6 тестов API + все предыдущие)

- [ ] **Step 6: Коммит**

```bash
git add strategy-engine/src/engine/entrypoints/api strategy-engine/tests/unit/api
git commit -m "feat(engine): add HTTP layer with token auth and domain error mapping"
```

---

### Task 13: Docker, Compose и сквозные гарантии

Два образа, Jesse-проект, Postgres и Redis. Здесь же — три теста, ради которых делалась вся перестройка.

**Files:**
- Create: `strategy-engine/docker/orchestrator.Dockerfile`
- Create: `strategy-engine/docker/runner.Dockerfile`
- Create: `strategy-engine/docker/render-jesse-env.sh`
- Create: `strategy-engine/jesse_project/strategies/.gitkeep`
- Create: `strategy-engine/jesse_project/storage/.gitkeep`
- Delete: `strategy-engine/Dockerfile`
- Modify: `docker-compose.yml`
- Modify: `.env.example`
- Test: `strategy-engine/tests/integration/test_end_to_end.py`

**Interfaces:**
- Consumes: всё предыдущее
- Produces: сервисы `strategy_engine`, `strategy_runner`, `strategy_postgres`, `strategy_redis`; общий volume `runner_ipc`

- [ ] **Step 1: Написать падающие сквозные тесты**

Создать `strategy-engine/tests/integration/test_end_to_end.py`:

```python
"""Три гарантии, ради которых делалась перестройка.

Требует поднятого compose-стека. Запуск:
    docker compose exec strategy_engine \\
        uv run pytest /app/tests/integration/test_end_to_end.py -m integration -v
"""

import os

import httpx
import pytest

pytestmark = pytest.mark.integration

BASE_URL = os.environ.get("ENGINE_BASE_URL", "http://127.0.0.1:8000")
TOKEN = os.environ.get("ENGINE_API_TOKEN", "")
HEADERS = {"X-Engine-Token": TOKEN} if TOKEN else {}

WORKING = """
from jesse.strategies import Strategy

class Working(Strategy):
    def should_long(self) -> bool:
        return self.index % 500 == 0
    def go_long(self) -> None:
        self.buy = 0.01, self.price
    def should_short(self) -> bool:
        return False
"""

HANGING = """
from jesse.strategies import Strategy

class Hanging(Strategy):
    def should_long(self) -> bool:
        while True:
            pass
    def go_long(self) -> None:
        pass
"""

ESCAPING = """
from jesse.strategies import Strategy
import jesse.helpers as jh

class Escaping(Strategy):
    def should_long(self) -> bool:
        return False
    def go_long(self) -> None:
        pass

LEAK = jh.os.popen("id").read()
"""

PAYLOAD = {
    "symbol": "BTC-USDT", "timeframe": "1h", "exchange": "Binance",
    "start_date": "2023-01-01", "end_date": "2023-01-05",
    "initial_balance": 10_000.0, "fee_rate": 0.0006,
}


def _backtest(source: str, **overrides) -> httpx.Response:
    with httpx.Client(timeout=300.0) as client:
        return client.post(
            f"{BASE_URL}/api/v1/backtest",
            json={**PAYLOAD, "source_code": source, **overrides},
            headers=HEADERS,
        )


def test_identical_requests_are_byte_for_byte_reproducible() -> None:
    """Прежняя реализация давала одинаковый run_hash при разных метриках,
    потому что бэктест шёл на случайных fake_range_candles."""
    first = _backtest(WORKING)
    second = _backtest(WORKING)

    assert first.status_code == 200, first.text
    assert second.status_code == 200, second.text

    a, b = first.json(), second.json()
    assert a["run_hash"] == b["run_hash"]
    assert a["dataset_hash"] == b["dataset_hash"]
    assert a["metrics"] == b["metrics"], "одинаковый run_hash обязан означать одинаковый результат"
    assert a["equity_curve"] == b["equity_curve"]


def test_equity_curve_is_not_empty() -> None:
    """Старый парсер всегда возвращал пустую кривую."""
    response = _backtest(WORKING)
    body = response.json()

    assert body["metrics"]["total_trades"] > 0, "стратегия обязана совершить сделки"
    assert len(body["equity_curve"]) > 0
    assert body["equity_curve"][0]["timestamp_ms"] > 1_000_000_000_000


def test_infinite_loop_times_out_and_engine_survives() -> None:
    hung = _backtest(HANGING)
    assert hung.status_code == 504, hung.text

    healthy = _backtest(WORKING)
    assert healthy.status_code == 200, "движок обязан пережить зависшую стратегию"


def test_sandbox_escape_gets_no_network_and_no_host() -> None:
    """Регрессия на воспроизведённую дыру: jesse.helpers реэкспортирует os,
    и AST-валидатор этого не ловит. Границей служит контейнер без сети."""
    response = _backtest(ESCAPING)

    # Стратегия может упасть или отработать, но наружу она не должна получить
    # ничего полезного: у контейнера раннера нет сетевых интерфейсов.
    assert response.status_code in (200, 422, 502), response.text

    with httpx.Client(timeout=30.0) as client:
        assert client.get(f"{BASE_URL}/health", headers=HEADERS).json()["status"] == "ok"


def test_missing_dataset_is_409_not_a_fabricated_result() -> None:
    response = _backtest(WORKING, symbol="NOSUCH-COIN")
    assert response.status_code == 409, response.text
```

- [ ] **Step 2: Написать entrypoint, рендерящий `.env` для Jesse**

Создать `strategy-engine/docker/render-jesse-env.sh`:

```bash
#!/bin/sh
# Jesse читает .env ФАЙЛОМ через dotenv_values() на импорте jesse.services.env,
# а не из переменных окружения. Если файла нет или он пуст — os._exit(1) без
# внятного сообщения. Поэтому рендерим его здесь, из переменных окружения.
set -eu

ENV_FILE="${JESSE_PROJECT_DIR:-/app/jesse_project}/.env"

cat > "$ENV_FILE" <<EOF
PASSWORD=${JESSE_PASSWORD:?JESSE_PASSWORD обязателен: Jesse падает на пустом PASSWORD}
POSTGRES_HOST=${POSTGRES_HOST:-strategy_postgres}
POSTGRES_NAME=${POSTGRES_NAME:-jesse_db}
POSTGRES_PORT=${POSTGRES_PORT:-5432}
POSTGRES_USERNAME=${POSTGRES_USERNAME:-jesse_user}
POSTGRES_PASSWORD=${POSTGRES_PASSWORD:?POSTGRES_PASSWORD обязателен}
REDIS_HOST=${REDIS_HOST:-strategy_redis}
REDIS_PORT=${REDIS_PORT:-6379}
REDIS_PASSWORD=${REDIS_PASSWORD:-}
REDIS_DB=${REDIS_DB:-0}
APP_PORT=8000
IS_DEV_ENV=${IS_DEV_ENV:-FALSE}
EOF

chmod 600 "$ENV_FILE"
cd "${JESSE_PROJECT_DIR:-/app/jesse_project}"
exec "$@"
```

```bash
chmod +x strategy-engine/docker/render-jesse-env.sh
```

- [ ] **Step 3: Написать два Dockerfile**

Создать `strategy-engine/docker/orchestrator.Dockerfile`:

```dockerfile
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

ARG GIT_SHA=unknown
ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ENGINE_GIT_SHA=${GIT_SHA} \
    JESSE_PROJECT_DIR=/app/jesse_project

RUN groupadd -g 10001 appuser && useradd -u 10001 -g appuser -s /bin/false appuser

COPY --from=builder --chown=10001:10001 /app /app
COPY --chmod=0755 docker/render-jesse-env.sh /usr/local/bin/render-jesse-env

# Jesse включает работу с БД только если в cwd есть strategies/ и storage/.
RUN mkdir -p /app/jesse_project/strategies /app/jesse_project/storage /run/engine \
    && chown -R 10001:10001 /app/jesse_project /run/engine

USER 10001:10001
EXPOSE 8000
ENTRYPOINT ["render-jesse-env"]
CMD ["uvicorn", "engine.entrypoints.api.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

Создать `strategy-engine/docker/runner.Dockerfile`:

```dockerfile
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
# WORKDIR НАМЕРЕННО не является Jesse-проектом: is_jesse_project() проверяет
# наличие strategies/ и storage/ в cwd. Их здесь нет, поэтому Jesse не
# открывает соединение с БД и не требует .env. Раннеру данные приходят
# байтами по сокету — ни БД, ни сеть ему не нужны.
WORKDIR /srv

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    ENGINE_RUNNER_TRANSPORT=uds \
    ENGINE_RUNNER_SOCKET_PATH=/run/engine/runner.sock

RUN groupadd -g 10001 appuser && useradd -u 10001 -g appuser -s /bin/false appuser
COPY --from=builder --chown=10001:10001 /app /app
RUN mkdir -p /run/engine /srv && chown -R 10001:10001 /run/engine /srv

USER 10001:10001
CMD ["python", "-m", "engine.entrypoints.runner.server"]
```

- [ ] **Step 4: Обновить compose**

Заменить содержимое `docker-compose.yml` в корне репозитория:

```yaml
services:
  trade_mcp:
    build: .
    container_name: trade_mcp
    env_file: .env
    restart: unless-stopped
    depends_on:
      - strategy_engine
    networks:
      - amaexecutioncore_default

  strategy_engine:
    build:
      context: ./strategy-engine
      dockerfile: docker/orchestrator.Dockerfile
      args:
        GIT_SHA: ${GIT_SHA:-unknown}
    container_name: trade_strategy_engine
    restart: unless-stopped
    environment:
      JESSE_PASSWORD: ${JESSE_PASSWORD}
      POSTGRES_HOST: strategy_postgres
      POSTGRES_NAME: jesse_db
      POSTGRES_USERNAME: jesse_user
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      REDIS_HOST: strategy_redis
      ENGINE_API_TOKEN: ${STRATEGY_ENGINE_TOKEN}
      ENGINE_RUNNER_TRANSPORT: uds
      ENGINE_RUNNER_SOCKET_PATH: /run/engine/runner.sock
      ENGINE_RUNNER_TIMEOUT_SECONDS: "120"
    volumes:
      - runner_ipc:/run/engine
    depends_on:
      - strategy_postgres
      - strategy_redis
      - strategy_runner
    networks:
      - amaexecutioncore_default
      - strategy_backend

  strategy_runner:
    build:
      context: ./strategy-engine
      dockerfile: docker/runner.Dockerfile
    container_name: trade_strategy_runner
    restart: unless-stopped
    # Сетевых интерфейсов нет вообще: связь только через Unix-сокет на volume.
    network_mode: none
    read_only: true
    tmpfs:
      - /tmp:size=64m,mode=1777
    mem_limit: 512m
    pids_limit: 64
    cap_drop:
      - ALL
    security_opt:
      - no-new-privileges:true
    user: "10001:10001"
    environment:
      ENGINE_RUNNER_TIMEOUT_SECONDS: "120"
      ENGINE_RUNNER_MEMORY_MB: "512"
      ENGINE_MAX_CONCURRENT_RUNS: "2"
    volumes:
      - runner_ipc:/run/engine

  strategy_postgres:
    image: postgres:16-alpine
    container_name: trade_strategy_postgres
    restart: unless-stopped
    environment:
      POSTGRES_DB: jesse_db
      POSTGRES_USER: jesse_user
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - strategy_pgdata:/var/lib/postgresql/data
    networks:
      - strategy_backend

  strategy_redis:
    image: redis:7-alpine
    container_name: trade_strategy_redis
    restart: unless-stopped
    networks:
      - strategy_backend

volumes:
  runner_ipc:
  strategy_pgdata:

networks:
  amaexecutioncore_default:
    external: true
  strategy_backend:
    internal: true
```

- [ ] **Step 5: Дополнить `.env.example`**

Добавить в `.env.example`:

```
# Strategy engine
STRATEGY_ENGINE_URL=http://strategy_engine:8000
STRATEGY_ENGINE_TOKEN=change-me
JESSE_PASSWORD=change-me
POSTGRES_PASSWORD=change-me
```

- [ ] **Step 6: Поднять стек и импортировать свечи**

```bash
cd "$(git rev-parse --show-toplevel)"
docker compose build strategy_engine strategy_runner
docker compose up -d strategy_postgres strategy_redis strategy_runner strategy_engine
docker compose logs -f strategy_engine   # дождаться старта uvicorn, Ctrl+C

# Первичный импорт свечей (идёт в биржу, занимает минуты)
docker compose exec strategy_engine python -c "
from jesse.research import import_candles
import_candles('Binance', 'BTC-USDT', '2023-01-01', show_progressbar=False)
print('готово')
"
```

- [ ] **Step 7: Прогнать сквозные тесты**

```bash
docker compose exec -e ENGINE_API_TOKEN="$STRATEGY_ENGINE_TOKEN" strategy_engine \
    uv run pytest /app/tests/integration/test_end_to_end.py -m integration -v
```

Expected: PASS (5 тестов). Если `test_identical_requests_are_byte_for_byte_reproducible` падает — искать оставшийся источник недетерминизма, а не ослаблять тест.

- [ ] **Step 8: Удалить старый Dockerfile и закоммитить**

```bash
git rm strategy-engine/Dockerfile
git add strategy-engine/docker strategy-engine/jesse_project \
        docker-compose.yml .env.example strategy-engine/tests/integration
git commit -m "feat(engine): add orchestrator and networkless runner containers with postgres"
```

---

### Task 14: Удаление старого пакета и обновление TS-стороны

Снос `src/strategy_engine/` и перевод TradeMCP на новый контракт. Хеши на TS больше не считаются.

**Files:**
- Delete: `strategy-engine/src/strategy_engine/` целиком
- Delete: `strategy-engine/tests/test_api.py`, `strategy-engine/tests/test_ast_validator.py`
- Delete: `strategy-engine/storage/`
- Modify: `src/server/strategyEngineClient.ts`
- Modify: `src/server/strategyRegistry.ts`
- Modify: `src/server/strategyRegistry.test.ts`
- Modify: `src/server/mcpServerFactory.ts`

**Interfaces:**
- Consumes: HTTP-контракт из Task 12 (`dataset_hash`, `payoff_ratio`, nullable-метрики)
- Produces: `StrategyEngineClient` с методами `healthCheck()`, `validateStrategy(sourceCode, parameters?)`, `runBacktest(payload)`; `strategyRegistry` без функций вычисления хешей

- [ ] **Step 1: Удалить старый пакет и его тесты**

```bash
cd strategy-engine
git rm -r src/strategy_engine tests/test_api.py tests/test_ast_validator.py
rm -rf storage
uv run pytest tests/unit tests/contract tests/architecture -v
```

Expected: PASS — новый пакет самодостаточен.

- [ ] **Step 2: Обновить схемы TS-клиента**

В `src/server/strategyEngineClient.ts` заменить схемы ответов:

```typescript
export const BacktestMetricsSchema = z.object({
  net_return_percent: z.number().nullable(),
  sharpe: z.number().nullable(),
  sortino: z.number().nullable(),
  calmar: z.number().nullable(),
  omega: z.number().nullable(),
  max_drawdown_percent: z.number().nullable(),
  win_rate: z.number().nullable(),
  profit_factor: z.number().nullable(),
  payoff_ratio: z.number().nullable(),
  expectancy: z.number().nullable(),
  starting_balance: z.number().nullable(),
  finishing_balance: z.number().nullable(),
  total_trades: z.number(),
  winning_trades: z.number(),
  losing_trades: z.number(),
  longs_count: z.number(),
  shorts_count: z.number(),
});

export const DatasetSchema = z.object({
  exchange: z.string(),
  symbol: z.string(),
  timeframe: z.string(),
  start_ms: z.number(),
  finish_ms: z.number(),
  warmup_rows: z.number(),
  trading_rows: z.number(),
});

export const BacktestResponseSchema = z.object({
  run_hash: z.string(),
  strategy_hash: z.string(),
  dataset_hash: z.string(),
  dataset: DatasetSchema,
  metrics: BacktestMetricsSchema,
  equity_curve: z.array(z.object({ timestamp_ms: z.number(), equity: z.number() })).default([]),
});
```

Добавить проброс токена и увеличить таймаут бэктеста:

```typescript
const STRATEGY_ENGINE_URL = process.env.STRATEGY_ENGINE_URL || 'http://127.0.0.1:8000';
const STRATEGY_ENGINE_TOKEN = process.env.STRATEGY_ENGINE_TOKEN || '';
const BACKTEST_TIMEOUT_MS = 300_000; // импорт свечей и длинные диапазоны идут минутами

private authHeaders(): Record<string, string> {
  return STRATEGY_ENGINE_TOKEN ? { 'X-Engine-Token': STRATEGY_ENGINE_TOKEN } : {};
}
```

Заменить `BacktestRequestPayload` и метод `runBacktest` целиком — `candles` больше не передаются, даты обязательны:

```typescript
export interface BacktestRequestPayload {
  source_code: string;
  parameters?: Record<string, unknown>;
  symbol?: string;
  timeframe?: string;
  exchange?: string;
  start_date: string;
  end_date: string;
  initial_balance?: number;
  fee_rate?: number;
  warmup_candles_num?: number;
}

async runBacktest(payload: BacktestRequestPayload): Promise<BacktestResponse> {
  const res = await axios.post(
    `${this.baseUrl}/api/v1/backtest`,
    {
      source_code: payload.source_code,
      parameters: payload.parameters || {},
      symbol: payload.symbol || 'BTC-USDT',
      timeframe: payload.timeframe || '1h',
      exchange: payload.exchange || 'Binance',
      start_date: payload.start_date,
      end_date: payload.end_date,
      initial_balance: payload.initial_balance ?? 10000.0,
      fee_rate: payload.fee_rate ?? 0.0006,
      warmup_candles_num: payload.warmup_candles_num ?? 210,
    },
    { timeout: BACKTEST_TIMEOUT_MS, headers: this.authHeaders() },
  );

  return BacktestResponseSchema.parse(res.data);
}
```

- [ ] **Step 3: Убрать вычисление хешей из реестра**

В `src/server/strategyRegistry.ts` удалить `calculateStrategyHash`, `calculateRunHash` и интерфейс `RunHashParams`. Причина — в комментарии рядом с `StrategyRunDoc`:

```typescript
// Хеши приходят из Python-движка и здесь не вычисляются: две независимые
// реализации канонического JSON расходились (Python добавляет пробелы после
// разделителей, JSON.stringify — нет), и один вход давал разные хеши.
```

В `StrategyRunDoc.environment` заменить `candlesCount: number` на:

```typescript
  environment: {
    symbol: string;
    timeframe: string;
    startDate: string;
    endDate: string;
    feeRate: number;
    datasetHash: string;
    warmupRows: number;
    tradingRows: number;
  };
```

Из `src/server/strategyRegistry.test.ts` удалить тесты вычисления хешей; остальные тесты сохранить.

- [ ] **Step 4: Обновить вызовы в mcpServerFactory**

В `src/server/mcpServerFactory.ts` убрать импорт `calculateStrategyHash` и заменить фолбэк в `trade_create_strategy`:

```typescript
// Было: validation.strategy_hash || calculateStrategyHash(sourceCode, parameters)
// Движок — единственный источник хешей. Отсутствие хеша при valid=true —
// это рассогласование контракта, а не повод посчитать свой и разойтись.
if (!validation.strategy_hash) {
    throw new Error('Strategy engine returned no strategy_hash for a valid strategy');
}
const strategyHash = validation.strategy_hash;
```

Сделать даты обязательными в `inputSchema` тула `trade_run_backtest` и обновить описание:

```typescript
description: "Execute a historical backtest of a Jesse strategy on real market data from the engine's candle store. Returns quantitative metrics (Net Return, Sharpe, Sortino, Calmar, Max Drawdown, Win Rate, Profit Factor, Payoff Ratio, trade counts), the equity curve, and deterministic StrategyHash/DatasetHash/RunHash. Metrics that cannot be computed are returned as null, never as 0. If historical data for the requested range is unavailable the call fails rather than returning a fabricated result.",
// ...
required: ["sourceCode", "startDate", "endDate"]
```

Заменить блок сохранения прогона на фактический дескриптор датасета:

```typescript
environment: {
    symbol: typeof args?.symbol === 'string' ? args.symbol : 'BTC-USDT',
    timeframe: typeof args?.timeframe === 'string' ? args.timeframe : '1h',
    startDate: args.startDate as string,
    endDate: args.endDate as string,
    feeRate: typeof args?.feeRate === 'number' ? args.feeRate : 0.0006,
    datasetHash: backtestRes.dataset_hash,
    warmupRows: backtestRes.dataset.warmup_rows,
    tradingRows: backtestRes.dataset.trading_rows,
},
metrics: {
    netProfitPercent: backtestRes.metrics.net_return_percent,
    sharpeRatio: backtestRes.metrics.sharpe,
    sortinoRatio: backtestRes.metrics.sortino,
    calmarRatio: backtestRes.metrics.calmar,
    maxDrawdownPercent: backtestRes.metrics.max_drawdown_percent,
    winRate: backtestRes.metrics.win_rate,
    profitFactor: backtestRes.metrics.profit_factor,
    payoffRatio: backtestRes.metrics.payoff_ratio,
    totalTrades: backtestRes.metrics.total_trades,
},
```

Соответственно в `StrategyRunMetrics` (файл `strategyRegistry.ts`) поля метрик становятся `number | null`, и добавляется `payoffRatio?: number | null`.

- [ ] **Step 5: Прогнать тесты TS**

```bash
cd "$(git rev-parse --show-toplevel)"
npm test -- src/server/strategyRegistry.test.ts src/server/mcpServerFactory.test.ts
npx tsc --noEmit
```

Expected: PASS, компиляция без ошибок.

- [ ] **Step 6: Финальная проверка целиком**

```bash
cd strategy-engine && uv run pytest tests/unit tests/contract tests/architecture -v && uv run lint-imports
cd .. && docker compose up -d --build && sleep 20
docker compose exec -e ENGINE_API_TOKEN="$STRATEGY_ENGINE_TOKEN" strategy_engine \
    uv run pytest /app/tests/integration -m integration -v
```

Expected: все зелёные, `lint-imports` подтверждает правило зависимостей.

- [ ] **Step 7: Коммит**

```bash
git add -A
git commit -m "refactor(engine): drop legacy package and move TS client to engine-owned hashes"
```

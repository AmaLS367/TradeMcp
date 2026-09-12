# Strategy Engine: чистая архитектура и изолированный рантайм

**Дата:** 2026-09-12
**Статус:** согласовано, готово к планированию реализации
**Область:** `strategy-engine/`, плюс точки стыка в `src/server/` на TS-стороне

---

## 1. Контекст

В `strategy-engine/` собран каркас Jesse-движка: FastAPI, AST-валидатор, вычисление хешей,
Pydantic-модели, отдельный контейнер. Каркас разложен правильно, но ревью выявило, что из семи
пунктов целевой архитектуры реализован один, а несущие механизмы сломаны. Ниже — только те
факты, которые воспроизведены прогоном кода, а не выведены чтением.

**Исполнение LLM-кода не изолировано.** `jesse_runner.py` делает `exec()` в процессе FastAPI.
AST-валидатор обходится через разрешённый модуль: `jesse.helpers` реэкспортирует `os`, атрибут
`os` не входит в список запрещённых. Проверено сквозным прогоном через настоящий
`validate_strategy_source` и настоящий `safe_builtins`:

```python
import jesse.helpers as jh
ESCAPE = jh.os.popen("whoami").read()
# AST VALIDATOR SAYS valid = True  errors = []
# ESCAPE RESULT: 'user\n'
# ENV KEYS LEAKED: 121
```

Тот же вектор открыт через `pandas` и `numpy`: `_safe_import` проверяет только корень имени, а
дальше доступно всё дерево зависимостей.

**Бэктесты идут на случайных данных и невоспроизводимы.** MCP-тул `trade_run_backtest` не
передаёт свечи вообще, срабатывает фолбэк `fake_range_candles(1000)`, генерирующий новый
случайный ряд на каждый вызов. Два идентичных запроса:

```
run_hash equal : True
net_return A/B : 42.540054 / 43.110240
REPRODUCIBLE   : False
```

Одинаковый `run_hash` при разных метриках — прямое опровержение обещания воспроизводимости.
`start_date`/`end_date` при этом не участвуют ни в чём, кроме вычисления хеша: свечи по ним не
режутся.

**Параметры стратегии не применяются.** `hasattr(strategy_class, "hp")` ложно: в Jesse
`self.hp: dict = {}` объявлен внутри `Strategy.__init__`, это атрибут экземпляра. Параметры
попадают в `strategy_hash` и меняют его, но на результат не влияют — любая оптимизация была бы
шумом.

**Хеши расходятся между TS и Python.** `json.dumps(sort_keys=True)` даёт `{"a": 1, "b": 2}`,
`JSON.stringify(params, keys.sort())` — `{"a":1,"b":2}`. Для одного входа:
`ebf6d1fef7539cd29cb8` против `f96aee6fe0b4326533cc`. На пустых параметрах совпадает, поэтому
не всплывало.

**`equity_curve` всегда пуст.** Jesse отдаёт `[{name, color, data: [{time, value, color}]}]`,
парсер ждёт `[timestamp, equity]` и отбрасывает всё через `isinstance(point, (list, tuple))`.

**Прочее.** Синхронный CPU-bound бэктест вызывается прямо в `async def` и блокирует event loop;
таймаута нет ни на сервере, ни в контейнере. `profit_factor` смаплен на `ratio_avg_win_loss`
(это payoff ratio). `_sanitize_float` превращает NaN в `0.0`, делая «не посчиталось»
неотличимым от «ноль». `required_methods = {"should_long", "go_long"}` отвергает валидные
short-only стратегии. На движке нет аутентификации, CORS — `allow_origins=["*"]` вместе с
`allow_credentials=True`.

---

## 2. Цели и не-цели

### Цели этой фазы

1. Чистая архитектура в `strategy-engine/` с исполняемым правилом зависимостей.
2. Переименование `src/strategy_engine/` → `src/engine/`.
3. Реальные данные: Postgres + Redis по нативному пути Jesse, датасеты адресуются хешем.
4. Изоляция исполнения: отдельный контейнер без сети, свежий процесс на прогон, таймаут.
5. Честная модель хеширования, единственный источник истины — Python.
6. Починка блокеров: параметры, `equity_curve`, метрики, NaN, short-only, event loop, периметр.

### Явные не-цели этой фазы

Микроструктурный симулятор исполнения (п.2 целевой архитектуры), пайплайн Train/Validation/OOS
с блокировкой (п.6), high-level MCP-тулы (п.7), PaperAdapter и LiveAdapter (п.1). Они описаны
в разделе 14 и опираются на фундамент, закладываемый здесь.

---

## 3. Целевая архитектура

### 3.1 Топология процессов

```
                    TradeMCP (Node/TS)
                            │ HTTP + STRATEGY_ENGINE_TOKEN
                            ▼
        ┌─────────────────────────────────────────┐
        │  strategy_engine (оркестратор)          │
        │  FastAPI · cwd = jesse_project/         │──── Postgres (свечи)
        │  Jesse в режиме проекта, БД доступна    │──── Redis (требует Jesse)
        └─────────────────────────────────────────┘
                            │ Unix domain socket (общий volume)
                            ▼
        ┌─────────────────────────────────────────┐
        │  strategy_runner                        │
        │  network_mode: none · read_only         │
        │  cwd вне Jesse-проекта → БД недоступна  │
        │  subprocess на каждый прогон + rlimits  │
        └─────────────────────────────────────────┘
```

Оркестратор — единственный, кто видит Postgres и креды. Раннер получает готовые numpy-массивы
свечей и не нуждается ни в БД, ни в сети, ни в `.env`.

**Почему Unix-сокет, а не эфемерные контейнеры.** Вариант «`docker run --rm --network none` на
прогон» буквально повторяет п.5 целевой архитектуры, но требует смонтировать
`/var/run/docker.sock`, что даёт root на хосте — риск больше закрываемого. Вариант «отдельная
сеть `internal: true`» оставляет боковое перемещение: раннер видит оркестратор. Unix-сокет на
общем volume даёт ту же сетевую изоляцию, что и `--network none` (интерфейсов нет вообще), без
доступа к docker-сокету. Свежесть состояния обеспечивается новым subprocess на каждый прогон.
Переход к эфемерным контейнерам позже — замена одной реализации порта `StrategyRunner`.

### 3.2 Слои и правило зависимостей

```
domain ← usecases ← adapters ← entrypoints
```

Два ограничения делают это не декорацией:

- **`import jesse` разрешён только в `adapters/` и `entrypoints/runner/`.** `domain` и
  `usecases` не знают ни про Jesse, ни про Postgres, ни про FastAPI, поэтому тестируются без
  контейнеров.
- **Pydantic живёт только на границе API** (`entrypoints/api/schemas/`). В `domain` — обычные
  dataclasses.

Правило проверяется `import-linter` в CI: контракт `layered` для слоёв плюс контракт
`independence` между предметными модулями `strategy` / `dataset` / `backtest`, которым разрешено
тянуть только `shared`. Единственное исключение — `domain/backtest/hashing.py`, композирующий
`strategy_hash` и `dataset_hash`; оно прописано в конфиге явно.

### 3.3 Карта модулей

```
strategy-engine/
├── docker/
│   ├── orchestrator.Dockerfile
│   ├── runner.Dockerfile
│   └── render-jesse-env.sh      # материализует .env для Jesse из переменных окружения
├── jesse_project/               # cwd оркестратора: strategies/ + storage/ + .env
├── src/engine/
│   ├── domain/                  # только stdlib, ноль внешних зависимостей
│   │   ├── shared/{errors,ids,hashing}.py        # hashing: canonical_json, sha256_of
│   │   ├── strategy/{models,source_policy,hashing}.py
│   │   ├── dataset/{models,hashing}.py
│   │   ├── backtest/{models,metrics,hashing}.py
│   │   └── runtime/{contracts,order_intent}.py   # единый рантайм: провод и OrderIntent
│   ├── usecases/
│   │   ├── ports/{candles,runner}.py             # typing.Protocol
│   │   ├── strategy/validate_strategy.py
│   │   ├── dataset/ensure_dataset.py
│   │   └── backtest/run_backtest.py
│   ├── adapters/
│   │   ├── jesse/{candles,backtest,bootstrap}.py
│   │   └── sandbox/{uds_runner,fake_runner}.py
│   ├── entrypoints/
│   │   ├── api/{main,deps,errors}.py + routers/ + schemas/
│   │   └── runner/{server,worker}.py
│   └── settings.py
└── tests/{unit,contract,integration}
```

`domain/runtime/` — это п.1 целевой архитектуры в зачаточной форме: `RunnerJob`/`RunnerResult`
и `StrategyOrderIntent` лежат рядом, и когда появится PaperAdapter, он расширит `RuntimeMode`,
а не создаст параллельную иерархию. Раннер импортирует ровно `engine.domain.runtime` и
`engine.domain.backtest`, поэтому все `__init__.py` остаются пустыми, без реэкспортов — иначе в
изолированный процесс утянутся psycopg и ccxt.

Порты описываются через `typing.Protocol`, а не ABC: адаптерам не нужно наследоваться от ядра,
зависимость остаётся структурной.

Реестр прогонов (`RunStore`) в эту фазу не входит — прогоны уже пишутся в Firestore на
TS-стороне. Собственный реестр понадобится на фазе OOS-локов, когда движку придётся знать, какие
диапазоны уже были затронуты.

---

## 4. Интеграция с Jesse: три ограничения

Обнаружены чтением исходников Jesse и определяют форму развёртывания.

1. **`is_jesse_project()` — это `'strategies' in os.listdir('.') and 'storage' in os.listdir('.')`.**
   Режим работы Jesse задаётся рабочей директорией процесса. Отсюда бесплатно получается
   разделение: оркестратор стартует из `jesse_project/` и имеет БД, раннер стартует вне её,
   `is_jesse_project()` ложно, соединение с БД не открывается.

2. **`jesse.services.env` читает `.env` файл на импорте, а не переменные окружения.**
   Используется `dotenv_values(env_path)`. Если файл отсутствует или пуст — `os._exit(1)`. Если
   в нём нет ключа `PASSWORD` — падение. Значит прокинуть `POSTGRES_HOST` через docker env
   недостаточно: entrypoint оркестратора обязан отрендерить `.env` из переменных окружения перед
   стартом uvicorn. Это делает `docker/render-jesse-env.sh`.

3. **`research.get_candles(...)` возвращает кортеж `(warmup, trading)`.** Это закрывает текущий
   `warm_up_candles: 0`, из-за которого индикаторы на старте считались на неполной истории.

---

## 5. Данные и датасеты

`ensure_dataset` проверяет наличие 1m-свечей за запрошенный диапазон в Postgres. При нехватке
вызывает `jesse.research.import_candles`. Если данных по-прежнему нет — `DatasetUnavailable`,
никакого молчаливого фолбэка. **`fake_range_candles` удаляется из продуктового пути целиком** и
остаётся только в тестах.

Датасет адресуется `DatasetRef`: биржа, символ, таймфрейм, границы диапазона, количество
warmup-свечей и `dataset_hash`. Один и тот же датасет переиспользуется между прогонами, что на
следующей фазе даёт корректные Train/Validation/OOS срезы поверх общего снепшота.

---

## 6. Модель хеширования

```
strategy_hash = sha256(canonical(normalized_source, parameters))
dataset_hash  = sha256(canonical({exchange, symbol, timeframe, start_ts, finish_ts,
                                  warmup_rows, trading_rows, columns, dtype})
                       + warmup.tobytes() + trading.tobytes())
run_hash      = sha256(canonical({
                  strategy_hash, dataset_hash,
                  engine_version, jesse_version,
                  exchange, symbol, timeframe, start, finish, warmup_candles,
                  initial_balance, fee_rate, fee_model, slippage_model,
                  leverage, market_type }))
```

**Нормализация исходника меняется.** Сейчас выбрасываются пустые строки, из-за чего две
стратегии, различающиеся пустой строкой внутри docstring или многострочного литерала, получают
одинаковый хеш при разном поведении. Новая нормализация: только `\r\n → \n` и обрезка хвостовых
пробелов в конце файла. Для системы, обещающей воспроизводимость, косметическая
нечувствительность — это коллизия, а не удобство.

**`dataset_hash` считается по байтам массива**, а не по `candles_count`. Два разных датасета
одинаковой длины больше не коллидируют.

**`engine_version`** — версия пакета плюс `GIT_SHA`, вшитый на сборке образа; `jesse_version`
берётся через `importlib.metadata`. Это закрывает требование `engineVersion` из целевой модели.

**`fee_model` и `slippage_model`** пока константы-заглушки `"jesse_default"`, но уже входят в
хеш. Появление настоящего fill model на следующей фазе автоматически инвалидирует старые
прогоны, а не смешает их с новыми молча.

**TS-сторона свои хеши больше не считает.** `calculateStrategyHash` и `calculateRunHash`
удаляются, движок остаётся единственным источником. Расхождение из раздела 1 исчезает по
конструкции, а не правкой сериализации в двух местах.

---

## 7. Контракт раннера и изоляция

**Протокол.** Кадрированный бинарный формат, одинаковый на обоих хопах (оркестратор → server по
UDS, server → worker по stdin/stdout): `[8 байт длины][JSON-заголовок][блоки свечей в .npy]`.
Свечи не едут в JSON: полмиллиона баров — это около 24 МБ в float64, в JSON вышло бы под сотню
с потерей точности на сериализации.

```
RunnerJob    = job_id, mode, source_code, strategy_class_name, parameters,
               config, warmup_candles, trading_candles
RunnerResult = status ∈ {ok, invalid_strategy, timeout, runtime_error, memory_exceeded},
               metrics, equity_curve, error{type, message, traceback_tail}
```

**Изоляция.** Контейнер раннера: `network_mode: none`, `read_only: true`,
`tmpfs: /tmp:size=64m`, `mem_limit: 512m`, `pids_limit: 64`, `cap_drop: [ALL]`,
`security_opt: [no-new-privileges]`, `user: 10001:10001`. Воркер запускается на каждый прогон
заново, в собственной process group, с `RLIMIT_AS`, `RLIMIT_CPU`, `RLIMIT_NPROC` и
`RLIMIT_FSIZE=0`; по таймауту — `SIGKILL` по всей группе. `stdout` занят протоколом, поэтому
вывод стратегии уходит в `stderr`.

**AST-валидатор — это фильтр качества и первая линия, но не граница безопасности.** Граница —
контейнер без сети с урезанными правами. Формулировка зафиксирована здесь намеренно: иначе
следующий человек снова начнёт дополнять список запрещённых атрибутов, считая это защитой.
Валидатор при этом остаётся полезен — он даёт агенту внятную обратную связь до запуска.

**Правки самого валидатора.** `required_methods` перестаёт требовать пару `should_long`/`go_long`
и принимает любую валидную комбинацию: long-only, short-only или обе. Детектируются и
`ast.AsyncFunctionDef`. При нескольких классах-наследниках `Strategy` возвращается ошибка вместо
молчаливого выбора последнего. Мёртвые записи `"np"` и `"pd"` из `ALLOWED_ROOT_MODULES`
убираются: проверяется `alias.name`, а не `asname`.

---

## 8. API движка

```
GET  /health
POST /api/v1/strategy/validate   → SourceValidation + strategy_hash
POST /api/v1/backtest            → metrics, equity_curve, strategy_hash, dataset_hash, run_hash
```

Формат ответа бэктеста расширяется `dataset_hash` — без него `run_hash` невозможно перепроверить
независимо.

---

## 9. Метрики и equity curve

Поля становятся `float | None`: NaN и inf отображаются в `None`, а не в `0.0`. «Sharpe не
определён» перестаёт выглядеть как «Sharpe равен нулю» — для агента, принимающего решения по
числам, это разные утверждения.

`profit_factor` считается как `gross_profit / abs(gross_loss)`: Jesse отдаёт оба поля в
метриках, пересчёт из сделок не нужен. `ratio_avg_win_loss` отдаётся отдельным полем
`payoff_ratio` под своим настоящим именем.

Полный набор ключей Jesse включает также `expectancy`, `omega_ratio`, `serenity_index`,
`max_underwater_period`, `total_winning_trades`, `total_losing_trades`, `longs_count`,
`shorts_count`. Маппинг ключей Jesse на наши метрики фиксируется характеризационным тестом,
чтобы апгрейд Jesse не переименовал что-нибудь молча.

`equity_curve` парсится по фактической форме: берётся серия `Portfolio` из
`[{name, data: [{time, value}]}]`, поле `time` приходит в секундах и переводится в миллисекунды.

---

## 10. Обработка ошибок

Один обработчик в `entrypoints/api/errors.py` отображает доменные ошибки в HTTP:

| Ошибка | Код |
|---|---|
| `SourceValidationError` | 422 |
| `DatasetUnavailable` | 409 |
| `RunnerTimeout` | 504 |
| `RunnerCrashed` | 502 |
| прочее | 500 с `request_id`, без трейсбека наружу |

---

## 11. Периметр и конкурентность

CORS по умолчанию пустой: движок не браузерный, текущая пара `allow_origins=["*"]` плюс
`allow_credentials=True` вдобавок невалидна по спецификации. Добавляется общий секрет
`STRATEGY_ENGINE_TOKEN` в заголовке — сейчас любой контейнер в сети `amaexecutioncore_default`
может отправить туда код на исполнение.

Очереди (Redis / BullMQ / Celery) в этой фазе не будет: семафор на `max_concurrent_runs` плюс
таймаут покрывают текущую нагрузку. Redis поднимается, потому что его требует Jesse, но как
брокер задач не используется. Полноценная очередь появится, когда пойдут оптимизации на сотни
прогонов.

---

## 12. Изменения на TS-стороне

- `strategyEngineClient.ts` — новые поля ответа (`dataset_hash`, `payoff_ratio`, nullable-метрики),
  проброс токена, осмысленные таймауты под длинные бэктесты.
- `strategyRegistry.ts` — `calculateStrategyHash` и `calculateRunHash` удаляются; хеши берутся из
  ответа движка. `StrategyOrderIntent` остаётся как контракт для будущего PaperAdapter.
- `mcpServerFactory.ts` — `trade_run_backtest` перестаёт хардкодить `candlesCount: 1000` и
  сохраняет фактический дескриптор датасета; ошибки движка транслируются в понятный агенту текст.

---

## 13. Стратегия тестирования

Работаем по TDD. Тесты воспроизводимости и изоляции пишутся до кода: они формулируют, ради чего
делается вся перестройка.

**unit** — `domain` и `usecases` на фейковых портах, без Postgres и Jesse. Детерминизм хешей,
чувствительность нормализации к значимым различиям исходника, AST-политика (включая short-only и
`AsyncFunctionDef`), отображение NaN в `None`.

**contract** — round-trip `RunnerJob`/`RunnerResult`, кадрирование протокола, соответствие
`fake_runner` и `uds_runner` одному `Protocol`.

**integration** (отдельный маркер, реальные Postgres и Jesse) — три ключевых:

1. **Воспроизводимость.** Два прогона на одном датасете дают побайтово равные метрики при равном
   `run_hash`. Прямая регрессия на дефект из раздела 1.
2. **Таймаут.** Стратегия с `while True` завершается кодом 504, сервис остаётся жив и
   обслуживает следующий запрос.
3. **Изоляция.** Стратегия, пытающаяся выполнить `jesse.helpers.os.popen`, не получает ни сети,
   ни доступа к хосту. Прямая регрессия на воспроизведённую дыру.

---

## 14. Дальнейшие фазы

Фундамент этой спеки специально оставляет швы под оставшиеся пункты целевой архитектуры.

**Фаза 2 — Fill model (п.2).** Микроструктурный симулятор исполнения: спред и глубина стакана,
задержка отправки ордера, динамическое проскальзывание, `cross` вместо `touch` для лимиток,
частичные исполнения, биржевые фильтры (`tickSize`, `stepSize`, `minNotional`) из CCXT
`market.precision`/`market.limits`, funding rate для бессрочных. Встраивается как замена
заглушек `fee_model` и `slippage_model`, уже присутствующих в `run_hash`.

**Фаза 3 — Пайплайн валидации (п.6).** Train/Validation/OOS поверх общего снепшота датасета,
блокировка OOS на уровне tool policy, значимость и Monte Carlo через готовые
`jesse.research.rule_significance_testing` и `jesse.research.monte_carlo`. Здесь же появляется
собственный реестр прогонов, вынесенный за рамки фазы 1.

**Фаза 4 — Paper/Live адаптеры (п.1) и high-level тулы (п.7).** `RuntimeMode` расширяется,
`StrategyOrderIntent` начинает реально производиться раннером и потребляться RiskEngine через
proposal gate. Появляются `trade_research_strategy`, `trade_validate_strategy`,
`trade_compare_strategies`.

---

## 15. Риски

**Jesse может открывать соединение с БД в неожиданных местах.** Раннер рассчитан на работу вне
Jesse-проекта, где `is_jesse_project()` ложно. Если какой-то путь внутри `research.backtest`
всё же дёрнет БД или Redis, это вскроется на первом же интеграционном тесте; запасной вариант —
поднять для раннера отдельный SQLite-стаб или замокать `jesse.services.db`.

**UDS на Windows.** Локальная разработка вне Docker потребует TCP-фолбэка; транспорт выбирается
настройкой `RUNNER_TRANSPORT` (`uds` в compose, `tcp` для dev).

**Объём данных на UDS.** Длинные диапазоны на 1m-таймфрейме дают десятки мегабайт на прогон.
Кадрированный бинарный протокол это выдерживает, но если окажется узким местом — следующий шаг
не оптимизация сериализации, а передача датасета через shared memory или read-only volume.

**`import_candles` идёт в биржу и может быть медленным.** Первый прогон по новому символу
займёт минуты. Поэтому `ensure_dataset` — отдельный юзкейс: позже он выносится в явный тул
подготовки данных, чтобы агент не упирался в таймаут бэктеста.

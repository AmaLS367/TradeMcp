import pytest

from engine.adapters.jesse.bootstrap import REQUIRED_ENV_KEYS, assert_jesse_project


def _make_project(tmp_path, *, omitted_key: str | None = None) -> None:
    (tmp_path / "strategies").mkdir()
    (tmp_path / "storage").mkdir()
    values = [f"{key}=value" for key in REQUIRED_ENV_KEYS if key != omitted_key]
    (tmp_path / ".env").write_text("\n".join(values), encoding="utf-8")


def test_valid_jesse_project_passes(tmp_path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("JESSE_ENV_FILE", raising=False)
    _make_project(tmp_path)

    assert_jesse_project(tmp_path)


def test_missing_database_password_fails_fast(
    tmp_path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.delenv("JESSE_ENV_FILE", raising=False)
    _make_project(tmp_path, omitted_key="POSTGRES_PASSWORD")

    with pytest.raises(RuntimeError, match="POSTGRES_PASSWORD"):
        assert_jesse_project(tmp_path)

import pytest

from conftest import load_plugin_module
from fake_plugin_context import FakePluginContext

_ENV_KEYS = ("AI_BASE_URL", "AI_API_KEY", "WHISPER_MODEL")


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    """FakePluginContext falls back to os.environ; keep ambient values out
    so "nothing set" really means nothing set, in container and CI alike."""
    for key in _ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def _api(env: dict):
    mod = load_plugin_module()
    return mod.SttApi(lambda vn: [], FakePluginContext(env=env))


def test_settings_read_ai_vars():
    api = _api({"AI_BASE_URL": "https://ai.example/v1/", "AI_API_KEY": "sk-ai", "WHISPER_MODEL": "whisper-tiny"})
    assert api._settings() == ("https://ai.example/v1/", "sk-ai", "whisper-tiny")


def test_settings_defaults_when_nothing_set():
    api = _api({})
    assert api._settings() == ("https://llm.ai.e-infra.cz/v1/", "", "whisper-large-v3")

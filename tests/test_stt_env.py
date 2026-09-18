import pytest
from openai import OpenAI

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


def _api_with_config(env: dict, config: dict):
    fake = _FakeClient()
    host = _HostLLM(fake)
    mod = load_plugin_module()
    ctx = FakePluginContext(env=env, config=config, llm_client=host)
    return mod.SttApi(lambda vn: [], ctx), fake


def test_settings_read_ai_vars():
    api = _api({"AI_BASE_URL": "https://ai.example/v1/", "AI_API_KEY": "sk-ai", "WHISPER_MODEL": "whisper-tiny"})
    assert api._settings() == ("https://ai.example/v1/", "sk-ai", "whisper-tiny")


def test_settings_defaults_when_nothing_set():
    api = _api({})
    assert api._settings() == ("https://llm.ai.e-infra.cz/v1/", "", "whisper-large-v3")


class _FakeTranscript:
    text = "hello world"
    language = "en"
    duration = 1.0
    segments = []


class _FakeTranscriptions:
    def __init__(self, client):
        self._client = client

    def create(self, **kwargs):
        self._client.last_kwargs = kwargs
        return _FakeTranscript()


class _FakeAudio:
    def __init__(self, client):
        self.transcriptions = _FakeTranscriptions(client)


class _FakeClient:
    def __init__(self):
        self.last_kwargs = None
        self.audio = _FakeAudio(self)


class _HostLLM:
    def __init__(self, client):
        self._client = client
        self.calls = 0

    def get_client(self):
        self.calls += 1
        return self._client


def test_client_prefers_host_llm_client():
    fake = _FakeClient()
    host = _HostLLM(fake)
    mod = load_plugin_module()
    api = mod.SttApi(lambda vn: [], FakePluginContext(env={}, llm_client=host))
    assert api._client() is fake
    assert host.calls == 1


def test_client_falls_back_to_env_built_client():
    mod = load_plugin_module()
    api = mod.SttApi(lambda vn: [], FakePluginContext(env={"AI_BASE_URL": "https://ai.example/v1/", "AI_API_KEY": "sk-ai"}))
    assert isinstance(api._client(), OpenAI)


def test_transcribe_uses_host_client():
    fake = _FakeClient()
    host = _HostLLM(fake)
    mod = load_plugin_module()
    api = mod.SttApi(lambda vn: [], FakePluginContext(env={}, llm_client=host))
    result = api.transcribe("main", b"abc", "clip.webm")
    assert result["text"] == "hello world"
    assert fake.last_kwargs["model"] == "whisper-large-v3"
    assert fake.last_kwargs["file"].name == "clip.webm"


def test_settings_prefer_configured_model_over_env():
    api, _ = _api_with_config({"WHISPER_MODEL": "env-model"}, {"model": "cfg-model"})
    assert api._settings()[2] == "cfg-model"


def test_settings_env_model_when_nothing_configured():
    api, _ = _api_with_config({"WHISPER_MODEL": "env-model"}, {})
    assert api._settings()[2] == "env-model"


def test_transcribe_uses_configured_model():
    api, fake = _api_with_config({"WHISPER_MODEL": "env-model"}, {"model": "cfg-model"})
    result = api.transcribe("main", b"abc", "clip.webm")
    assert result["text"] == "hello world"
    assert fake.last_kwargs["model"] == "cfg-model"


def test_transcribe_uses_stored_settings_model():
    fake = _FakeClient()
    host = _HostLLM(fake)
    mod = load_plugin_module()
    ctx = FakePluginContext(env={"WHISPER_MODEL": "env-model"}, llm_client=host)
    ctx.store.set("settings", {"model": "stored-model"})
    api = mod.SttApi(lambda vn: [], ctx)
    api.transcribe("main", b"abc", "clip.webm")
    assert fake.last_kwargs["model"] == "stored-model"

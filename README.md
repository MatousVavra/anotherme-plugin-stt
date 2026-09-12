# anotherme-plugin-stt

Speech-to-text via Whisper for
[AnotherMe](https://github.com/MatousVavra/AnotherMe), through an
OpenAI-compatible `/v1/audio/transcriptions` provider.

Extracted from the AnotherMe host repository at commit 9a6ef26 — prior
history lives there.

## Configuration

| Env var | Default | Purpose |
|---|---|---|
| `AI_BASE_URL` | `https://llm.ai.e-infra.cz/v1/` | Provider base URL |
| `AI_API_KEY` | — | Provider API key |
| `WHISPER_MODEL` | `whisper-large-v3` | STT model name |

The model is also configurable per-install via the plugin settings UI.

## Development

Unit tests run standalone against `FakePluginContext`:

    pip install fastapi pydantic httpx pyyaml pytest pytest-asyncio openai python-multipart
    pytest tests/ --ignore=tests/integration

Integration tests run inside the released app image (see
`.github/workflows/test.yml`). To develop against a live app, point
`COMMUNITY_PLUGINS_DIR` at this checkout's parent directory.

## Releases

Tag `vX.Y.Z` (must match `plugin/plugin.yaml` `version`), then bump the tag
in the [community index](https://github.com/MatousVavra/anotherme-plugins).

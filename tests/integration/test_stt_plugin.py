"""STT plugin integration tests (moved from the AnotherMe host repo,
tests/test_plugins/test_stt_chat_plugin.py)."""
import asyncio
import json
import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

@pytest.fixture
def client(make_client):
    return make_client()


def _get_api(name):
    import src.main
    return src.main.plugin_manager.get_registry().get_api(name)


def _get_stt_api():
    return _get_api("stt")


# ===========================================================================
# STT plugin tests
# ===========================================================================

# --- 1. Plugin listed ---

def test_stt_plugin_listed(client):
    names = {p["name"] for p in client.get("/plugins").json()}
    assert "stt" in names


# --- 2. Transcribe (mocked) ---

def test_stt_transcribe(client):
    fake_result = {
        "text": "Hello world",
        "original_text": "Hello world",
        "name_corrections": [],
        "language": "en",
        "duration": 2.5,
        "segments": [{"start": 0.0, "end": 2.5, "text": "Hello world"}],
    }
    with patch.object(_get_stt_api(), "transcribe", return_value=fake_result):
        resp = client.post(
            "/plugins/stt/transcribe",
            files={"file": ("recording.wav", b"fake-audio", "audio/wav")},
        )
    assert resp.status_code == 200
    data = resp.json()
    assert data["text"] == "Hello world"
    assert data["original_text"] == "Hello world"


# --- 3. Validation ---

def test_stt_transcribe_validation(client):
    # Non-audio content type
    resp = client.post(
        "/plugins/stt/transcribe",
        files={"file": ("test.txt", b"hello", "text/plain")},
    )
    assert resp.status_code == 400

    # Empty file
    resp = client.post(
        "/plugins/stt/transcribe",
        files={"file": ("test.wav", b"", "audio/wav")},
    )
    assert resp.status_code == 400


# --- 4. API registered ---

def test_stt_api_registered(client):
    api = _get_api("stt")
    assert api is not None
    assert hasattr(api, "transcribe")

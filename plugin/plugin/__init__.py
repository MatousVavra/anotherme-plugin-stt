import asyncio
import importlib.util
import io
from pathlib import Path

from openai import OpenAI
from fastapi import APIRouter, HTTPException, UploadFile


def _load_sibling(name: str):
    """Load a helper module shipped next to this entrypoint.

    The plugin loader uses file-location specs without sys.modules
    registration, so relative imports do not work; siblings are loaded
    explicitly (fresh per plugin reload — hot-reload safe).
    """
    path = Path(__file__).resolve().parent / f"{name}.py"
    spec = importlib.util.spec_from_file_location(f"stt_plugin.{name}", path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


stt_names = _load_sibling("stt_names")
build_name_prompt = stt_names.build_name_prompt
correct_names = stt_names.correct_names


class SttApi:
    """Sync API — callers must wrap in asyncio.to_thread()."""

    def __init__(self, memory_getter, ctx):
        self._memory_getter = memory_getter
        self._ctx = ctx

    def _settings(self) -> tuple[str, str, str]:
        base_url = self._ctx.get_env("AI_BASE_URL") or "https://llm.ai.e-infra.cz/v1/"
        api_key = self._ctx.get_env("AI_API_KEY") or ""
        model = self._ctx.get_env("WHISPER_MODEL") or "whisper-large-v3"
        return base_url, api_key, model

    def transcribe(self, vault_name, audio_bytes, filename):
        people = self._memory_getter(vault_name)
        base_url, api_key, model = self._settings()
        client = OpenAI(base_url=base_url, api_key=api_key)
        buf = io.BytesIO(audio_bytes)
        buf.name = filename
        prompt = build_name_prompt(people or [])
        kwargs = {"model": model, "file": buf, "response_format": "verbose_json"}
        if prompt:
            kwargs["prompt"] = prompt
        transcript = client.audio.transcriptions.create(**kwargs)
        text = transcript.text
        corrected, replacements = correct_names(text, people or [])
        return {
            "text": corrected,
            "original_text": text,
            "name_corrections": replacements,
            "language": getattr(transcript, "language", None),
            "duration": getattr(transcript, "duration", None),
            "segments": [
                {"start": s.start, "end": s.end, "text": s.text}
                for s in (getattr(transcript, "segments", None) or [])
            ],
        }


class Plugin:
    def on_load(self, ctx):
        def memory_get_people(vault_name):
            api = ctx.get_plugin_api("memory")
            return api.get_people(vault_name) if api else []

        stt_api = SttApi(memory_get_people, ctx)

        router = APIRouter()

        @router.post("/transcribe")
        async def transcribe(file: UploadFile):
            if not file.filename or not file.content_type or not file.content_type.startswith("audio/"):
                raise HTTPException(400, "Upload must be an audio file")
            audio_bytes = await file.read()
            if len(audio_bytes) == 0:
                raise HTTPException(400, "Empty audio file")
            return await asyncio.to_thread(
                stt_api.transcribe,
                ctx.vault_name,
                audio_bytes,
                file.filename,
            )

        ctx.register_router(router)
        ctx.register_api("stt", stt_api)

#!/usr/bin/env python3
"""ElevenLabs text-to-speech for Evee — her spoken voice.

Standalone and stdlib-only (same shape as inventory_service). serve.py drives it
in two steps -- POST /api/tts registers the text and hands back a URL, GET
/api/tts/{id} opens this stream and forwards the bytes as they arrive -- so the
key never reaches the client and the page can start playing on the first chunk
instead of waiting for the whole file. That wait was the only latency left worth
removing: Evee answers in one sentence, so there is no second sentence to
overlap and streaming her *text* would save nothing.

Config (read from the environment at call time; serve.py loads .env first):

    ELEVENLABS_API_KEY    required — from the ElevenLabs dashboard (sk_...)
    ELEVENLABS_VOICE_ID   required — the voice's id ("Copy Voice ID" in the app)
    ELEVENLABS_MODEL      optional — default eleven_flash_v2_5 (lowest latency)

When the key/voice aren't set, synthesize() raises a TTSError the server
forwards as a non-2xx; the client then just shows the caption and Evee stays
silent — there is deliberately no browser-voice fallback.
"""

import json
import os
import re
import urllib.error
import urllib.request

ELEVEN_API = "https://api.elevenlabs.io/v1"
DEFAULT_MODEL = "eleven_flash_v2_5"
# 44.1kHz / 128kbps mp3 — good quality and universally playable in browsers.
OUTPUT_FORMAT = "mp3_44100_128"
AUDIO_CONTENT_TYPE = "audio/mpeg"
# Evee's replies are short; cap one utterance so a runaway prompt can't burn
# credits.
MAX_CHARS = 1500

# Spoken-form fixes, applied to the TTS text only — the on-screen caption keeps
# the real spelling. ElevenLabs reads "Evee" as "eh-VEE" (the E of "elephant"),
# but it is meant to be "EE-vee". Respelling for the model is the fix that works
# on every model: <phoneme> tags are only honored by some of them, and a
# pronunciation dictionary needs a PLS file uploaded and referenced by id.
# Add a (pattern, replacement) pair here for any other word she mispronounces.
SPOKEN_AS = [
    (re.compile(r"\bEvee\b", re.IGNORECASE), "Eevee"),
]


def _respell(text):
    """Rewrite words ElevenLabs mispronounces. Affects audio only, never the caption."""
    for pattern, replacement in SPOKEN_AS:
        text = pattern.sub(replacement, text)
    return text


class TTSError(Exception):
    """Raised on a TTS failure or missing config. `status` is forwarded to the browser."""

    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


def is_configured():
    return bool(os.environ.get("ELEVENLABS_API_KEY") and os.environ.get("ELEVENLABS_VOICE_ID"))


def _error_detail(raw):
    """Pull a human message out of an ElevenLabs error body (shape varies)."""
    try:
        detail = json.loads(raw.decode("utf-8")).get("detail")
    except Exception:
        return ""
    if isinstance(detail, dict):
        return detail.get("message") or detail.get("status") or json.dumps(detail)
    if isinstance(detail, list):
        return "; ".join(str(d.get("msg", d)) if isinstance(d, dict) else str(d) for d in detail)
    return str(detail or "")


def _open(text):
    """Open ElevenLabs' streaming TTS response for `text`. Raises TTSError.

    Hits the /stream endpoint, which starts returning mp3 frames while the rest
    is still being synthesized, rather than the plain endpoint that only answers
    once the whole utterance exists.
    """
    text = (text or "").strip()
    if not text:
        raise TTSError("No text to speak", status=400)
    key = os.environ.get("ELEVENLABS_API_KEY")
    voice_id = os.environ.get("ELEVENLABS_VOICE_ID")
    if not key or not voice_id:
        raise TTSError("ElevenLabs is not configured", status=503)
    model = os.environ.get("ELEVENLABS_MODEL", DEFAULT_MODEL)

    url = "%s/text-to-speech/%s/stream?output_format=%s" % (ELEVEN_API, voice_id, OUTPUT_FORMAT)
    body = json.dumps({"text": _respell(text)[:MAX_CHARS], "model_id": model}).encode("utf-8")
    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("xi-api-key", key)
    req.add_header("Content-Type", "application/json")
    req.add_header("Accept", AUDIO_CONTENT_TYPE)
    try:
        return urllib.request.urlopen(req, timeout=30)
    except urllib.error.HTTPError as e:
        detail = _error_detail(e.read())
        # Forward client errors (bad key/voice) as-is; collapse server errors.
        status = e.code if 400 <= e.code < 500 else 502
        raise TTSError("ElevenLabs error %s: %s" % (e.code, detail or e.reason), status=status)
    except urllib.error.URLError as e:
        raise TTSError("Could not reach ElevenLabs: %s" % e.reason, status=502)


def open_stream(text):
    """Return (open_response, content_type). The caller reads it in chunks,
    forwards each one to the browser, and closes it."""
    resp = _open(text)
    return resp, resp.headers.get("Content-Type", AUDIO_CONTENT_TYPE)

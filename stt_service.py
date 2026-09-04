#!/usr/bin/env python3
"""ElevenLabs speech-to-text for Evee — her ears.

Standalone and stdlib-only (same shape as tts_service). serve.py exposes it at
POST /api/stt: the browser records with MediaRecorder and posts the raw audio
bytes, we forward them to ElevenLabs server-to-server so the API key never
reaches the client, and return the transcript.

Why not the browser's own Web Speech API (which this replaced): it never exposes
its MediaStream, so its microphone capture can't be released. On iOS that leaves
the audio session stuck in `playAndRecord`, which routes playback down the call
path — quiet, echo-cancelled, "phone speaker" sounding — and makes the mic
unreliable on the next tap. Owning the stream via MediaRecorder lets the client
call track.stop() and hand the session back. Web Speech is also Chrome-only
(webkit-prefixed) with no Firefox support at all.

Config (read from the environment at call time; serve.py loads .env first):

    ELEVENLABS_API_KEY    required — shared with tts_service (sk_...)
    ELEVENLABS_STT_MODEL  optional — default scribe_v1
    ELEVENLABS_STT_LANG   optional — default eng. Pin the spoken language;
                          "" re-enables Scribe's auto-detection

When the key isn't set, transcribe() raises an STTError the server forwards as a
non-2xx; the client then reports that voice input is unavailable and the user can
still type.
"""

import json
import os
import secrets
import urllib.error
import urllib.request

ELEVEN_API = "https://api.elevenlabs.io/v1"
DEFAULT_MODEL = "scribe_v1"
# Pin the language. Left unset, Scribe auto-detects per clip, and a short/quiet
# recording is enough for it to guess wrong and return confident gibberish in
# another language. Set ELEVENLABS_STT_LANG="" to opt back into detection.
DEFAULT_LANG = "eng"
# Guard against a runaway upload burning credits. A spoken command is a few
# seconds; 10 MB is far more headroom than that needs.
MAX_BYTES = 10 * 1024 * 1024
# Filename extension is a format hint for the API. MediaRecorder gives us
# audio/mp4 on Safari and audio/webm;codecs=opus on Chrome.
EXT_BY_TYPE = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "mp4",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/aac": "aac",
    "audio/flac": "flac",
}


class STTError(Exception):
    """Raised on a transcription failure or missing config. `status` is forwarded to the browser."""

    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


def is_configured():
    return bool(os.environ.get("ELEVENLABS_API_KEY"))


def _ext_for(content_type):
    base = (content_type or "").split(";")[0].strip().lower()
    return EXT_BY_TYPE.get(base, "webm")


def _multipart(fields, file_field, filename, file_type, data):
    """Build a multipart/form-data body. Returns (body_bytes, content_type_header)."""
    boundary = "----EveeSTT" + secrets.token_hex(16)
    crlf = b"\r\n"
    out = []
    for name, value in fields.items():
        out.append(b"--" + boundary.encode() + crlf)
        out.append(('Content-Disposition: form-data; name="%s"' % name).encode() + crlf + crlf)
        out.append(str(value).encode("utf-8") + crlf)
    out.append(b"--" + boundary.encode() + crlf)
    out.append(('Content-Disposition: form-data; name="%s"; filename="%s"'
                % (file_field, filename)).encode() + crlf)
    out.append(("Content-Type: %s" % file_type).encode() + crlf + crlf)
    out.append(data + crlf)
    out.append(b"--" + boundary.encode() + b"--" + crlf)
    return b"".join(out), "multipart/form-data; boundary=%s" % boundary


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


def transcribe(audio, content_type="audio/webm"):
    """Return the transcript string for `audio` bytes. Raises STTError on failure."""
    if not audio:
        raise STTError("No audio to transcribe", status=400)
    if len(audio) > MAX_BYTES:
        raise STTError("Audio too large (%d bytes)" % len(audio), status=413)
    key = os.environ.get("ELEVENLABS_API_KEY")
    if not key:
        raise STTError("ElevenLabs is not configured", status=503)
    model = os.environ.get("ELEVENLABS_STT_MODEL", DEFAULT_MODEL)

    fields = {"model_id": model}
    lang = os.environ.get("ELEVENLABS_STT_LANG", DEFAULT_LANG).strip()
    if lang:
        fields["language_code"] = lang
    body, ctype = _multipart(
        fields, "file",
        "speech.%s" % _ext_for(content_type), content_type or "audio/webm", audio)
    req = urllib.request.Request(ELEVEN_API + "/speech-to-text", data=body, method="POST")
    req.add_header("xi-api-key", key)
    req.add_header("Content-Type", ctype)
    req.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            return (json.loads(resp.read().decode("utf-8")).get("text") or "").strip()
    except urllib.error.HTTPError as e:
        detail = _error_detail(e.read())
        # Forward client errors (bad key, unsupported format) as-is; collapse server errors.
        status = e.code if 400 <= e.code < 500 else 502
        raise STTError("ElevenLabs error %s: %s" % (e.code, detail or e.reason), status=status)
    except urllib.error.URLError as e:
        raise STTError("Could not reach ElevenLabs: %s" % e.reason, status=502)

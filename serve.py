#!/usr/bin/env python3
# Dev server for Evee.
#
# 1. Serves the static app like `python3 -m http.server`, but sends
#    Cache-Control: no-store so the browser always re-fetches the hifi/*.jsx
#    files instead of running a stale cached copy after an edit.
# 2. Adds a thin /api/inventory backend that proxies to Notion (server-to-
#    server, so the browser never sees the Notion token and there is no CORS
#    problem). See inventory_service.py for the Notion mapping.
# 3. Adds /api/chat — the in-app AI assistant (Claude tool-use loop). See
#    chat_service.py.
# 4. Adds /api/tts and /api/stt — Evee's voice out and in (ElevenLabs, so the
#    key stays server-side). See tts_service.py / stt_service.py. Voice out is
#    two calls: POST /api/tts registers the text and returns a URL, GET
#    /api/tts/{id} streams the mp3 so playback starts on the first bytes.
# 5. Adds /api/livereload — an SSE stream the page listens to so an edit (or a
#    server restart) reloads every connected device on its own.
import glob
import http.server
import json
import os
import secrets
import sys
import time
import urllib.parse

import chat_service
import inventory_service
import plan_service
import stt_service
import tts_service
from chat_service import ChatError
from inventory_service import NotionError
from plan_service import PlanError
from stt_service import STTError
from tts_service import TTSError

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
HERE = os.path.dirname(os.path.abspath(__file__))


def load_dotenv():
    """Load KEY=VALUE pairs from a local .env into the environment.

    Keeps secrets (NOTION_TOKEN etc.) out of shell history. Existing env vars
    win, so you can still override per-invocation.
    """
    path = os.path.join(HERE, ".env")
    if not os.path.exists(path):
        return
    with open(path) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key:
                os.environ.setdefault(key, value)



# ── spoken replies ───────────────────────────────────────────────────────────
# POST /api/tts parks the text here and hands back a URL; the page points an
# <audio> at it and the GET streams the synthesis through. The indirection is
# what buys progressive playback: <audio> streams a URL but cannot POST, and we
# will not put the reply (which names the user's own things) in a query string.
# Entries are short-lived — a URL is fetched moments after it is issued.
TTS_JOBS = {}
TTS_JOB_TTL = 300.0


def _tts_job(text):
    """Register `text` for playback and return the URL that will speak it."""
    text = (text or "").strip()
    if not text:
        raise TTSError("No text to speak", status=400)
    # Fail here, while the client is still on a fetch it can catch — inside the
    # <audio> element the only signal is an opaque 'error' event.
    if not tts_service.is_configured():
        raise TTSError("ElevenLabs is not configured", status=503)
    now = time.time()
    for jid, job in list(TTS_JOBS.items()):
        if now - job["created"] > TTS_JOB_TTL:
            TTS_JOBS.pop(jid, None)
    jid = secrets.token_urlsafe(12)
    TTS_JOBS[jid] = {"text": text, "created": now}
    return "/api/tts/%s" % jid


# ── live reload ──────────────────────────────────────────────────────────────
# Changes to a BOOT_ID force every connected page to reload, which covers server
# restarts (a .py edit) as well as file edits. Watching mtimes is enough here —
# the tree is tiny and a 1s poll costs nothing next to a stat() per file.
BOOT_ID = secrets.token_hex(8)
WATCH_GLOBS = ("Evee.html", "hifi/*.jsx", "*.py")


def _watch_version():
    """Newest mtime across the app's own files — bumps whenever anything is edited."""
    newest = 0.0
    for pattern in WATCH_GLOBS:
        for path in glob.glob(os.path.join(HERE, pattern)):
            try:
                newest = max(newest, os.path.getmtime(path))
            except OSError:
                pass
    return round(newest, 3)


def _plan_rev():
    """Plan revision for the SSE payload, or 0 if the store is unreadable.

    Swallows errors on purpose — a missing home.json must not kill the live
    stream that every connected page depends on.
    """
    try:
        return plan_service.current_rev()
    except Exception:
        return 0


def _sse(obj):
    return ("data: %s\n\n" % json.dumps(obj)).encode("utf-8")


class EveeServer(http.server.ThreadingHTTPServer):
    """Threaded, with a listen backlog big enough for one page load.

    Loading Evee opens ~11 sockets at essentially the same instant — the HTML,
    the manifest, nine `text/babel` scripts Babel fetches by XHR, and the
    livereload stream — and every one has to be its *own* connection, because
    responses are HTTP/1.0 and so are never reused. The stdlib default backlog
    is 5. The rest overflow the accept queue, and macOS answers the overflow
    with an RST rather than queueing it: the browser is handed a dead socket,
    Babel silently ends up short a file or three, and a missing `app.jsx`
    renders as a blank page. It cost ~52% of loads (69 of 132 in server.log),
    which matches the reported 'every other time' exactly. 128 is the ceiling
    macOS will honour anyway (kern.ipc.somaxconn).
    """

    request_queue_size = 128

    def handle_error(self, request, client_address):
        # A page navigating away mid-request is routine, not a fault. These were
        # ~90% of the log, which is how a real problem stays invisible in it.
        exc = sys.exc_info()[1]
        if isinstance(exc, (BrokenPipeError, ConnectionResetError)):
            return
        super().handle_error(request, client_address)


class EveeHandler(http.server.SimpleHTTPRequestHandler):
    # ── static serving: no-store so edits always reload ──────────────────
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        self.send_header("Pragma", "no-cache")
        super().end_headers()

    # Python's default map has no .webmanifest, so it would be served as
    # application/octet-stream and silently ignored by the browser.
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
    }

    # ── helpers ──────────────────────────────────────────────────────────
    def _send_json(self, status, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_bytes(self, status, content_type, data):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        if not length:
            return {}
        return json.loads(self.rfile.read(length).decode("utf-8"))

    def _read_bytes(self):
        """Raw request body — used by /api/stt, which posts audio, not JSON."""
        length = int(self.headers.get("Content-Length", 0))
        return self.rfile.read(length) if length else b""

    def _stream_livereload(self):
        """Server-Sent Events: one message per change, plus a keepalive comment.

        Deliberately not a websocket — SSE is a plain HTTP/1.1 stream, so it needs
        no extra dependency and rides through the Tailscale HTTPS proxy unchanged,
        and EventSource reconnects on its own after a server restart.
        """
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        # Defeat any proxy that would otherwise buffer the stream into silence.
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()
        last = _watch_version()
        last_rev = _plan_rev()
        try:
            self.wfile.write(_sse({"boot": BOOT_ID, "v": last, "rev": last_rev}))
            self.wfile.flush()
            idle = 0
            while True:
                time.sleep(1)
                now = _watch_version()
                rev = _plan_rev()
                if now != last or rev != last_rev:
                    last, last_rev = now, rev
                    self.wfile.write(_sse({"boot": BOOT_ID, "v": last, "rev": last_rev}))
                    self.wfile.flush()
                    idle = 0
                    continue
                idle += 1
                if idle >= 20:          # keepalive so idle proxies don't hang up
                    self.wfile.write(b": ping\n\n")
                    self.wfile.flush()
                    idle = 0
        except (BrokenPipeError, ConnectionResetError):
            pass                        # page closed or navigated away

    def _stream_tts(self, job_id):
        """Forward one ElevenLabs synthesis to the <audio> element as it arrives.

        No Content-Length: the response ends when the connection closes, which is
        how this server already streams (protocol_version is HTTP/1.0, so every
        response closes). Same reason the livereload SSE stream works.
        """
        job = TTS_JOBS.get(job_id)
        if job is None:
            self._send_json(404, {"error": "that speech link has expired"})
            return
        if job.get("audio") is not None:
            # Safari re-requests a media URL fairly readily (and a replayed reply
            # would otherwise be billed twice). Serve the finished bytes, which
            # also gives that request a Content-Length.
            self._send_bytes(200, job["ctype"], job["audio"])
            return
        try:
            resp, ctype = tts_service.open_stream(job["text"])
        except TTSError as e:
            self._send_json(e.status, {"error": str(e)})
            return
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("X-Accel-Buffering", "no")   # no proxy buffering, same as SSE
        self.end_headers()
        buf = bytearray()
        try:
            with resp:
                while True:
                    chunk = resp.read(4096)
                    if not chunk:
                        break
                    buf += chunk
                    self.wfile.write(chunk)
                    self.wfile.flush()
        except (BrokenPipeError, ConnectionResetError):
            return                      # barge-in, or the page went away mid-reply
        job["audio"] = bytes(buf)
        job["ctype"] = ctype

    def _item_id(self, path):
        """Extract `{id}` from /api/inventory/{id}, or None for the collection."""
        parts = [p for p in path.split("/") if p]  # ['api', 'inventory', '{id}']
        return parts[2] if len(parts) >= 3 else None

    def _handle_api(self, method):
        """Route /api/* endpoints. Returns True if handled."""
        parsed = urllib.parse.urlparse(self.path)
        if not parsed.path.startswith("/api/"):
            return False

        try:
            if parsed.path == "/api/chat":
                if method != "POST":
                    self._send_json(405, {"error": "method not allowed"})
                    return True
                body = self._read_json()
                self._send_json(200, chat_service.handle(
                    body.get("messages", []), body.get("directory", {})))
                return True

            if parsed.path == "/api/tts":
                if method != "POST":
                    self._send_json(405, {"error": "method not allowed"})
                    return True
                self._send_json(200, {"url": _tts_job(self._read_json().get("text", ""))})
                return True

            if parsed.path.startswith("/api/tts/"):
                if method != "GET":
                    self._send_json(405, {"error": "method not allowed"})
                    return True
                self._stream_tts(parsed.path.rsplit("/", 1)[-1])
                return True

            if parsed.path == "/api/plan":
                if method == "GET":
                    self._send_json(200, plan_service.load())
                elif method == "PUT":
                    body = self._read_json()
                    self._send_json(200, plan_service.save(
                        body.get("plan"), body.get("rev")))
                else:
                    self._send_json(405, {"error": "method not allowed"})
                return True

            if parsed.path == "/api/livereload":
                if method != "GET":
                    self._send_json(405, {"error": "method not allowed"})
                    return True
                self._stream_livereload()
                return True

            if parsed.path == "/api/stt":
                if method != "POST":
                    self._send_json(405, {"error": "method not allowed"})
                    return True
                # The browser posts the recorded audio as the raw body; its
                # Content-Type tells us the container MediaRecorder produced
                # (audio/mp4 on Safari, audio/webm on Chrome).
                text = stt_service.transcribe(
                    self._read_bytes(), self.headers.get("Content-Type", ""))
                self._send_json(200, {"text": text})
                return True

            if parsed.path == "/api/inventory/relabel":
                if method != "POST":
                    self._send_json(405, {"error": "method not allowed"})
                    return True
                body = self._read_json()
                self._send_json(200, inventory_service.relabel_container(
                    body["containerId"], body.get("container", "")))
                return True

            if parsed.path == "/api/inventory/reassign":
                if method != "POST":
                    self._send_json(405, {"error": "method not allowed"})
                    return True
                body = self._read_json()
                self._send_json(200, inventory_service.reassign_container(
                    body["fromContainerId"], body))
                return True

            if parsed.path.startswith("/api/inventory"):
                item_id = self._item_id(parsed.path)
                if method == "GET":
                    qs = urllib.parse.parse_qs(parsed.query)
                    container_id = (qs.get("containerId") or [None])[0]
                    self._send_json(200, inventory_service.list_items(container_id))
                elif method == "POST":
                    self._send_json(201, inventory_service.create_item(self._read_json()))
                elif method == "PATCH":
                    if not item_id:
                        self._send_json(400, {"error": "missing item id"})
                    else:
                        self._send_json(200, inventory_service.update_item(item_id, self._read_json()))
                elif method == "DELETE":
                    if not item_id:
                        self._send_json(400, {"error": "missing item id"})
                    else:
                        self._send_json(200, inventory_service.delete_item(item_id))
                else:
                    self._send_json(405, {"error": "method not allowed"})
                return True

            self._send_json(404, {"error": "unknown endpoint"})
        except PlanError as e:
            payload = {"error": str(e)}
            if e.state is not None:
                payload.update(e.state)
            self._send_json(e.status, payload)
        except (NotionError, ChatError, TTSError, STTError) as e:
            self._send_json(e.status, {"error": str(e)})
        except (ValueError, KeyError) as e:
            self._send_json(400, {"error": "bad request: %s" % e})
        return True

    # ── method dispatch ──────────────────────────────────────────────────
    def do_GET(self):
        if not self._handle_api("GET"):
            super().do_GET()

    def do_POST(self):
        self._handle_api("POST")

    def do_PUT(self):
        self._handle_api("PUT")

    def do_PATCH(self):
        self._handle_api("PATCH")

    def do_DELETE(self):
        self._handle_api("DELETE")


if __name__ == "__main__":
    load_dotenv()
    os.chdir(HERE)
    # Loopback only by default: /api/* proxies the Notion database and the
    # Anthropic/ElevenLabs keys with no auth of its own, so it must not be
    # reachable from the LAN. Remote access goes through Tailscale Serve,
    # which proxies from 127.0.0.1 — binding loopback does not affect it.
    # Set EVEE_BIND=0.0.0.0 (env or .env) to restore plain-HTTP LAN access.
    BIND = os.environ.get("EVEE_BIND", "127.0.0.1")
    # Threaded so a server-side rate-limit retry (which sleeps) never blocks
    # static files or other API calls.
    with EveeServer((BIND, PORT), EveeHandler) as httpd:
        configured = bool(os.environ.get("NOTION_TOKEN") and (
            os.environ.get("NOTION_DATABASE_ID") or os.environ.get("NOTION_DATA_SOURCE_ID")))
        print("Evee dev server: http://localhost:%d/Evee.html" % PORT)
        print("Bound to %s:%d%s" % (BIND, PORT,
            "" if BIND != "0.0.0.0" else "  (ALL interfaces — /api/* has no auth)"))
        print("Notion inventory API: %s" % (
            "configured" if configured else "NOT configured (set NOTION_TOKEN + NOTION_DATABASE_ID in .env)"))
        # flush: stdout is block-buffered under launchd, so without this the
        # startup banner never reaches logs/server.log.
        print("ElevenLabs voice: %s" % (
            "configured" if tts_service.is_configured() else "NOT configured (Evee stays silent)"), flush=True)
        httpd.serve_forever()

#!/usr/bin/env python3
"""Server-side store for Evee's floor plan, theme and container definitions.

The layout used to live in each browser's localStorage, which is scoped per
*origin* — so the iPad on https://evee-server.<tailnet>.ts.net and the Mac on
http://localhost:8000 kept separate copies and silently drifted apart. This
module makes the server the single source of truth instead.

Deliberately NOT in Notion: Notion is bad at geometry, which is why the layout
was local to begin with. It is a plain JSON file beside the app, gitignored,
holding the same `{apt, furniture, storageAreas}` shape the client already uses.

Like inventory_service, this is a standalone stdlib-only module with no HTTP
coupling — serve.py wires it to routes.

Concurrency: writes carry the `rev` they were based on. A stale rev is refused
with 409 rather than silently clobbering, which is the whole point — a
wall-mounted iPad sitting open for hours must not be able to overwrite an hour
of edits made elsewhere with the state it happened to load this morning.
"""

import json
import os
import shutil
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_DIR = os.path.join(HERE, "state")
STATE_FILE = os.path.join(STATE_DIR, "plan.json")
BACKUP_DIR = os.path.join(STATE_DIR, "backups")
SEED_FILE = os.path.join(HERE, "home.json")
KEEP = int(os.environ.get("EVEE_PLAN_BACKUP_KEEP", "50"))

# One writer at a time: serve.py is a ThreadingHTTPServer, so two clients can
# PUT concurrently. The rev check alone would not prevent interleaved writes.
_LOCK = threading.RLock()
_STATE = None  # in-memory copy; the server is the only writer


class PlanError(Exception):
    """Raised on a bad or conflicting plan write.

    `status` is an HTTP code serve.py forwards to the browser. A 409 carries
    the server's current state on `.state` so the client can adopt it.
    """

    def __init__(self, message, status=400, state=None):
        super().__init__(message)
        self.status = status
        self.state = state


def _seed_from_home():
    """Build the initial state from home.json.

    home.json is the *file-plan* shape the ⋮ Save/Load menu uses
    ({version, width, depth, name, rooms, furniture, storageAreas}); the client
    works in the runtime shape ({apt, furniture, storageAreas}). This is the
    same mapping importPlanJson does in app.jsx.
    """
    with open(SEED_FILE) as fh:
        d = json.load(fh)
    apt = {"width": d["width"], "depth": d["depth"], "rooms": d.get("rooms", [])}
    if d.get("name"):
        apt["name"] = d["name"]
    if d.get("theme"):
        apt["theme"] = d["theme"]
    return {
        "apt": apt,
        "furniture": d.get("furniture", {}),
        "storageAreas": d.get("storageAreas", {}),
        "catalog": d.get("catalog", []),
    }


def _prune(directory, keep):
    """Keep the most recent `keep` snapshots. Mirrors backup.py's prune()."""
    try:
        snaps = sorted(
            f for f in os.listdir(directory)
            if f.startswith("plan-") and f.endswith(".json")
        )
    except OSError:
        return
    for stale in snaps[:-keep] if keep > 0 else []:
        try:
            os.remove(os.path.join(directory, stale))
        except OSError:
            pass


def _write_atomic(state):
    """Write via temp file + os.replace.

    Not hygiene: a torn write costs a floor plan that took hours to build, and
    the failure would only surface on the next load.
    """
    os.makedirs(STATE_DIR, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=STATE_DIR, prefix=".plan-", suffix=".json")
    try:
        with os.fdopen(fd, "w") as fh:
            json.dump(state, fh, indent=2)
            fh.flush()
            os.fsync(fh.fileno())
        os.replace(tmp, STATE_FILE)
    except BaseException:
        try:
            os.remove(tmp)
        except OSError:
            pass
        raise


def _snapshot():
    """Copy the current file aside before overwriting it."""
    if not os.path.exists(STATE_FILE):
        return
    os.makedirs(BACKUP_DIR, exist_ok=True)
    stamp = time.strftime("%Y%m%d-%H%M%S")
    try:
        shutil.copy2(STATE_FILE, os.path.join(BACKUP_DIR, "plan-%s.json" % stamp))
    except OSError:
        pass  # a missing backup must never block the write itself
    _prune(BACKUP_DIR, KEEP)


def load():
    """Current state as {rev, updated, plan}, seeding from home.json if absent."""
    global _STATE
    with _LOCK:
        # Drop the cache if the file was removed underneath us. `rm -rf state/`
        # is the documented dev reset, and without this check the in-memory copy
        # survives it and gets written straight back out — the reset appears to
        # do nothing, which is worse than it failing loudly.
        if _STATE is not None and not os.path.exists(STATE_FILE):
            _STATE = None
        if _STATE is not None:
            return _STATE
        if os.path.exists(STATE_FILE):
            try:
                with open(STATE_FILE) as fh:
                    _STATE = json.load(fh)
                if isinstance(_STATE, dict) and "plan" in _STATE:
                    return _STATE
            except (OSError, ValueError):
                pass  # unreadable or truncated — fall through and re-seed
        _STATE = {"rev": 1, "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "plan": _seed_from_home()}
        _write_atomic(_STATE)
        return _STATE


def current_rev():
    """Cheap accessor for the SSE loop, which asks once a second per client."""
    return load()["rev"]


def save(plan, base_rev):
    """Persist `plan`, refusing a write based on a stale rev.

    Returns the new {rev, updated}. Raises PlanError(409) carrying the server's
    current state when `base_rev` is behind.
    """
    global _STATE
    if not isinstance(plan, dict) or "apt" not in plan:
        raise PlanError("plan must be an object with an `apt` key", 400)
    if not isinstance(plan.get("apt"), dict) or not plan["apt"].get("rooms"):
        raise PlanError("plan.apt must have rooms", 400)
    with _LOCK:
        cur = load()
        if base_rev is not None and base_rev != cur["rev"]:
            raise PlanError(
                "stale rev: client has %s, server has %s" % (base_rev, cur["rev"]),
                409, state=cur)
        _snapshot()
        _STATE = {"rev": cur["rev"] + 1,
                  "updated": time.strftime("%Y-%m-%dT%H:%M:%SZ"),
                  "plan": plan}
        _write_atomic(_STATE)
        return {"rev": _STATE["rev"], "updated": _STATE["updated"]}

#!/usr/bin/env python3
"""Notion-backed inventory service for Evee.

A small, dependency-free (stdlib only) module that maps Evee's inventory
records to rows in a single Notion database and back. It is intentionally a
*standalone module* — serve.py wires it to HTTP routes today, and the Phase 2
AI chat will expose the same functions as Claude tools. Keeping it free of any
HTTP-server coupling is what makes a later move to serverless cheap.

Configuration (read from the environment at call time, so serve.py can load a
.env file first):

    NOTION_TOKEN          required — internal integration token (ntn_...)
    NOTION_DATABASE_ID    required — the database id from the database's URL
    NOTION_DATA_SOURCE_ID optional — skip the database->data_source lookup

Notion API version 2025-09-03 made a database a *container* of one or more
*data sources*; item rows live in a data source. We therefore resolve the
data source id from the database id once and cache it, then query/create
against /v1/data_sources/{id} and /v1/pages.
"""

import json
import os
import time
import urllib.error
import urllib.request

NOTION_API = "https://api.notion.com/v1"
NOTION_VERSION = "2025-09-03"

# Notion property names. Single source of truth for the app<->Notion mapping;
# the database created in the Notion UI must use these exact column names.
PROP_NAME = "Name"            # title
PROP_QUANTITY = "Quantity"    # number
PROP_NOTES = "Notes"          # rich_text
PROP_CONTAINER = "Container"  # rich_text (human-readable label)
PROP_ROOM = "Room"            # rich_text (human-readable name)
PROP_CONTAINER_ID = "Container ID"  # rich_text (join key -> storageAreas[].id)
PROP_ROOM_ID = "Room ID"            # rich_text (join key -> room id)

_data_source_id = None  # cached


class NotionError(Exception):
    """Raised on a Notion API failure or missing configuration.

    `status` is an HTTP-ish code serve.py can forward to the browser.
    """

    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


# ── HTTP plumbing ──────────────────────────────────────────────────────────

def _token():
    token = os.environ.get("NOTION_TOKEN")
    if not token:
        raise NotionError("NOTION_TOKEN is not set", status=500)
    return token


def _request(method, path, body=None, _attempt=0):
    """Make a Notion API call and return the parsed JSON response.

    On HTTP 429 (rate limit) we honor the `Retry-After` header and retry a few
    times, so a burst of writes is smoothed out transparently for the caller.
    """
    url = NOTION_API + path
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", "Bearer " + _token())
    req.add_header("Notion-Version", NOTION_VERSION)
    req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 429 and _attempt < 4:
            try:
                wait = float(e.headers.get("Retry-After", "1"))
            except (TypeError, ValueError):
                wait = 1.0
            time.sleep(min(max(wait, 0.25), 8))
            return _request(method, path, body, _attempt + 1)
        detail = ""
        try:
            detail = json.loads(e.read().decode("utf-8")).get("message", "")
        except Exception:
            pass
        raise NotionError(
            "Notion API error %s: %s" % (e.code, detail or e.reason),
            status=502,
        )
    except urllib.error.URLError as e:
        raise NotionError("Could not reach Notion: %s" % e.reason, status=502)


def resolve_data_source_id():
    """Resolve (and cache) the data source id for the configured database."""
    global _data_source_id
    if _data_source_id:
        return _data_source_id

    override = os.environ.get("NOTION_DATA_SOURCE_ID")
    if override:
        _data_source_id = override
        return _data_source_id

    db_id = os.environ.get("NOTION_DATABASE_ID")
    if not db_id:
        raise NotionError("NOTION_DATABASE_ID is not set", status=500)

    db = _request("GET", "/databases/" + db_id)
    sources = db.get("data_sources") or []
    if not sources:
        # Pre-2025-09-03 database (single implicit source) — the database id
        # doubles as the data source id for query/parent purposes.
        _data_source_id = db_id
    else:
        _data_source_id = sources[0]["id"]
    return _data_source_id


# ── Property mapping ───────────────────────────────────────────────────────

def _rich_text(value):
    return [{"type": "text", "text": {"content": value or ""}}]


def _read_rich_text(prop):
    if not prop:
        return ""
    return "".join(part.get("plain_text", "") for part in prop.get("rich_text", []))


def _read_title(prop):
    if not prop:
        return ""
    return "".join(part.get("plain_text", "") for part in prop.get("title", []))


def _page_to_item(page):
    """Flatten a Notion page into Evee's flat item shape."""
    props = page.get("properties", {})
    return {
        "id": page["id"],
        "name": _read_title(props.get(PROP_NAME)),
        "quantity": (props.get(PROP_QUANTITY) or {}).get("number"),
        "notes": _read_rich_text(props.get(PROP_NOTES)),
        "container": _read_rich_text(props.get(PROP_CONTAINER)),
        "room": _read_rich_text(props.get(PROP_ROOM)),
        "containerId": _read_rich_text(props.get(PROP_CONTAINER_ID)),
        "roomId": _read_rich_text(props.get(PROP_ROOM_ID)),
        "created": page.get("created_time"),    # Notion timestamps, for the Recent feed
        "edited": page.get("last_edited_time"),
    }


def _fields_to_properties(fields):
    """Build a Notion `properties` patch from a (partial) item dict.

    Only keys present in `fields` are written, so this serves both create and
    update.
    """
    props = {}
    if "name" in fields:
        props[PROP_NAME] = {"title": _rich_text(fields["name"])}
    if "quantity" in fields:
        qty = fields["quantity"]
        props[PROP_QUANTITY] = {"number": qty if qty is not None else None}
    if "notes" in fields:
        props[PROP_NOTES] = {"rich_text": _rich_text(fields["notes"])}
    if "container" in fields:
        props[PROP_CONTAINER] = {"rich_text": _rich_text(fields["container"])}
    if "room" in fields:
        props[PROP_ROOM] = {"rich_text": _rich_text(fields["room"])}
    if "containerId" in fields:
        props[PROP_CONTAINER_ID] = {"rich_text": _rich_text(fields["containerId"])}
    if "roomId" in fields:
        props[PROP_ROOM_ID] = {"rich_text": _rich_text(fields["roomId"])}
    return props


# ── Public API (also the future AI tool surface) ───────────────────────────

def list_items(container_id=None):
    """Return all non-archived items, optionally filtered to one container."""
    ds_id = resolve_data_source_id()
    body = {"page_size": 100}
    if container_id:
        body["filter"] = {
            "property": PROP_CONTAINER_ID,
            "rich_text": {"equals": container_id},
        }

    items = []
    cursor = None
    while True:
        if cursor:
            body["start_cursor"] = cursor
        resp = _request("POST", "/data_sources/%s/query" % ds_id, body)
        items.extend(_page_to_item(p) for p in resp.get("results", []))
        if resp.get("has_more"):
            cursor = resp.get("next_cursor")
        else:
            break
    return items


def create_item(fields):
    """Create an item row. `fields` is the flat Evee item shape."""
    ds_id = resolve_data_source_id()
    page = _request("POST", "/pages", {
        "parent": {"type": "data_source_id", "data_source_id": ds_id},
        "properties": _fields_to_properties(fields),
    })
    return _page_to_item(page)


def update_item(item_id, patch):
    """Update an existing item's properties."""
    page = _request("PATCH", "/pages/" + item_id, {
        "properties": _fields_to_properties(patch),
    })
    return _page_to_item(page)


def delete_item(item_id):
    """Archive an item (Notion's notion of delete)."""
    _request("PATCH", "/pages/" + item_id, {"archived": True})
    return {"id": item_id, "deleted": True}


def relabel_container(container_id, container):
    """Update the human-readable Container column on every row of a container.

    The join key (Container ID) is untouched — this only refreshes the display
    label after a rename so Notion stays readable.
    """
    items = list_items(container_id)
    for it in items:
        update_item(it["id"], {"container": container})
    return {"containerId": container_id, "updated": len(items)}


def reassign_container(old_container_id, fields):
    """Re-link every row of one (orphaned) container to a different container.

    Rewrites the join keys (Container ID / Room ID) and the display labels on
    each row, so items whose original container was deleted can be recovered.
    """
    items = list_items(old_container_id)
    patch = {
        "containerId": fields.get("containerId", ""),
        "roomId": fields.get("roomId", ""),
        "container": fields.get("container", ""),
        "room": fields.get("room", ""),
    }
    for it in items:
        update_item(it["id"], patch)
    return {"from": old_container_id, "to": patch["containerId"], "updated": len(items)}

#!/usr/bin/env python3
"""Evee's in-app AI assistant — an Anthropic Messages API tool-use loop.

The browser POSTs {messages, directory} to /api/chat; this module runs a manual
agentic loop (Claude Haiku 4.5) whose tools are thin wrappers over the SAME
`inventory_service` functions the manual container panel uses. So the AI and the
manual UI write to Notion through one code path.

`directory` is the live room/container map from the client (rooms + storage
areas, with ids). It is embedded in the system prompt so Claude can map a phrase
like "the fridge" to a container id, and is used server-side to fill the
human-readable Container/Room columns when creating Notion rows.

Returns {reply, changes}. The client reloads inventory when changes is non-empty.

Requires the `anthropic` package (imported lazily so the inventory backend still
works without it) and ANTHROPIC_API_KEY in the environment.
"""

import json
import os

import inventory_service

# Haiku 4.5 — fast and cheap, strong at NL->tool-call over a small schema.
# Override with ANTHROPIC_MODEL if desired.
MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5")
MAX_TOKENS = 1024
MAX_TOOL_ITERATIONS = 8


class ChatError(Exception):
    """Raised on a chat/config failure. `status` is forwarded to the browser."""

    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


# ── Tool schemas (the AI's surface = the inventory CRUD verbs) ─────────────

TOOLS = [
    {
        "name": "open_room",
        "description": (
            "Change what the user is looking at. Call this whenever they ask to "
            "see, open, go to, show, or look inside a room or container — and "
            "also when they ask to go back, go outside, zoom out, or go home. "
            "This only changes what is on screen; it does not read or modify "
            "inventory."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "room_id": {
                    "type": "string",
                    "description": (
                        "Room id from the directory, or the reserved value \"home\" for the "
                        "whole-apartment overview. There is no room named home — \"home\" is "
                        "how you back out of a room."
                    ),
                },
                "container_id": {
                    "type": "string",
                    "description": "Optional container id inside that room, to open its panel too.",
                },
            },
            "required": ["room_id"],
        },
    },
    {
        "name": "list_items",
        "description": (
            "List inventory items, optionally scoped to one container. Call this "
            "to answer questions about what the user owns or where something is "
            "(e.g. 'how many batteries do I have', 'what's in the fridge') and to "
            "find an item's id before updating or removing it."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "container_id": {
                    "type": "string",
                    "description": "Optional storage-area id to scope to a single container.",
                },
                "query": {
                    "type": "string",
                    "description": "Optional case-insensitive substring to filter item names.",
                },
            },
        },
    },
    {
        "name": "add_item",
        "description": (
            "Add an inventory item to a container. Call this when the user asks "
            "to add/put/store something. Resolve the container_id from the "
            "directory in the system prompt. If an item with the same name is "
            "already in that container, this increases its quantity instead of "
            "creating a duplicate and returns the new total."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "container_id": {"type": "string", "description": "Target storage-area id."},
                "name": {"type": "string", "description": "Item name."},
                "quantity": {"type": "number", "description": "Quantity (default 1)."},
                "notes": {"type": "string", "description": "Optional notes."},
            },
            "required": ["container_id", "name"],
        },
    },
    {
        "name": "update_item",
        "description": (
            "Update an existing item's name, quantity, or notes. Get the item_id "
            "from list_items first."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "item_id": {"type": "string", "description": "The item's id (Notion page id)."},
                "name": {"type": "string"},
                "quantity": {"type": "number"},
                "notes": {"type": "string"},
            },
            "required": ["item_id"],
        },
    },
    {
        "name": "remove_item",
        "description": "Remove an item from inventory. Get the item_id from list_items first.",
        "input_schema": {
            "type": "object",
            "properties": {
                "item_id": {"type": "string", "description": "The item's id (Notion page id)."},
            },
            "required": ["item_id"],
        },
    },
]


def _build_system(directory):
    rooms = directory.get("rooms", []) or []
    containers = directory.get("containers", []) or []
    room_name = {r.get("id"): r.get("name", "") for r in rooms}
    lines = [
        "You are Evee, a warm, concise home-inventory assistant living inside an "
        "isometric apartment app. You help the user track what they own and where "
        "it is stored. Items live in containers, and containers live in rooms.",
        "",
        "Your replies are spoken aloud, so write plain, natural sentences — no "
        "markdown, bullet lists, emoji, or raw ids. Usually one short sentence "
        "that confirms what you did or asks what you need.",
        "",
        "Always use the tools to make changes — never say you added, changed, or "
        "removed something without calling the matching tool. To answer questions "
        "about inventory, call list_items and reason over the result.",
        "",
        "Showing things on screen:",
        "- When the user asks to see, open, go to, or look inside a room or "
        "container, call open_room. If they name only a container, look up which "
        "room it is in and pass both ids.",
        "- open_room only moves the view; it tells you nothing about contents. "
        "To answer what is inside somewhere, still call list_items.",
        "- You can do both in one turn — open a room and say what is in it.",
        "- To back out of a room — 'go home', 'take me back', 'go outside', "
        "'exit', 'zoom out' — call open_room with room_id \"home\". That is the "
        "whole-apartment view; no room is actually named home.",
        "",
        "Finding the right place (use the directory below):"
        "- Map a named container or room to its id and pass that id to the tools.",
        "- If a name matches more than one container (e.g. the same label in two "
        "rooms), ask which one, naming the rooms.",
        "- If the user names a room that has several containers, ask which "
        "container; if that room has exactly one container, just use it.",
        "- If no place is named, or none matches, ask where it should go — don't "
        "guess. You can't create containers; the user makes those in the app.",
        "",
        "Adding and changing items:",
        "- Capitalize the first letter of an item's name, but keep real brand "
        "casing (iPhone, eBay) and don't title-case or shout.",
        "- Adding something already in that container increases its count rather "
        "than making a duplicate (the add tool does this and reports the new "
        "total — confirm that count to the user).",
        "- If a quantity is vague ('some', 'a few'), ask how many instead of "
        "inventing a number — or add it without a quantity if the user clearly "
        "doesn't track the count.",
        "- 'I used/drank/finished N' means reduce the quantity; only remove an "
        "item when it's gone or the user says to remove or delete it.",
        "",
        "If a request is ambiguous, you didn't understand it, or it's outside "
        "home inventory, say so briefly and ask one short question — never "
        "pretend or make something up.",
        "",
        "Rooms (id — name):",
    ]
    for r in rooms:
        lines.append("  %s — %s" % (r.get("id"), r.get("name", "")))
    lines.append("Containers (id — label — room):")
    for c in containers:
        lines.append("  %s — %s — %s" % (
            c.get("id"), c.get("label", ""), room_name.get(c.get("roomId"), "")))
    if not containers:
        lines.append("  (no containers defined yet — ask the user to create one in the app)")
    return "\n".join(lines)


def _tidy_name(name):
    """Normalize an item name: trim/collapse whitespace and capitalize the first
    letter when it's plainly lowercase ('beer' -> 'Beer'), while leaving real
    brand casing like 'iPhone' or 'eBay' alone. Deterministic, so naming stays
    consistent no matter how the model emits it."""
    n = " ".join((name or "").split())
    if not n:
        return n
    first = n.split(" ", 1)[0]
    if first[:1].islower() and first == first.lower():
        n = n[0].upper() + n[1:]
    return n


def _execute_tool(name, inp, container_index, room_index):
    """Run one tool call against inventory_service. Returns (result_str, change)."""
    try:
        if name == "open_room":
            # Purely a view change, so there is nothing to do server-side: the
            # navigation target rides back to the client, which owns the router.
            rid = inp.get("room_id")
            cid = inp.get("container_id") or None
            if rid == "home":
                # The dollhouse overview is not a room and has no directory entry,
                # so "home" is reserved to mean "zoom back out".
                return (json.dumps({"opened": True, "view": "home"}),
                        {"op": "navigate", "roomId": "home", "containerId": None})
            if rid not in room_index:
                return json.dumps({"error": "unknown room_id"}), None
            if cid and cid not in container_index:
                return json.dumps({"error": "unknown container_id"}), None
            if cid and container_index[cid].get("roomId") != rid:
                return json.dumps({"error": "that container is not in that room"}), None
            return (json.dumps({"opened": True, "room": room_index[rid].get("name"),
                                "container": container_index[cid].get("label") if cid else None}),
                    {"op": "navigate", "roomId": rid, "containerId": cid})

        if name == "list_items":
            items = inventory_service.list_items(inp.get("container_id"))
            q = (inp.get("query") or "").strip().lower()
            if q:
                items = [it for it in items if q in (it.get("name") or "").lower()]
            return json.dumps(items), None

        if name == "add_item":
            cid = inp["container_id"]
            if cid not in container_index:
                # Don't write a row keyed to a container that doesn't exist (it
                # would be orphaned). Make the model pick a real one or ask.
                return json.dumps({
                    "error": "No container with id '%s' exists. Use a container id from "
                             "the directory, or ask the user which container." % cid,
                }), None
            c = container_index.get(cid, {})
            rid = c.get("roomId") or ""
            r = room_index.get(rid, {})
            item_name = _tidy_name(inp["name"])
            qty = inp.get("quantity")
            # Merge into an existing item of the same name in this container
            # instead of creating a duplicate row. Adding bumps the count.
            existing = next(
                (it for it in inventory_service.list_items(cid)
                 if (it.get("name") or "").strip().lower() == item_name.lower()),
                None,
            )
            if existing:
                merged_qty = (existing.get("quantity") or 0) + (qty if qty is not None else 1)
                updated = inventory_service.update_item(existing["id"], {"quantity": merged_qty})
                return json.dumps({"merged": True, "previous_quantity": existing.get("quantity"), **updated}), \
                    {"op": "update", "containerId": cid, "item": updated}
            created = inventory_service.create_item({
                "name": item_name,
                "quantity": qty,
                "notes": inp.get("notes", ""),
                "containerId": cid,
                "roomId": rid,
                "container": c.get("label", ""),
                "room": r.get("name", ""),
            })
            return json.dumps(created), {"op": "add", "containerId": cid, "item": created}

        if name == "update_item":
            patch = {k: inp[k] for k in ("name", "quantity", "notes") if k in inp}
            if "name" in patch:
                patch["name"] = _tidy_name(patch["name"])
            updated = inventory_service.update_item(inp["item_id"], patch)
            return json.dumps(updated), {"op": "update", "containerId": updated.get("containerId"), "item": updated}

        if name == "remove_item":
            inventory_service.delete_item(inp["item_id"])
            return json.dumps({"removed": True, "id": inp["item_id"]}), {"op": "remove", "itemId": inp["item_id"]}

    except inventory_service.NotionError as e:
        # Surface the failure to Claude so it can explain it, not crash the loop.
        return json.dumps({"error": str(e)}), None
    except (KeyError, TypeError) as e:
        return json.dumps({"error": "bad tool input: %s" % e}), None

    return json.dumps({"error": "unknown tool"}), None


def handle(messages, directory):
    """Run the agentic loop. `messages` = [{role, content}]. Returns {reply, changes}."""
    try:
        import anthropic
    except ImportError:
        raise ChatError(
            "The 'anthropic' package isn't installed. Run: pip install -r requirements.txt",
            status=500,
        )
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise ChatError("ANTHROPIC_API_KEY is not set", status=500)

    # The Messages API requires the first message to be from the user.
    convo = [{"role": m.get("role"), "content": m.get("content", "")} for m in (messages or [])]
    while convo and convo[0]["role"] != "user":
        convo.pop(0)
    if not convo:
        raise ChatError("No user message to respond to", status=400)

    container_index = {c.get("id"): c for c in (directory.get("containers", []) or [])}
    room_index = {r.get("id"): r for r in (directory.get("rooms", []) or [])}
    system = _build_system(directory)

    client = anthropic.Anthropic()
    changes = []
    response = None
    try:
        for _ in range(MAX_TOOL_ITERATIONS):
            response = client.messages.create(
                model=MODEL,
                max_tokens=MAX_TOKENS,
                system=system,
                tools=TOOLS,
                messages=convo,
            )
            if response.stop_reason != "tool_use":
                break
            convo.append({"role": "assistant", "content": response.content})
            tool_results = []
            for block in response.content:
                if block.type == "tool_use":
                    result, change = _execute_tool(block.name, block.input, container_index, room_index)
                    if change:
                        changes.append(change)
                    tool_results.append({
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": result,
                    })
            convo.append({"role": "user", "content": tool_results})
    except anthropic.APIError as e:
        raise ChatError("Claude API error: %s" % getattr(e, "message", str(e)), status=502)

    reply = ""
    if response is not None:
        reply = "".join(b.text for b in response.content if b.type == "text").strip()
    # Navigation is a client-side view change, not an inventory mutation. Keep it
    # out of `changes`, which the client uses to decide whether to reload Notion.
    navigate = next((c for c in reversed(changes) if c.get("op") == "navigate"), None)
    if navigate:
        navigate = {"roomId": navigate.get("roomId"), "containerId": navigate.get("containerId")}
        changes = [c for c in changes if c.get("op") != "navigate"]
    return {"reply": reply or "(no reply)", "changes": changes, "navigate": navigate}

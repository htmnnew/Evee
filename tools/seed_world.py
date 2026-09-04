#!/usr/bin/env python3
"""Regenerate hifi/world.jsx's default layout literals from a plan JSON.

The front-end has no build step, so the default apartment lives as inline
literals in world.jsx rather than being fetched at runtime (APARTMENT is read
synchronously at module scope by scenes.jsx and friends). This script keeps
those literals honest: author the layout in the floor-plan editor, ⋮ Save Plan,
then re-seed from the saved file.

    python3 tools/seed_world.py home.json

It rewrites only the APARTMENT / HOME_FURNITURE / STORAGE_AREAS block, between
the `let APARTMENT = {` line and the `// Live inventory` comment that follows
STORAGE_AREAS. Everything else in world.jsx is left untouched.
"""
import json
import re
import sys

# Room keys in the order world.jsx writes them; `points` is emitted last.
ROOM_FLAGS = ("hideName", "noInteract", "groupId", "homeOrder", "viewRot", "wallOverrides")
FURN_KEYS = ("id", "label", "shape", "x", "y", "w", "d", "h", "z", "angle", "color",
             "storage", "groupId", "zOrder", "zOrders")
AREA_KEYS = ("id", "label", "furniture", "face", "items")


def num(v):
    """Shortest round-trip form: 6 not 6.0, full precision for 1/12ths."""
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return repr(v)


def val(v):
    if isinstance(v, bool):
        return "true" if v else "false"
    if isinstance(v, (int, float)):
        return num(v)
    if isinstance(v, str):
        return "'%s'" % v.replace("\\", "\\\\").replace("'", "\\'")
    # wallOverrides / zOrders: compact nested object, keys quoted for numerics.
    return json.dumps(v, separators=(", ", ": "))


def obj(d, keys):
    """`key: value` pairs for keys present in d, in the given order."""
    return ", ".join("%s: %s" % (k, val(d[k])) for k in keys if k in d)


def emit_rooms(rooms):
    out = []
    for r in rooms:
        head = "id: %s, name: %s, color: %s" % (val(r["id"]), val(r.get("name", "")),
                                                val(r.get("color", "#f0ece2")))
        flags = obj(r, ROOM_FLAGS)
        if flags:
            head += ", " + flags
        pts = [" { x: %s, y: %s }," % (num(p["x"]), num(p["y"])) for p in r.get("points", [])]
        lines = ["    { %s, points: [" % head]
        # Three points per line, matching the hand-written style.
        for i in range(0, len(pts), 3):
            lines.append("     " + "".join(pts[i:i + 3]).strip())
        lines.append("    ]},")
        out.append("\n".join(lines))
    return "\n".join(out)


def emit_map(d, keys, indent="  "):
    out = []
    for rid in d:
        rows = d[rid]
        if not rows:
            continue
        # Bare key only when it is a valid JS identifier (ids may contain '-').
        key = rid if re.match(r"^[A-Za-z_$][\w$]*$", rid) else "'%s'" % rid
        out.append("%s%s: [" % (indent, key))
        for row in rows:
            out.append("%s  { %s }," % (indent, obj(row, keys)))
        out.append("%s]," % indent)
    return "\n".join(out)


def main():
    src = sys.argv[1] if len(sys.argv) > 1 else "home.json"
    plan = json.load(open(src))
    rooms = plan.get("rooms") or []

    block = []
    block.append("let APARTMENT = {")
    block.append("  width: %s, depth: %s," % (num(plan["width"]), num(plan["depth"])))
    if plan.get("name"):
        block.append("  name: %s," % val(plan["name"]))
    # Scene theme (⋮ → Customize). Optional, and `val` already renders a dict
    # as a JS object literal — its `null`s are valid JS as-is.
    if plan.get("theme"):
        block.append("  theme: %s," % val(plan["theme"]))
    if plan.get("presets"):
        block.append("  presets: %s," % val(plan["presets"]))
    block.append("  rooms: [")
    block.append(emit_rooms(rooms))
    block.append("  ],")
    block.append("};")
    block.append("")
    block.append("// Furniture keyed by room id. Seeded from %s; user additions are persisted" % src)
    block.append("// to localStorage. (x,y) is room-local, relative to the room's polygon-bbox origin.")
    block.append("let HOME_FURNITURE = {")
    block.append(emit_map(plan.get("furniture") or {}, FURN_KEYS))
    block.append("};")
    block.append("")
    block.append("// Storage areas keyed by room id. Each id doubles as the Notion \"Container ID\".")
    block.append("let STORAGE_AREAS = {")
    block.append(emit_map(plan.get("storageAreas") or {}, AREA_KEYS))
    block.append("};")
    new = "\n".join(block) + "\n"

    path = "hifi/world.jsx"
    text = open(path).read()
    start = text.index("let APARTMENT = {")
    end = text.index("// Live inventory")
    open(path, "w").write(text[:start] + new + "\n" + text[end:])

    nf = sum(len(v) for v in (plan.get("furniture") or {}).values())
    na = sum(len(v) for v in (plan.get("storageAreas") or {}).values())
    print("seeded %s from %s: %d rooms, %d furniture, %d storage areas"
          % (path, src, len(rooms), nf, na))


if __name__ == "__main__":
    main()

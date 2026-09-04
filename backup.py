#!/usr/bin/env python3
"""Snapshot the Evee Inventory Notion database to a local JSON file.

Reuses inventory_service (the app's own Notion integration), so it needs the
same NOTION_TOKEN / NOTION_DATABASE_ID in .env and no extra dependencies. Writes
a timestamped file under backups/ and prunes to the most recent KEEP snapshots.

Run manually:   python3 backup.py
On a schedule:  see launchd/com.evee.inventory-backup.plist
"""

import datetime
import json
import os
import sys

import inventory_service

HERE = os.path.dirname(os.path.abspath(__file__))
BACKUP_DIR = os.path.join(HERE, "backups")
KEEP = int(os.environ.get("EVEE_BACKUP_KEEP", "30"))  # most-recent snapshots to retain


def load_dotenv():
    """Minimal .env loader (same behavior as serve.py)."""
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
            if key:
                os.environ.setdefault(key, value.strip().strip('"').strip("'"))


def prune(directory, keep):
    snaps = sorted(
        f for f in os.listdir(directory)
        if f.startswith("evee-inventory-") and f.endswith(".json")
    )
    for stale in snaps[:-keep] if keep > 0 else []:
        try:
            os.remove(os.path.join(directory, stale))
        except OSError:
            pass


def main():
    load_dotenv()
    os.makedirs(BACKUP_DIR, exist_ok=True)
    try:
        data_source_id = inventory_service.resolve_data_source_id()
        items = inventory_service.list_items()
    except inventory_service.NotionError as e:
        print("Backup failed: %s" % e, file=sys.stderr)
        return 1

    stamp = datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    out = os.path.join(BACKUP_DIR, "evee-inventory-%s.json" % stamp)
    snapshot = {
        "backedUpAt": datetime.datetime.now().isoformat(timespec="seconds"),
        "databaseId": os.environ.get("NOTION_DATABASE_ID"),
        "dataSourceId": data_source_id,
        "count": len(items),
        "items": items,
    }
    with open(out, "w") as f:
        json.dump(snapshot, f, indent=2, ensure_ascii=False)

    prune(BACKUP_DIR, KEEP)
    print("Backed up %d item(s) -> %s" % (len(items), os.path.relpath(out, HERE)))
    return 0


if __name__ == "__main__":
    sys.exit(main())

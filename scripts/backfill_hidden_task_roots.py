#!/usr/bin/env python3
"""Backfill the `isHiddenRoot` marker used by lazy hidden-task loading.

The command is a dry run unless `--apply` is supplied. A hidden task is a
root when its parent is missing or is not hidden. Missing false markers are
left untouched to minimize writes; stale true/non-boolean markers are fixed.
"""

from __future__ import annotations

import argparse
import pathlib
import sys
from typing import Iterable, List

import firebase_admin
from firebase_admin import credentials, firestore


TASK_COLLECTIONS = ["tasks", "fa_tasks", "ict_tasks"]
PARENT_ID_FIELDS = ("parentId", "parent_id", "parentTaskId", "parent_task_id")


def chunks(values: List, size: int) -> Iterable[List]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


def parent_id(data: dict) -> str:
    for field in PARENT_ID_FIELDS:
        value = data.get(field)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def backfill_collection(db, collection_name: str, apply: bool, batch_size: int) -> int:
    snapshots = list(db.collection(collection_name).stream())
    by_id = {snapshot.id: snapshot.to_dict() or {} for snapshot in snapshots}
    pending = []

    for snapshot in snapshots:
        data = by_id[snapshot.id]
        hidden = data.get("isHidden") is True
        parent = by_id.get(parent_id(data))
        expected = hidden and not (parent and parent.get("isHidden") is True)
        current = data.get("isHiddenRoot")

        if expected:
            if current is not True:
                pending.append((snapshot.reference, True))
        elif current is True or ("isHiddenRoot" in data and not isinstance(current, bool)):
            pending.append((snapshot.reference, False))

    print(f"{collection_name}: {len(pending)} of {len(snapshots)} document(s) need updates")
    for reference, value in pending[:5]:
        print(f"  sample: {reference.path} -> isHiddenRoot={value}")

    if not apply:
        return len(pending)

    for group in chunks(pending, batch_size):
        batch = db.batch()
        for reference, value in group:
            batch.update(reference, {"isHiddenRoot": value})
        batch.commit()
    return len(pending)


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill hidden task root markers")
    parser.add_argument("--service-account", required=True, help="Path to Firebase service account JSON")
    parser.add_argument("--collections", nargs="*", default=TASK_COLLECTIONS)
    parser.add_argument("--batch-size", type=int, default=400)
    parser.add_argument("--apply", action="store_true", help="Write changes; otherwise perform a dry run")
    args = parser.parse_args()

    service_account = pathlib.Path(args.service_account)
    if not service_account.exists():
        print(f"Service account file not found: {service_account}")
        return 1
    if args.batch_size < 1 or args.batch_size > 500:
        print("--batch-size must be between 1 and 500")
        return 1

    firebase_admin.initialize_app(credentials.Certificate(str(service_account)))
    db = firestore.client()
    total = sum(
        backfill_collection(db, collection_name, args.apply, args.batch_size)
        for collection_name in args.collections
    )
    action = "updated" if args.apply else "would update"
    print(f"Done: {action} {total} document(s) across {len(args.collections)} collection(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

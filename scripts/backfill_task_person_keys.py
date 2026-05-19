#!/usr/bin/env python3
"""
Backfill personKeys for Firestore task collections.

Usage:
  python scripts/backfill_task_person_keys.py \
    --service-account ./serviceAccountKey.json \
    --dry-run
"""

from __future__ import annotations

import argparse
import pathlib
import sys
from typing import Iterable, List

import firebase_admin
from firebase_admin import credentials, firestore


TASK_COLLECTIONS = ["tasks", "fa_tasks", "ict_tasks"]


def build_task_person_keys(person: str) -> List[str]:
    keys = set()
    for raw_value in (person or "").split(","):
        normalized = " ".join(raw_value.strip().lower().split())
        if not normalized:
            continue
        keys.add(normalized)
        keys.add(normalized.replace(" ", ""))
        if "@" in normalized:
            local = normalized.split("@", 1)[0]
            keys.add(local)
            keys.add(" ".join(local.replace(".", " ").replace("_", " ").replace("-", " ").split()))
            keys.add(local.replace(".", "").replace("_", "").replace("-", "").replace(" ", ""))
    return sorted(k for k in keys if k)


def init_firestore(service_account_path: pathlib.Path):
    cred = credentials.Certificate(str(service_account_path))
    firebase_admin.initialize_app(cred)
    return firestore.client()


def chunks(values: List, size: int) -> Iterable[List]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


def backfill_collection(db, collection_name: str, dry_run: bool, batch_size: int) -> int:
    docs = list(db.collection(collection_name).stream())
    updates = []
    for doc_snap in docs:
        data = doc_snap.to_dict() or {}
        expected = build_task_person_keys(str(data.get("person") or ""))
        current = data.get("personKeys")
        if current == expected:
            continue
        updates.append((doc_snap.reference, expected, data.get("person") or ""))

    print(f"{collection_name}: {len(updates)} update(s) needed out of {len(docs)} document(s)")
    for ref, expected, person in updates[:5]:
        print(f"  sample {ref.id}: person={person!r} personKeys={expected}")

    if dry_run:
        return len(updates)

    for group in chunks(updates, batch_size):
        batch = db.batch()
        for ref, expected, _person in group:
            batch.update(ref, {"personKeys": expected})
        batch.commit()

    return len(updates)


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill task personKeys in Firestore")
    parser.add_argument("--service-account", required=True, help="Path to Firebase service account json")
    parser.add_argument("--collections", nargs="*", default=TASK_COLLECTIONS, help="Task collections to backfill")
    parser.add_argument("--batch-size", type=int, default=400, help="Firestore batch size")
    parser.add_argument("--dry-run", action="store_true", help="Print pending updates without writing")
    args = parser.parse_args()

    service_account = pathlib.Path(args.service_account)
    if not service_account.exists():
        print(f"Service account file not found: {service_account}")
        return 1
    if args.batch_size < 1 or args.batch_size > 500:
        print("--batch-size must be between 1 and 500")
        return 1

    db = init_firestore(service_account)
    total = 0
    for collection_name in args.collections:
        total += backfill_collection(db, collection_name, args.dry_run, args.batch_size)

    action = "would update" if args.dry_run else "updated"
    print(f"Done: {action} {total} document(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

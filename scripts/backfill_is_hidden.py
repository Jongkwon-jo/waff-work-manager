#!/usr/bin/env python3
"""
Backfill `isHidden` field for Firestore project/task collections.

Firestore `where("isHidden", "==", false)` cannot match documents that are
missing the field entirely. Older documents created before the field existed
need a one-time backfill so they can be excluded from default reads.

Usage:
  # Dry run first to see what would change
  python scripts/backfill_is_hidden.py \
    --service-account ./serviceAccountKey.json \
    --dry-run

  # Apply
  python scripts/backfill_is_hidden.py \
    --service-account ./serviceAccountKey.json

Notes:
  - Only documents where `isHidden` is missing OR not a boolean are updated.
  - Documents that already have `isHidden == true` or `isHidden == false` are
    left alone.
  - Run safely multiple times; subsequent runs are no-ops.
"""

from __future__ import annotations

import argparse
import pathlib
import sys
from typing import Iterable, List

import firebase_admin
from firebase_admin import credentials, firestore


PROJECT_COLLECTIONS = ["projects", "fa_projects", "ict_projects"]
TASK_COLLECTIONS = ["tasks", "fa_tasks", "ict_tasks"]
DEFAULT_COLLECTIONS = PROJECT_COLLECTIONS + TASK_COLLECTIONS


def init_firestore(service_account_path: pathlib.Path):
    cred = credentials.Certificate(str(service_account_path))
    firebase_admin.initialize_app(cred)
    return firestore.client()


def chunks(values: List, size: int) -> Iterable[List]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


def backfill_collection(db, collection_name: str, dry_run: bool, batch_size: int) -> int:
    docs = list(db.collection(collection_name).stream())
    pending = []
    for doc_snap in docs:
        data = doc_snap.to_dict() or {}
        current = data.get("isHidden")
        if isinstance(current, bool):
            continue
        pending.append(doc_snap.reference)

    print(
        f"{collection_name}: {len(pending)} document(s) need isHidden backfill "
        f"out of {len(docs)} total"
    )
    for ref in pending[:5]:
        print(f"  sample: {ref.path}")

    if dry_run or not pending:
        return len(pending)

    for group in chunks(pending, batch_size):
        batch = db.batch()
        for ref in group:
            batch.update(ref, {"isHidden": False})
        batch.commit()

    return len(pending)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill isHidden=False for project/task docs missing the field"
    )
    parser.add_argument(
        "--service-account",
        required=True,
        help="Path to Firebase service account JSON",
    )
    parser.add_argument(
        "--collections",
        nargs="*",
        default=DEFAULT_COLLECTIONS,
        help=f"Collections to backfill (default: {' '.join(DEFAULT_COLLECTIONS)})",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=400,
        help="Firestore batch size (1-500)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print pending updates without writing",
    )
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
        total += backfill_collection(
            db, collection_name, args.dry_run, args.batch_size
        )

    action = "would update" if args.dry_run else "updated"
    print(f"Done: {action} {total} document(s) across {len(args.collections)} collection(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

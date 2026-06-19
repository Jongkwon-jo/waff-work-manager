#!/usr/bin/env python3
"""
Backfill `isIct` boolean field for strategy task documents.

The app uses `isIct` as a fast lookup marker, but final visibility is based on
the current ICT rule:

  department contains "ICT" OR assignee matches an ICT person

By default this script reads ICT people from
settings/department_person_settings.ICT and updates strategy `tasks`.
"""

from __future__ import annotations

import argparse
import pathlib
import sys
from typing import Iterable, List

import firebase_admin
from firebase_admin import credentials, firestore


DEFAULT_COLLECTIONS = ["tasks"]
SETTINGS_COLLECTION = "settings"
DEPARTMENT_PERSON_SETTINGS_DOC = "department_person_settings"


def split_people(person) -> List[str]:
    return [
        value.strip().lower()
        for value in str(person or "").split(",")
        if value and value.strip()
    ]


def has_matching_person(person, ict_person_names: List[str]) -> bool:
    tokens = split_people(person)
    names = [value.strip().lower() for value in ict_person_names if value and value.strip()]
    return any(
        token == name or token in name or name in token
        for token in tokens
        for name in names
    )


def compute_is_ict(department, person, ict_person_names: List[str]) -> bool:
    return (
        isinstance(department, str)
        and "ICT" in department.upper()
    ) or has_matching_person(person, ict_person_names)


def init_firestore(service_account_path: pathlib.Path):
    cred = credentials.Certificate(str(service_account_path))
    firebase_admin.initialize_app(cred)
    return firestore.client()


def fetch_ict_person_names(db) -> List[str]:
    snap = (
        db.collection(SETTINGS_COLLECTION)
        .document(DEPARTMENT_PERSON_SETTINGS_DOC)
        .get()
    )
    data = snap.to_dict() or {}
    raw_people = data.get("ICT")
    if not isinstance(raw_people, list):
        return []
    return [value.strip() for value in raw_people if isinstance(value, str) and value.strip()]


def chunks(values: List, size: int) -> Iterable[List]:
    for index in range(0, len(values), size):
        yield values[index : index + size]


def backfill_collection(
    db,
    collection_name: str,
    dry_run: bool,
    batch_size: int,
    ict_person_names: List[str],
) -> int:
    docs = list(db.collection(collection_name).stream())
    pending = []
    set_true = 0
    for doc_snap in docs:
        data = doc_snap.to_dict() or {}
        expected = compute_is_ict(data.get("department"), data.get("person"), ict_person_names)
        current = data.get("isIct")
        if isinstance(current, bool) and current == expected:
            continue
        pending.append((doc_snap.reference, expected))
        if expected:
            set_true += 1

    print(
        f"{collection_name}: {len(pending)} document(s) need isIct backfill "
        f"out of {len(docs)} total (will set true={set_true}, false={len(pending) - set_true})"
    )
    for ref, expected in pending[:5]:
        print(f"  sample: {ref.path} -> isIct={expected}")

    if dry_run or not pending:
        return len(pending)

    for group in chunks(pending, batch_size):
        batch = db.batch()
        for ref, expected in group:
            batch.update(ref, {"isIct": expected})
        batch.commit()

    return len(pending)


def main() -> int:
    parser = argparse.ArgumentParser(description="Backfill isIct boolean for strategy task docs")
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
        "--ict-person",
        action="append",
        default=[],
        help="ICT person name override. Can be passed multiple times. Defaults to Firestore settings.",
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
    ict_person_names = [value.strip() for value in args.ict_person if value.strip()]
    if not ict_person_names:
        ict_person_names = fetch_ict_person_names(db)
    print(f"Loaded {len(ict_person_names)} ICT person name(s)")

    total = 0
    for collection_name in args.collections:
        total += backfill_collection(
            db,
            collection_name,
            args.dry_run,
            args.batch_size,
            ict_person_names,
        )

    action = "would update" if args.dry_run else "updated"
    print(f"Done: {action} {total} document(s) across {len(args.collections)} collection(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Backfill `isIct` boolean field for strategy `tasks` (and optionally fa_tasks/ict_tasks).

ICT 스케줄 페이지가 strategy task 중 department 에 "ICT" 가 포함된 것만 server-side
필터로 가져오도록, 모든 strategy task 문서에 isIct boolean 을 백필.

규칙 (lib/firestore-service-ict.ts 의 isIctTask 와 동일):
  isIct = isinstance(department, str) and "ICT" in department.upper()

Usage:
  # Dry run
  python scripts/backfill_strategy_task_isict.py \
    --service-account ./serviceAccountKey.json --dry-run

  # Apply
  python scripts/backfill_strategy_task_isict.py \
    --service-account ./serviceAccountKey.json

Notes:
  - 기본 컬렉션은 strategy `tasks` 만. ICT 페이지 server-side 필터에 필요한 부분.
  - 이미 isIct 값이 정확하면 건너뜀 → 멱등 (몇 번 돌려도 안전).
"""

from __future__ import annotations

import argparse
import pathlib
import sys
from typing import Iterable, List

import firebase_admin
from firebase_admin import credentials, firestore


DEFAULT_COLLECTIONS = ["tasks"]


def compute_is_ict(department) -> bool:
    if not isinstance(department, str):
        return False
    return "ICT" in department.upper()


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
    set_true = 0
    for doc_snap in docs:
        data = doc_snap.to_dict() or {}
        expected = compute_is_ict(data.get("department"))
        current = data.get("isIct")
        if isinstance(current, bool) and current == expected:
            continue
        pending.append((doc_snap.reference, expected))
        if expected:
            set_true += 1

    print(
        f"{collection_name}: {len(pending)} document(s) need isIct backfill "
        f"out of {len(docs)} total  (will set true={set_true}, false={len(pending) - set_true})"
    )
    for ref, expected in pending[:5]:
        print(f"  sample: {ref.path}  →  isIct={expected}")

    if dry_run or not pending:
        return len(pending)

    for group in chunks(pending, batch_size):
        batch = db.batch()
        for ref, expected in group:
            batch.update(ref, {"isIct": expected})
        batch.commit()

    return len(pending)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Backfill isIct boolean for strategy task docs"
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

#!/usr/bin/env python3
"""
Bulk import projects/tasks into Firestore from CSV or XLSX.

Required packages:
  pip install firebase-admin openpyxl

Usage:
  python scripts/firebase_bulk_import.py \
    --service-account ./serviceAccountKey.json \
    --file ./templates/firebase_import_template.csv
"""

from __future__ import annotations

import argparse
import csv
import pathlib
import sys
from dataclasses import dataclass
from typing import Dict, List, Optional

import firebase_admin
from firebase_admin import credentials, firestore


EXPECTED_COLUMNS = [
    "project_key",
    "project_id",
    "project_name",
    "project_type",
    "project_period",
    "project_display_order",
    "task_key",
    "task_id",
    "parent_task_key",
    "task_name",
    "task_category",
    "task_department",
    "task_person",
    "task_start_date",
    "task_end_date",
    "task_status",
    "task_man_days",
    "task_display_order",
    "is_sub_task",
]

PROJECTS_COLLECTION = "projects"
TASKS_COLLECTION = "tasks"


@dataclass
class RowItem:
    row_num: int
    values: Dict[str, str]


def norm_str(value: object) -> str:
    if value is None:
        return ""
    return str(value).strip()


def parse_int(value: str) -> Optional[int]:
    if not value:
        return None
    return int(float(value))


def parse_float(value: str) -> Optional[float]:
    if not value:
        return None
    return float(value)


def parse_bool(value: str) -> Optional[bool]:
    if not value:
        return None
    lowered = value.strip().lower()
    if lowered in {"1", "true", "t", "yes", "y"}:
        return True
    if lowered in {"0", "false", "f", "no", "n"}:
        return False
    raise ValueError(f"Invalid bool value: {value}")


def load_rows(file_path: pathlib.Path) -> List[RowItem]:
    suffix = file_path.suffix.lower()

    if suffix == ".csv":
        with file_path.open("r", encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            _validate_headers(reader.fieldnames)
            return [
                RowItem(i + 2, {k: norm_str(v) for k, v in row.items()})
                for i, row in enumerate(reader)
            ]

    if suffix in {".xlsx", ".xlsm"}:
        try:
            import openpyxl  # type: ignore
        except Exception as exc:
            raise RuntimeError("openpyxl is required for xlsx import. Install: pip install openpyxl") from exc

        wb = openpyxl.load_workbook(file_path, read_only=True, data_only=True)
        ws = wb.active
        rows_iter = ws.iter_rows(values_only=True)
        headers_raw = next(rows_iter, None)
        if headers_raw is None:
            return []

        headers = [norm_str(h) for h in headers_raw]
        _validate_headers(headers)

        items: List[RowItem] = []
        for i, row in enumerate(rows_iter, start=2):
            values = {headers[j]: norm_str(row[j]) if j < len(row) else "" for j in range(len(headers))}
            items.append(RowItem(i, values))
        return items

    raise ValueError(f"Unsupported file type: {file_path.suffix}. Use .csv or .xlsx")


def _validate_headers(headers: Optional[List[str]]) -> None:
    if not headers:
        raise ValueError("Input file is missing header row")
    missing = [c for c in EXPECTED_COLUMNS if c not in headers]
    if missing:
        raise ValueError(f"Missing required columns: {', '.join(missing)}")


def init_firestore(service_account_path: pathlib.Path):
    cred = credentials.Certificate(str(service_account_path))
    firebase_admin.initialize_app(cred)
    return firestore.client()


def import_data(db, rows: List[RowItem]) -> None:
    if not rows:
        print("No rows found")
        return

    project_refs: Dict[str, firestore.DocumentReference] = {}
    task_refs_by_key: Dict[str, firestore.DocumentReference] = {}
    task_refs_by_row: Dict[int, firestore.DocumentReference] = {}

    for item in rows:
        v = item.values

        project_name = v["project_name"]
        project_type = v["project_type"]
        if not project_name or not project_type:
            raise ValueError(f"Row {item.row_num}: project_name and project_type are required")

        project_id = v["project_id"]
        project_key = v["project_key"] or f"{project_name}|{project_type}|{v['project_period']}"

        if project_key not in project_refs:
            if project_id:
                project_ref = db.collection(PROJECTS_COLLECTION).document(project_id)
            else:
                project_ref = db.collection(PROJECTS_COLLECTION).document()
            project_refs[project_key] = project_ref

        task_name = v["task_name"]
        if not task_name:
            raise ValueError(f"Row {item.row_num}: task_name is required")

        task_id = v["task_id"]
        task_ref = db.collection(TASKS_COLLECTION).document(task_id) if task_id else db.collection(TASKS_COLLECTION).document()
        task_refs_by_row[item.row_num] = task_ref

        task_key = v["task_key"]
        if task_key:
            if task_key in task_refs_by_key:
                raise ValueError(f"Row {item.row_num}: duplicated task_key '{task_key}'")
            task_refs_by_key[task_key] = task_ref

    batch = db.batch()
    writes = 0

    for item in rows:
        v = item.values
        project_name = v["project_name"]
        project_type = v["project_type"]
        project_period = v["project_period"]
        project_order = parse_int(v["project_display_order"])

        project_key = v["project_key"] or f"{project_name}|{project_type}|{project_period}"
        project_ref = project_refs[project_key]

        project_payload = {
            "name": project_name,
            "type": project_type,
            "period": project_period or None,
            "displayOrder": project_order if project_order is not None else int(item.row_num),
            "createdAt": firestore.SERVER_TIMESTAMP,
        }
        batch.set(project_ref, {k: val for k, val in project_payload.items() if val is not None}, merge=True)
        writes += 1

        parent_task_key = v["parent_task_key"]
        parent_task_ref = task_refs_by_key.get(parent_task_key) if parent_task_key else None
        if parent_task_key and parent_task_ref is None:
            raise ValueError(f"Row {item.row_num}: parent_task_key '{parent_task_key}' not found")

        task_payload = {
            "projectId": project_ref.id,
            "parentId": parent_task_ref.id if parent_task_ref else None,
            "task": v["task_name"],
            "category": v["task_category"] or "일반",
            "department": v["task_department"] or "전략",
            "person": v["task_person"] or "",
            "startDate": v["task_start_date"] or "01월 01일",
            "endDate": v["task_end_date"] or "01월 01일",
            "status": v["task_status"] or "대기",
            "manDays": parse_float(v["task_man_days"]) if v["task_man_days"] else 0,
            "isSubTask": parse_bool(v["is_sub_task"]) if v["is_sub_task"] else bool(parent_task_ref),
            "displayOrder": parse_int(v["task_display_order"]) if v["task_display_order"] else int(item.row_num),
        }

        task_ref = task_refs_by_row[item.row_num]
        batch.set(task_ref, {k: val for k, val in task_payload.items() if val is not None}, merge=True)
        writes += 1

        if writes >= 400:
            batch.commit()
            batch = db.batch()
            writes = 0

    if writes > 0:
        batch.commit()

    print(f"Imported {len(rows)} row(s)")


def main() -> int:
    parser = argparse.ArgumentParser(description="Bulk import projects/tasks into Firestore from CSV/XLSX")
    parser.add_argument("--service-account", required=True, help="Path to Firebase service account json")
    parser.add_argument("--file", required=True, help="Input csv/xlsx file")
    args = parser.parse_args()

    service_account = pathlib.Path(args.service_account)
    input_file = pathlib.Path(args.file)

    if not service_account.exists():
        print(f"Service account file not found: {service_account}")
        return 1
    if not input_file.exists():
        print(f"Input file not found: {input_file}")
        return 1

    try:
        rows = load_rows(input_file)
        db = init_firestore(service_account)
        import_data(db, rows)
        return 0
    except Exception as exc:
        print(f"Import failed: {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())

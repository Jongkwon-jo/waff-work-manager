#!/usr/bin/env python3
"""Diagnose why a strategy task is not visible in the ICT schedule."""

from __future__ import annotations

import argparse
import pathlib
import sys
from typing import Any, Dict, List, Set, Tuple

import firebase_admin
from firebase_admin import credentials, firestore


SETTINGS_COLLECTION = "ict_settings"
VISIBILITY_DOC = "ict_linked_strategy_project_visibility"
HIDDEN_PROJECT_IDS_FIELD = "hiddenLinkedStrategyProjectIds"
PROJECTS_COLLECTION = "projects"
TASKS_COLLECTION = "tasks"


def init_firestore(service_account_path: pathlib.Path):
    cred = credentials.Certificate(str(service_account_path))
    firebase_admin.initialize_app(cred)
    return firestore.client()


def text(value: Any) -> str:
    return str(value or "").strip()


def task_blob(data: Dict[str, Any]) -> str:
    return " ".join(
        [
            text(data.get("task")),
            text(data.get("person")),
            text(data.get("department")),
            " ".join(text(value) for value in data.get("personKeys") or []),
        ]
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--service-account", required=True, help="Path to Firebase service account JSON")
    parser.add_argument("--project-token", action="append", default=["석산관제솔루션2.5"])
    parser.add_argument("--person", default="최강일")
    args = parser.parse_args()

    service_account = pathlib.Path(args.service_account)
    if not service_account.exists():
        print(f"Service account file not found: {service_account}")
        return 1

    db = init_firestore(service_account)
    print("scanning tasks...", flush=True)
    task_matches: List[Tuple[str, Dict[str, Any]]] = []
    project_ids: Set[str] = set()
    for task_snap in db.collection(TASKS_COLLECTION).stream():
        task = task_snap.to_dict() or {}
        blob = task_blob(task)
        if args.person not in blob:
            continue
        task_matches.append((task_snap.id, task))
        project_id = text(task.get("projectId"))
        if project_id:
            project_ids.add(project_id)

    print(f"person_task_candidates={len(task_matches)}", flush=True)

    print("checking projects...", flush=True)
    project_matches: List[Tuple[str, Dict[str, Any]]] = []
    for project_id in sorted(project_ids):
        project_snap = db.collection(PROJECTS_COLLECTION).document(project_id).get()
        if not project_snap.exists:
            continue
        project = project_snap.to_dict() or {}
        project_text = " ".join(
            [
                text(project.get("name")),
                text(project.get("period")),
                text(project.get("pmEmail")),
                " ".join(text(value) for value in project.get("pmEmails") or []),
            ]
        )
        if all(token in project_text for token in args.project_token if token):
            project_matches.append((project_id, project))

    print(f"project_matches={len(project_matches)}", flush=True)

    print("checking ICT visibility...", flush=True)
    visibility_snap = db.collection(SETTINGS_COLLECTION).document(VISIBILITY_DOC).get()
    visibility_data = visibility_snap.to_dict() or {}
    hidden_ids = [text(value) for value in visibility_data.get(HIDDEN_PROJECT_IDS_FIELD, []) if text(value)]
    hidden_id_set = set(hidden_ids)
    print(f"hidden_linked_strategy_project_ids={hidden_ids}", flush=True)

    person_task_matches = []
    for project_id, project in project_matches:
        print(
            "PROJECT",
            project_id,
            f"name={text(project.get('name'))!r}",
            f"period={text(project.get('period'))!r}",
            f"pmEmail={text(project.get('pmEmail'))!r}",
            f"pmEmails={project.get('pmEmails')!r}",
            f"isHidden={project.get('isHidden')!r}",
            f"hiddenInIct={project_id in hidden_id_set}",
        )
        for task_id, task in task_matches:
            if text(task.get("projectId")) != project_id:
                continue
            person_task_matches.append((project_id, task_id, task))
            print(
                "  TASK",
                task_id,
                f"task={text(task.get('task'))!r}",
                f"person={text(task.get('person'))!r}",
                f"department={text(task.get('department'))!r}",
                f"personKeys={task.get('personKeys')!r}",
                f"isIct={task.get('isIct')!r}",
                f"isHidden={task.get('isHidden')!r}",
                f"parentId={text(task.get('parentId'))!r}",
                flush=True,
            )

    print(f"person_task_matches={len(person_task_matches)}")
    if not project_matches or not person_task_matches:
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())

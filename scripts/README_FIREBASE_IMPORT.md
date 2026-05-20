# Firestore Bulk Import

## Install

```bash
pip install firebase-admin openpyxl
```

## One-time backfill: isHidden field

Before the app's `where("isHidden", "==", false)` filters start excluding hidden docs, every document needs the `isHidden` field present (Firestore's `==` filter does not match docs that are missing the field). Run this once:

```bash
# Dry-run first (no writes)
python scripts/backfill_is_hidden.py \
  --service-account ./serviceAccountKey.json \
  --dry-run

# Apply
python scripts/backfill_is_hidden.py \
  --service-account ./serviceAccountKey.json
```

It scans `projects`, `tasks`, `fa_projects`, `fa_tasks`, `ict_projects`, `ict_tasks` and sets `isHidden = false` on any doc missing or having a non-boolean value. Safe to re-run; existing booleans are not touched.

### Required Firestore composite indexes

The default subscribes combine `isHidden == false` with another field. Firestore needs these composite indexes (the SDK will print an auto-create URL the first time each query runs — click those and create):

| Collection                                | Fields                                                          | Used by                                                  |
| ----------------------------------------- | --------------------------------------------------------------- | -------------------------------------------------------- |
| `tasks` / `fa_tasks` / `ict_tasks`        | `personKeys` (array-contains) + `isHidden` (==)                 | scoped per-person subscribes (my-page, weekly, work-mgmt) |
| `tasks` / `fa_tasks` / `ict_tasks`        | `projectId` (==/in) + `isHidden` (==)                           | PM-scope task subscribes                                  |
| `projects` / `fa_projects` / `ict_projects` | `pmEmail` (==) + `isHidden` (==)                                | PM-scope project subscribes                               |

The single-field queries (collection-scan with only `isHidden == false`) used by `subscribeToData` / `fetchProjectsWithTasks` do **not** need a composite index — Firestore auto-indexes single fields.

## Bulk import

```bash
python scripts/firebase_bulk_import.py \
  --service-account ./serviceAccountKey.json \
  --file ./templates/firebase_import_template.csv
```

Use `.csv` or `.xlsx` for `--file`.

## Required columns

- `project_key`
- `project_id`
- `project_name`
- `project_type`
- `project_period`
- `project_display_order`
- `task_key`
- `task_id`
- `parent_task_key`
- `task_name`
- `task_category`
- `task_department`
- `task_person`
- `task_start_date` (`MM월 dd일`)
- `task_end_date` (`MM월 dd일`)
- `task_status`
- `task_man_days`
- `task_display_order`
- `is_sub_task`

## Notes

- `project_key` groups rows into one project during a single import run.
- Leave `project_id` empty to create a new project doc automatically.
- `task_key` is optional but required if you use `parent_task_key`.
- `parent_task_key` should reference another row's `task_key`.
- If `is_sub_task` is empty, it is auto-detected from `parent_task_key`.

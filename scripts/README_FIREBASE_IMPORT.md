# Firestore Bulk Import

## Install

```bash
pip install firebase-admin openpyxl
```

## Run

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

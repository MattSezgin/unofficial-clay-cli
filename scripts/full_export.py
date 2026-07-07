#!/usr/bin/env python3
"""
Full Clay workbook export — gets ALL rows for every table in a workbook
including externalContent (the full JSON payloads of Claygent / Use AI / HTTP action columns).

Usage:
    python3 full_export.py <workbook_id> <output_dir>

Reads session cookie from ../.clay-session (one directory above this repo) (JSON: {"cookie": "...", "savedAt": "..."}).

Outputs per table:
    <output_dir>/<table_name>__raw.json    # bulk-fetch responses, full fidelity
    <output_dir>/<table_name>__flat.csv    # flattened CSV (one row per record, action cells as JSON strings)
    <output_dir>/<table_name>__schema.json # field definitions + typeSettings (prompts, schemas)
"""
import csv
import json
import os
import sys
import time
import urllib.request
import urllib.parse
from pathlib import Path

CLAY_VERSION = "v20260311_192407Z_5025845142"
BASE = "https://api.clay.com"
BATCH_SIZE = 50
RATE_DELAY = 0.4  # seconds between requests — well below the 200-req limit observed


def load_session() -> str:
    session_path = Path(__file__).resolve().parent.parent.parent / ".clay-session"
    if not session_path.exists():
        sys.exit(f"missing session at {session_path}")
    raw = json.loads(session_path.read_text())
    return raw["cookie"]


def clay_request(method: str, path: str, cookie: str, body=None):
    url = path if path.startswith("http") else BASE + path
    data = None
    headers = {
        "accept": "application/json, text/plain, */*",
        "origin": "https://app.clay.com",
        "referer": "https://app.clay.com/",
        "x-clay-frontend-version": CLAY_VERSION,
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/145.0.0.0 Safari/537.36",
        "cookie": f"claysession={cookie}",
    }
    if body is not None:
        data = json.dumps(body).encode()
        headers["content-type"] = "application/json"
    req = urllib.request.Request(url, data=data, method=method, headers=headers)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode())


def list_workbook_tables(workbook_id: str, cookie: str):
    """Return [{id, name}, ...] for tables in a workbook."""
    data = clay_request("GET", f"/v3/workbooks/{workbook_id}/tables", cookie)
    if isinstance(data, list):
        return data
    return data.get("tables", data.get("results", []))


def get_table_config(table_id: str, cookie: str):
    """Returns {table: {...}, fields: [...], views: [...]}-shaped object."""
    return clay_request("GET", f"/v3/tables/{table_id}", cookie)


def get_record_ids(table_id: str, view_id: str, cookie: str):
    data = clay_request(
        "GET", f"/v3/tables/{table_id}/views/{view_id}/records/ids", cookie
    )
    if isinstance(data, list):
        return data
    for k in ("results", "recordIds", "ids"):
        if k in data:
            return data[k]
    return []


def bulk_fetch(table_id: str, record_ids, external_field_ids, cookie: str):
    return clay_request(
        "POST",
        f"/v3/tables/{table_id}/bulk-fetch-records",
        cookie,
        body={
            "recordIds": record_ids,
            "includeExternalContentFieldIds": external_field_ids,
        },
    )


def flatten_cell(cell):
    """Return a string suitable for CSV. JSON-stringify dicts/lists."""
    if cell is None:
        return ""
    if isinstance(cell, (dict, list)):
        return json.dumps(cell, ensure_ascii=False)
    return str(cell)


def export_table(table_id: str, cookie: str, outdir: Path):
    print(f"  -> {table_id}")
    cfg = get_table_config(table_id, cookie)
    tbl = cfg.get("table") or cfg
    fields = cfg.get("fields") or tbl.get("fields") or []
    view_id = tbl.get("firstViewId") or (tbl.get("views", [{}])[0].get("id"))
    table_name = tbl.get("name", table_id).replace("/", "_")

    print(f"     name: {table_name}")
    print(f"     view: {view_id}")
    print(f"     fields: {len(fields)}")

    # Action fields — these are the columns whose full JSON lives in externalContent
    action_field_ids = [f["id"] for f in fields if f.get("type") == "action"]
    print(f"     action fields (will pull externalContent): {len(action_field_ids)}")

    # Save schema (field defs + typeSettings — includes prompts!)
    (outdir / f"{table_name}__schema.json").write_text(
        json.dumps({"table": tbl, "fields": fields}, indent=2, ensure_ascii=False)
    )

    # Get all record IDs
    record_ids = get_record_ids(table_id, view_id, cookie)
    print(f"     records: {len(record_ids)}")

    # Bulk-fetch in batches
    all_results = []
    for i in range(0, len(record_ids), BATCH_SIZE):
        batch = record_ids[i : i + BATCH_SIZE]
        resp = bulk_fetch(table_id, batch, action_field_ids, cookie)
        results = resp.get("results", resp if isinstance(resp, list) else [])
        all_results.extend(results)
        done = min(i + BATCH_SIZE, len(record_ids))
        print(f"     fetched {done}/{len(record_ids)}")
        time.sleep(RATE_DELAY)

    # Raw dump
    (outdir / f"{table_name}__raw.json").write_text(
        json.dumps({"table": tbl, "fields": fields, "results": all_results}, indent=2, ensure_ascii=False)
    )

    # Flat CSV — one row per record, columns = field names, action cells as JSON
    field_name_by_id = {f["id"]: f["name"] for f in fields}
    headers = ["_recordId", "_createdAt", "_updatedAt"] + [f["name"] for f in fields]
    csv_path = outdir / f"{table_name}__flat.csv"
    with csv_path.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=headers, extrasaction="ignore")
        w.writeheader()
        for rec in all_results:
            row = {
                "_recordId": rec.get("id"),
                "_createdAt": rec.get("createdAt", ""),
                "_updatedAt": rec.get("updatedAt", ""),
            }
            cells = rec.get("cells", {})
            ext = rec.get("externalContent", {})
            for f in fields:
                fid = f["id"]
                fname = f["name"]
                if fid in ext and ext[fid]:
                    row[fname] = flatten_cell(ext[fid])
                else:
                    row[fname] = flatten_cell(cells.get(fid))
            w.writerow(row)

    print(f"     wrote {csv_path.name} + {table_name}__raw.json + __schema.json")
    return {"table_id": table_id, "name": table_name, "rows": len(all_results), "action_fields": len(action_field_ids)}


def main():
    if len(sys.argv) != 3:
        sys.exit("usage: full_export.py <workbook_id> <output_dir>")
    workbook_id = sys.argv[1]
    outdir = Path(sys.argv[2])
    outdir.mkdir(parents=True, exist_ok=True)

    cookie = load_session()

    print(f"Workbook: {workbook_id}")
    tables = list_workbook_tables(workbook_id, cookie)
    print(f"Tables found: {len(tables)}")
    for t in tables:
        print(f"  - {t.get('id')}  {t.get('name')}")

    print()
    print("Exporting...")
    summary = []
    for t in tables:
        try:
            summary.append(export_table(t["id"], cookie, outdir))
        except Exception as e:
            print(f"     FAILED: {e}")
            summary.append({"table_id": t.get("id"), "error": str(e)})

    print()
    print("Summary:")
    print(json.dumps(summary, indent=2))
    (outdir / "_export_summary.json").write_text(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()

import json
from openpyxl import load_workbook

path = r"c:\Users\razon\Downloads\Untitled spreadsheet (3).xlsx"
wb = load_workbook(path, data_only=True)
out = {"sheets": []}
for ws in wb.worksheets:
    rows = []
    for i, r in enumerate(ws.iter_rows(values_only=True), 1):
        if not any(c is not None and str(c).strip() != "" for c in r):
            continue
        rows.append({"row": i, "vals": [c if c is not None else "" for c in r]})
    out["sheets"].append({
        "name": ws.title,
        "dims": ws.dimensions,
        "n": len(rows),
        "rows": rows
    })
print(json.dumps(out, indent=2, default=str))

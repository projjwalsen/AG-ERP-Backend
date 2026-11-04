import json
from openpyxl import load_workbook

path = r"c:\Users\razon\Downloads\RCM_Vouchers_Sorted_Ledger_Wise.xlsx"
wb = load_workbook(path, data_only=True)
out = {"sheets": [], "ledgers": {}}

def money(v):
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return round(float(v), 2)
    s = str(v).replace(",", "").strip()
    if not s:
        return None
    try:
        return round(float(s), 2)
    except ValueError:
        return None

for ws in wb.worksheets:
    rows = list(ws.iter_rows(values_only=True))
    headers = [str(c).strip() if c is not None else "" for c in (rows[0] if rows else [])]
    sample = []
    for r in rows[1:8]:
        sample.append([str(c) if c is not None else "" for c in r[:12]])
    parsed = []
    for r in rows[1:]:
        if not any(c is not None and str(c).strip() != "" for c in r):
            continue
        rec = {}
        for i, h in enumerate(headers):
            rec[h or f"col{i}"] = r[i] if i < len(r) else None
        parsed.append(rec)
    out["sheets"].append({
        "name": ws.title,
        "headers": headers,
        "n": len(parsed),
        "sample": sample,
        "first": parsed[:3] if parsed else [],
    })
    # dump all rows per sheet
    with open(fr"c:\Users\razon\AG_ERP_Backend\.tmp-rcm-sheet-{ws.title.replace('/', '_')}.json", "w", encoding="utf-8") as f:
        json.dump({"headers": headers, "n": len(parsed), "rows": parsed}, f, ensure_ascii=False, default=str)

print(json.dumps({s["name"]: {"headers": s["headers"], "n": s["n"], "sample": s["sample"], "first": s["first"]} for s in out["sheets"]}, indent=2, default=str))


import json, openpyxl
wb=openpyxl.load_workbook(r"c:\\Users\\razon\\AG_ERP_Backend\\.tmp-opstock.xlsx", data_only=True)
ws=wb.active
rows=[]
skip="anionic emulsion ms- kg"
for row in ws.iter_rows(min_row=12, max_row=303, values_only=True):
    name=str(row[0] or "").strip()
    if not name or name.lower()==skip: continue
    qty, rate, val = row[1], row[2], row[3]
    if qty is None or val is None: continue
    q=float(qty); v=float(val)
    if q==0: continue
    rows.append({"name": name, "qty": q, "tallyRate": None if rate is None else float(rate), "value": v, "rawRate": v/q})
print(json.dumps(rows))

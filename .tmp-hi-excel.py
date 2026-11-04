import json
from openpyxl import load_workbook

wb = load_workbook(r"c:\Users\razon\Downloads\Hi.xlsx", data_only=True)
out = {"sheets": wb.sheetnames, "data": {}}
for name in wb.sheetnames:
    ws = wb[name]
    rows = []
    for i, row in enumerate(ws.iter_rows(values_only=True), 1):
        vals = []
        empty = True
        for c in row:
            if c is not None and str(c).strip() != "":
                empty = False
            vals.append(c)
        if empty:
            continue
        rows.append({"r": i, "c": vals})
    out["data"][name] = {"max_row": ws.max_row, "max_col": ws.max_column, "rows": rows[:400]}
print(json.dumps(out, default=str))

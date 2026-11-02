import json
import openpyxl

def money(n):
    return round(float(n or 0) + 1e-12, 2)

def key(s):
    return " ".join(str(s or "").split()).strip().lower()

wb = openpyxl.load_workbook(r"c:\Users\razon\AG_ERP_Backend\.tmp-opstock.xlsx", data_only=True)
ws = wb.active
tally = {}
for row in ws.iter_rows(min_row=12, max_row=303, values_only=True):
    name = str(row[0] or "").strip()
    if not name or name.lower() == "grand total":
        continue
    qty, rate, val = row[1], row[2], row[3]
    k = key(name)
    if k not in tally:
        tally[k] = {"name": name, "qty": 0.0, "rate": rate, "value": 0.0}
    if qty is not None:
        tally[k]["qty"] += float(qty)
    if val is not None:
        tally[k]["value"] += float(val)
    if rate is not None:
        tally[k]["rate"] = float(rate)

pl = openpyxl.load_workbook(r"c:\Users\razon\Downloads\profit-and-loss.xlsx", data_only=True).active
pnl = {}
header = None
for row in pl.iter_rows(min_row=1, max_row=pl.max_row, values_only=True):
    a, b, c = row[0], row[1], row[2]
    if a and str(a).strip().lower() == "opening stock":
        header = money(c)
        continue
    if a and str(a).strip().lower() == "purchase accounts":
        break
    if header is None:
        continue
    name = str(a or "").strip()
    if not name:
        continue
    pnl[key(name)] = {"name": name, "amount": money(b) if b is not None else 0.0}

rows = []
for k, t in tally.items():
    tv = money(t["value"])
    pv = pnl.get(k, {}).get("amount")
    if pv is None:
        if abs(tv) < 0.005:
            continue
        pv = 0.0
    diff = money(tv - pv)
    if abs(diff) >= 0.005:
        rows.append({
            "name": t["name"],
            "qty": t["qty"],
            "rate": t["rate"],
            "tallyValue": tv,
            "pnlAmount": pv,
            "difference": diff,
        })

for k, p in pnl.items():
    if k in tally:
        continue
    if abs(p["amount"]) >= 0.005:
        rows.append({
            "name": p["name"],
            "qty": None,
            "rate": None,
            "tallyValue": 0.0,
            "pnlAmount": p["amount"],
            "difference": money(0 - p["amount"]),
        })

rows.sort(key=lambda r: abs(r["difference"]), reverse=True)

out = {
    "pnlOpeningHeader": header,
    "tallyGrandTotal": money(sum(t["value"] for t in tally.values())),
    "pnlChildrenSum": money(sum(p["amount"] for p in pnl.values())),
    "mismatchCount": len(rows),
    "sumOfDifferences": money(sum(r["difference"] for r in rows)),
    "hardcodeLine": {
        "name": "Opening stock value difference",
        "amount": money(sum(r["difference"] for r in rows)),
    },
    "products": rows,
}
print(json.dumps(out, indent=2))

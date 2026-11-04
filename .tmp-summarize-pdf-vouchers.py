import json
from collections import defaultdict

d = json.load(open(".tmp-screditors-pdf-extract.json", encoding="utf-8"))
v = d["vouchers"]
print("vouchers", len(v))
by = defaultdict(lambda: {"n": 0, "dr": 0.0, "cr": 0.0})
for r in v:
    b = by[r["type"]]
    b["n"] += 1
    if r["side"] == "DEBIT":
        b["dr"] += r["amount"]
    else:
        b["cr"] += r["amount"]
for t, b in sorted(by.items(), key=lambda x: -x[1]["n"]):
    print(f"{t:22} n={b['n']:5} dr={b['dr']:18.2f} cr={b['cr']:18.2f}")

print("\n--- sample Payment ---")
for r in [x for x in v if x["type"] == "Payment"][:3]:
    print(r)
print("--- sample Purchase ---")
for r in [x for x in v if x["type"] == "Purchase"][:3]:
    print(r)
print("--- sample Journal ---")
for r in [x for x in v if x["type"] == "Journal"][:5]:
    print(r)
print("--- openings ---")
o = d["openings"]
print("open count", len(o), "dr", round(sum(x["amount"] for x in o if x["side"]=="DEBIT"),2),
      "cr", round(sum(x["amount"] for x in o if x["side"]=="CREDIT"),2))
print("open sample debit", [x for x in o if x["side"]=="DEBIT"][:3])
print("open sample credit", [x for x in o if x["side"]=="CREDIT"][:3])

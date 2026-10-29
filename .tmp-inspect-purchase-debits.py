import json
d = json.load(open(".tmp-screditors-pdf-extract.json", encoding="utf-8"))
v = d["vouchers"]
purchase_dr = [x for x in v if x["type"] == "Purchase" and x["side"] == "DEBIT"]
purchase_cr = [x for x in v if x["type"] == "Purchase" and x["side"] == "CREDIT"]
print("purchase debit count", len(purchase_dr), "sum", round(sum(x["amount"] for x in purchase_dr), 2))
print("purchase credit count", len(purchase_cr), "sum", round(sum(x["amount"] for x in purchase_cr), 2))
print("largest purchase debits:")
for x in sorted(purchase_dr, key=lambda r: -r["amount"])[:15]:
    print(x)
print("journal debit count", sum(1 for x in v if x["type"]=="Journal" and x["side"]=="DEBIT"),
      "credit", sum(1 for x in v if x["type"]=="Journal" and x["side"]=="CREDIT"))
print("largest journals:")
for x in sorted([r for r in v if r["type"]=="Journal"], key=lambda r: -r["amount"])[:10]:
    print(x["side"], x["amount"], x["agency"], x["no"], x["particulars"])

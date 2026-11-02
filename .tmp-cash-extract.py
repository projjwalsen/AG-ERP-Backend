import json, re
from datetime import datetime
from pypdf import PdfReader

PDF = r"c:\Users\razon\Documents\CASH IN HAND.pdf"
OUT = r"c:\Users\razon\AG_ERP_Backend\.tmp-cash-pdf.json"

def money(s):
    return round(float(str(s).replace(",", "")), 2)

def parse_date(s):
    return datetime.strptime(s, "%d-%b-%y").date().isoformat()

reader = PdfReader(PDF)
text = "\n".join((p.extract_text() or "") for p in reader.pages)
lines = [re.sub(r"\s+", " ", ln).strip() for ln in text.splitlines()]

date_re = re.compile(r"^(\d{1,2}-[A-Za-z]{3}-\d{2})\s+(.*)$")
row_re = re.compile(
    r"^(To|By)\s+(.+?)\s+([\d,]+\.\d{2})(\d+)\s*(CASH PAYMENT|CASH RECEIPT|Salary Payment|Receipt|Payment|Journal|Contra)$",
    re.I,
)
skip = re.compile(
    r"^(A G Ashtavinayaka|SURVEY|KHOPOLI|CIN:|E-Mail|Cash  Book|Page |Date Particulars|Brought Forward|Carried Over|continued|1-Apr-25 to 31-Mar-26|\d+\.\d{2}\s+\d|Office Expenses \d|Courier Charges \d|Printing|Diesel|Conveyance \d)",
    re.I,
)

vouchers = []
openings = []
current_date = None
for ln in lines:
    if not ln or skip.search(ln):
        continue
    if "Opening Balance" in ln:
        m = re.search(r"([\d,]+\.\d{2})", ln)
        side = "CREDIT" if re.search(r"\bBy\b", ln) else "DEBIT"
        # First opening of the year only
        if not openings:
            openings.append({"date": "2025-04-01", "side": side, "amount": money(m.group(1)) if m else 0})
        continue
    if "Closing Balance" in ln:
        continue
    dm = date_re.match(ln)
    rest = ln
    if dm:
        current_date = dm.group(1)
        rest = dm.group(2).strip()
    m = row_re.search(rest)
    if not m:
        continue
    side_word, particular, amt, no, vtype = m.groups()
    if particular.strip().lower() in ("opening balance", "closing balance"):
        continue
    vouchers.append({
        "date": parse_date(current_date) if current_date else None,
        "rawDate": current_date,
        "particular": particular.strip(),
        "type": vtype,
        "no": no,
        "side": "DEBIT" if side_word.lower() == "to" else "CREDIT",
        "amount": money(amt),
    })

per_dr = round(sum(v["amount"] for v in vouchers if v["side"] == "DEBIT"), 2)
per_cr = round(sum(v["amount"] for v in vouchers if v["side"] == "CREDIT"), 2)
open_amt = openings[0]["amount"] if openings else 0
open_side = openings[0]["side"] if openings else "DEBIT"
open_signed = open_amt if open_side == "DEBIT" else -open_amt
close_signed = round(open_signed + per_dr - per_cr, 2)

out = {
    "openings": openings,
    "n": len(vouchers),
    "perDr": per_dr,
    "perCr": per_cr,
    "closeSigned": close_signed,
    "wantOpenDr": 141935.0,
    "wantCloseDr": 140163.15,
    "vouchers": vouchers,
}
print(json.dumps({k: out[k] for k in out if k != "vouchers"}, indent=2))
print("first", vouchers[:4])
print("last", vouchers[-4:])
from collections import Counter
print("types", Counter(v["type"] for v in vouchers))
open(OUT, "w").write(json.dumps(out, indent=2))
print("wrote", OUT)

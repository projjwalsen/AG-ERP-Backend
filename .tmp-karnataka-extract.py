import json, re
from pypdf import PdfReader

PDF = r"c:\Users\razon\Documents\BRANCH KARNATAKA.pdf"
OUT = r"c:\Users\razon\AG_ERP_Backend\.tmp-karnataka-pdf.json"

def money(s):
    return round(float(str(s).replace(",", "")), 2)

reader = PdfReader(PDF)
text = "\n".join((p.extract_text() or "") for p in reader.pages)
# Keep voucher lines; drop headers/footers
lines = [re.sub(r"\s+", " ", ln).strip() for ln in text.splitlines()]
vouchers = []
openings = []
current_date = None
# Date at start: 7-Apr-25
date_re = re.compile(r"^(\d{1,2}-[A-Za-z]{3}-\d{2})\s+(.*)$")
# To/By PARTICULAR amount vchno Type  OR  To/By PARTICULAR amount
row_re = re.compile(
    r"^(To|By)\s+(.+?)\s+([\d,]+\.\d{2})(\d+)\s*(Receipt|Payment|Journal|Contra|Debit Note|Credit Note)$",
    re.I,
)
row_re2 = re.compile(
    r"^(To|By)\s+(.+?)\s+([\d,]+\.\d{2})$",
    re.I,
)

skip = re.compile(
    r"^(A G Ashtavinayaka|SURVEY|KHOPOLI|CIN:|E-Mail|Ledger Account|Survey No|Ankola|Page |Date Particulars|Brought Forward|Carried Over|continued|1-Apr-25 to 31-Mar-26)",
    re.I,
)

for ln in lines:
    if not ln or skip.search(ln):
        continue
    if "Opening Balance" in ln:
        m = re.search(r"([\d,]+\.\d{2})", ln)
        side = "CREDIT" if re.search(r"\bBy\b", ln) else "DEBIT"
        openings.append({"date": "2025-04-01", "side": side, "amount": money(m.group(1)) if m else 0, "type": "Opening Balance"})
        continue
    if "Closing Balance" in ln:
        continue
    dm = date_re.match(ln)
    rest = ln
    if dm:
        current_date = dm.group(1)
        rest = dm.group(2).strip()
    # A line can have multiple To/By rows glued? Usually one.
    m = row_re.search(rest)
    if m:
        side_word, particular, amt, no, vtype = m.groups()
        vouchers.append({
            "date": current_date,
            "particular": particular.strip(),
            "type": vtype,
            "no": no,
            "side": "DEBIT" if side_word.lower() == "to" else "CREDIT",
            "amount": money(amt),
        })
        continue
    # try: Type at end without glued no
    m = re.search(
        r"^(To|By)\s+(.+?)\s+([\d,]+\.\d{2})(\d+)(Receipt|Payment|Journal|Contra)$",
        rest, re.I,
    )
    if m:
        side_word, particular, amt, no, vtype = m.groups()
        vouchers.append({
            "date": current_date,
            "particular": particular.strip(),
            "type": vtype,
            "no": no,
            "side": "DEBIT" if side_word.lower() == "to" else "CREDIT",
            "amount": money(amt),
        })

# totals
per_dr = round(sum(v["amount"] for v in vouchers if v["side"] == "DEBIT"), 2)
per_cr = round(sum(v["amount"] for v in vouchers if v["side"] == "CREDIT"), 2)
open_cr = openings[0]["amount"] if openings and openings[0]["side"] == "CREDIT" else 0
open_dr = openings[0]["amount"] if openings and openings[0]["side"] == "DEBIT" else 0
close_signed = round(open_dr - open_cr + per_dr - per_cr, 2)

out = {
    "openings": openings,
    "n": len(vouchers),
    "perDr": per_dr,
    "perCr": per_cr,
    "closeSigned": close_signed,  # + Dr / - Cr
    "wantCloseCr": 27440680.25,
    "wantPerDr": 389390938.87,
    "wantPerCr": 403559076.00,
    "vouchers": vouchers,
}
print(json.dumps({k: out[k] for k in out if k != "vouchers"}, indent=2))
print("sample", json.dumps(vouchers[:3], indent=2))
print("last", json.dumps(vouchers[-5:], indent=2))
open(OUT, "w").write(json.dumps(out, indent=2))
print("wrote", OUT)

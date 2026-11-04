import json, re
from datetime import datetime
from pypdf import PdfReader

PDF = r"c:\Users\razon\Documents\S Debtor New Export.pdf"
OUT = r"c:\Users\razon\AG_ERP_Backend\.tmp-sd-vouchers.json"

def money(s):
    if s is None or str(s).strip() == "":
        return 0.0
    return round(float(str(s).replace(",", "")), 2)

def parse_date(s):
    s = s.strip()
    for fmt in ("%d-%m-%Y", "%d-%b-%Y", "%d-%b-%y", "%d/%m/%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return s

reader = PdfReader(PDF)
raw_lines = []
for p in reader.pages:
    text = p.extract_text() or ""
    for ln in text.splitlines():
        raw_lines.append(re.sub(r"\s+", " ", ln).strip())

# Typical: 1-4-2025 AGENCY TYPE NO PARTICULARS 1,23.00
# Amounts may be debit or credit (one side filled)
date_re = re.compile(r"^(\d{1,2}-\d{1,2}-\d{4})\s+(.*)$")
# voucher types seen: Journal, Tax Invoice, Receipt, Payment, Debit Note, Credit Note, Contra
type_re = re.compile(
    r"^(.*?)\s+(Journal|Tax Invoice|Receipt|Payment|Debit Note|Credit Note|Contra|Sales|Purchase)\s+(\S+)\s+(.*?)\s+([\d,]+\.\d{2})$",
    re.I,
)
skip = re.compile(r"^(Date Agency|A G Ashtavinayaka|Page |\d+\s*$)", re.I)

vouchers = []
unparsed = []
current_date = None
for ln in raw_lines:
    if not ln or skip.search(ln):
        continue
    dm = date_re.match(ln)
    rest = ln
    if dm:
        current_date = dm.group(1)
        rest = dm.group(2).strip()
    m = type_re.match(rest)
    if not m:
        unparsed.append(ln)
        continue
    agency, vtype, no, particular, amt = m.groups()
    # PDF extraction often concatenates debit+credit or puts amount on one side.
    # The sample lines have a single amount at the end. Side is inferred later
    # from voucher type: Tax Invoice/Debit Note = debit, Receipt/Credit Note = credit,
    # Journal/Payment need particular or we'll store as amount and detect side from
    # a second pass using known patterns.
    vouchers.append({
        "date": parse_date(current_date) if current_date else None,
        "rawDate": current_date,
        "agency": agency.strip(),
        "type": vtype,
        "no": no,
        "particular": particular.strip(),
        "amount": money(amt),
        "raw": ln,
    })

print("vouchers", len(vouchers), "unparsed", len(unparsed))
print("sample vouchers", json.dumps(vouchers[:8], indent=2))
print("sample unparsed", json.dumps(unparsed[:20], indent=2))
print("types", sorted({v["type"] for v in vouchers}))
print("agencies", len({v["agency"] for v in vouchers}))
with open(OUT, "w", encoding="utf-8") as f:
    json.dump({"n": len(vouchers), "unparsedN": len(unparsed), "unparsedSample": unparsed[:50], "vouchers": vouchers}, f)

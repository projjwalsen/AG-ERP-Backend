import json, re
from datetime import datetime
from pypdf import PdfReader

def money(s):
    return round(float(str(s).replace(",", "")), 2)

def parse_date(s):
    s = s.strip()
    for fmt in ("%d-%b-%y", "%d-%b-%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return s

FILES = [
    (r"c:\Users\razon\Documents\CPCB Expense.pdf", "cpcb"),
    (r"c:\Users\razon\Documents\Prepaid Exxpenses.pdf", "expenses"),
    (r"c:\Users\razon\Documents\Prepaid Insurance.pdf", "insurance"),
    (r"c:\Users\razon\Documents\Prepaid License - 1.pdf", "licence"),
    (r"c:\Users\razon\Documents\Prepaid License Fees - 1.pdf", "license_fees"),
]

date_re = re.compile(r"^(\d{1,2}-[A-Za-z]{3}-\d{2})\s+(.*)$")
row_re = re.compile(
    r"^(To|By)\s+(.+?)\s+([\d,]+\.\d{2})(\d+)\s*(CASH PAYMENT|CASH RECEIPT|Salary Payment|Receipt|Payment|Journal|Contra|Debit Note|Credit Note)$",
    re.I,
)
row_re2 = re.compile(
    r"^(To|By)\s+(.+?)\s+([\d,]+\.\d{2})$",
    re.I,
)
skip = re.compile(
    r"^(A G Ashtavinayaka|SURVEY|KHOPOLI|CIN:|E-Mail|Ledger Account|Page |Date Particulars|Brought Forward|Carried Over|continued|1-Apr-25 to 31-Mar-26)",
    re.I,
)

for src, key in FILES:
    reader = PdfReader(src)
    text = "\n".join((p.extract_text() or "") for p in reader.pages)
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in text.splitlines()]
    vouchers = []
    openings = []
    closings = []
    current_date = None
    for ln in lines:
        if not ln or skip.search(ln):
            continue
        if "Opening Balance" in ln:
            m = re.search(r"([\d,]+\.\d{2})", ln)
            side = "CREDIT" if re.search(r"\bBy\b", ln) else "DEBIT"
            openings.append({"side": side, "amount": money(m.group(1)) if m else 0, "raw": ln})
            continue
        if "Closing Balance" in ln:
            m = re.search(r"([\d,]+\.\d{2})", ln)
            side = "CREDIT" if re.search(r"\bBy\b", ln) else "DEBIT"
            closings.append({"side": side, "amount": money(m.group(1)) if m else 0, "raw": ln})
            continue
        dm = date_re.match(ln)
        rest = ln
        if dm:
            current_date = dm.group(1)
            rest = dm.group(2).strip()
        m = row_re.search(rest) or row_re2.search(rest)
        if not m:
            continue
        groups = m.groups()
        side_word, particular, amt = groups[0], groups[1], groups[2]
        no = groups[3] if len(groups) > 3 else None
        vtype = groups[4] if len(groups) > 4 else None
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
            "raw": ln,
        })
    per_dr = round(sum(v["amount"] for v in vouchers if v["side"] == "DEBIT"), 2)
    per_cr = round(sum(v["amount"] for v in vouchers if v["side"] == "CREDIT"), 2)
    out = {
        "file": src,
        "pages": len(reader.pages),
        "openings": openings,
        "closings": closings,
        "n": len(vouchers),
        "perDr": per_dr,
        "perCr": per_cr,
        "preview": "\n".join(lines[:40]),
        "vouchers": vouchers,
        "unparsed_sample": [ln for ln in lines if ln and not skip.search(ln)][:15],
    }
    path = fr"c:\Users\razon\AG_ERP_Backend\.tmp-prepaid-{key}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(key, "pages", out["pages"], "n", out["n"], "open", openings, "close", closings, "dr", per_dr, "cr", per_cr)
    print("--- preview ---")
    print(out["preview"][:1500])
    print()

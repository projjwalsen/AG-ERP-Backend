import json, re
from datetime import datetime
from pypdf import PdfReader

def money(s):
    return round(float(str(s).replace(",", "")), 2)

def parse_date(s):
    return datetime.strptime(s, "%d-%b-%y").date().isoformat()

date_re = re.compile(r"^(\d{1,2}-[A-Za-z]{3}-\d{2})\s+(.*)$")
# amount concatenated with voucher: 1,260.163790Journal  or  3,813.70039/2025-26Journal Expenses
row_re = re.compile(
    r"^(To|By)\s+(.+?)\s+([\d,]+\.\d{2})(\S*?)\s*(Journal(?: Expenses| Expense)?|Payment|Receipt|Contra)?$",
    re.I,
)

skip = re.compile(
    r"^(A G Ashtavinayaka|SURVEY|KHOPOLI|CIN:|E-Mail|Ledger Account|Page |Date Particulars|Brought Forward|Carried Over|continued|1-Apr-25 to 31-Mar-26|Prepaid )",
    re.I,
)

def parse(path):
    reader = PdfReader(path)
    text = "\n".join((p.extract_text() or "") for p in reader.pages)
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in text.splitlines()]
    vouchers = []
    openings = []
    current_date = None
    for ln in lines:
        if not ln or skip.search(ln):
            continue
        if "Opening Balance" in ln:
            m = re.search(r"([\d,]+\.\d{2})", ln)
            side = "CREDIT" if re.search(r"\bBy\b", ln) else "DEBIT"
            openings.append({"side": side, "amount": money(m.group(1)) if m else 0})
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
        # skip totals-only numeric lines
        if re.fullmatch(r"[\d,.]+", particular.replace(" ", "")):
            continue
        vouchers.append({
            "date": parse_date(current_date) if current_date else None,
            "particular": particular.strip(),
            "type": vtype or "Journal",
            "no": no or None,
            "side": "DEBIT" if side_word.lower() == "to" else "CREDIT",
            "amount": money(amt),
        })
    return {
        "openings": openings,
        "n": len(vouchers),
        "perDr": round(sum(v["amount"] for v in vouchers if v["side"] == "DEBIT"), 2),
        "perCr": round(sum(v["amount"] for v in vouchers if v["side"] == "CREDIT"), 2),
        "vouchers": vouchers,
        "lines": lines,
    }

ins = parse(r"c:\Users\razon\Documents\Prepaid Insurance.pdf")
print("insurance n", ins["n"], "dr", ins["perDr"], "cr", ins["perCr"], "open", ins["openings"])
print("credits", [v for v in ins["vouchers"] if v["side"] == "CREDIT"])
print("debits n", len([v for v in ins["vouchers"] if v["side"] == "DEBIT"]))
print("debit sample", [v for v in ins["vouchers"] if v["side"] == "DEBIT"][:15])
print("ALL LINES PAGE2-ish")
for ln in ins["lines"]:
    print(ln)

with open(r"c:\Users\razon\AG_ERP_Backend\.tmp-prepaid-insurance.json", "w", encoding="utf-8") as f:
    json.dump(ins, f, ensure_ascii=False)

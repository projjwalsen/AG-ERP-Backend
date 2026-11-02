import json, re
from datetime import datetime
from pypdf import PdfReader

def money(s):
    return round(float(str(s).replace(",", "")), 2)

def parse_date(s):
    s = (s or "").strip()
    for fmt in ("%d-%b-%y", "%d-%b-%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return s

date_re = re.compile(r"^(\d{1,2}-[A-Za-z]{3}-\d{2})\s+(.*)$")
row_re = re.compile(
    r"^(To|By)\s+(.+?)\s+([\d,]+\.\d{2})([A-Za-z0-9/_-]*)\s*(Journal(?: Expenses| Expense)?|Payment|Receipt|Contra)?$",
    re.I,
)
skip = re.compile(
    r"^(A G Ashtavinayaka|SURVEY|KHOPOLI|CIN:|E-Mail|Ledger Account|Page |Date Particulars|Brought Forward|Carried Over|continued|1-Apr-25 to 31-Mar-26)",
    re.I,
)

def parse(path):
    reader = PdfReader(path)
    lines = []
    for p in reader.pages:
        text = p.extract_text() or ""
        lines.extend([re.sub(r"\s+", " ", ln).strip() for ln in text.splitlines() if ln.strip()])
    vouchers, openings, closings = [], [], []
    current_date = None
    unparsed = []
    for ln in lines:
        if skip.search(ln) and "Opening" not in ln and "Closing" not in ln:
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
        m = row_re.search(rest)
        if not m:
            if rest and not re.match(r"^[\d,]+\.\d{2}", rest) and "Prepaid" not in rest:
                unparsed.append(ln)
            continue
        side_word, particular, amt, no, vtype = m.groups()
        if particular.strip().lower() in ("opening balance", "closing balance"):
            continue
        if re.fullmatch(r"[\d,.]+", particular.replace(" ", "")):
            continue
        vouchers.append({
            "date": parse_date(current_date) if current_date else None,
            "rawDate": current_date,
            "particular": particular.strip(),
            "type": vtype or "Journal",
            "no": no or None,
            "side": "DEBIT" if side_word.lower() == "to" else "CREDIT",
            "amount": money(amt),
            "raw": ln,
        })
    per_dr = round(sum(v["amount"] for v in vouchers if v["side"] == "DEBIT"), 2)
    per_cr = round(sum(v["amount"] for v in vouchers if v["side"] == "CREDIT"), 2)
    open_amt = openings[0]["amount"] if openings else 0
    open_side = openings[0]["side"] if openings else "DEBIT"
    signed = open_amt if open_side == "DEBIT" else -open_amt
    close_signed = round(signed + per_dr - per_cr, 2)
    return {
        "file": path, "pages": len(reader.pages),
        "openings": openings, "closings": closings,
        "n": len(vouchers), "perDr": per_dr, "perCr": per_cr,
        "closeSigned": close_signed,
        "vouchers": vouchers, "unparsed": unparsed, "lines": lines,
    }

for src, key in [
    (r"c:\Users\razon\Documents\Prepaid Insurance.pdf", "insurance"),
    (r"c:\Users\razon\Documents\Prepaid Exxpenses.pdf", "expenses"),
]:
    out = parse(src)
    with open(fr"c:\Users\razon\AG_ERP_Backend\.tmp-pe-{key}.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(key, "n", out["n"], "dr", out["perDr"], "cr", out["perCr"], "open", out["openings"], "close", out["closings"], "calc", out["closeSigned"], "unparsed", out["unparsed"])

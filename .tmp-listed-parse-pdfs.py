import json, re, os
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
# Tally often concatenates amount + voucher no + type
row_re = re.compile(
    r"^(To|By)\s+(.+?)\s+([\d,]+\.\d{2})(.*)$",
    re.I,
)
vtype_re = re.compile(
    r"(Journal(?: Expenses| Expense)?|Salary Journal|Payment|Receipt|Contra|Purchase|Debit Note|Credit Note)$",
    re.I,
)
skip = re.compile(
    r"^(A G Ashtavinayaka|SURVEY|KHOPOLI|CIN:|E-Mail|Ledger Account|Page |Date Particulars|Brought Forward|Carried Over|continued|1-Apr-25 to 31-Mar-26|Brindavan|CST Road|Santacruz|Mumbai)",
    re.I,
)

FILES = {
    "cgst_itc": r"c:\Users\razon\Documents\CGST ITC Not Reflected in GSTR-2B- Current Liabilities - Duties & Taxes - GST -  Input GST.pdf",
    "sgst_itc": r"c:\Users\razon\Documents\CGST ITC Not Reflected in GSTR-2B - Current Liabilities - Duties & Taxes - GST -  Input GST.pdf",
    "tds_lt": r"c:\Users\razon\Documents\TDS RECEIVABLE ON UNSECURED LOAN-L & T FINANCE- Current Assets - TDS RECEIVABLE ON UNSECURED LOAN.pdf",
    "inel_sgst": r"c:\Users\razon\Documents\Ineligible ITC 17(5) -SGST - Indirect Expesne - Rate & Taxes.pdf",
    "inel_igst": r"c:\Users\razon\Documents\Ineligible ITC 17(5) - IGST - Indirect Expense - Rate & Taxes.pdf",
    "inel_cgst": r"c:\Users\razon\Documents\Ineligible ITC 17(5) - CGST- Indirect Expense - Rate & Taxes.pdf",
    "vanishka": r"c:\Users\razon\Documents\Vqanishka Anil Menda Salary - Indirect Expense - Employee Benifit Expenses .pdf",
    "prarthana": r"c:\Users\razon\Documents\Prarthana Anil Menda Salary - Indirect Expense - Employee Benifit Expenses - Salary Paid to Related Person.pdf",
    "anil": r"c:\Users\razon\Documents\Anil Menda Salary - Indirect Expense - Employee Benifit Expenses - Salary Paid to Related Person.pdf",
    "wages": r"c:\Users\razon\Documents\Salary & Wages - Indirect Expense - Employee Benifit Expenses.pdf",
}

def parse(path):
    reader = PdfReader(path)
    lines = []
    for p in reader.pages:
        text = p.extract_text() or ""
        lines.extend([re.sub(r"\s+", " ", ln).strip() for ln in text.splitlines() if ln.strip()])
    title = next((ln for ln in lines if "Ledger" not in ln and ln not in (
        "A G Ashtavinayaka Petrochem Pvt Ltd - Maharashtra",
    ) and not skip.search(ln)), "")
    vouchers, openings, closings, unparsed = [], [], [], []
    current_date = None
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
            if rest and not re.match(r"^[\d,.]+", rest):
                unparsed.append(ln)
            continue
        side_word, particular, amt, tail = m.groups()
        if particular.strip().lower() in ("opening balance", "closing balance"):
            continue
        tail = (tail or "").strip()
        vt = vtype_re.search(tail)
        vtype = vt.group(1) if vt else None
        no = tail[:vt.start()].strip() if vt else tail
        vouchers.append({
            "date": parse_date(current_date) if current_date else None,
            "rawDate": current_date,
            "particular": particular.strip(),
            "type": vtype,
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
        "title": title, "n": len(vouchers), "perDr": per_dr, "perCr": per_cr,
        "openings": openings, "closings": closings, "closeSigned": close_signed,
        "vouchers": vouchers, "unparsed": unparsed[:20],
    }

out = {}
for key, path in FILES.items():
    parsed = parse(path)
    out[key] = {k: parsed[k] for k in parsed if k != "vouchers"}
    with open(fr"c:\Users\razon\AG_ERP_Backend\.tmp-listed-{key}.json", "w", encoding="utf-8") as f:
        json.dump(parsed, f, ensure_ascii=False)
print(json.dumps(out, indent=2))

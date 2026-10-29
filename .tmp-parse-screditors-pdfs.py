from pypdf import PdfReader
import json, re, collections

AMT = re.compile(r"[\d,]+\.\d{2}")
DATE = re.compile(r"^\s*(\d{1,2}-\d{1,2}-\d{4})\s+(.*)$")
TYPES = [
    "Opening Balance", "Journal Expenses", "RCM Purchase", "RCM Debit Note",
    "Inward Debit Note", "Inward Credit Note", "CASH PAYMENT", "Salary Payment",
    "Tax Invoice", "Payment", "Receipt", "Purchase", "Journal"
]

def money(s):
    return round(float(s.replace(",", "")), 2)

def cents(v):
    return int(round(v * 100))

def parse_voucher_like(path):
    r = PdfReader(path)
    rows = []
    skipped = []
    debit_idx = credit_idx = None
    for pi, page in enumerate(r.pages):
        lines = (page.extract_text(extraction_mode="layout") or "").splitlines()
        page_max = max((len(ln.rstrip()) for ln in lines), default=0)
        header = next((ln for ln in lines if "Debit Amount" in ln and "Credit Amount" in ln), None)
        if header:
            debit_idx = header.find("Debit Amount")
            credit_idx = header.find("Credit Amount")
        if page_max:
            credit_cut = page_max - 16
        elif credit_idx is not None:
            credit_cut = credit_idx - 4
        else:
            skipped.append({"page": pi + 1, "line": "NO_HEADER"})
            continue
        for ln in lines:
            m = DATE.match(ln)
            if not m:
                continue
            date, rest = m.group(1), m.group(2)
            found = None
            for t in TYPES:
                idx = rest.find(t)
                if idx >= 0:
                    found = (t, idx)
                    break
            amts = list(AMT.finditer(ln))
            if not found or not amts:
                skipped.append({"page": pi + 1, "line": ln.strip()})
                continue
            vtype, tidx = found
            agency = rest[:tidx].strip()
            after = rest[tidx + len(vtype):].strip()
            last = amts[-1]
            amount = money(last.group())
            side = "CREDIT" if last.start() >= credit_cut else "DEBIT"
            # voucher no is the first token after type; particulars the rest minus amount
            after_wo_amt = (ln[m.end():last.start()] if True else after)
            # after type in original rest
            after_part = rest[tidx + len(vtype):].strip()
            # strip trailing amount from after_part
            after_part = AMT.sub("", after_part).strip()
            parts = after_part.split()
            voucher_no = parts[0] if parts else ""
            particulars = " ".join(parts[1:]) if len(parts) > 1 else ""
            rows.append({
                "date": date,
                "agency": agency,
                "type": vtype,
                "no": voucher_no,
                "particulars": particulars,
                "side": side,
                "amount": amount
            })
    return rows, skipped

def parse_group_summary(path):
    r = PdfReader(path)
    ledgers = []
    skip_re = re.compile(
        r"^(particulars|grand total|sundry creditors|a g ashtavinayaka|cin:|e-mail|"
        r"group summary|1-apr|khopoli|survey|carried|brought|continued|page |debit|credit|"
        r"opening balance|closing balance|p a r t i c u l a r s)",
        re.I,
    )
    for page in r.pages:
        lines = (page.extract_text(extraction_mode="layout") or "").splitlines()
        header = next((ln for ln in lines if ln.count("Debit") >= 1 and ln.count("Credit") >= 1 and "Particulars" not in ln and not ln.strip().startswith("SUNDRY")), None)
        # column anchors from a 4-amount line if possible
        for ln in lines:
            name = ln.strip()
            if not name or skip_re.match(name.replace("  ", " ")):
                continue
            if re.search(r"C a r r i e d|B r o u g h t|G r a n d", ln):
                continue
            amts = [(m.start(), money(m.group())) for m in AMT.finditer(ln)]
            # strip amounts from name
            raw_name = AMT.sub("", ln).strip()
            raw_name = re.sub(r"\s+", " ", raw_name)
            if not raw_name or skip_re.match(raw_name):
                continue
            # infer 4 columns by position: OpenDr ~67, OpenCr ~84, CloseDr ~102, CloseCr ~116 from page1
            open_dr = open_cr = close_dr = close_cr = 0.0
            for pos, val in amts:
                if pos < 78:
                    open_dr = val
                elif pos < 100:
                    open_cr = val
                elif pos < 118:
                    close_dr = val
                else:
                    close_cr = val
            ledgers.append({
                "name": raw_name,
                "openDr": open_dr,
                "openCr": open_cr,
                "closeDr": close_dr,
                "closeCr": close_cr,
                "n": len(amts),
                "positions": [p for p, _ in amts]
            })
    return ledgers

open_rows, open_skip = parse_voucher_like(r"c:\Users\razon\Documents\S.Creditors Opening Balance.pdf")
vouch_rows, vouch_skip = parse_voucher_like(r"c:\Users\razon\Documents\Sundry Creditors Tally new.pdf")
summary = parse_group_summary(r"c:\Users\razon\Documents\S.Creditors.pdf")

def tot(rows, side):
    return round(sum(r["amount"] for r in rows if r["side"] == side), 2)

out = {
    "openings": {
        "count": len(open_rows),
        "debit": tot(open_rows, "DEBIT"),
        "credit": tot(open_rows, "CREDIT"),
        "skipped": open_skip[:20],
        "skippedCount": len(open_skip),
    },
    "vouchers": {
        "count": len(vouch_rows),
        "debit": tot(vouch_rows, "DEBIT"),
        "credit": tot(vouch_rows, "CREDIT"),
        "skipped": vouch_skip[:20],
        "skippedCount": len(vouch_skip),
        "types": dict(collections.Counter(r["type"] for r in vouch_rows)),
    },
    "summary": {
        "count": len(summary),
        "openDr": round(sum(r["openDr"] for r in summary), 2),
        "openCr": round(sum(r["openCr"] for r in summary), 2),
        "closeDr": round(sum(r["closeDr"] for r in summary), 2),
        "closeCr": round(sum(r["closeCr"] for r in summary), 2),
    }
}
print(json.dumps(out, indent=2))
json.dump({"openings": open_rows, "vouchers": vouch_rows, "summary": summary}, open(".tmp-screditors-pdf-extract.json", "w"), indent=2)
print("wrote .tmp-screditors-pdf-extract.json")

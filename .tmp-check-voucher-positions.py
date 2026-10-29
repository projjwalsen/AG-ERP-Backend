from pypdf import PdfReader
import re
from collections import Counter

r = PdfReader(r"c:\Users\razon\Documents\Sundry Creditors Tally new.pdf")
AMT = re.compile(r"[\d,]+\.\d{2}")
DATE = re.compile(r"^\s*\d{1,2}-\d{1,2}-\d{4}")
header = None
debit_idx = credit_idx = None
starts = Counter()
pages_checked = [0, 1, 50, 100, 172]
for pi in pages_checked:
    page = r.pages[pi]
    lines = (page.extract_text(extraction_mode="layout") or "").splitlines()
    h = next((ln for ln in lines if "Debit Amount" in ln and "Credit Amount" in ln), None)
    if h:
        header = h
        debit_idx = h.find("Debit Amount")
        credit_idx = h.find("Credit Amount")
    print(f"\nPAGE {pi+1} header debit={debit_idx} credit={credit_idx} linelen_max={max((len(ln) for ln in lines), default=0)}")
    local = Counter()
    for ln in lines:
        if not DATE.match(ln):
            continue
        amts = list(AMT.finditer(ln))
        if not amts:
            continue
        m = amts[-1]
        local[m.start()] += 1
        starts[m.start()] += 1
    print(" amount starts", sorted(local.items())[:15], "..." if len(local)>15 else "")
    # print 2 debit-like and 2 credit-like
    shown_d = shown_c = 0
    for ln in lines:
        if not DATE.match(ln):
            continue
        amts = list(AMT.finditer(ln))
        if not amts:
            continue
        m = amts[-1]
        side = "CR" if m.start() >= (credit_idx or 150) - 4 else "DR"
        if side == "DR" and shown_d < 1:
            print(" DR", m.start(), m.group(), ln[:110])
            shown_d += 1
        if side == "CR" and shown_c < 1:
            print(" CR", m.start(), m.group(), ln[:110])
            shown_c += 1
print("\nALL starts", sorted(starts.items())[:30])

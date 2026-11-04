import json, os, re
from pypdf import PdfReader

FILES = [
    r"c:\Users\razon\Documents\CGST ITC Not Reflected in GSTR-2B - Current Liabilities - Duties & Taxes - GST -  Input GST.pdf",
    r"c:\Users\razon\Documents\CGST ITC Not Reflected in GSTR-2B- Current Liabilities - Duties & Taxes - GST -  Input GST.pdf",
    r"c:\Users\razon\Documents\TDS RECEIVABLE ON UNSECURED LOAN-L & T FINANCE- Current Assets - TDS RECEIVABLE ON UNSECURED LOAN.pdf",
    r"c:\Users\razon\Documents\Ineligible ITC 17(5) -SGST - Indirect Expesne - Rate & Taxes.pdf",
    r"c:\Users\razon\Documents\Ineligible ITC 17(5) - IGST - Indirect Expense - Rate & Taxes.pdf",
    r"c:\Users\razon\Documents\Ineligible ITC 17(5) - CGST- Indirect Expense - Rate & Taxes.pdf",
    r"c:\Users\razon\Documents\Vqanishka Anil Menda Salary - Indirect Expense - Employee Benifit Expenses .pdf",
    r"c:\Users\razon\Documents\Prarthana Anil Menda Salary - Indirect Expense - Employee Benifit Expenses - Salary Paid to Related Person.pdf",
    r"c:\Users\razon\Documents\Anil Menda Salary - Indirect Expense - Employee Benifit Expenses - Salary Paid to Related Person.pdf",
    r"c:\Users\razon\Documents\Salary & Wages - Indirect Expense - Employee Benifit Expenses.pdf",
]

out = {}
for path in FILES:
    name = os.path.basename(path)
    reader = PdfReader(path)
    pages = []
    for i, p in enumerate(reader.pages):
        pages.append(p.extract_text() or "")
    text = "\n".join(pages)
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in text.splitlines() if ln.strip()]
    out[name] = {
        "pages": len(reader.pages),
        "chars": len(text),
        "head": lines[:40],
        "tail": lines[-30:],
    }
    safe = re.sub(r"[^A-Za-z0-9]+", "_", name)[:80]
    with open(fr"c:\Users\razon\AG_ERP_Backend\.tmp-listed-pdf-{safe}.txt", "w", encoding="utf-8") as f:
        f.write(text)

print(json.dumps(out, indent=2, ensure_ascii=False))

"""Extract all unsecured-loan Excel registers and the PDF group summary."""
import json
import os
from datetime import datetime, date
from openpyxl import load_workbook
from pypdf import PdfReader

BATCH1 = r"c:\Users\razon\Downloads\Unsecured_Loan_Ledgers_Excel_Files"
BATCH2 = r"c:\Users\razon\Downloads\Unsecured_Loan_Ledgers_Excel_Files_Batch2"
PDF = r"c:\Users\razon\Documents\Unsec Loan.pdf"
OUT = r"c:\Users\razon\AG_ERP_Backend\.tmp-unsec-excel.json"

MAP = {
    "ART_Infra_Loan_-_Unsecured_From_Other_Bank.xlsx": ("Art Infrastructure Pvt Ltd - Loan A/c", "Unsecured from Other than Bank"),
    "Auriolis_Finvest_BIZFUND_-_Unsecured_From_Other_Bank.xlsx": ("Auriolus Finvest Pvt Ltd (BIZFUNDS)", "Unsecured from Other than Bank"),
    "AXIS_BANK_2112_-_Unsecured_From_Bank.xlsx": ("AXIS BANK BPR032712902112", "Unsecured from Bank"),
    "AXIS_CORPORATE_-_0344_-_Unsecured_From_Bank.xlsx": ("AXIS CORPORATE CARD 0344", "Unsecured from Bank"),
    "HDFC_CORPORATE_CARD_9607_-_Unsecured_From_Bank.xlsx": ("HDFC CORPORATE CARD -9607", "Unsecured from Bank"),
    "HDFC_CORPORATE_CARD_V2P_3288_-_Unsecured_From_Bank.xlsx": ("HDFC CORPORATE CARD - V2P 3288", "Unsecured from Bank"),
    "HDFC_CORPORATE_CARD_V2P_3767_-_Unsecured_From_Bank.xlsx": ("HDFC CORPORATE CARD - V2P 3767", "Unsecured from Bank"),
    "IDBI_BANK_LIMITED_-_Unsecured_From_Bank.xlsx": ("IDBI BANK LIMITED", "Unsecured from Bank"),
    "L_T_Finance_Holdings_Ltd_100133_-_Unsecured_From_Other_Bank.xlsx": ("L&T Finance Holdings Limited. BL231224040100133", "Unsecured from Other than Bank"),
    "L_T_FINANCE_LTD_600976_-_Unsecured_From_Other_Bank.xlsx": ("L &T FINANCE LIMITED BL250613256600976", "Unsecured from Other than Bank"),
    "MAS_FINANCIAL_SERVICES_1230_-_Unsecured_From_Other_Bank.xlsx": ("MAS FINANCIAL SERVICES LTD -5391230", "Unsecured from Other than Bank"),
    "Mihima_Menda_-_Loan_From_Director_-_Unsecured_From_Director.xlsx": ("Mahima Menda - Loan From Director", "Loan From Directors"),
    "Sandeep_Singh_-_Loan_From_Director_-_Unsecured_From_Director.xlsx": ("Sandeep Singh - Loan From Director", "Loan From Directors"),
    "SHREE_GURU_KRIPA_ENT_CR_-_Unsecured_From_Other_Bank.xlsx": ("SHREE GURU KRIPA ENTERPRISES (DR)", "Unsecured from Other than Bank"),
    "TATA_CAPITAL_LIMITED_-_Unsecured_From_Other_Bank.xlsx": ("TATA CAPITAL LIMITED", "Unsecured from Other than Bank"),
    "UNITY_SMALL_FINANCE_BANK_LTD_-_Unsecured_From_Other_Bank.xlsx": ("UNITY SMALL FINANCE BANK LTD", "Unsecured from Other than Bank"),
    "AXIS_BANK_LOAN_41270_-_Unsecured_Loan.xlsx": ("AXIS BANK LOAN - BPR064708241270", "Unsecured Loans"),
    "CLIX_CAPITAL_SERVICES_-_Unsecured_Loan.xlsx": ("CLIX CAPITAL SERVICES PVT LTD", "Unsecured Loans"),
    "HDFC_CORPORATE_CARD_4385_-_Unsecured_Loan.xlsx": ("HDFC CORPORATE CARD -4385", "Unsecured Loans"),
    "ICICI_Business_Loan_26149_-_Unsecured_Loan.xlsx": ("ICICI Business Loan - UPMUM00046126149", "Unsecured Loans"),
    "IVC_LOGISTICS_LIMITED_-_Unsecured_Loan.xlsx": ("IVC LOGISTICS LIMITED", "Unsecured Loans"),
    "MAS_FINANCIAL_-_VENDOR_-_Unsecured_Loan.xlsx": ("MAS FINANCIAL SERVICES LTD - VENDOR", "Unsecured Loans"),
    "MONEYWISE_FINANCIAL_SERVICES_-_Unsecured_Loan.xlsx": ("MONEYWISE FINANCIAL SERICES PVT LTD - BL00711", "Unsecured Loans"),
    "POONAWALA_24326_-_Unsecured_Loan.xlsx": ("POONAWALA FINCORP LTD - BLU0027DSC000006124326", "Unsecured Loans"),
    "SHRIRAM_FINANCE_LTD_-_Unsecured_Loan.xlsx": ("SHRIRAM FINANCE LIMITED", "Unsecured Loans"),
    "VAISHNAVI_-_Unsecured_Loan.xlsx": ("VAISHNAVI ENTERPRISES", "Unsecured Loans"),
    "YES_BANK_TERM_LOAN_-_690001_-_Unsecured_Loan.xlsx": ("YES BANK TERM LOAN 803LA42250690001", "Unsecured Loans"),
    "YES_BANK_TERM_LOAN_920001_-_Unsecured_Loan.xlsx": ("YES BANK TERM LOAN 803LA42250920001", "Unsecured Loans"),
}

def parse_date(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    s = str(v).strip()
    for fmt in ("%d-%b-%y", "%d-%b-%Y", "%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(s, fmt).date().isoformat()
        except ValueError:
            pass
    return s

def money(v):
    if v is None or v == "":
        return 0.0
    return round(float(v), 2)

def extract_xlsx(path, ledger, group):
    wb = load_workbook(path, data_only=True)
    ws = wb[wb.sheetnames[0]]
    openings, closing, vouchers = [], None, []
    per_dr = per_cr = 0.0
    for i, row in enumerate(ws.iter_rows(values_only=True), 1):
        if i == 1:
            continue
        dt, particular, vtype, no, debit, credit = (list(row) + [None] * 6)[:6]
        vtype_s = str(vtype or "").strip()
        if not vtype_s and not debit and not credit:
            continue
        if vtype_s.lower() == "opening balance":
            side = "DEBIT" if debit else "CREDIT"
            amt = money(debit or credit)
            openings.append({"date": parse_date(dt), "side": side, "amount": amt, "type": vtype_s})
            continue
        if vtype_s.lower() == "closing balance":
            side = "DEBIT" if debit else "CREDIT"
            amt = money(debit or credit)
            closing = {"date": parse_date(dt), "side": side, "amount": amt}
            continue
        if debit and money(debit):
            side, amt = "DEBIT", money(debit)
        elif credit and money(credit):
            side, amt = "CREDIT", money(credit)
        else:
            continue
        if side == "DEBIT":
            per_dr += amt
        else:
            per_cr += amt
        vouchers.append({
            "date": parse_date(dt),
            "particular": str(particular or "").strip(),
            "type": vtype_s,
            "no": str(no).strip() if no is not None else "",
            "side": side,
            "amount": amt,
        })
    return {
        "file": os.path.basename(path),
        "ledger": ledger,
        "group": group,
        "openings": openings,
        "closing": closing,
        "vouchers": vouchers,
        "n": len(vouchers),
        "perDr": round(per_dr, 2),
        "perCr": round(per_cr, 2),
    }

ledgers = []
for folder in (BATCH1, BATCH2):
    for name in os.listdir(folder):
        if not name.lower().endswith(".xlsx"):
            continue
        if name not in MAP:
            print("UNMAPPED", name)
            continue
        ledger, group = MAP[name]
        rec = extract_xlsx(os.path.join(folder, name), ledger, group)
        ledgers.append(rec)
        print(f"{rec['ledger'][:50]:50} n={rec['n']:4} dr={rec['perDr']:14.2f} cr={rec['perCr']:14.2f} open={rec['openings']} close={rec['closing']}")

reader = PdfReader(PDF)
pdf_text = "\n".join(p.extract_text() or "" for p in reader.pages)

out = {"ledgers": ledgers, "pdfText": pdf_text}
with open(OUT, "w", encoding="utf-8") as f:
    json.dump(out, f)
print("wrote", OUT, "ledgers", len(ledgers))

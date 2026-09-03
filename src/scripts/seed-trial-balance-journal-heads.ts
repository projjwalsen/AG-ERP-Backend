/**
 * Seed JournalHeads from the Ledger-wise Trial Balance export.
 *
 * This is intentionally idempotent. It creates only missing journal heads
 * and does not create opening balances or voucher entries.
 *
 * Run with:
 *   npx tsx src/scripts/seed-trial-balance-journal-heads.ts
 */
import { LedgerNature, LedgerType } from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const TRIAL_BALANCE_LEDGER_NAMES = `
A G ASHTAVINAYAKA PETROCHEM PVT LTD-KARNATAKA
A G ASHTAVINAYAKA PETROCHEM PVT LTD-RAJASTHAN
A G ASHTAVINAYAKA PETROCHEM PVT LTD-TELANGANA
Accommodation Exp
Admin Charges
Advance Salary
ADVANCE TAX PAID
AINUMPUDI SURESH VARMA
Air Conditioner - Office
Airconditioner
ALLTECH MAKE MICROSURFACING PAVER MACHINE
ALOIS BUILDERS AND INF
AMC CHARGES
AML MOTORS PVT LTD
Anil Menda Salary
ANNUAL CUSTODY FEES
ANUP OMPRAKASH AGRAWAL / J C ENTERPRISES
Art Infrastructure Pvt Ltd - Loan A/c
ASPHALTERA PRIVATE LIMITED
ATHER 450X (BIKE)
Auriolus Finvest Pvt Ltd (BIZFUNDS)
AXIS BANK BPR032712902112
AXIS BANK LOAN - BPR064708241270
AXIS CORPORATE CARD 0344
AZUS ASPHALTS INDIA PVT. LTD-Mumbai (Dr)
Bank Charges
BANK OF BARODA - 13780500000078
BANK OF MAHARASHTRA GECL LOAN - 60435324219
Bank of Maharashtra Term Loan 60435104974
BANK OF MAHARASHTRA- C/C 60434886441
BIO METRIC MACHINE
BMW NEW 3 SERIE
BOM CA 60435349267
Bunglow Mahanagar Gas Charges
Bunglow Mahanagar Gas Payable
BUSINESS PROMOTION
Cargo Insurance
Carriage Inwards RD
Carriage Outward-URD
Carriage Outwards RD
Cash
CCTV
Central Bank - 3224976293
CGST CASH LEDGER
CGST- PAYABLE/REFUNDABLE
CGST-ITC BLOCKED
CHEMICAL PURCHASE
CLASSIC BITUMEN PRIVATE LIMITED
CLIX CAPITAL SERVICES PVT LTD
Commission Paid
Computer
Conveyance
Cooling Tower
Courier Charges
CPCB EXPENSES
CSR Expenses
Custom Duty
Decanting Machine
DEPOSIT - POWER2SME PVT LTD
DEPOSIT FOR OFFICE UNIT NO.2401-2403 WITH MAHIMA MENDA
DEPOSIT FOR OFFICE UNIT NO.2401-2403 WITH URMILA SINGH
DEPOSIT WITH ICICI BANK FOR TATA CAPITAL LTD - FD
DEPOSIT WITH MSEDCL
DHIRAJ PETROCHEMICAL AND GAS PRIVATE LIMITED
Diesel & Petrol Expenses
DIRECTORS REMUNERATION-SANDEEP SINGH
DISHWASHER
Donation
Disallowance
DREAMZZ MAKERS EVENTS AN
EKVIRA TRANSPORT AND LOGISTICS
Electrical Equipments
Electricity Charges (Bunglow)
Electricity Charges (DHULE)
Electricity Charges (Mahima Menda)
Electricity Charges Factory
Electricity Office 24th Floor
Electricity Payable
Emulsion Machinery
FACTORY INSURANCE
Factory Rent
Factory Shed
FD WITH BOM 60481155324
FD WITH BOM 60522865556
FD WITH YES BANK 024840600029570
FIRE INSURANCE
FLOW METER
Furniture & Fixtures
GARMENT IRON STEAMER
Gauri Impex -Cr
GLOBAL PLASTO CHEM - DR
GOLD & ORNAMENTS
GST Voluntary Payment
HDFC BANK 160603957 COMM. VEH. MH43CK6521
HDFC BANK AUTO LOAN-139545540 KIA SONET
HDFC BANK AUTO LOAN-140544428 INNOVA HYCROSS
HDFC BANK AUTO LOAN-166649820 BMW
HDFC BANK LTD (MAHINDRA THAR) 117909323
HDFC CORPORATE CARD - V2P 3288
HDFC CORPORATE CARD - V2P 3767
HDFC CORPORATE CARD -4385
HDFC CORPORATE CARD -9607
ICICI BANK CE LOAN- LQPVL00047732425-PAVER
ICICI Business Loan - UPMUM00046126149
IDBI BANK LIMITED
IGST CASH LEDGER
IGST- PAYABLE/REFUNDABLE
IGST-ITC BLOCKED
Import Clearing & Forwarding Expenses
INCENTIVES
INDIAIDEAS.COM
Indian Oil Corporation Limited-GJ
Ineligible ITC 17(5) -CGST
INPUT CGST 2.5%
INPUT CGST 9%
INPUT IGST 18%
INPUT RCM CGST
INPUT RCM IGST
INSURANCE
Insurance - Vehicles
INSURANCE ON LOAN
Interest on Corporate Card
INTEREST ON FD/OD
INTEREST ON GECL
INTEREST ON TDS
Interest on Tata Capital FD
Interest on Term Loan 60435104974
Interest on Term Loan Yes Bank
Interest on Unsecured Loan
Interest on Vehicle Loan
Internet Charges
IVC LOGISTICS LIMITED
JAI HANUMAN TRADING
JALDEV SHIPPING AGENCY
JOINING FEES OF CDSL
KARNATAKA BANK FD AC NO - 5201500202002401
KARNATAKA BANK FD AC NO - 5201500202009301
KARNATAKA BANK FD AC NO - 5201500202084001
KHANDOBA BIOREFINERIES PRIVATE LIMITED
L &T FINANCE LIMITED BL250613256600976
L&T Finance Holdings Limited. BL231224040100133
Lab Equipments
Labour Charges
Land at Dhule
Land at Khopoli
Land at Kolkata
LAPTOP
LATE FEES
LC CHARGES
Licence Fees
M1 EXCHANGE
MAHABHAGWANI DEVI ENTE
MAHADEV OIL INDUSTRIES
Mahima Menda - Loan From Director
Mahima Menda - Office Rent Payable
MAHIMA MENDA REMUNERATION PAYABLE
MAHINDRA BOLERO B6 MH46BZ1066
MAS FINANCIAL SERVICES LTD - VENDOR
MAS FINANCIAL SERVICES LTD -5391230
MH 46 AR 6643
MH 46 AR 6775
Mobile /Telephone
MOBILE & TELEPHONE EXPENSES
MONEYWISE FINANCIAL SERICES PVT LTD - BL00711
Mynd Solutions Pvt. Ltd.
NAYARA ENERGY LIMITED
NEW BHARAT ENTERPRISES Maharashtra
O/D INTEREST
Office Expenses
OFFICE RENT 2401,2402,2403
OUTPUT CGST 9%
OUTPUT IGST 12%
OUTPUT IGST 18%
OUTPUT RCM CGST
OUTPUT RCM IGST
OUTPUT SGST 9%
PENALTY PAID
PETROMAX ENERGY - DR
Plant & Machinery
POLLUTION PARAMETER DISPLAY BOARD
POONAWALA FINCORP LTD - BLU0027DSC000006124326
Prepaid Expenses
Printer
Printing & Stationery
Processing Charges
ROC Charges
ROC Charges URD
PROFESSIONAL FEES
Property Insurance
PROVIDENT FUND PAYABLE
Provision for CSR Expenses
Provision for Income Tax A.Y. 25-26
PTEC Company
PTEC PAID
PTEC PAYABLE
PTRC PAYABLE
Pump
R D R LOGISTIC
R/OFF
REFRIGERATOR
REPAIR & MAINTENANCE OF VEHICLES
REPAIRS & MAINTENANCE OF COMPUTER@9%
Repairs & Maintenance to Others
Repairs & Maintenance to Vehicle 18%
Repairs & Maintence of P & M
Repairs Maintenance Building
RIDDHI SIDDHI ENTERPRISES(Andheri)
ROYAL AUTOCRYSTAL SERVICES PRIVATE LIMITED
ROYAL ENTERPRISES
Salary & Wages
Salary Payable
Sandeep Singh - Loan From Director
SANDEEP SINGH REMUNERATION PAYABLE
SANDEEPDADA THAKUR FOUNDATION
SECURITY DEPOSIT FOR ELECTRICITY
SECURITY DEPOSIT WITH CDSL
SECURITY DEPOSIT WITH SHRIRAM FINANCE
SGST CASH LEDGER
SGST- PAYABLE/REFUNDABLE
SHIVSAMARTH LOGISTICS
SHREE GURU KRIPA ENTERPRISES (DR)
SHREE HARI ENTERPRISES
SHRIRAM FINANCE LIMITED
SOFTWARES
Staff Welfare
STAMP DUTY
STAR MOTORS
STORAGE MS TANK
TANK
TATA 610 SFC MH43CK6521
TATA CAPITAL LIMITED
TCS ON SALE @0.1%
TCS ON SALE OF SCRAP 1%
TDS ASSETS F.Y 2025-26
TDS ON COMMISSION
TDS ON CONTRACT
TDS ON INTEREST ON UNSECURED LOAN
TDS ON LABOUR CHARGES
TDS ON PROFESSIONAL FEES
TDS ON PURCHASE OF GOODS @0.10%
TDS ON RENT
TDS ON SALARY
TDS RECEIVABLE FROM MYND SOLUTION PVT LTD
TDS RECEIVABLE ON UNSECURED LOAN- CLIX CAPITAL
TDS RECEIVABLE ON UNSECURED LOAN-AMBIT FINVEST
TDS RECEIVABLE ON UNSECURED LOAN-L & T FINANCE
TDS RECEIVABLE ON UNSECURED LOAN-MAS FINANCIAL
TDS RECEIVABLE ON UNSECURED LOAN-MAS VENDOR
TDS RECEIVABLE ON UNSECURED LOAN-MONEYWISE
TDS RECEIVABLE ON UNSECURED LOAN-POONAWALA
Television & DTH
Testing Charges
Travelling Expenses- International
Travelling Expenses-Domestic
UNCONSUMED CHALLAN
UNITY SMALL FINANCE BANK LTD
UPS
URMILA GIRIJASHANKAR SINGH - Office Rent
URMILA GIRIJASHANKAR SINGH- Factory Rent
VAISHNAVI ENTERPRISES
Visa Expencess
Washing Machine
WATER BILL PAYABLE
Water Expenses (Bunglow)
WATER PURIFIER
Written Off
YES BANK CA - 024863700003291
YES BANK LTD ( MAHINDRA BOLERO) - ALN000100853150
YES BANK TERM LOAN 248LA42252890001
YES BANK TERM LOAN 248LA42252930001
YES BANK TERM LOAN 803LA42250690001
YES BANK TERM LOAN 803LA42250920001
YES BANK TERM LOAN 803LA42251680001
YES BANK TERM LOAN 803LA42251890001
`;

const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
const code = (value: string) => `TB_JH_${normalize(value).replace(/[^A-Z0-9]+/gi, "_").replace(/^_|_$/g, "").toUpperCase()}`;

function definition(name: string) {
    const upper = name.toUpperCase();
    const isBank = /\bBANK\b|\bCA\b|CORPORATE CARD|O\/D/.test(upper);
    const isCash = upper === "CASH" || /CASH LEDGER/.test(upper);
    const isTax = /^(INPUT|OUTPUT)|GST|TCS|TDS|PTEC|PTRC|PROVIDENT FUND|PAYABLE|ITC/.test(upper);
    const isLoan = /LOAN|FINANCE LIMITED|FINVEST|CAPITAL SERVICES/.test(upper);
    const isIncome = /INCENTIVES|HIRING CHARGES|SALES|COMMISSION RECEIVED|INTEREST ON TATA CAPITAL FD/.test(upper);
    const isAsset = /LAND|MACHINE|EQUIPMENT|FURNITURE|COMPUTER|LAPTOP|PRINTER|PUMP|TANK|VEHICLE|BIKE|BMW|CAR|REFRIGERATOR|TELEVISION|WASHING|PURIFIER|SOFTWARE|DEPOSIT|PREPAID|TDS ASSETS/.test(upper);
    const isPartyCredit = /\(CR\)|PAYABLE|VENDOR|SUPPLIER|CREDITOR/.test(upper);

    if (isCash) return { groupCode: "CASH_IN_HAND", category: LedgerType.CASH, type: "INWARD" as const };
    if (isBank) return { groupCode: "BANK_ACCOUNTS", category: LedgerType.BANK, type: "INWARD" as const };
    if (isTax) return { groupCode: "DUTIES_AND_TAXES", category: LedgerType.GST, type: "INWARD" as const };
    if (isLoan || isPartyCredit) return { groupCode: "LOANS", category: LedgerType.JOURNAL, type: "INWARD" as const };
    if (isIncome) return { groupCode: "INDIRECT_INCOME", category: LedgerType.JOURNAL, type: "INWARD" as const };
    if (isAsset) return { groupCode: "FIXED_ASSETS", category: LedgerType.JOURNAL, type: "OUTWARD" as const };
    return { groupCode: "INDIRECT_EXPENSE", category: LedgerType.JOURNAL, type: "OUTWARD" as const };
}

async function main() {
    await LedgerService.ensureDefaultLedgerGroups(prisma);

    const names = Array.from(new Set(
        TRIAL_BALANCE_LEDGER_NAMES
            .split("\n")
            .map(normalize)
            .filter(Boolean)
    ));

    let created = 0;
    let existing = 0;

    for (const name of names) {
        const alreadyExists = await prisma.journalHead.findFirst({
            where: { name: { equals: name, mode: "insensitive" } }
        });

        if (alreadyExists) {
            existing++;
            continue;
        }

        const item = definition(name);
        const ledger = await LedgerService.getOrCreateLedger(prisma, {
            code: code(name),
            name,
            category: item.category,
            groupCode: item.groupCode,
            nature: item.type === "INWARD" ? LedgerNature.CREDIT : LedgerNature.DEBIT
        });

        await prisma.journalHead.create({
            data: {
                name,
                type: item.type,
                ledgerId: ledger.id
            }
        });
        created++;
    }

    console.log(`Trial-balance journal heads: created=${created}, existing=${existing}, total=${names.length}`);
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => prisma.$disconnect());

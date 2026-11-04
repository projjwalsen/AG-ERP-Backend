import "dotenv/config";
import {
    EntryType,
    JournalDirection,
    JournalStatus,
    PaymentMode,
    VoucherType
} from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const BRANCH_CODE = "AG_ASHTAVINAYAKA_PETROCHEM-MH";
const FY_START = new Date("2025-04-01T00:00:00+05:30");
const FY_END = new Date("2026-04-01T00:00:00+05:30");
const AMOUNT = {
    334: 3_617_289,
    335: 114_391,
    344: 4_995_683,
    345: 157_980,
    358: 3_667_868,
    359: 115_990
} as const;

const cents = (value: unknown) => Math.round(Number(value || 0) * 100);
const apply = process.argv.includes("--apply");

const principal = [
    { voucherNo: "334", date: "2025-05-05", sourceRow: 14, sample: "375", amount: AMOUNT[334] },
    { voucherNo: "344", date: "2025-05-06", sourceRow: 20, sample: "375", amount: AMOUNT[344] },
    { voucherNo: "358", date: "2025-05-07", sourceRow: 24, sample: "375", amount: AMOUNT[358] }
] as const;

const interest = [
    { voucherNo: "335", date: "2025-05-05", sourceRow: 16, principal: AMOUNT[334], net: AMOUNT[335] },
    { voucherNo: "345", date: "2025-05-06", sourceRow: 21, principal: AMOUNT[344], net: AMOUNT[345] },
    { voucherNo: "359", date: "2025-05-07", sourceRow: 25, principal: AMOUNT[358], net: AMOUNT[359] }
] as const;

const istDate = (date: string) => new Date(`${date}T00:00:00+05:30`);
const reconKey = (voucherNo: string, accountCode: string) =>
    `SHRI_FINANCE_RECON_2025_26_${voucherNo}_${accountCode}`;
const serialNo = (voucherNo: string, accountCode: string) =>
    `SHRI-RECON-2025-26-${voucherNo}-${accountCode}`;

async function main() {
    const result = await prisma.$transaction(async tx => {
        const branch = await tx.branch.findUnique({ where: { code: BRANCH_CODE } });
        if (!branch || !branch.isActive) throw new Error(`Active branch ${BRANCH_CODE} was not found`);

        const shriram = await tx.ledger.findMany({
            where: {
                branchId: branch.id,
                category: "JOURNAL",
                name: { equals: "SHRIRAM FINANCE LIMITED", mode: "insensitive" }
            },
            select: { id: true }
        });
        const shriramEntries = await tx.ledgerEntry.findMany({
            where: {
                ledgerId: { in: shriram.map(ledger => ledger.id) },
                voucher: { voucherDate: { gte: FY_START, lt: FY_END } }
            },
            select: { entryType: true, amount: true }
        });
        const shriramDebits = shriramEntries.filter(entry => entry.entryType === EntryType.DEBIT)
            .reduce((sum, entry) => sum + cents(entry.amount), 0);
        const shriramCredits = shriramEntries.filter(entry => entry.entryType === EntryType.CREDIT)
            .reduce((sum, entry) => sum + cents(entry.amount), 0);
        if (shriram.length !== 2 || shriramDebits !== 9_170_457_200 || shriramCredits !== 9_170_457_200) {
            throw new Error(`SHRIRAM ledger control failed: ledgers=${shriram.length}, debit=${shriramDebits / 100}, credit=${shriramCredits / 100}`);
        }

        const lines: Array<{
            voucherNo: string;
            date: string;
            sourceRow: number;
            sampleVoucherNo: string;
            accountName: string;
            accountCode: string;
            entryType: EntryType;
            amount: number;
            remarks: string;
        }> = [];

        for (const row of principal) {
            lines.push({
                voucherNo: row.voucherNo,
                date: row.date,
                sourceRow: row.sourceRow,
                sampleVoucherNo: row.sample,
                accountName: "Sulaki Chemicals Pvt Ltd-CR",
                accountCode: "SULAKI",
                entryType: EntryType.DEBIT,
                amount: row.amount,
                remarks: `Particulars: Sulaki Chemicals Pvt Ltd-CR | Counterpart for SHRIRAM FINANCE LIMITED voucher ${row.voucherNo}, supported by SHRIRAM.xls row ${row.sourceRow}`
            });
        }

        for (const row of interest) {
            // Existing Shriram interest vouchers use 14.25% for 90 days and
            // credit TDS at 10%; the workbook supplies the net lender credit.
            const gross = Math.round(row.principal * 0.1425 * 90 / 365);
            const tds = gross - row.net;
            if (tds <= 0 || Math.abs(tds - Math.round(gross * 0.1)) > 1) {
                throw new Error(`Interest/TDS reconstruction failed for voucher ${row.voucherNo}`);
            }
            lines.push({
                voucherNo: row.voucherNo,
                date: row.date,
                sourceRow: row.sourceRow,
                sampleVoucherNo: "376",
                accountName: "Interest on Unsecured Loan",
                accountCode: "INTEREST",
                entryType: EntryType.DEBIT,
                amount: gross,
                remarks: `Particulars: Interest on Unsecured Loan | Gross interest inferred from the matching 14.25% / 90-day Shriram voucher pattern; net credit on SHRIRAM.xls row ${row.sourceRow} is ₹${row.net}`
            }, {
                voucherNo: row.voucherNo,
                date: row.date,
                sourceRow: row.sourceRow,
                sampleVoucherNo: "376",
                accountName: "TDS ON INTEREST ON UNSECURED LOAN",
                accountCode: "TDS",
                entryType: EntryType.CREDIT,
                amount: tds,
                remarks: `Particulars: TDS on Interest on Unsecured Loan (10%) | Inferred from the matching Shriram voucher pattern for voucher ${row.voucherNo}`
            });
        }

        const references = new Map<string, { journalHeadId: string; categoryId: string; ledgerId: string }>();
        for (const line of lines) {
            if (references.has(line.accountCode)) continue;
            const sample = await tx.journal.findFirst({
                where: {
                    branchId: branch.id,
                    voucherNo: line.sampleVoucherNo,
                    sourceSheet: "Journal Register",
                    journalHead: { name: { equals: line.accountName, mode: "insensitive" } }
                },
                select: {
                    journalHeadId: true,
                    categoryId: true,
                    journalHead: { select: { ledgerId: true, name: true, ledger: { select: { name: true, branchId: true } } } }
                }
            });
            if (!sample?.categoryId || sample.journalHead.ledger.branchId !== branch.id ||
                sample.journalHead.ledger.name.toLocaleLowerCase() !== line.accountName.toLocaleLowerCase()) {
                throw new Error(`Could not resolve the matching journal-register ledger for ${line.accountName}`);
            }
            references.set(line.accountCode, {
                journalHeadId: sample.journalHeadId,
                categoryId: sample.categoryId,
                ledgerId: sample.journalHead.ledgerId
            });
        }

        const existing = await tx.journal.findMany({
            where: { branchId: branch.id, importKey: { in: lines.map(line => reconKey(line.voucherNo, line.accountCode)) } },
            include: { voucher: { include: { entries: true } } }
        });
        if (existing.length && existing.length !== lines.length) {
            throw new Error(`Partial counterpart repair exists (${existing.length}/${lines.length} rows); inspect before proceeding`);
        }
        if (existing.length) {
            for (const line of lines) {
                const row = existing.find(item => item.importKey === reconKey(line.voucherNo, line.accountCode));
                const entry = row?.voucher?.entries[0];
                const reference = references.get(line.accountCode)!;
                if (!row || row.voucherNo !== line.voucherNo || cents(row.amount) !== cents(line.amount) ||
                    row.direction !== (line.entryType === EntryType.DEBIT ? JournalDirection.OUTWARD : JournalDirection.INWARD) ||
                    row.voucher?.entries.length !== 1 || entry?.ledgerId !== reference.ledgerId ||
                    entry.entryType !== line.entryType || cents(entry.amount) !== cents(line.amount)) {
                    throw new Error(`Existing repair row does not match the approved reconstruction for voucher ${line.voucherNo}/${line.accountCode}`);
                }
            }
        }
        if (existing.length) {
            for (const row of existing) {
                const expected = lines.find(line => reconKey(line.voucherNo, line.accountCode) === row.importKey)!;
                if (row.serialNo !== serialNo(expected.voucherNo, expected.accountCode)) {
                    throw new Error(`Existing counterpart serial does not match voucher ${expected.voucherNo}/${expected.accountCode}`);
                }
            }
        } else {
            const serials = await tx.journal.findMany({
                where: { branchId: branch.id, serialNo: { in: lines.map(line => serialNo(line.voucherNo, line.accountCode)) } },
                select: { serialNo: true }
            });
            if (serials.length) throw new Error(`Counterpart repair serials already exist: ${serials.map(row => row.serialNo).join(", ")}`);
        }

        const preview = lines.map(line => ({
            voucherNo: line.voucherNo,
            date: line.date,
            account: line.accountName,
            entryType: line.entryType,
            amount: line.amount,
            sourceRow: line.sourceRow
        }));
        if (!apply) return { dryRun: true, branch: branch.name, alreadyPresent: Boolean(existing.length), preview };

        const affectedLedgerIds = Array.from(new Set(lines.map(line => references.get(line.accountCode)!.ledgerId)));
        if (existing.length) {
            for (const ledgerId of affectedLedgerIds) await LedgerService.syncCachedBalance(tx, ledgerId);
        }

        const operator = await tx.user.findFirst({
            where: { isActive: true, status: "ACTIVE", branchId: branch.id },
            orderBy: { createdAt: "asc" },
            select: { id: true }
        }) ?? await tx.user.findFirst({
            where: { isActive: true, status: "ACTIVE", branchId: null },
            orderBy: { createdAt: "asc" },
            select: { id: true }
        });
        if (!operator) throw new Error("No active user is available for journal audit fields");

        const created = [];
        for (const line of existing.length ? [] : lines) {
            const amount = Number(line.amount.toFixed(2));
            const reference = references.get(line.accountCode)!;
            const journal = await tx.journal.create({
                data: {
                    branchId: branch.id,
                    journalHeadId: reference.journalHeadId,
                    categoryId: reference.categoryId,
                    serialNo: serialNo(line.voucherNo, line.accountCode),
                    voucherNo: line.voucherNo,
                    sourceSheet: "SHRIRAM FINANCE LIMITED",
                    sourceRow: line.sourceRow,
                    importKey: reconKey(line.voucherNo, line.accountCode),
                    amount,
                    direction: line.entryType === EntryType.DEBIT ? JournalDirection.OUTWARD : JournalDirection.INWARD,
                    paymentMode: PaymentMode.OFFLINE,
                    remarks: line.remarks,
                    journalDate: istDate(line.date),
                    status: JournalStatus.APPROVED,
                    createdById: operator.id,
                    approvedById: operator.id,
                    approvedAt: new Date()
                }
            });
            const voucher = await tx.voucher.create({
                data: {
                    voucherNo: line.voucherNo,
                    voucherType: VoucherType.JOURNAL,
                    sourceId: journal.id,
                    branchId: branch.id,
                    narration: line.remarks,
                    totalDebit: line.entryType === EntryType.DEBIT ? amount : 0,
                    totalCredit: line.entryType === EntryType.CREDIT ? amount : 0,
                    voucherDate: istDate(line.date),
                    entries: {
                        create: {
                            ledgerId: reference.ledgerId,
                            branchId: branch.id,
                            entryType: line.entryType,
                            amount,
                            narration: line.remarks
                        }
                    }
                },
                select: { id: true }
            });
            await tx.journal.update({ where: { id: journal.id }, data: { voucherId: voucher.id } });
            created.push({ voucherNo: line.voucherNo, account: line.accountName, entryType: line.entryType, amount });
        }

        for (const ledgerId of affectedLedgerIds) await LedgerService.syncCachedBalance(tx, ledgerId);

        const sourceRows = await tx.journal.findMany({
            where: { branchId: branch.id, importKey: { startsWith: "SHRI_FINANCE_RECON_2025_26_" } },
            select: {
                voucherNo: true,
                voucher: { select: { entries: { select: { entryType: true, amount: true } } } }
            }
        });
        for (const voucherNo of Object.keys(AMOUNT)) {
            const voucherRows = sourceRows.filter(row => row.voucherNo === voucherNo);
            const debits = voucherRows.flatMap(row => row.voucher?.entries ?? [])
                .filter(entry => entry.entryType === EntryType.DEBIT)
                .reduce((sum, entry) => sum + cents(entry.amount), 0);
            const credits = voucherRows.flatMap(row => row.voucher?.entries ?? [])
                .filter(entry => entry.entryType === EntryType.CREDIT)
                .reduce((sum, entry) => sum + cents(entry.amount), 0);
            if (debits !== credits) throw new Error(`Voucher ${voucherNo} does not balance: debit=${debits / 100}, credit=${credits / 100}`);
        }

        return { dryRun: false, branch: branch.name, created, balancedVoucherCount: Object.keys(AMOUNT).length };
    }, { maxWait: 120_000, timeout: 120_000 });

    console.log(JSON.stringify(result, null, 2));
}

main()
    .catch(error => {
        console.error(error instanceof Error ? error.message : error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());

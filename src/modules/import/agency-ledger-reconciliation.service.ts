import * as XLSX from "xlsx";
import { EntryType, LedgerType, VoucherType } from "@prisma/client";
import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { LedgerService } from "../accounting/ledger/ledger.service";

type AgencyLedgerRow = {
    row: number;
    voucherNo: string;
    voucherType: VoucherType;
    debit: number;
    credit: number;
};

const normalize = (value: unknown) => String(value ?? "")
    .replace(/[\u00a0\u2013\u2014]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeKey = (value: unknown) => normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const normalizeAgencyName = (value: unknown) => normalize(value)
    .replace(/\s*-\s*sundry\s+(?:debtor|creditor)\s*$/i, "")
    .replace(/\bPRIVATE\b/gi, "PVT")
    .replace(/\bLIMITED\b/gi, "LTD")
    .replace(/[^a-z0-9]/gi, "")
    .toUpperCase();

const parseAmount = (value: unknown) => {
    if (typeof value === "number") return Math.round(value * 100) / 100;
    const text = normalize(value).replace(/[₹,]/g, "");
    if (!text) return 0;
    const parsed = Number(text.replace(/[()]/g, ""));
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : NaN;
};

const parseVoucherType = (value: unknown): VoucherType | undefined => {
    const type = normalizeKey(value);
    const mappings: Record<string, VoucherType> = {
        sale: VoucherType.SALE,
        taxinvoice: VoucherType.SALE,
        sales: VoucherType.SALE,
        receipt: VoucherType.RECEIPT,
        payment: VoucherType.PAYMENT,
        journal: VoucherType.JOURNAL,
        contra: VoucherType.CONTRA,
        purchase: VoucherType.PURCHASE,
        debitnote: VoucherType.DEBIT_NOTE,
        outwarddebitnote: VoucherType.DEBIT_NOTE,
        inwarddebitnote: VoucherType.DEBIT_NOTE,
        creditnote: VoucherType.CREDIT_NOTE,
        outwardcreditnote: VoucherType.CREDIT_NOTE,
        inwardcreditnote: VoucherType.CREDIT_NOTE,
        cashreceipt: VoucherType.CASH_RECEIPT,
        cashpayment: VoucherType.CASH_PAYMENT,
        bankreceipt: VoucherType.BANK_RECEIPT,
        bankpayment: VoucherType.BANK_PAYMENT
    };
    return mappings[type];
};

const parseAgencyLedgerWorkbook = (buffer: Buffer, agencyName: string) => {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: true });
    const wantedSheet = normalizeAgencyName(agencyName);
    const ledgerSheets = workbook.SheetNames
        .map(name => ({
            name,
            rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
                header: 1,
                defval: "",
                raw: true
            })
        }))
        .map(sheet => {
            const headerIndex = sheet.rows.findIndex(row => {
                const headers = row.map(normalizeKey);
                return headers.some(header => ["vchtype", "vouchertype"].includes(header)) &&
                    headers.some(header => ["vchno", "vchno.", "voucherno", "vouchernumber"].includes(header)) &&
                    headers.some(header => header === "debit") &&
                    headers.some(header => header === "credit");
            });
            return { ...sheet, headerIndex };
        })
        .filter(sheet => sheet.headerIndex >= 0);
    const candidates = ledgerSheets.filter(sheet => {
        const sheetNameMatches = normalizeAgencyName(sheet.name) === wantedSheet;
        const titleMatches = sheet.rows
            .slice(0, Math.min(sheet.headerIndex, 20))
            .some(row => row.some(cell => normalizeAgencyName(cell) === wantedSheet));
        return sheetNameMatches || titleMatches;
    });

    if (candidates.length !== 1) {
        const available = ledgerSheets.map(sheet => {
            const title = sheet.rows.slice(0, Math.min(sheet.headerIndex, 20))
                .flat()
                .map(normalize)
                .find(value => value.length > 3) || "(no title found)";
            return `${sheet.name}: ${title}`;
        });
        const detail = available.length ? ` Ledger sheets found: ${available.join("; ")}.` : " No ledger-account sheet with voucher headers was found.";
        throw new ApiError(
            candidates.length === 0
                ? `Could not match agency "${agencyName}" to a ledger worksheet or report title.${detail}`
                : `More than one ledger sheet matches agency "${agencyName}"`,
            400
        );
    }

    const { rows, headerIndex } = candidates[0];
    if (headerIndex < 0) {
        throw new ApiError(`The ledger sheet for "${agencyName}" has no recognizable voucher headers`, 400);
    }
    const headers = rows[headerIndex].map(normalizeKey);
    const column = (...names: string[]) => headers.findIndex(header => names.includes(header));
    const typeColumn = column("vchtype", "vouchertype");
    const numberColumn = column("vchno", "voucherno", "vouchernumber");
    const debitColumn = column("debit");
    const creditColumn = column("credit");
    const result: AgencyLedgerRow[] = [];
    const invalid: number[] = [];

    for (let index = headerIndex + 1; index < rows.length; index++) {
        const cells = rows[index];
        const voucherNo = normalize(cells[numberColumn]).replace(/\.0$/, "");
        const rawType = normalize(cells[typeColumn]);
        if (!voucherNo && !rawType) continue; // Opening Balance and total rows.
        if (!voucherNo && /grand\s*total/i.test(normalize(cells[0]))) continue;

        const voucherType = parseVoucherType(rawType);
        const debit = parseAmount(cells[debitColumn]);
        const credit = parseAmount(cells[creditColumn]);
        if (!voucherNo || !voucherType || !Number.isFinite(debit) || !Number.isFinite(credit) ||
            (debit > 0) === (credit > 0)) {
            invalid.push(index + 1);
            continue;
        }
        result.push({ row: index + 1, voucherNo, voucherType, debit, credit });
    }

    if (invalid.length) {
        throw new ApiError(`Invalid voucher rows in ${candidates[0].name}: ${invalid.slice(0, 20).join(", ")}`, 400);
    }
    if (!result.length) throw new ApiError("No voucher rows found in the agency ledger sheet", 400);

    const uniqueRows = new Map<string, AgencyLedgerRow>();
    for (const row of result) {
        const key = `${row.voucherType}|${row.voucherNo}`;
        const previous = uniqueRows.get(key);
        if (previous && (previous.debit !== row.debit || previous.credit !== row.credit)) {
            throw new ApiError(`Conflicting rows found for ${row.voucherType} voucher ${row.voucherNo}`, 400);
        }
        if (!previous) uniqueRows.set(key, row);
    }
    return [...uniqueRows.values()];
};

export class AgencyLedgerReconciliationService {
    static async reconcile(actor: any, agencyName: string, buffer: Buffer, requestedBranchId?: string, apply = false) {
        if (!actor?.id) throw new ApiError("Unauthorized", 401);
        const requestedAgency = normalizeAgencyName(agencyName);
        if (!requestedAgency) throw new ApiError("agencyName is required", 400);

        const branchId = actor.branchAccessType === "ALL" ? requestedBranchId : actor.branchId;
        if (!branchId && actor.branchAccessType !== "ALL") {
            throw new ApiError("A branch is required to reconcile agency vouchers", 400);
        }
        if (requestedBranchId && actor.branchAccessType !== "ALL" && requestedBranchId !== actor.branchId) {
            throw new ApiError("You do not have access to this branch", 403);
        }

        const rows = parseAgencyLedgerWorkbook(buffer, agencyName);
        const agencies = await prisma.agency.findMany({
            where: { isActive: true },
            select: { id: true, name: true, type: true }
        });
        const agencyMatches = agencies.filter(item => normalizeAgencyName(item.name) === requestedAgency);
        if (agencyMatches.length !== 1) {
            throw new ApiError(agencyMatches.length === 0
                ? `Active agency "${agencyName}" was not found`
                : `Agency name "${agencyName}" is ambiguous; use a more specific name`, 400);
        }
        const agency = agencyMatches[0];

        const eligibleCategories = agency.type === "CLIENT"
            ? [LedgerType.CUSTOMER]
            : agency.type === "VENDOR"
                ? [LedgerType.VENDOR]
                : [LedgerType.CUSTOMER, LedgerType.VENDOR];
        const ledgers = await prisma.ledger.findMany({
            where: {
                agencyId: agency.id,
                category: { in: eligibleCategories },
                isActive: true,
                ...(branchId ? { branchId } : {})
            },
            select: { id: true, name: true, branchId: true, category: true }
        });
        if (ledgers.length !== 1) {
            throw new ApiError(ledgers.length === 0
                ? `No active agency ledger found for "${agency.name}"${branchId ? " in the selected branch" : ""}`
                : `Agency "${agency.name}" has ledgers in multiple branches; supply branchId`, 400);
        }
        const targetLedger = ledgers[0];
        const reconciliationBranchId = branchId || targetLedger.branchId || undefined;

        return prisma.$transaction(async tx => {
            const matched: Array<Record<string, unknown>> = [];
            const missing: Array<Record<string, unknown>> = [];
            const ambiguous: Array<Record<string, unknown>> = [];
            const plans: Array<{ row: AgencyLedgerRow; voucherId: string; entryId: string; previousLedgerId: string; journalIds: string[] }> = [];

            for (const row of rows) {
                const branchFilter = reconciliationBranchId ? { branchId: reconciliationBranchId } : {};
                const voucherIds = new Set<string>();
                const directVouchers = await tx.voucher.findMany({
                    where: { voucherNo: row.voucherNo, voucherType: row.voucherType, ...branchFilter },
                    select: { id: true }
                });
                directVouchers.forEach(voucher => voucherIds.add(voucher.id));

                // Tally calls sales by invoice number; the application's sale
                // voucher number is a generated SALE-* reference.
                if (row.voucherType === VoucherType.SALE) {
                    const sale = await tx.sale.findFirst({
                        where: { invoiceNo: row.voucherNo, ...(reconciliationBranchId ? { branchId: reconciliationBranchId } : {}) },
                        select: { id: true }
                    });
                    if (sale) {
                        const saleVouchers = await tx.voucher.findMany({
                            where: { sourceId: sale.id, voucherType: VoucherType.SALE, ...branchFilter },
                            select: { id: true }
                        });
                        saleVouchers.forEach(voucher => voucherIds.add(voucher.id));
                    }
                }

                // Match the Tally voucher number only. Journal.serialNo is
                // an internal sequence and can collide with a different
                // Tally voucher number in the same branch.
                if (row.voucherType === VoucherType.JOURNAL) {
                    const journals = await tx.journal.findMany({
                        where: {
                            voucherNo: row.voucherNo,
                            ...(reconciliationBranchId ? { branchId: reconciliationBranchId } : {})
                        },
                        select: { voucherId: true }
                    });
                    journals.forEach(journal => { if (journal.voucherId) voucherIds.add(journal.voucherId); });
                }

                const vouchers = voucherIds.size
                    ? await tx.voucher.findMany({
                        where: { id: { in: [...voucherIds] } },
                        include: { entries: { include: { ledger: true } }, journals: true, debitCreditNotes: true }
                    })
                    : [];
                if (vouchers.length === 0) {
                    missing.push({ row: row.row, voucherNo: row.voucherNo, voucherType: row.voucherType, debit: row.debit, credit: row.credit, reason: "Voucher not found; no record was created" });
                    continue;
                }
                const expectedType = row.debit > 0 ? EntryType.DEBIT : EntryType.CREDIT;
                const expectedAmount = row.debit > 0 ? row.debit : row.credit;

                const alreadyLinked: Array<{ voucher: typeof vouchers[number]; entryId: string }> = [];
                const movable: Array<{ voucher: typeof vouchers[number]; entry: typeof vouchers[number]["entries"][number] }> = [];
                for (const voucher of vouchers) {
                    const linked = voucher.entries.find(entry =>
                        entry.ledgerId === targetLedger.id && entry.entryType === expectedType &&
                        Math.abs(Number(entry.amount) - expectedAmount) < 0.005
                    );
                    if (linked) {
                        alreadyLinked.push({ voucher, entryId: linked.id });
                        continue;
                    }

                    let sourceAgencyIds: Array<string | null> = voucher.journals.map(journal => journal.agencyId);
                    if (voucher.voucherType === VoucherType.SALE) {
                        const sale = await tx.sale.findUnique({ where: { id: voucher.sourceId }, select: { agencyId: true } });
                        if (sale) sourceAgencyIds.push(sale.agencyId);
                    } else if (voucher.voucherType === VoucherType.PURCHASE) {
                        const purchase = await tx.purchase.findUnique({ where: { id: voucher.sourceId }, select: { agencyId: true } });
                        if (purchase) sourceAgencyIds.push(purchase.agencyId);
                    } else if (
                        voucher.voucherType === VoucherType.RECEIPT ||
                        voucher.voucherType === VoucherType.PAYMENT ||
                        voucher.voucherType === VoucherType.CASH_RECEIPT ||
                        voucher.voucherType === VoucherType.CASH_PAYMENT ||
                        voucher.voucherType === VoucherType.BANK_RECEIPT ||
                        voucher.voucherType === VoucherType.BANK_PAYMENT
                    ) {
                        const transaction = await tx.transaction.findUnique({
                            where: { id: voucher.sourceId },
                            select: { agencyId: true, thirdPartyAgencyId: true }
                        });
                        if (transaction) sourceAgencyIds.push(transaction.agencyId, transaction.thirdPartyAgencyId);
                    }
                    if (voucher.voucherType === VoucherType.DEBIT_NOTE || voucher.voucherType === VoucherType.CREDIT_NOTE) {
                        sourceAgencyIds.push(...voucher.debitCreditNotes.map(note => note.agencyId));
                    }
                    const sourceBelongsToAgency = sourceAgencyIds.includes(agency.id);
                    const candidates = voucher.entries.filter(entry => {
                        const trustedLedger = entry.ledger.category === LedgerType.JOURNAL &&
                            normalizeAgencyName(entry.ledger.name) === requestedAgency;
                        return entry.ledgerId !== targetLedger.id &&
                            entry.entryType === expectedType &&
                            Math.abs(Number(entry.amount) - expectedAmount) < 0.005 &&
                            (trustedLedger || entry.ledger.agencyId === agency.id ||
                                (sourceBelongsToAgency && (
                                    entry.ledger.category === LedgerType.CUSTOMER ||
                                    entry.ledger.category === LedgerType.VENDOR ||
                                    entry.ledger.category === LedgerType.JOURNAL
                                )));
                    });
                    if (candidates.length === 1) movable.push({ voucher, entry: candidates[0] });
                }

                if (alreadyLinked.length > 1 || movable.length > 1 || (alreadyLinked.length === 1 && movable.length > 0)) {
                    ambiguous.push({
                        row: row.row,
                        voucherNo: row.voucherNo,
                        voucherType: row.voucherType,
                        debit: row.debit,
                        credit: row.credit,
                        reason: "More than one voucher or party posting matches the workbook row"
                    });
                    continue;
                }

                if (alreadyLinked.length === 1) {
                    matched.push({ row: row.row, voucherNo: row.voucherNo, voucherType: row.voucherType, status: "already-linked", entryId: alreadyLinked[0].entryId });
                    continue;
                }

                if (movable.length === 0) {
                    ambiguous.push({
                        row: row.row,
                        voucherNo: row.voucherNo,
                        voucherType: row.voucherType,
                        debit: row.debit,
                        credit: row.credit,
                        reason: vouchers.length > 1
                            ? `Found ${vouchers.length} vouchers but none has a safely identifiable agency posting`
                            : "No safely identifiable existing agency posting to move"
                    });
                    continue;
                }

                const { voucher, entry } = movable[0];

                plans.push({
                    row,
                    voucherId: voucher.id,
                    entryId: entry.id,
                    previousLedgerId: entry.ledgerId,
                    journalIds: voucher.journals.map(journal => journal.id)
                });
            }

            if (apply && ambiguous.length) {
                throw new ApiError(`Reconciliation stopped: ${ambiguous.length} rows need review. No changes were applied.`, 409);
            }

            if (apply) {
                const affectedLedgers = new Set<string>();
                for (const plan of plans) {
                    await tx.ledgerEntry.update({
                        where: { id: plan.entryId },
                        data: { ledgerId: targetLedger.id }
                    });
                    await tx.journal.updateMany({
                        where: { voucherId: plan.voucherId, agencyId: null },
                        data: { agencyId: agency.id }
                    });
                    affectedLedgers.add(plan.previousLedgerId);
                    affectedLedgers.add(targetLedger.id);
                }
                for (const ledgerId of affectedLedgers) await LedgerService.syncCachedBalance(tx, ledgerId);
            }

            return {
                agency: { id: agency.id, name: agency.name },
                branchId: reconciliationBranchId,
                apply,
                workbookRows: rows.length,
                alreadyLinked: matched.length,
                readyToLink: plans.length,
                linked: apply ? plans.length : 0,
                missing,
                ambiguous,
                planned: plans.map(plan => ({
                    row: plan.row.row,
                    voucherNo: plan.row.voucherNo,
                    voucherType: plan.row.voucherType,
                    debit: plan.row.debit,
                    credit: plan.row.credit
                }))
            };
        }, { maxWait: 60_000, timeout: 5 * 60_000 });
    }

    static async unlinkExtraCreditPostings(
        actor: any,
        agencyName: string,
        buffer: Buffer,
        requestedBranchId?: string,
        allowUnlink = false
    ) {
        if (!actor?.id) throw new ApiError("Unauthorized", 401);
        const requestedAgency = normalizeAgencyName(agencyName);
        if (!requestedAgency) throw new ApiError("agencyName is required", 400);

        const branchId = actor.branchAccessType === "ALL" ? requestedBranchId : actor.branchId;
        if (!branchId && actor.branchAccessType !== "ALL") {
            throw new ApiError("A branch is required to check agency vouchers", 400);
        }
        if (requestedBranchId && actor.branchAccessType !== "ALL" && requestedBranchId !== actor.branchId) {
            throw new ApiError("You do not have access to this branch", 403);
        }

        const rows = parseAgencyLedgerWorkbook(buffer, agencyName);
        const agencies = await prisma.agency.findMany({
            where: { isActive: true },
            select: { id: true, name: true, type: true }
        });
        const matches = agencies.filter(item => normalizeAgencyName(item.name) === requestedAgency);
        if (matches.length !== 1) {
            throw new ApiError(matches.length === 0
                ? `Active agency "${agencyName}" was not found`
                : `Agency name "${agencyName}" is ambiguous; use a more specific name`, 400);
        }
        const agency = matches[0];
        if (agency.type !== "CLIENT") {
            throw new ApiError(`"${agency.name}" is not a client agency with a Sundry Debtor ledger`, 400);
        }

        const ledgers = await prisma.ledger.findMany({
            where: { agencyId: agency.id, category: LedgerType.CUSTOMER, isActive: true, ...(branchId ? { branchId } : {}) },
            select: { id: true, name: true, branchId: true }
        });
        if (ledgers.length !== 1) {
            throw new ApiError(ledgers.length === 0
                ? `No active Sundry Debtor ledger found for "${agency.name}"${branchId ? " in the selected branch" : ""}`
                : `Agency "${agency.name}" has ledgers in multiple branches; supply branchId`, 400);
        }
        const targetLedger = ledgers[0];
        const reconciliationBranchId = branchId || targetLedger.branchId || undefined;

        return prisma.$transaction(async tx => {
            const vouchers = await tx.voucher.findMany({
                where: {
                    ...(reconciliationBranchId ? { branchId: reconciliationBranchId } : {}),
                    entries: { some: { ledgerId: targetLedger.id } }
                },
                include: {
                    entries: { include: { ledger: true } },
                    journals: true,
                    debitCreditNotes: true
                }
            });
            const saleIds = vouchers
                .filter(voucher => voucher.voucherType === VoucherType.SALE)
                .map(voucher => voucher.sourceId)
                .filter((id): id is string => Boolean(id));
            const sales = saleIds.length
                ? await tx.sale.findMany({ where: { id: { in: saleIds } }, select: { id: true, invoiceNo: true } })
                : [];
            const saleById = new Map(sales.map(sale => [sale.id, sale]));
            const workbookByKey = new Map(rows.map(row => [`${row.voucherType}|${row.voucherNo}`, row]));
            const creditGroups = new Map<string, {
                voucher: typeof vouchers[number];
                entry: typeof vouchers[number]["entries"][number];
                tallyVoucherNo: string;
            }[]>();

            for (const voucher of vouchers) {
                if (voucher.voucherType === VoucherType.OPENING_BALANCE) continue;
                const tallyVoucherNo = voucher.voucherType === VoucherType.SALE && voucher.sourceId
                    ? saleById.get(voucher.sourceId)?.invoiceNo || voucher.voucherNo || ""
                    : voucher.voucherType === VoucherType.JOURNAL
                        ? voucher.journals.find(journal => journal.voucherNo)?.voucherNo || voucher.voucherNo || ""
                        : (voucher.voucherType === VoucherType.DEBIT_NOTE || voucher.voucherType === VoucherType.CREDIT_NOTE)
                            ? voucher.debitCreditNotes.find(note => note.noteNo)?.noteNo || voucher.voucherNo || ""
                            : voucher.voucherNo || "";
                if (!tallyVoucherNo) continue;
                const key = `${voucher.voucherType}|${tallyVoucherNo}`;
                for (const entry of voucher.entries.filter(item => item.ledgerId === targetLedger.id && item.entryType === EntryType.CREDIT)) {
                    const group = creditGroups.get(key) || [];
                    group.push({ voucher, entry, tallyVoucherNo });
                    creditGroups.set(key, group);
                }
            }

            const extras: Array<{
                row?: number;
                voucherNo: string;
                systemVoucherNo: string;
                voucherType: VoucherType;
                voucherId: string;
                sourceId: string;
                entryId: string;
                date: Date;
                narration: string;
                amount: number;
                ledger: string;
                workbookDebit: number;
                workbookCredit: number;
                reason: string;
                canUnlink: boolean;
                unlinkToLedger?: { id: string; name: string };
                status: string;
            }> = [];

            for (const [key, group] of creditGroups) {
                const workbookRow = workbookByKey.get(key);
                const workbookCredit = workbookRow?.credit || 0;
                const systemCredit = group.reduce((sum, item) => sum + Number(item.entry.amount), 0);
                let excess: typeof group = [];
                let excessIsUniquelyIdentified = true;

                if (workbookCredit === 0) {
                    excess = group;
                } else if (systemCredit > workbookCredit + 0.005) {
                    // Only detach a whole line if removing it leaves exactly the workbook amount.
                    const uniquelyExcessive = group.filter(item =>
                        Math.abs(systemCredit - Number(item.entry.amount) - workbookCredit) < 0.005
                    );
                    if (uniquelyExcessive.length === 1) {
                        excess = uniquelyExcessive;
                    } else {
                        excess = group;
                        excessIsUniquelyIdentified = false;
                    }
                }

                for (const item of excess) {
                    const oppositeEntries = item.voucher.entries.filter(entry =>
                        entry.id !== item.entry.id && entry.ledgerId !== targetLedger.id && entry.entryType === EntryType.DEBIT &&
                        Math.abs(Number(entry.amount) - Number(item.entry.amount)) < 0.005
                    );
                    const uniqueCounterpart = oppositeEntries.length === 1 ? oppositeEntries[0] : undefined;
                    const hasRequiredAgencySource = item.voucher.voucherType === VoucherType.SALE || item.voucher.voucherType === VoucherType.PURCHASE;
                    const isBalanced = Math.abs(Number(item.voucher.totalDebit) - Number(item.voucher.totalCredit)) < 0.005;
                    const canUnlink = excessIsUniquelyIdentified && Boolean(uniqueCounterpart) && isBalanced && !hasRequiredAgencySource;
                    extras.push({
                        row: workbookRow?.row,
                        voucherNo: item.tallyVoucherNo,
                        systemVoucherNo: item.voucher.voucherNo,
                        voucherType: item.voucher.voucherType,
                        voucherId: item.voucher.id,
                        sourceId: item.voucher.sourceId,
                        entryId: item.entry.id,
                        date: item.voucher.voucherDate,
                        narration: item.voucher.narration || "",
                        amount: Number(item.entry.amount),
                        ledger: targetLedger.name,
                        workbookDebit: workbookRow?.debit || 0,
                        workbookCredit: workbookCredit,
                        reason: workbookCredit === 0
                            ? workbookRow?.debit
                                ? "System has a credit posting, while the workbook lists this voucher on the debit side"
                                : "Credit posting is absent from the workbook"
                            : "System credit total exceeds the workbook credit amount",
                        canUnlink,
                        unlinkToLedger: uniqueCounterpart ? { id: uniqueCounterpart.ledgerId, name: uniqueCounterpart.ledger.name } : undefined,
                        status: !allowUnlink ? (canUnlink ? "preview" : "needs_review") : (canUnlink ? "unlinked" : "not_unlinked")
                    });
                }
            }

            const applied: string[] = [];
            if (allowUnlink) {
                const affectedLedgerIds = new Set<string>();
                for (const extra of extras.filter(item => item.canUnlink)) {
                    const current = await tx.ledgerEntry.findUnique({
                        where: { id: extra.entryId },
                        select: { id: true, ledgerId: true }
                    });
                    if (!current || current.ledgerId !== targetLedger.id) {
                        throw new ApiError(`Voucher ${extra.voucherNo} changed during unlink; transaction rolled back`, 409);
                    }
                    const target = extra.unlinkToLedger!;
                    await tx.ledgerEntry.update({ where: { id: current.id }, data: { ledgerId: target.id } });
                    affectedLedgerIds.add(targetLedger.id);
                    affectedLedgerIds.add(target.id);

                    await tx.journal.updateMany({
                        where: { voucherId: extra.voucherId, agencyId: agency.id },
                        data: { agencyId: null }
                    });
                    await tx.transaction.updateMany({
                        where: { id: extra.sourceId, agencyId: agency.id },
                        data: { agencyId: null }
                    });
                    await tx.transaction.updateMany({
                        where: { id: extra.sourceId, thirdPartyAgencyId: agency.id },
                        data: { thirdPartyAgencyId: null }
                    });
                    await tx.$executeRaw`
                        UPDATE "DebitCreditNote"
                        SET "agencyId" = NULL
                        WHERE "voucherId" = ${extra.voucherId} AND "agencyId" = ${agency.id}
                    `;
                    applied.push(extra.entryId);
                }
                for (const ledgerId of affectedLedgerIds) await LedgerService.syncCachedBalance(tx, ledgerId);
            }

            return {
                agency: { id: agency.id, name: agency.name },
                branchId: reconciliationBranchId,
                allowUnlink,
                workbookRows: rows.length,
                extraCreditPostings: extras,
                extraCount: extras.length,
                unlinked: applied.length,
                notUnlinked: extras.filter(item => allowUnlink && !item.canUnlink).length
            };
        }, { maxWait: 60_000, timeout: 5 * 60_000 });
    }
}

import * as XLSX from "xlsx";
import { EntryType, JournalDirection, JournalStatus, PaymentMode, VoucherType } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { LedgerService } from "../accounting/ledger/ledger.service";

type ImportedRow = {
    row: number;
    voucherNo: string;
    voucherType: VoucherType;
    voucherDate?: Date;
    debit: number;
    credit: number;
    narration: string;
    offsetLedgerName: string;
};

type ParsedWorkbook = {
    rows: ImportedRow[];
    periodStart?: Date;
    periodEnd?: Date;
    headerLabels: string[];
};

const parseVoucherType = (value: unknown): VoucherType | undefined => {
    const key = normalize(value).toLowerCase().replace(/[^a-z]/g, "");
    const types: Record<string, VoucherType> = {
        payment: VoucherType.PAYMENT,
        journal: VoucherType.JOURNAL,
        journalvch: VoucherType.JOURNAL,
        journalvoucher: VoucherType.JOURNAL,
        journalexpenses: VoucherType.JOURNAL,
        journalexpense: VoucherType.JOURNAL,
        receipt: VoucherType.RECEIPT,
        cashpayment: VoucherType.CASH_PAYMENT,
        cashreceipt: VoucherType.CASH_RECEIPT,
        bankpayment: VoucherType.BANK_PAYMENT,
        bankreceipt: VoucherType.BANK_RECEIPT,
        contra: VoucherType.CONTRA,
        sale: VoucherType.SALE,
        sales: VoucherType.SALE,
        taxinvoice: VoucherType.SALE,
        purchase: VoucherType.PURCHASE,
        rcmpurchase: VoucherType.RCM_PURCHASE,
        igstpurchase: VoucherType.IGST_PURCHASE,
        gstpurchase: VoucherType.GST_PURCHASE,
        cstpurchase: VoucherType.CST_PURCHASE,
        discountpurchase: VoucherType.DISCOUNT_PURCHASE,
        highseaspurchase: VoucherType.HIGH_SEAS_PURCHASE,
        importpurchase: VoucherType.IMPORT_PURCHASE,
        vatpurchase: VoucherType.VAT_PURCHASE,
        interestsaundarycreditors: VoucherType.INTEREST_SAUNDRY_CREDITORS,
        debitnote: VoucherType.DEBIT_NOTE,
        creditnote: VoucherType.CREDIT_NOTE,
        openingbalance: VoucherType.OPENING_BALANCE,
        openingbal: VoucherType.OPENING_BALANCE
    };
    return types[key];
};

const normalize = (value: unknown) => String(value ?? "")
    .replace(/[\u00a0\u2013\u2014]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeKey = (value: unknown) => normalize(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");

const money = (value: unknown) => {
    if (typeof value === "number") return Math.round(value * 100) / 100;
    const text = normalize(value).replace(/[₹$,]/g, "");
    if (!text) return 0;
    const parsed = Number(text.replace(/[()]/g, ""));
    return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : NaN;
};

const parseDate = (value: unknown) => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === "number") {
        const parsed = XLSX.SSF.parse_date_code(value);
        if (parsed) return new Date(parsed.y, parsed.m - 1, parsed.d);
    }
    const text = normalize(value);
    const dmy = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (dmy) {
        let year = Number(dmy[3]);
        if (year < 100) year += year >= 70 ? 1900 : 2000;
        const parsed = new Date(year, Number(dmy[2]) - 1, Number(dmy[1]));
        return Number.isNaN(parsed.getTime()) ? undefined : parsed;
    }
    const parsed = new Date(text);
    return text && !Number.isNaN(parsed.getTime()) ? parsed : undefined;
};

function parseWorkbook(buffer: Buffer): ParsedWorkbook {
    let workbook: XLSX.WorkBook;
    try {
        workbook = XLSX.read(buffer, { type: "buffer", cellDates: true, raw: true });
    } catch {
        throw new ApiError("Could not read the uploaded Excel workbook", 400);
    }

    const parsed: ImportedRow[] = [];
    const invalid: string[] = [];
    let periodStart: Date | undefined;
    let periodEnd: Date | undefined;
    const headerLabels = new Set<string>();
    const supportedSheets = workbook.SheetNames.map(name => ({
        name,
        rows: XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], {
            header: 1, defval: "", raw: true
        })
    }));
    for (const sheet of supportedSheets) {
        const headerIndex = sheet.rows.findIndex(row => {
            const headers = row.map(normalizeKey);
            return headers.some(h => ["vchtype", "vouchertype", "type"].includes(h)) &&
                headers.some(h => ["vchno", "voucherno", "vouchernumber", "voucherno"].includes(h)) &&
                headers.some(h => ["date", "vchdate", "voucherdate"].includes(h)) &&
                headers.some(h => h === "debit") && headers.some(h => h === "credit");
        });
        if (headerIndex < 0) continue;
        for (const cell of sheet.rows.slice(0, headerIndex).flat()) {
            const label = normalize(cell);
            if (label) headerLabels.add(label);
        }
        for (const cell of sheet.rows.slice(0, headerIndex).flat()) {
            const range = normalize(cell).match(/^(.+?)\s+to\s+(.+)$/i);
            if (!range) continue;
            const start = parseDate(range[1]);
            const end = parseDate(range[2]);
            if (start && end && start <= end) {
                periodStart = new Date(start);
                periodStart.setHours(0, 0, 0, 0);
                periodEnd = new Date(end);
                periodEnd.setHours(23, 59, 59, 999);
                break;
            }
        }
        const headers = sheet.rows[headerIndex].map(normalizeKey);
        const find = (...names: string[]) => headers.findIndex(h => names.includes(h));
        const typeCol = find("vchtype", "vouchertype", "type");
        const noCol = find("vchno", "voucherno", "vouchernumber");
        const dateCol = find("date", "vchdate", "voucherdate");
        const debitCol = find("debit");
        const creditCol = find("credit");
        const narrationCol = find("particulars", "narration", "description", "remarks");
        for (let i = headerIndex + 1; i < sheet.rows.length; i++) {
            const cells = sheet.rows[i];
            const voucherType = parseVoucherType(cells[typeCol]);
            const voucherNo = normalize(cells[noCol]).replace(/\.0$/, "");
            // Ledger exports commonly end with opening/closing balance and
            // total rows. They may contain a type label or amount but are not
            // vouchers without a voucher number.
            if (!voucherNo) continue;
            const debit = money(cells[debitCol]);
            const credit = money(cells[creditCol]);
            const voucherDate = parseDate(cells[dateCol]);
            const problems: string[] = [];
            if (!voucherType) problems.push(`Vch Type "${normalize(cells[typeCol]) || "blank"}" is not supported`);
            if (!Number.isFinite(debit) || !Number.isFinite(credit)) problems.push("Debit/Credit amount is not numeric");
            else if ((debit > 0) === (credit > 0)) problems.push("exactly one of Debit or Credit must be greater than zero");
            if (problems.length) {
                invalid.push(`${i + 1} (${problems.join("; ")})`);
                continue;
            }
            // Tally ledger exports commonly place "To"/"By" in the first
            // Particulars cell and the counter-ledger in the following cell.
            const particulars = cells.slice(narrationCol >= 0 ? narrationCol : 0, typeCol)
                .map(normalize)
                .filter(value => value && !/^(to|by)$/i.test(value));
            parsed.push({
                row: i + 1,
                voucherNo,
                voucherType: voucherType!,
                voucherDate,
                debit,
                credit,
                narration: particulars.join(" "),
                offsetLedgerName: particulars.length ? particulars[particulars.length - 1] : ""
            });
        }
    }
    if (invalid.length) throw new ApiError(`Invalid supported voucher row(s): ${invalid.slice(0, 20).join(", ")}`, 400);
    if (!parsed.length) throw new ApiError("No supported voucher rows with recognizable headers were found", 400);

    const unique = new Map<string, ImportedRow>();
    for (const row of parsed) {
        const key = `${row.voucherType}|${row.voucherNo.toLowerCase()}`;
        const old = unique.get(key);
        if (old && (old.debit !== row.debit || old.credit !== row.credit ||
            old.voucherDate?.toDateString() !== row.voucherDate?.toDateString() ||
            old.offsetLedgerName !== row.offsetLedgerName)) {
            throw new ApiError(`Conflicting workbook rows use ${row.voucherType} voucher number ${row.voucherNo}`, 400);
        }
        if (!old) unique.set(key, row);
    }
    return { rows: [...unique.values()], periodStart, periodEnd, headerLabels: [...headerLabels] };
}

const groupPathFor = (groupId: string, groupsById: Map<string, { id: string; name: string; parentId: string | null }>) => {
    const path: string[] = [];
    const seen = new Set<string>();
    let current = groupsById.get(groupId);
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        const name = normalize(current.name);
        // Trial Balance hides repeated adjacent headings created by legacy imports.
        if (!path.length || normalizeKey(path[path.length - 1]) !== normalizeKey(name)) path.push(name);
        current = current.parentId ? groupsById.get(current.parentId) : undefined;
    }
    return path.reverse();
};

const categoryPathFor = (groupId: string, groupsById: Map<string, { id: string; name: string; parentId: string | null }>) =>
    groupPathFor(groupId, groupsById).join(" > ");

export class TrialBalanceLedgerVoucherService {
    static async import(actor: any, ledgerName: string, buffer: Buffer, accept = false, branchId?: string, offsetLedgerName?: string, allowUnlink = false) {
        if (!actor?.id) throw new ApiError("Unauthorized", 401);
        if (!ledgerName.trim()) throw new ApiError("ledgerName is required", 400);
        if (branchId && actor.branchAccessType !== "ALL" && branchId !== actor.branchId) {
            throw new ApiError("You do not have access to this branch", 403);
        }
        const effectiveBranchId = actor.branchAccessType === "ALL" ? branchId : actor.branchId;
        const targetWhere = {
            name: { equals: ledgerName.trim(), mode: "insensitive" as const },
            isActive: true
        };
        // A branch may have a branch-specific ledger and a shared (branchId
        // null) ledger with the same name. Prefer the branch-specific account;
        // use the shared account only when no local account exists.
        let targetCandidates = effectiveBranchId
            ? await prisma.ledger.findMany({
                where: { ...targetWhere, branchId: effectiveBranchId },
                include: { group: { include: { parent: true } } }
            })
            : [];
        if (targetCandidates.length === 0 && effectiveBranchId) {
            targetCandidates = await prisma.ledger.findMany({
                where: { ...targetWhere, branchId: null },
                include: { group: { include: { parent: true } } }
            });
        }
        if (!effectiveBranchId) {
            targetCandidates = await prisma.ledger.findMany({
                where: targetWhere,
                include: { group: { include: { parent: true } } }
            });
        }
        if (targetCandidates.length === 0) {
            throw new ApiError(
                `Ledger "${ledgerName}" was not found${effectiveBranchId ? ` in branch ${effectiveBranchId} or as a shared ledger` : ""}`,
                400
            );
        }

        // Resolve the named ledger in its actual Trial Balance hierarchy. The
        // same-name record can appear more than once because legacy imports
        // created duplicate ledger rows; same-branch records on the same path
        // are one logical Trial Balance account for reconciliation purposes.
        const groupRows = await prisma.ledgerGroup.findMany({
            select: { id: true, name: true, parentId: true }
        });
        const groupsById = new Map(groupRows.map(group => [group.id, group]));
        const groupDepth = (groupId: string) => {
            let depth = 0;
            let current = groupsById.get(groupId);
            const seen = new Set<string>();
            while (current && !seen.has(current.id)) {
                seen.add(current.id);
                depth += 1;
                current = current.parentId ? groupsById.get(current.parentId) : undefined;
            }
            return depth;
        };
        const candidatesByBranch = new Map<string, typeof targetCandidates>();
        for (const candidate of targetCandidates) {
            const branchKey = candidate.branchId || "shared";
            const rows = candidatesByBranch.get(branchKey) || [];
            rows.push(candidate);
            candidatesByBranch.set(branchKey, rows);
        }
        if (candidatesByBranch.size > 1) {
            throw new ApiError(
                `Ledger "${ledgerName}" exists in multiple branches; specify branchId to select its Trial Balance account`,
                400
            );
        }
        const canonicalCandidates = [...candidatesByBranch.values()].map(candidates => {
            const minDepth = Math.min(...candidates.map(candidate => groupDepth(candidate.groupId)));
            return candidates.filter(candidate => groupDepth(candidate.groupId) === minDepth);
        }).flat();

        const canonicalPaths = [...new Set(canonicalCandidates.map(candidate =>
            categoryPathFor(candidate.groupId, groupsById)
        ))];
        if (canonicalPaths.length > 1) {
            throw new ApiError(
                `Ledger "${ledgerName}" matches multiple Trial Balance paths: ${canonicalPaths.join("; ")}; specify a branch or a more specific ledger name`,
                400
            );
        }
        if (canonicalCandidates.length === 0) {
            throw new ApiError(`Ledger "${ledgerName}" was not found in the selected Trial Balance`, 404);
        }
        const candidateIds = canonicalCandidates.map(candidate => candidate.id);
        const candidateCounts = await prisma.ledgerEntry.groupBy({
            by: ["ledgerId"],
            where: { ledgerId: { in: candidateIds } },
            _count: { _all: true }
        });
        const entryCountByLedger = new Map(candidateCounts.map(row => [row.ledgerId, row._count._all]));
        const target = [...canonicalCandidates].sort((a, b) =>
            (entryCountByLedger.get(b.id) || 0) - (entryCountByLedger.get(a.id) || 0) || a.id.localeCompare(b.id)
        )[0];
        const targetLedgerIds = canonicalCandidates.map(candidate => candidate.id);
        const targetCategoryPath = categoryPathFor(target.groupId, groupsById);
        if (effectiveBranchId && target.branchId && target.branchId !== effectiveBranchId) throw new ApiError("You do not have access to this ledger", 403);

        const parsedWorkbook = parseWorkbook(buffer);
        const rows = parsedWorkbook.rows;
        const statementLedgerMatches = parsedWorkbook.headerLabels.some(label =>
            normalizeKey(label).includes(normalizeKey(ledgerName))
        );
        if (allowUnlink && !statementLedgerMatches) {
            throw new ApiError("allowUnlink requires a workbook header that identifies the requested ledger", 400);
        }
        const workbookVoucherKeys = new Set(rows.map(row =>
            `${row.voucherType}|${normalizeKey(row.voucherNo)}`
        ));
        const outcomes: Array<Record<string, unknown>> = [];
        const missing: ImportedRow[] = [];
        for (const row of rows) {
            const dateStart = row.voucherDate ? new Date(row.voucherDate) : undefined;
            const dateEnd = row.voucherDate ? new Date(row.voucherDate) : undefined;
            dateStart?.setHours(0, 0, 0, 0);
            dateEnd?.setHours(23, 59, 59, 999);
            // Search every branch/ledger before deciding a row is missing.
            // Legacy data can contain duplicate voucher numbers, so conflicts
            // must be surfaced as ambiguous instead of silently imported.
            const direct = await prisma.voucher.findMany({
                where: { voucherNo: row.voucherNo, voucherType: row.voucherType },
                include: { entries: { include: { ledger: { select: { id: true, name: true } } } } }
            });
            let journalCandidates: any[] = [];
            if (row.voucherType === VoucherType.JOURNAL) {
                const journals = await prisma.journal.findMany({
                    where: { voucherNo: row.voucherNo, ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}) },
                    select: {
                        id: true,
                        voucherId: true,
                        amount: true,
                        direction: true,
                        journalHead: { select: { ledgerId: true, type: true, ledger: { select: { name: true } } } }
                    }
                });
                journalCandidates = journals;
                const linkedIds = journals.map(journal => journal.voucherId).filter((id): id is string => Boolean(id));
                if (linkedIds.length) {
                    const linkedVouchers = await prisma.voucher.findMany({
                        where: { id: { in: linkedIds }, ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}) },
                        include: { entries: { include: { ledger: { select: { id: true, name: true } } } } }
                    });
                    direct.push(...linkedVouchers);
                }
                const journalMatches = journals.filter(journal =>
                    targetLedgerIds.includes(journal.journalHead.ledgerId) &&
                    (journal.direction || journal.journalHead.type) ===
                        (row.debit > 0 ? "OUTWARD" : "INWARD") &&
                    Math.abs(Number(journal.amount) - Math.max(row.debit, row.credit)) < 0.005
                );
                if (journalMatches.length === 1) {
                    outcomes.push({ row: row.row, voucherNo: row.voucherNo, voucherType: row.voucherType,
                        status: "exists", matchedBy: "Journal number and target-ledger amount",
                        voucherId: journalMatches[0].voucherId || journalMatches[0].id });
                    continue;
                }
                if (journalMatches.length > 1) {
                    outcomes.push({ row: row.row, voucherNo: row.voucherNo, voucherType: row.voucherType,
                        status: "ambiguous", reason: "Multiple Journal records with this number match the target ledger and amount" });
                    continue;
                }
            }
            const uniqueDirect = [...new Map(direct.map(voucher => [voucher.id, voucher])).values()];
            const directMatches = uniqueDirect.filter(v => v.entries.some(e => targetLedgerIds.includes(e.ledgerId) &&
                e.entryType === (row.debit > 0 ? EntryType.DEBIT : EntryType.CREDIT) &&
                Math.abs(Number(e.amount) - Math.max(row.debit, row.credit)) < 0.005));
            if (directMatches.length === 1) {
                outcomes.push({ row: row.row, voucherNo: row.voucherNo, voucherType: row.voucherType, status: "exists", matchedBy: "voucher number and target-ledger amount", voucherId: directMatches[0].id });
                continue;
            }
            if (directMatches.length > 1) {
                outcomes.push({ row: row.row, voucherNo: row.voucherNo, voucherType: row.voucherType, status: "ambiguous", reason: "Multiple vouchers with this number match the target ledger and amount" });
                continue;
            }
            if (uniqueDirect.length) {
                const candidates = uniqueDirect.flatMap(voucher => voucher.entries.map(entry => ({
                    voucherId: voucher.id,
                    voucherNo: voucher.voucherNo,
                    voucherType: voucher.voucherType,
                    voucherDate: voucher.voucherDate,
                    narration: entry.narration || voucher.narration,
                    ledgerName: entry.ledger.name,
                    entryType: entry.entryType,
                    amount: Number(entry.amount)
                })));
                outcomes.push({ row: row.row, voucherNo: row.voucherNo, voucherType: row.voucherType,
                    status: "ambiguous",
                    reason: "This voucher number and type already exist in the system, but not as the requested target-ledger posting; review the existing entry before importing",
                    candidates });
                continue;
            }
            if (journalCandidates.length) {
                outcomes.push({
                    row: row.row,
                    voucherNo: row.voucherNo,
                    voucherType: row.voucherType,
                    status: "ambiguous",
                    reason: "A Journal with this voucher number already exists in the system, but it is not linked to the requested target-ledger amount",
                    candidates: journalCandidates.map(journal => ({
                        journalId: journal.id,
                        voucherId: journal.voucherId,
                        voucherNo: row.voucherNo,
                        ledgerName: journal.journalHead.ledger.name,
                        amount: Number(journal.amount),
                        direction: journal.direction || journal.journalHead.type
                    }))
                });
                continue;
            }
            const alternatives = await prisma.ledgerEntry.findMany({
                where: { entryType: row.debit > 0 ? EntryType.DEBIT : EntryType.CREDIT, amount: Math.max(row.debit, row.credit),
                    ledgerId: { notIn: targetLedgerIds }, voucher: { voucherType: row.voucherType,
                        ...(dateStart && dateEnd ? { voucherDate: { gte: dateStart, lte: dateEnd } } : {}),
                        ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}) } },
                include: { voucher: { select: { id: true, voucherNo: true, voucherDate: true, voucherType: true } }, ledger: { select: { id: true, name: true } } },
                take: 20
            });
            if (alternatives.length) {
                outcomes.push({ row: row.row, voucherNo: row.voucherNo, voucherType: row.voucherType, status: "ambiguous", reason: `A same${row.voucherDate ? "-date" : ""}, same-amount ${row.voucherType} exists under another ledger; review before accepting`, candidates: alternatives.map(e => ({ voucherId: e.voucher.id, voucherNo: e.voucher.voucherNo, voucherDate: e.voucher.voucherDate, voucherType: e.voucher.voucherType, ledgerName: e.ledger.name, particulars: e.narration || e.voucher.narration, entryType: e.entryType, amount: Number(e.amount) })) });
                continue;
            }
            outcomes.push({ row: row.row, voucherNo: row.voucherNo, voucherType: row.voucherType, status: "missing", debit: row.debit, credit: row.credit, date: row.voucherDate, narration: row.narration });
            missing.push(row);
        }

        // A Tally ledger statement is the source of truth for postings on the
        // selected ledger. Report system postings absent from the workbook,
        // but never unlink opening-balance rows through this flow. An explicit
        // allowUnlink flag can move only balanced two-line postings when the
        // opposite ledger is uniquely identified.
        const targetEntries = await prisma.ledgerEntry.findMany({
            where: {
                ledgerId: { in: targetLedgerIds },
                voucher: {
                    ...(parsedWorkbook.periodStart && parsedWorkbook.periodEnd
                        ? { voucherDate: { gte: parsedWorkbook.periodStart, lte: parsedWorkbook.periodEnd } }
                        : {})
                }
            },
            include: {
                ledger: { select: { id: true, name: true } },
                voucher: {
                    include: {
                        entries: { include: { ledger: { select: { id: true, name: true } } } },
                        journals: { include: { journalHead: { select: { id: true, ledgerId: true, headType: true } } } }
                    }
                }
            }
        });
        const entriesByVoucher = new Map<string, typeof targetEntries>();
        for (const entry of targetEntries) {
            const list = entriesByVoucher.get(entry.voucherId) || [];
            list.push(entry);
            entriesByVoucher.set(entry.voucherId, list);
        }
        const extraVouchers: Array<Record<string, unknown> & {
            canUnlink: boolean;
            status: string;
            entryId?: string;
            counterpartLedgerId?: string;
            journalId?: string;
            counterpartJournalHeadId?: string;
        }> = [];
        const sourceLinkedVoucherTypes = new Set<VoucherType>([
            VoucherType.SALE,
            VoucherType.PURCHASE,
            VoucherType.DEBIT_NOTE,
            VoucherType.CREDIT_NOTE
        ]);
        for (const [voucherId, rowsForVoucher] of entriesByVoucher) {
            const voucher = rowsForVoucher[0].voucher;
            const key = `${voucher.voucherType}|${normalizeKey(voucher.voucherNo)}`;
            if (workbookVoucherKeys.has(key)) continue;

            const targetLines = voucher.entries.filter(entry => targetLedgerIds.includes(entry.ledgerId));
            const candidates = targetLines.length === 1 && voucher.entries.length === 2
                ? voucher.entries.filter(entry => !targetLedgerIds.includes(entry.ledgerId) &&
                    entry.entryType !== targetLines[0].entryType &&
                    Math.abs(Number(entry.amount) - Number(targetLines[0].amount)) < 0.005)
                : [];
            const counterpart = candidates.length === 1 ? candidates[0] : undefined;
            const isBalanced = Math.abs(Number(voucher.totalDebit) - Number(voucher.totalCredit)) < 0.005;
            let canUnlink = Boolean(targetLines.length === 1 && counterpart && isBalanced &&
                parsedWorkbook.periodStart && parsedWorkbook.periodEnd && statementLedgerMatches);
            let reason = canUnlink
                ? "Voucher is absent from the workbook and has a unique balanced counter-ledger posting"
                : !statementLedgerMatches
                    ? "Cannot safely reassign: the workbook header does not identify the requested ledger"
                    : !parsedWorkbook.periodStart || !parsedWorkbook.periodEnd
                    ? "Cannot safely reassign: the workbook has no recognizable statement date range"
                    : "Cannot safely reassign: voucher is not a balanced two-line posting with one unique opposite ledger entry";
            let targetJournal: (typeof voucher.journals)[number] | undefined;
            let counterpartJournalHeadId: string | undefined;

            if (voucher.voucherType === VoucherType.OPENING_BALANCE) {
                canUnlink = false;
                reason = "Opening balance postings require the dedicated opening-balance reconciliation flow";
            }
            if (sourceLinkedVoucherTypes.has(voucher.voucherType)) {
                canUnlink = false;
                reason = "Source-linked sales, purchases, and notes require source-document reconciliation";
            }
            if (canUnlink) {
                const linkedTransaction = await prisma.transaction.findUnique({
                    where: { id: voucher.sourceId },
                    select: { id: true }
                });
                if (linkedTransaction) {
                    canUnlink = false;
                    reason = "Voucher is linked to a transaction and requires transaction-level reconciliation";
                }
            }
            if (canUnlink && voucher.voucherType === VoucherType.JOURNAL) {
                const targetJournals = voucher.journals.filter(journal => targetLedgerIds.includes(journal.journalHead.ledgerId));
                targetJournal = targetJournals.length === 1 ? targetJournals[0] : undefined;
                const heads = counterpart
                    ? await prisma.journalHead.findMany({
                        where: { ledgerId: counterpart.ledgerId },
                        select: { id: true, headType: true }
                    })
                    : [];
                const sameTypeHead = targetJournal
                    ? heads.filter(head => head.headType === targetJournal!.journalHead.headType)
                    : [];
                const parentFallback = heads.filter(head => head.headType === "PARENT");
                const selectedHead = sameTypeHead.length === 1
                    ? sameTypeHead[0]
                    : sameTypeHead.length === 0 && parentFallback.length === 1
                        ? parentFallback[0]
                        : undefined;
                if (!targetJournal || !selectedHead) {
                    canUnlink = false;
                    reason = "Journal entry has no unique matching Journal Head on the counter-ledger";
                } else {
                    counterpartJournalHeadId = selectedHead.id;
                }
            }

            extraVouchers.push({
                voucherId,
                voucherNo: voucher.voucherNo,
                voucherType: voucher.voucherType,
                date: voucher.voucherDate,
                narration: voucher.narration,
                entryId: targetLines.length === 1 ? targetLines[0].id : undefined,
                ledgerName: targetLines.length === 1 ? targetLines[0].ledger.name : target.name,
                entryType: targetLines.length === 1 ? targetLines[0].entryType : undefined,
                amount: targetLines.length === 1 ? Number(targetLines[0].amount) : undefined,
                counterpartLedgerId: counterpart?.ledgerId,
                counterpartLedgerName: counterpart?.ledger.name,
                canUnlink,
                reason,
                status: allowUnlink ? (canUnlink ? "unlinked" : "needs_review") : (canUnlink ? "preview" : "needs_review"),
                journalId: targetJournal?.id,
                counterpartJournalHeadId
            });
        }

        let unlinked = 0;
        if (allowUnlink && extraVouchers.some(item => item.canUnlink)) {
            const affectedLedgerIds = new Set<string>();
            await prisma.$transaction(async tx => {
                for (const extra of extraVouchers.filter(item => item.canUnlink)) {
                    const current = await tx.ledgerEntry.findUnique({
                        where: { id: extra.entryId! },
                        include: { voucher: { include: { entries: true } } }
                    });
                    if (!current || !targetLedgerIds.includes(current.ledgerId) ||
                        current.voucherId !== extra.voucherId || current.voucher.entries.length !== 2) {
                        throw new ApiError(`Voucher ${extra.voucherNo} changed during unlink; transaction rolled back`, 409);
                    }
                    const opposite = current.voucher.entries.filter(entry => entry.id !== current.id &&
                        !targetLedgerIds.includes(entry.ledgerId) && entry.entryType !== current.entryType &&
                        Math.abs(Number(entry.amount) - Number(current.amount)) < 0.005);
                    if (opposite.length !== 1 ||
                        Math.abs(Number(current.voucher.totalDebit) - Number(current.voucher.totalCredit)) >= 0.005) {
                        throw new ApiError(`Voucher ${extra.voucherNo} is no longer safe to unlink; transaction rolled back`, 409);
                    }
                    await tx.ledgerEntry.update({ where: { id: current.id }, data: { ledgerId: opposite[0].ledgerId } });
                    affectedLedgerIds.add(current.ledgerId);
                    affectedLedgerIds.add(opposite[0].ledgerId);
                    if (extra.journalId && extra.counterpartJournalHeadId) {
                        await tx.journal.update({
                            where: { id: extra.journalId },
                            data: {
                                journalHeadId: extra.counterpartJournalHeadId,
                                direction: opposite[0].entryType === EntryType.CREDIT
                                    ? JournalDirection.INWARD
                                    : JournalDirection.OUTWARD
                            }
                        });
                    }
                    unlinked++;
                }
                for (const ledgerId of affectedLedgerIds) await LedgerService.syncCachedBalance(tx, ledgerId);
            }, { maxWait: 60_000, timeout: 5 * 60_000 });
        }

        let created = 0;
        if (accept && missing.length) {
            const importableTypes = new Set<VoucherType>([VoucherType.PAYMENT, VoucherType.RECEIPT, VoucherType.JOURNAL]);
            const unsupported = missing.filter(row => !importableTypes.has(row.voucherType) || !row.voucherDate);
            if (unsupported.length) throw new ApiError(`Cannot create missing voucher(s) through this importer: ${unsupported.map(row => `${row.voucherType} ${row.voucherNo}${row.voucherDate ? "" : " (missing date)"}`).join(", ")}. Missing rows must be dated PAYMENT, RECEIPT, or JOURNAL vouchers.`, 400);

            const resolveOffset = async (row: ImportedRow) => {
                const name = offsetLedgerName?.trim() || row.offsetLedgerName;
                if (!name) {
                    throw new ApiError(`Workbook row ${row.row} (${row.voucherType} ${row.voucherNo}) does not identify a counter-ledger; provide offsetLedgerName`, 400);
                }
                let offsets = await prisma.ledger.findMany({
                    where: { name: { equals: name, mode: "insensitive" }, isActive: true,
                        ...(effectiveBranchId ? { OR: [{ branchId: effectiveBranchId }, { branchId: null }] } : {}) },
                    select: { id: true, name: true, branchId: true }
                });
                if (effectiveBranchId) {
                    const localOffsets = offsets.filter(ledger => ledger.branchId === effectiveBranchId);
                    offsets = localOffsets.length ? localOffsets : offsets.filter(ledger => ledger.branchId === null);
                }
                // Prefer the offset ledger historically paired with any
                // same-name target record, which handles duplicate legacy IDs.
                if (offsets.length > 1) {
                    const targetVoucherRows = await prisma.ledgerEntry.findMany({
                        where: { ledgerId: { in: targetLedgerIds } },
                        select: { voucherId: true }
                    });
                    const targetVoucherIds = [...new Set(targetVoucherRows.map(entry => entry.voucherId))];
                    if (targetVoucherIds.length) {
                        const counterpartRows = await prisma.ledgerEntry.findMany({
                            where: { voucherId: { in: targetVoucherIds }, ledgerId: { in: offsets.map(ledger => ledger.id) } },
                            select: { ledgerId: true }
                        });
                        const counts = new Map<string, number>();
                        for (const entry of counterpartRows) counts.set(entry.ledgerId, (counts.get(entry.ledgerId) || 0) + 1);
                        const highestCount = Math.max(0, ...counts.values());
                        const mostUsed = offsets.filter(ledger => (counts.get(ledger.id) || 0) === highestCount && highestCount > 0);
                        if (mostUsed.length === 1) offsets = mostUsed;
                    }
                }
                if (offsets.length !== 1) {
                    throw new ApiError(offsets.length
                        ? `More than one active ledger matches offset "${name}" for voucher ${row.voucherNo}; provide branchId or offsetLedgerName`
                        : `Offset ledger "${name}" for voucher ${row.voucherNo} was not found`, 400);
                }
                if (targetLedgerIds.includes(offsets[0].id)) throw new ApiError(`Target and offset ledger are the same for voucher ${row.voucherNo}`, 400);
                return offsets[0];
            };
            const rowsWithOffsets = await Promise.all(missing.map(async row => ({ row, offset: await resolveOffset(row) })));
            await prisma.$transaction(async tx => {
                for (const { row, offset } of rowsWithOffsets) {
                    const voucher = await LedgerService.createVoucher({
                        voucherNo: row.voucherNo, voucherType: row.voucherType, sourceId: randomUUID(),
                        branchId: effectiveBranchId || target.branchId || offset.branchId || undefined,
                        voucherDate: row.voucherDate, narration: row.narration || `Imported ${row.voucherType} ${row.voucherNo}`,
                        entries: [
                            { ledgerId: target.id, entryType: row.debit > 0 ? EntryType.DEBIT : EntryType.CREDIT, amount: Math.max(row.debit, row.credit), narration: row.narration || undefined },
                            { ledgerId: offset.id, entryType: row.debit > 0 ? EntryType.CREDIT : EntryType.DEBIT, amount: Math.max(row.debit, row.credit), narration: row.narration || undefined }
                        ]
                    }, tx);
                    if (row.voucherType === VoucherType.JOURNAL) {
                        const journalDate = row.voucherDate!;
                        const journalRemarks = row.narration || `Imported JOURNAL ${row.voucherNo}`;
                        const journalBranchId = effectiveBranchId || target.branchId || offset.branchId;
                        if (!journalBranchId) {
                            throw new ApiError(`A branchId is required to create JOURNAL ${row.voucherNo}`, 400);
                        }
                        for (const entry of voucher.entries) {
                            const journalHead = await tx.journalHead.findFirst({
                                where: { ledgerId: entry.ledgerId, headType: "SUBHEAD" },
                                select: { id: true }
                            }) || await tx.journalHead.findFirst({
                                where: { ledgerId: entry.ledgerId, headType: "PARENT" },
                                select: { id: true }
                            });
                            if (!journalHead) {
                                throw new ApiError(`No Journal Head exists for ledger ${entry.ledgerId}; cannot create JOURNAL ${row.voucherNo}`, 400);
                            }
                            await tx.journal.create({
                                data: {
                                    id: randomUUID(),
                                    branchId: journalBranchId,
                                    journalHeadId: journalHead.id,
                                    amount: Number(entry.amount),
                                    paymentMode: PaymentMode.OFFLINE,
                                    status: JournalStatus.APPROVED,
                                    voucherId: voucher.id,
                                    voucherNo: row.voucherNo,
                                    journalDate,
                                    direction: entry.entryType === EntryType.CREDIT
                                        ? JournalDirection.INWARD
                                        : JournalDirection.OUTWARD,
                                    remarks: journalRemarks,
                                    createdById: actor.id,
                                    approvedById: actor.id,
                                    approvedAt: new Date()
                                }
                            });
                        }
                    }
                    const outcome = outcomes.find(item => item.row === row.row && item.voucherNo === row.voucherNo);
                    if (outcome) Object.assign(outcome, {
                        status: "created",
                        voucherId: voucher.id,
                        ledgerName: target.name,
                        offsetLedgerName: offset.name
                    });
                    created++;
                }
            });
        }
        return { ledger: {
                id: target.id,
                ids: targetLedgerIds,
                name: target.name,
                group: target.group.name,
                categoryPath: targetCategoryPath
            },
            supportedVoucherTypes: Object.values(VoucherType).filter(type => type !== VoucherType.OPENING_BALANCE),
            creatableVoucherTypes: [VoucherType.PAYMENT, VoucherType.RECEIPT, VoucherType.JOURNAL],
            accepted: accept, workbookRows: rows.length, created,
            statementPeriod: parsedWorkbook.periodStart && parsedWorkbook.periodEnd
                ? { start: parsedWorkbook.periodStart, end: parsedWorkbook.periodEnd }
                : null,
            statementLedgerMatches,
            allowUnlink,
            extraVouchers,
            unlinked,
            inferredOffsetLedgerNames: [...new Set(rows.map(row => row.offsetLedgerName).filter(Boolean))],
            summary: { exists: outcomes.filter(x => x.status === "exists").length, created, missing: outcomes.filter(x => x.status === "missing").length, ambiguous: outcomes.filter(x => x.status === "ambiguous").length, extra: extraVouchers.length, unlinked }, rows: outcomes };
    }
}

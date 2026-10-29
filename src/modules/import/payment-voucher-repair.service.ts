import * as XLSX from "xlsx";
import { EntryType, LedgerNature, LedgerType, Prisma, VoucherType } from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { LedgerService } from "../accounting/ledger/ledger.service";

type VoucherLine = {
    sourceRow: number;
    voucherNo: string;
    voucherDate?: Date;
    groups: string[];
    accountName: string;
    debit: number;
    credit: number;
    narration: string;
};

type VoucherData = {
    voucherNo: string;
    voucherDate?: Date;
    lines: VoucherLine[];
    debit: number;
    credit: number;
};

const normalize = (value: unknown) => String(value ?? "")
    .replace(/[\u00a0\u2013\u2014]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const key = (value: unknown) => normalize(value).toLowerCase().replace(/[^a-z0-9]/g, "");
const roundMoney = (value: number) => Math.round(value * 100) / 100;

const parseAmount = (value: unknown) => {
    if (typeof value === "number") return roundMoney(value);
    const text = normalize(value).replace(/[₹$,]/g, "");
    if (!text) return 0;
    const parsed = Number(text.replace(/[()]/g, ""));
    return Number.isFinite(parsed) ? roundMoney(parsed) : NaN;
};

const parseDate = (value: unknown): Date | undefined => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === "number") {
        const parts = XLSX.SSF.parse_date_code(value);
        if (parts) return new Date(parts.y, parts.m - 1, parts.d);
    }
    const text = normalize(value);
    const iso = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (iso) return new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    const dmy = text.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
    if (dmy) {
        let year = Number(dmy[3]);
        if (year < 100) year += year >= 70 ? 1900 : 2000;
        return new Date(year, Number(dmy[2]) - 1, Number(dmy[1]));
    }
    const date = new Date(text);
    return text && !Number.isNaN(date.getTime()) ? date : undefined;
};

const columns: Record<string, string[]> = {
    date: ["date"],
    voucherNo: ["vouchernumber", "voucherno", "vchno"],
    journalGroup: ["journalgroup"],
    subGroup: ["subgroup"],
    subGroup2: ["subgroup2"],
    subGroup3: ["subgroup3"],
    voucherType: ["journalnametype", "journalname", "type"],
    accountName: ["accountledgername", "ledgeraccountname", "ledgername", "accountname"],
    debit: ["debitamount", "debit"],
    credit: ["creditamount", "credit"],
    narration: ["narration"]
};

function parseWorkbook(buffer: Buffer): VoucherData[] {
    let workbook: XLSX.WorkBook;
    try {
        workbook = XLSX.read(buffer, { type: "buffer", raw: true, cellDates: true });
    } catch {
        throw new ApiError("Could not read the uploaded Excel workbook", 400);
    }

    const lines: VoucherLine[] = [];
    const invalid: string[] = [];
    for (const sheetName of workbook.SheetNames) {
        const sheetRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[sheetName], {
            header: 1, defval: "", raw: true
        });
        const headerIndex = sheetRows.findIndex(row => {
            const headers = row.map(key);
            return columns.voucherNo.some(name => headers.includes(name)) &&
                headers.includes("journalgroup") &&
                columns.accountName.some(name => headers.includes(name)) &&
                columns.debit.some(name => headers.includes(name)) &&
                columns.credit.some(name => headers.includes(name));
        });
        if (headerIndex < 0) continue;
        const headers = sheetRows[headerIndex].map(key);
        const columnIndex = (name: string) => headers.findIndex(header => columns[name].includes(header));
        const col = {
            date: columnIndex("date"), voucherNo: columnIndex("voucherNo"),
            journalGroup: columnIndex("journalGroup"), subGroup: columnIndex("subGroup"),
            subGroup2: columnIndex("subGroup2"), subGroup3: columnIndex("subGroup3"),
            voucherType: columnIndex("voucherType"), accountName: columnIndex("accountName"),
            debit: columnIndex("debit"), credit: columnIndex("credit"), narration: columnIndex("narration")
        };

        let currentVoucherNo = "";
        let currentVoucherDate: Date | undefined;
        for (let index = headerIndex + 1; index < sheetRows.length; index++) {
            const cells = sheetRows[index];
            const rowVoucherNo = normalize(cells[col.voucherNo]).replace(/\.0$/, "");
            const parsedRowDate = parseDate(cells[col.date]);
            if (rowVoucherNo) {
                currentVoucherNo = rowVoucherNo;
                currentVoucherDate = parsedRowDate;
            } else if (parsedRowDate && currentVoucherDate &&
                parsedRowDate.toDateString() !== currentVoucherDate.toDateString()) {
                // A changed date marks a new voucher boundary. Do not carry a
                // merged voucher number into the next dated transaction.
                currentVoucherNo = "";
                currentVoucherDate = parsedRowDate;
            }
            const voucherNo = rowVoucherNo || currentVoucherNo;
            const accountName = normalize(cells[col.accountName]);
            if (!voucherNo && !accountName) continue;
            if (!voucherNo && /total|closing balance|opening balance/i.test(cells.map(normalize).join(" "))) continue;

            const voucherType = normalize(cells[col.voucherType]).toLowerCase().replace(/[^a-z]/g, "");
            const debit = parseAmount(cells[col.debit]);
            const credit = parseAmount(cells[col.credit]);
            const groupNames = [col.journalGroup, col.subGroup, col.subGroup2, col.subGroup3]
                .map(cell => normalize(cells[cell])).filter(Boolean);
            const problems: string[] = [];
            if (!voucherNo) problems.push("voucher number is blank");
            if (voucherType !== "payment") problems.push(`expected Payment type; found "${normalize(cells[col.voucherType]) || "blank"}"`);
            if (!accountName) problems.push("Account / Ledger Name is blank");
            if (!groupNames.length) problems.push("Journal Group/Sub Group path is blank");
            if (!Number.isFinite(debit) || !Number.isFinite(credit)) problems.push("debit/credit amount is invalid");
            else if ((debit > 0) === (credit > 0)) problems.push("exactly one of Debit Amount or Credit Amount must be positive");
            if (problems.length) {
                invalid.push(`${index + 1} (${problems.join("; ")})`);
                continue;
            }
            lines.push({
                sourceRow: index + 1,
                voucherNo,
                voucherDate: parsedRowDate || currentVoucherDate,
                groups: groupNames,
                accountName,
                debit,
                credit,
                narration: normalize(cells[col.narration])
            });
        }
    }

    if (invalid.length) throw new ApiError(`Invalid Payment voucher row(s): ${invalid.slice(0, 30).join(", ")}`, 400);
    if (!lines.length) throw new ApiError("No Payment voucher rows found with the expected register columns", 400);

    const vouchers = new Map<string, VoucherData>();
    const undatedByNarration = new Map<string, VoucherData>();
    for (const line of lines) {
        const dateKey = line.voucherDate
            ? `${line.voucherDate.getFullYear()}-${line.voucherDate.getMonth() + 1}-${line.voucherDate.getDate()}`
            : "undated";
        // When a Tally date cell contains a group label or is blank, a repeated
        // voucher number can otherwise be split from its other lines. Narration
        // lets us keep separate, reused voucher numbers together safely.
        const narrationKey = key(line.narration);
        const groupKey = dateKey === "undated"
            ? `${line.voucherNo.toLowerCase()}|undated|${narrationKey}`
            : `${line.voucherNo.toLowerCase()}|${dateKey}`;
        const target = dateKey === "undated" ? undatedByNarration : vouchers;
        const voucher = target.get(groupKey) || {
            voucherNo: line.voucherNo, voucherDate: line.voucherDate, lines: [], debit: 0, credit: 0
        };
        voucher.voucherDate ||= line.voucherDate;
        voucher.lines.push(line);
        voucher.debit = roundMoney(voucher.debit + line.debit);
        voucher.credit = roundMoney(voucher.credit + line.credit);
        target.set(groupKey, voucher);
    }
    // A missing/invalid date can be a merged cell on the continuation rows.
    // Attach those rows to a dated transaction only when the voucher number
    // and non-empty narration identify exactly one candidate.
    for (const [groupKey, undated] of undatedByNarration) {
        const narrationParts = groupKey.split("|undated|");
        const narrationKey = narrationParts[narrationParts.length - 1] || "";
        const candidates = [...vouchers.entries()].filter(([datedKey, dated]) =>
            datedKey.startsWith(`${undated.voucherNo.toLowerCase()}|`) &&
            dated.lines.some(line => key(line.narration) === narrationKey)
        );
        if (narrationKey && candidates.length === 1) {
            const [datedKey, dated] = candidates[0];
            dated.lines.push(...undated.lines);
            dated.debit = roundMoney(dated.debit + undated.debit);
            dated.credit = roundMoney(dated.credit + undated.credit);
            vouchers.set(datedKey, dated);
        } else {
            vouchers.set(groupKey, undated);
        }
    }
    return [...vouchers.values()];
}

const normalizedPath = (values: string[]) => values.map(value => value
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase());
const normalizedPartyName = (value: unknown) => normalize(value)
    .replace(/\s+-\s+sundry\s+(?:creditor|debtor)\s*$/i, "")
    .toLowerCase();
const partyKey = (value: unknown) => key(normalizedPartyName(value));

// Some imported ledgers have a subgroup whose name repeats the ledger name,
// while other party ledgers append their category (" - Sundry Debtor") to the
// ledger name. Both are equivalent to the workbook's canonical path/name.
const canonicalLedgerPath = (values: string[]) => {
    const path = [...values];
    if (path.length > 1 && partyKey(path[path.length - 1]) === partyKey(path[path.length - 2])) {
        path.splice(path.length - 2, 1);
    }
    if (path.length) path[path.length - 1] = normalizedPartyName(path[path.length - 1]);
    return normalizedPath(path);
};

export class PaymentVoucherRepairService {
    static async reconcile(
        actor: any,
        buffer: Buffer,
        entry = false,
        requestedBranchId?: string,
        onVoucher?: (voucher: Record<string, unknown>) => void,
        onProgress?: (progress: { processed: number; total: number; voucherNo: string }) => void,
        repairExisting = false,
        repairAmbiguous = false,
        ledgerMappings: Record<string, string> = {},
        repairPostingIssues = false
    ) {
        if (!actor?.id) throw new ApiError("Unauthorized", 401);
        if (requestedBranchId && actor.branchAccessType !== "ALL" && requestedBranchId !== actor.branchId) {
            throw new ApiError("You do not have access to this branch", 403);
        }
        const branchId = actor.branchAccessType === "ALL" ? requestedBranchId : actor.branchId;
        if (!branchId) throw new ApiError("branchId is required for payment voucher reconciliation", 400);
        if (entry && (repairExisting || repairAmbiguous || repairPostingIssues)) {
            throw new ApiError("Create missing vouchers and repair existing postings in separate runs", 400);
        }
        if (repairAmbiguous && !Object.keys(ledgerMappings).length) {
            throw new ApiError("repairAmbiguous requires ledgerMappings that select a candidate ledger ID for each full path", 400);
        }
        if (!repairAmbiguous && Object.keys(ledgerMappings).length) {
            throw new ApiError("ledgerMappings can only be used with repairAmbiguous=true", 400);
        }

        let vouchers = parseWorkbook(buffer);
        // Payment registers identify a creditor by the account name and its
        // Sundry Creditors path. Resolve that name back to the Agency master
        // so the posting uses the canonical agency-linked VENDOR ledger.
        const agencies = await prisma.agency.findMany({
            select: { id: true, name: true }
        });
        const agenciesByName = new Map<string, typeof agencies>();
        for (const agency of agencies) {
            const name = normalizedPartyName(agency.name);
            agenciesByName.set(name, [...(agenciesByName.get(name) || []), agency]);
        }
        const resolveCreditorAgency = (line: VoucherLine) => {
            const isSundryCreditor = line.groups.some(group =>
                key(group) === "sundrycreditors"
            );
            if (!isSundryCreditor) return undefined;
            const matches = agenciesByName.get(normalizedPartyName(line.accountName)) || [];
            // Never guess when Agency master contains duplicate normalized names.
            return matches.length === 1 ? matches[0] : undefined;
        };
        const allGroups = await prisma.ledgerGroup.findMany({ select: { id: true, name: true, parentId: true } });
        const groupById = new Map(allGroups.map(group => [group.id, group]));
        const actualPath = (ledger: { name: string; groupId: string }) => {
            const result: string[] = [];
            let group = groupById.get(ledger.groupId);
            while (group) {
                result.unshift(group.name);
                group = group.parentId ? groupById.get(group.parentId) : undefined;
            }
            return [...result, ledger.name];
        };
        const agencyIds = agencies.map(agency => agency.id);
        const vendorLedgers = agencyIds.length ? await prisma.ledger.findMany({
            where: {
                branchId,
                category: LedgerType.VENDOR,
                agencyId: { in: agencyIds },
                isActive: true
            },
            select: { id: true, name: true, groupId: true, agencyId: true }
        }) : [];
        const vendorLedgersByAgency = new Map<string, typeof vendorLedgers>();
        for (const ledger of vendorLedgers) {
            if (!ledger.agencyId) continue;
            vendorLedgersByAgency.set(ledger.agencyId, [...(vendorLedgersByAgency.get(ledger.agencyId) || []), ledger]);
        }
        const mappingsByPath = new Map(Object.entries(ledgerMappings).map(([path, ledgerId]) => [
            JSON.stringify(normalizedPath(path.split(" > "))), String(ledgerId).trim()
        ]));

        // Load the workbook's existing vouchers and candidate ledgers once.
        // The old per-voucher/per-line lookups caused thousands of serial DB
        // round trips, making large imports appear to freeze mid-stream.
        const voucherBatchSize = 300;
        const existingByNumber = new Map<string, any[]>();
        const voucherNumbers = [...new Set(vouchers.map(voucher => voucher.voucherNo))];
        for (let index = 0; index < voucherNumbers.length; index += voucherBatchSize) {
            const batch = await prisma.voucher.findMany({
                where: {
                    voucherNo: { in: voucherNumbers.slice(index, index + voucherBatchSize) },
                    voucherType: VoucherType.PAYMENT,
                    branchId
                },
                include: { entries: { include: { ledger: true } }, journals: { select: { id: true } } }
            });
            for (const voucher of batch) {
                existingByNumber.set(voucher.voucherNo, [
                    ...(existingByNumber.get(voucher.voucherNo) || []), voucher
                ]);
            }
        }

        // If a malformed/merged Date cell split one workbook transaction into
        // multiple fragments, merge them only when the combined debit and
        // credit exactly match the single existing voucher for that number.
        // Reused numbers with multiple system vouchers are left separate and
        // resolved later by date and totals.
        const vouchersByNumber = new Map<string, VoucherData[]>();
        for (const voucher of vouchers) {
            vouchersByNumber.set(voucher.voucherNo, [...(vouchersByNumber.get(voucher.voucherNo) || []), voucher]);
        }
        const reconciledVouchers: VoucherData[] = [];
        for (const [voucherNo, fragments] of vouchersByNumber) {
            const existing = existingByNumber.get(voucherNo) || [];
            if (fragments.length > 1 && existing.length === 1) {
                const debit = roundMoney(fragments.reduce((sum, fragment) => sum + fragment.debit, 0));
                const credit = roundMoney(fragments.reduce((sum, fragment) => sum + fragment.credit, 0));
                if (Math.abs(debit - Number(existing[0].totalDebit)) < 0.005 &&
                    Math.abs(credit - Number(existing[0].totalCredit)) < 0.005) {
                    reconciledVouchers.push({
                        voucherNo,
                        voucherDate: fragments.find(fragment => fragment.voucherDate)?.voucherDate || existing[0].voucherDate,
                        lines: fragments.flatMap(fragment => fragment.lines),
                        debit,
                        credit
                    });
                    continue;
                }
            }
            reconciledVouchers.push(...fragments);
        }
        vouchers = reconciledVouchers;

        const ledgerNames = [...new Set(vouchers.flatMap(voucher =>
            voucher.lines.map(line => normalize(line.accountName))
        ))];
        const ledgerLookupNames = [...new Set(ledgerNames.flatMap(name => [
            name,
            `${name} - Sundry Debtor`,
            `${name} - Sundry Creditor`
        ]))];
        const ledgersByName = new Map<string, any[]>();
        for (let index = 0; index < ledgerLookupNames.length; index += voucherBatchSize) {
            const batch = await prisma.ledger.findMany({
                where: {
                    name: { in: ledgerLookupNames.slice(index, index + voucherBatchSize), mode: "insensitive" },
                    isActive: true,
                    OR: [{ branchId }, { branchId: null }]
                },
                select: { id: true, name: true, groupId: true, branchId: true, category: true, agencyId: true }
            });
            for (const ledger of batch) {
                const normalizedName = partyKey(ledger.name);
                ledgersByName.set(normalizedName, [
                    ...(ledgersByName.get(normalizedName) || []), ledger
                ]);
            }
        }

        const results: Array<Record<string, unknown>> = [];
        const addResult = (result: Record<string, unknown>) => {
            results.push(result);
            onVoucher?.(result);
        };
        let created = 0;
        let repaired = 0;
        const createVoucher = async (voucher: VoucherData) => prisma.$transaction(async tx => {
            const postingLines: Array<{
                ledgerId: string; entryType: EntryType; amount: number; branchId: string; narration?: string
            }> = [];
            const postingMetadata: Array<Record<string, unknown>> = [];
            for (const line of voucher.lines) {
                const creditorAgency = resolveCreditorAgency(line);
                if (creditorAgency) {
                    const vendorLedger = await LedgerService.getOrCreateVendorLedger(tx, branchId, creditorAgency.id);
                    postingLines.push({
                        ledgerId: vendorLedger.id,
                        entryType: line.debit > 0 ? EntryType.DEBIT : EntryType.CREDIT,
                        amount: Math.max(line.debit, line.credit),
                        branchId,
                        narration: line.narration || undefined
                    });
                    postingMetadata.push({
                        sourceRow: line.sourceRow, accountName: line.accountName,
                        ledgerId: vendorLedger.id, ledgerName: vendorLedger.name,
                        ledgerCategory: vendorLedger.category, path: [...line.groups, line.accountName],
                        entryType: line.debit > 0 ? EntryType.DEBIT : EntryType.CREDIT,
                        amount: Math.max(line.debit, line.credit)
                    });
                    continue;
                }

                const nature = /LIABIL|CREDIT|INCOME|CAPITAL|DUTI|TAX|CREDITOR/i.test(line.groups[0] || "")
                    ? LedgerNature.CREDIT : LedgerNature.DEBIT;
                let parentId: string | null = null;
                for (const groupName of line.groups) {
                    const group = await LedgerService.getOrCreateImportedJournalGroup(tx, groupName, parentId, nature);
                    parentId = group.id;
                }
                const ledger = await LedgerService.getOrCreateImportedJournalLedger(tx, branchId, line.accountName, parentId!, nature);
                postingLines.push({
                    ledgerId: ledger.id,
                    entryType: line.debit > 0 ? EntryType.DEBIT : EntryType.CREDIT,
                    amount: Math.max(line.debit, line.credit),
                    branchId,
                    narration: line.narration || undefined
                });
                postingMetadata.push({
                    sourceRow: line.sourceRow, accountName: line.accountName,
                    ledgerId: ledger.id, ledgerName: ledger.name, ledgerCategory: ledger.category,
                    path: actualPath({ name: ledger.name, groupId: ledger.groupId }),
                    entryType: line.debit > 0 ? EntryType.DEBIT : EntryType.CREDIT,
                    amount: Math.max(line.debit, line.credit)
                });
            }
            const createdVoucher = await LedgerService.createVoucher({
                voucherNo: voucher.voucherNo,
                voucherType: VoucherType.PAYMENT,
                sourceId: randomUUID(),
                branchId,
                allowVoucherNoReuseOnDifferentDate: true,
                voucherDate: voucher.voucherDate!,
                narration: voucher.lines.map(line => line.narration).filter(Boolean).join(" | ").slice(0, 1000),
                entries: postingLines
            }, tx);
            return { createdVoucher, postingLines, postingMetadata };
        }, { maxWait: 60_000, timeout: 5 * 60_000 });

        const getOrCreateTargetLedger = async (tx: any, line: VoucherLine) => {
            const agency = resolveCreditorAgency(line);
            if (agency) return LedgerService.getOrCreateVendorLedger(tx, branchId, agency.id);
            const nature = /LIABIL|CREDIT|INCOME|CAPITAL|DUTI|TAX|CREDITOR/i.test(line.groups[0] || "")
                ? LedgerNature.CREDIT : LedgerNature.DEBIT;
            let parentId: string | null = null;
            for (const groupName of line.groups) {
                const group = await LedgerService.getOrCreateImportedJournalGroup(tx, groupName, parentId, nature);
                parentId = group.id;
            }
            if (!parentId) throw new Error(`No target subgroup for ${line.accountName}`);
            const ledgersInTargetGroup = await tx.ledger.findMany({
                where: { branchId, groupId: parentId, isActive: true }
            });
            const matchingLedgers = ledgersInTargetGroup.filter((ledger: any) =>
                partyKey(ledger.name) === partyKey(line.accountName)
            );
            if (matchingLedgers.length > 1) throw new Error(`Target ledger is ambiguous for ${line.accountName}`);
            if (matchingLedgers.length === 1) return matchingLedgers[0];
            return LedgerService.getOrCreateImportedJournalLedger(tx, branchId, line.accountName, parentId, nature);
        };

        const sameDay = (left?: Date, right?: Date) => Boolean(left && right &&
            left.toISOString().slice(0, 10) === right.toISOString().slice(0, 10));
        for (const [voucherIndex, voucher] of vouchers.entries()) {
            onProgress?.({
                processed: voucherIndex,
                total: vouchers.length,
                voucherNo: voucher.voucherNo
            });
            const systemVouchers = existingByNumber.get(voucher.voucherNo) || [];
            const matchingTotals = systemVouchers.filter((candidate: any) =>
                Math.abs(Number(candidate.totalDebit) - voucher.debit) < 0.005 &&
                Math.abs(Number(candidate.totalCredit) - voucher.credit) < 0.005
            );
            const matchingDateAndTotals = voucher.voucherDate
                ? matchingTotals.filter((candidate: any) => sameDay(candidate.voucherDate, voucher.voucherDate))
                : [];
            const sameDateCandidates = voucher.voucherDate
                ? systemVouchers.filter((candidate: any) => sameDay(candidate.voucherDate, voucher.voucherDate))
                : [];
            const overlapScore = (candidate: any) => voucher.lines.reduce((score, line) => {
                const agency = resolveCreditorAgency(line);
                const side = line.debit > 0 ? EntryType.DEBIT : EntryType.CREDIT;
                const value = Math.max(line.debit, line.credit);
                const matches = (candidate.entries || []).filter((item: any) =>
                    item.entryType === side && (partyKey(item.ledger?.name) === partyKey(line.accountName) ||
                        Boolean(agency && item.ledger?.agencyId === agency.id)));
                if (!matches.length) return score;
                const exactValue = matches.some((item: any) => Math.abs(Number(item.amount) - value) < 0.005);
                return score + (exactValue ? 4 : 1);
            }, 0);
            const scoredCandidates = systemVouchers.map((candidate: any) => ({ candidate, score: overlapScore(candidate) }))
                // One exact ledger/amount/side match is the minimum acceptable
                // overlap. A shared bank ledger name alone is too common to
                // disambiguate reused voucher numbers safely.
                .filter((item: any) => item.score >= 4)
                .sort((a: any, b: any) => b.score - a.score);
            const bestOverlap = scoredCandidates.length &&
                (scoredCandidates.length === 1 || scoredCandidates[0].score > scoredCandidates[1].score)
                ? scoredCandidates[0] : undefined;
            const systemVoucher = matchingDateAndTotals.length === 1 ? matchingDateAndTotals[0]
                : matchingTotals.length === 1 ? matchingTotals[0]
                    : sameDateCandidates.length === 1 ? sameDateCandidates[0]
                        : bestOverlap ? bestOverlap.candidate
                            : undefined;
            const reusedNumberMissing = Boolean(voucher.voucherDate && systemVouchers.length > 0 &&
                !systemVoucher && sameDateCandidates.length === 0 && matchingTotals.length === 0 && !bestOverlap);
            if (systemVouchers.length > 0 && !systemVoucher && !reusedNumberMissing) {
                addResult({ voucherNo: voucher.voucherNo, voucherDate: voucher.voucherDate, status: "ambiguous", reason: "More than one PAYMENT voucher has this number and date/totals do not identify one safely" });
                continue;
            }
            if (!systemVoucher) {
                const balanced = Math.abs(voucher.debit - voucher.credit) < 0.005;
                const dateAvailable = Boolean(voucher.voucherDate);
                const status = balanced && dateAvailable ? "missing" : "invalidMissingVoucher";
                const result: Record<string, unknown> = {
                    voucherNo: voucher.voucherNo, status, voucherDate: voucher.voucherDate,
                    reusedVoucherNumber: reusedNumberMissing,
                    debit: voucher.debit, credit: voucher.credit, balanced, dateAvailable,
                    rows: voucher.lines.map(line => {
                        const agency = resolveCreditorAgency(line);
                        return {
                            sourceRow: line.sourceRow,
                            accountName: line.accountName,
                            path: [...line.groups, line.accountName],
                            debit: line.debit,
                            credit: line.credit,
                            ...(agency ? {
                                resolvedAgencyId: agency.id,
                                resolvedAgencyName: agency.name,
                                postingLedgerCategory: "VENDOR"
                            } : {})
                        };
                    })
                };
                if (entry && status === "missing") {
                    try {
                        const { createdVoucher, postingLines, postingMetadata } = await createVoucher(voucher);
                        created++;
                        Object.assign(result, {
                            status: "created",
                            voucherId: createdVoucher.id,
                            voucherType: createdVoucher.voucherType,
                            branchId: createdVoucher.branchId,
                            createdAt: createdVoucher.createdAt,
                            entryCount: postingLines.length,
                            rows: postingMetadata
                        });
                        existingByNumber.set(voucher.voucherNo, [...(existingByNumber.get(voucher.voucherNo) || []), createdVoucher]);
                    } catch (error) {
                        Object.assign(result, {
                            status: "creationFailed",
                            reason: error instanceof Error ? error.message : "Voucher creation failed"
                        });
                    }
                }
                addResult(result);
                continue;
            }

            const checks: Array<Record<string, unknown>> = [];
            const repairPlans: Array<{
                action: "remap" | "amount" | "add";
                entryId?: string;
                oldLedgerId?: string;
                oldAmount?: number;
                targetLedgerId?: string;
                line: VoucherLine;
            }> = [];
            const consumedEntryIds = new Set<string>();
            for (const line of voucher.lines) {
                const indexedLedgers = ledgersByName.get(partyKey(line.accountName)) || [];
                const voucherLedgers = systemVoucher.entries
                    .map((item: any) => item.ledger)
                    .filter((ledger: any) => ledger && partyKey(ledger.name) === partyKey(line.accountName));
                const ledgers = [...new Map([...indexedLedgers, ...voucherLedgers].map((ledger: any) => [ledger.id, ledger])).values()];
                const expectedPath = normalizedPath([...line.groups, line.accountName]);
                const expectedGroupPath = normalizedPath(line.groups);
                const exactPathMatches = ledgers.filter(ledger =>
                    JSON.stringify(normalizedPath(actualPath(ledger))) === JSON.stringify(expectedPath));
                const exactGroupMatches = ledgers.filter(ledger => {
                    const path = actualPath(ledger);
                    return partyKey(ledger.name) === partyKey(line.accountName) &&
                        JSON.stringify(normalizedPath(path.slice(0, -1))) === JSON.stringify(expectedGroupPath);
                });
                // Prefer an exact workbook path, then the exact workbook group
                // path with a normalized party-ledger suffix. Only fall back
                // to the legacy repeated-leaf path when neither exists; mixing
                // canonical aliases with exact matches falsely marks thousands
                // of correctly posted bank rows as ambiguous.
                const pathMatches = exactPathMatches.length
                    ? exactPathMatches
                    : exactGroupMatches.length
                        ? exactGroupMatches
                        : ledgers.filter(ledger =>
                            JSON.stringify(canonicalLedgerPath(actualPath(ledger))) ===
                            JSON.stringify(canonicalLedgerPath([...line.groups, line.accountName])));
                const scopedPathMatches = pathMatches.filter(ledger => ledger.branchId === branchId);
                const usablePathMatches = scopedPathMatches.length ? scopedPathMatches : pathMatches.filter(ledger => ledger.branchId === null);
                const agency = resolveCreditorAgency(line);
                const agencyMatches = agency ? vendorLedgersByAgency.get(agency.id) || [] : [];
                const expectedCandidates = agency ? agencyMatches : usablePathMatches;
                const expectedPathKey = JSON.stringify(normalizedPath([...line.groups, line.accountName]));
                const selectedLedgerId = mappingsByPath.get(expectedPathKey);
                const selectedCandidate = selectedLedgerId
                    ? expectedCandidates.find((ledger: any) => ledger.id === selectedLedgerId)
                    : undefined;
                const expectedLedger = expectedCandidates.length === 1
                    ? expectedCandidates[0]
                    : expectedCandidates.length > 1 ? selectedCandidate : undefined;
                const candidateLedgerDetails = expectedCandidates.map((ledger: any) => ({
                    ledgerId: ledger.id,
                    ledgerName: ledger.name,
                    branchId: ledger.branchId,
                    path: actualPath(ledger)
                }));
                const side = line.debit > 0 ? EntryType.DEBIT : EntryType.CREDIT;
                const value = Math.max(line.debit, line.credit);
                const availableEntries = systemVoucher.entries.filter((item: any) => !consumedEntryIds.has(item.id));
                const correctEntry = expectedLedger && availableEntries.find((item: any) =>
                    item.ledgerId === expectedLedger.id && item.entryType === side && Math.abs(Number(item.amount) - value) < 0.005);
                if (correctEntry) {
                    consumedEntryIds.add(correctEntry.id);
                    checks.push({
                        sourceRow: line.sourceRow, accountName: line.accountName,
                        expectedPath: [...line.groups, line.accountName], actualPath: actualPath(expectedLedger),
                        status: "correctSubGroup", debit: line.debit, credit: line.credit
                    });
                    continue;
                }
                const sourceIdentityEntries = availableEntries.filter((item: any) => {
                    const sameLedgerName = partyKey(item.ledger?.name) === partyKey(line.accountName);
                    const sameAgency = Boolean(agency && item.ledger?.agencyId === agency.id);
                    return sameLedgerName || sameAgency;
                });
                const sourceEntries = sourceIdentityEntries.filter((item: any) =>
                    item.entryType === side && Math.abs(Number(item.amount) - value) < 0.005);
                let status: string;
                if (expectedCandidates.length > 1 && !expectedLedger) status = "ledgerPathAmbiguous";
                else if (sourceEntries.length === 1) {
                    const sourceEntry = sourceEntries[0];
                    consumedEntryIds.add(sourceEntry.id);
                    repairPlans.push({
                        action: "remap", entryId: sourceEntry.id, oldLedgerId: sourceEntry.ledgerId,
                        oldAmount: Number(sourceEntry.amount), targetLedgerId: expectedLedger?.id, line
                    });
                    status = expectedLedger ? "wrongSubGroup" : "ledgerPathNotFound";
                } else if (sourceEntries.length > 1) status = "postingAmbiguous";
                else if (sourceIdentityEntries.length === 1 && sourceIdentityEntries[0].entryType === side) {
                    status = "amountMismatch";
                    if (repairPostingIssues) {
                        const sourceEntry = sourceIdentityEntries[0];
                        consumedEntryIds.add(sourceEntry.id);
                        repairPlans.push({
                            action: "amount", entryId: sourceEntry.id, oldLedgerId: sourceEntry.ledgerId,
                            oldAmount: Number(sourceEntry.amount), targetLedgerId: expectedLedger?.id, line
                        });
                    }
                } else if (sourceIdentityEntries.length === 0) {
                    status = expectedLedger ? "postingMissing" : "ledgerPathNotFound";
                    if (repairPostingIssues) repairPlans.push({ action: "add", targetLedgerId: expectedLedger?.id, line });
                } else if (sourceIdentityEntries.length === 1) status = "postingAmbiguous";
                else status = expectedLedger ? "postingMissing" : "ledgerPathNotFound";
                const lineRepair = repairPlans.find(plan => plan.line.sourceRow === line.sourceRow);
                checks.push({
                    sourceRow: line.sourceRow, accountName: line.accountName,
                    expectedPath: [...line.groups, line.accountName],
                    actualPath: sourceEntries.length === 1 ? actualPath(sourceEntries[0].ledger) : undefined,
                    targetLedgerId: expectedLedger?.id,
                    ...(expectedCandidates.length > 1 ? { candidateLedgers: candidateLedgerDetails } : {}),
                    ...(selectedLedgerId && !selectedCandidate ? { mappingError: "Selected ledgerId is not an eligible candidate for this workbook path" } : {}),
                    status, repairable: Boolean(lineRepair), repairAction: lineRepair?.action,
                    actualAmount: sourceIdentityEntries.length === 1 ? Number(sourceIdentityEntries[0].amount) : undefined,
                    debit: line.debit, credit: line.credit
                });
            }
            const extraEntries = systemVoucher.entries.filter((item: any) => !consumedEntryIds.has(item.id));
            const totalsMatch = Math.abs(Number(systemVoucher.totalDebit) - voucher.debit) < 0.005 &&
                Math.abs(Number(systemVoucher.totalCredit) - voucher.credit) < 0.005;
            const plannedAdds = repairPlans.filter(plan => plan.action === "add").length;
            let projectedDebit = systemVoucher.entries.reduce((sum: number, item: any) =>
                sum + (item.entryType === EntryType.DEBIT ? Number(item.amount) : 0), 0);
            let projectedCredit = systemVoucher.entries.reduce((sum: number, item: any) =>
                sum + (item.entryType === EntryType.CREDIT ? Number(item.amount) : 0), 0);
            for (const plan of repairPlans) {
                const value = Math.max(plan.line.debit, plan.line.credit);
                if (plan.action === "add") {
                    if (plan.line.debit > 0) projectedDebit += value;
                    else projectedCredit += value;
                } else if (plan.action === "amount") {
                    const delta = value - Number(plan.oldAmount || 0);
                    if (plan.line.debit > 0) projectedDebit += delta;
                    else projectedCredit += delta;
                }
            }
            projectedDebit = roundMoney(projectedDebit);
            projectedCredit = roundMoney(projectedCredit);
            const allRowsCovered = repairPlans.length === checks.filter(check => check.status !== "correctSubGroup").length;
            const hasNoLinkedJournals = systemVoucher.journals.length === 0;
            const ledgerOnlySafe = totalsMatch && systemVoucher.entries.length === voucher.lines.length &&
                extraEntries.length === 0 && allRowsCovered && hasNoLinkedJournals &&
                repairPlans.every(plan => plan.action === "remap");
            const postingRepairSafe = Math.abs(voucher.debit - voucher.credit) < 0.005 &&
                Math.abs(projectedDebit - voucher.debit) < 0.005 &&
                Math.abs(projectedCredit - voucher.credit) < 0.005 &&
                systemVoucher.entries.length + plannedAdds === voucher.lines.length &&
                extraEntries.length === 0 && allRowsCovered && hasNoLinkedJournals;
            const repairSafe = repairPostingIssues ? postingRepairSafe : ledgerOnlySafe;
            let repairedThisVoucher = 0;
            if (repairExisting && repairPlans.length && repairSafe) {
                try {
                    await prisma.$transaction(async tx => {
                        const linkedJournals = await tx.journal.count({ where: { voucherId: systemVoucher.id } });
                        if (linkedJournals) throw new Error("Voucher has linked Journal rows; manual review is required before remapping");
                        const currentVoucher = await tx.voucher.findUnique({ where: { id: systemVoucher.id } });
                        if (!currentVoucher ||
                            Math.abs(Number(currentVoucher.totalDebit) - Number(systemVoucher.totalDebit)) >= 0.005 ||
                            Math.abs(Number(currentVoucher.totalCredit) - Number(systemVoucher.totalCredit)) >= 0.005) {
                            throw new Error(`Voucher ${voucher.voucherNo} changed after preview; no entries were changed`);
                        }
                        const currentEntries = await tx.ledgerEntry.findMany({
                            where: { voucherId: systemVoucher.id },
                            select: { id: true, ledgerId: true, entryType: true, amount: true }
                        });
                        const initialEntriesById = new Map(systemVoucher.entries.map((item: any) => [item.id, item]));
                        if (currentEntries.length !== systemVoucher.entries.length || currentEntries.some((item: any) => {
                            const initial = initialEntriesById.get(item.id) as any;
                            return !initial || initial.ledgerId !== item.ledgerId || initial.entryType !== item.entryType ||
                                Math.abs(Number(initial.amount) - Number(item.amount)) >= 0.005;
                        })) {
                            throw new Error(`Voucher ${voucher.voucherNo} entries changed after preview; no entries were changed`);
                        }
                        const affectedLedgerIds = new Set<string>();
                        let appliedRows = 0;
                        for (const plan of repairPlans) {
                            const targetLedger = plan.targetLedgerId
                                ? await tx.ledger.findUnique({ where: { id: plan.targetLedgerId } })
                                : await getOrCreateTargetLedger(tx, plan.line);
                            if (!targetLedger) throw new Error(`Target ledger not found for ${plan.line.accountName}`);
                            const amount = Math.max(plan.line.debit, plan.line.credit);
                            const entryType = plan.line.debit > 0 ? EntryType.DEBIT : EntryType.CREDIT;
                            if (plan.action === "add") {
                                await tx.ledgerEntry.create({
                                    data: {
                                        voucherId: systemVoucher.id,
                                        ledgerId: targetLedger.id,
                                        branchId,
                                        entryType,
                                        amount,
                                        narration: plan.line.narration || undefined
                                    }
                                });
                                affectedLedgerIds.add(targetLedger.id);
                                appliedRows += 1;
                                continue;
                            }
                            const currentEntry = await tx.ledgerEntry.findUnique({ where: { id: plan.entryId! } });
                            if (!currentEntry || currentEntry.voucherId !== systemVoucher.id ||
                                currentEntry.ledgerId !== plan.oldLedgerId || currentEntry.entryType !== entryType ||
                                Math.abs(Number(currentEntry.amount) - Number(plan.oldAmount)) >= 0.005) {
                                throw new Error(`Voucher ${voucher.voucherNo} changed after preview; no entries were changed`);
                            }
                            if (currentEntry.ledgerId !== targetLedger.id ||
                                (plan.action === "amount" && Math.abs(Number(currentEntry.amount) - amount) >= 0.005)) {
                                await tx.ledgerEntry.update({
                                    where: { id: currentEntry.id },
                                    data: {
                                        ledgerId: targetLedger.id,
                                        ...(plan.action === "amount" ? { amount } : {})
                                    }
                                });
                                appliedRows += 1;
                            }
                            affectedLedgerIds.add(currentEntry.ledgerId);
                            affectedLedgerIds.add(targetLedger.id);
                        }
                        if (repairPostingIssues &&
                            (Math.abs(Number(currentVoucher.totalDebit) - voucher.debit) >= 0.005 ||
                                Math.abs(Number(currentVoucher.totalCredit) - voucher.credit) >= 0.005)) {
                            await tx.voucher.update({
                                where: { id: systemVoucher.id },
                                data: { totalDebit: voucher.debit, totalCredit: voucher.credit }
                            });
                        }
                        for (const ledgerId of affectedLedgerIds) await LedgerService.syncCachedBalance(tx, ledgerId);
                        repairedThisVoucher = appliedRows;
                    }, { maxWait: 60_000, timeout: 5 * 60_000, isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
                    repaired += repairedThisVoucher;
                    for (const check of checks) if (check.status !== "correctSubGroup") check.status = "repaired";
                } catch (error) {
                    checks.push({ status: "repairFailed", reason: error instanceof Error ? error.message : "Safe ledger remap failed" });
                }
            }
            const issues = checks.filter(check => check.status !== "correctSubGroup" && check.status !== "repaired").length;
            const reconciliationStatus = issues
                ? "existsWithSubGroupIssues"
                : !(repairPostingIssues && repairedThisVoucher > 0) && !totalsMatch
                    ? "existsWithAmountIssues"
                    : repairedThisVoucher
                        ? "repaired"
                        : "existsCorrectly";
            const repairReason = repairedThisVoucher
                ? repairPostingIssues
                    ? "Workbook rows were reconciled to the selected ledgers; missing rows or mismatched amounts were corrected and voucher totals were balanced"
                    : "Wrong-subgroup ledger entries were reassigned; voucher debit/credit totals and counterpart entries were preserved"
                : repairPlans.length && repairSafe && !repairExisting
                    ? "Repair checks passed in preview; no entries were changed. Set repairExisting=true to apply."
                : repairExisting && repairPlans.length && !repairSafe
                    ? repairPostingIssues
                        ? "Not repaired: rows could not be matched one-to-one, final Excel totals would not balance, or the voucher has extra entries or linked Journals"
                        : "Not repaired: voucher totals, entry count, unmatched entries, or linked Journal rows failed the safety checks"
                    : "Voucher already exists; existing ledger entries were not changed";
            addResult({
                voucherNo: voucher.voucherNo,
                voucherId: systemVoucher.id,
                // Existing vouchers are modified only when an explicit repair mode
                // was requested and every matching and balance guard passed.
                status: repairedThisVoucher ? "repaired" : "skipped",
                reconciliationStatus,
                reason: repairReason,
                voucherDate: voucher.voucherDate,
                debit: voucher.debit,
                credit: voucher.credit,
                balanced: Math.abs(voucher.debit - voucher.credit) < 0.005,
                repairableLines: repairPlans.length,
                repairReady: !repairedThisVoucher && repairPlans.length > 0 && repairSafe,
                repairedLines: repairedThisVoucher,
                totalsMatch: totalsMatch || (repairPostingIssues && repairedThisVoucher > 0),
                entryCountMatch: systemVoucher.entries.length + (repairedThisVoucher > 0 ? plannedAdds : 0) === voucher.lines.length,
                unmatchedSystemEntries: extraEntries.length,
                rows: checks
            });
        }

        return {
            branchId,
            entry,
            repairExisting,
            repairAmbiguous,
            repairPostingIssues,
            voucherType: VoucherType.PAYMENT,
            workbookVouchers: vouchers.length,
            created,
            repaired,
            summary: {
                missing: results.filter(result => result.status === "missing").length,
                skipped: results.filter(result => result.status === "skipped").length,
                existsCorrectly: results.filter(result => result.reconciliationStatus === "existsCorrectly").length,
                existsWithSubGroupIssues: results.filter(result => result.reconciliationStatus === "existsWithSubGroupIssues").length,
                existsWithAmountIssues: results.filter(result => result.reconciliationStatus === "existsWithAmountIssues").length,
                voucherTotalsMismatch: results.filter(result => result.totalsMatch === false).length,
                invalid: results.filter(result => result.status === "invalidMissingVoucher").length,
                ambiguous: results.filter(result => result.status === "ambiguous").length,
                repaired: results.filter(result => result.status === "repaired").length,
                repairReadyVouchers: results.filter(result => result.repairReady === true).length,
                repairReadyLines: results.reduce((sum, result) => sum + (result.repairReady ? Number(result.repairableLines || 0) : 0), 0),
                creationFailed: results.filter(result => result.status === "creationFailed").length
            },
            vouchers: results
        };
    }
}

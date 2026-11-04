import ExcelJS from "exceljs";
import { Response } from "express";
import { prisma } from "../../config/db";
import profitAndLossWorkbook from "./PLAC/PandL_full.json";
import balanceSheetSource from "./BLSHEET/BSheet-pure.json";
import { ReportingService } from "./reporting.service";

type StatementKind = "PROFIT_AND_LOSS" | "BALANCE_SHEET";
type PureStatementItem = { name: string; amount: number; isDetail?: boolean; children?: PureStatementItem[]; items?: PureStatementItem[] };
type FullStatementCell = { column: string; value: unknown };
type FullStatementRow = { rowNumber: number; cells: FullStatementCell[] };
type FullStatementWorkbook = { sheets: Array<{ rows: FullStatementRow[] }> };
type PureBalanceSheet = {
    report: string;
    company: string;
    period: { from: string; to: string };
    liabilities: PureStatementItem[];
    assets: PureStatementItem[];
    totals: { liabilities: number; assets: number };
};
export type FinancialStatementReport = {
    statementType: StatementKind;
    reportName: string;
    company: string;
    period: string;
    companyDetails: {
        address: string[];
        identifier: string;
        email: string;
    };
    rows: unknown[][];
};
type TrialBalanceNode = {
    name?: string;
    account?: string;
    closingDebit?: number;
    closingCredit?: number;
    closingSigned?: number;
    children?: TrialBalanceNode[];
};
type LiveStatementQuery = {
    branchId?: string;
    startDate?: string;
    endDate?: string;
    includeZero?: boolean;
};
type StatementItem = { name: string; amount: number };

const text = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const rupee = String.fromCharCode(0x20b9);
const amountFormat = `${rupee}#,##,##0.00;[Red](${rupee}#,##,##0.00);-`;

const companyAddress = [
    "SURVEY NO - 222, VILLAGE - HEDAVALI, Tl- SUDHAGAD",
    "KHOPOLI - PALI ROAD, KHOPOLI, DIST - RAIGAD"
];
const companyIdentifier = "CIN: U11100MH2011PTC224243";
const companyEmail = "E-Mail : info@ashtvinayakapetrochem.com";

const displayDate = (isoDate: string) => {
    const date = new Date(`${isoDate}T00:00:00`);
    return `${date.getDate()}-${date.toLocaleString("en", { month: "short" })}-${String(date.getFullYear()).slice(-2)}`;
};

const periodLabel = (period: { from: string; to: string }) =>
    `${displayDate(period.from)} to ${displayDate(period.to)}`;

const reportHeaderRows = (company: string, reportName: string, period: string) => [
    [company, null, null, null, null, null],
    [companyAddress[0], null, null, null, null, null],
    [companyAddress[1], null, null, null, null, null],
    [companyIdentifier, null, null, null, null, null],
    [companyEmail, null, null, null, null, null],
    [reportName, null, null, null, null, null],
    [period, null, null, null, null, null]
];

const flattenSections = (sections: PureStatementItem[]) => sections.flatMap(section => {
    const rows: unknown[][] = [section.isDetail
        ? [section.name, section.amount, null]
        : [section.name, null, section.amount]];
    const children = section.children ?? section.items ?? [];
    const appendChildren = (items: PureStatementItem[]) => {
        for (const child of items) {
            const descendants = child.children ?? child.items ?? [];
            if (descendants.length) {
                rows.push([child.name, null, child.amount]);
                appendChildren(descendants);
            } else {
                rows.push([child.name, child.amount, null]);
            }
        }
    };
    appendChildren(children);
    return rows;
});

const pairStatementSides = (leftRows: unknown[][], rightRows: unknown[][]) => {
    const count = Math.max(leftRows.length, rightRows.length);
    return Array.from({ length: count }, (_, index) => {
        const left = leftRows[index] ?? [];
        const right = rightRows[index] ?? [];
        return [left[0] ?? null, left[1] ?? null, left[2] ?? null, right[0] ?? null, right[1] ?? null, right[2] ?? null];
    });
};

const money = (value: number) => Math.round((Number(value) || 0) * 100) / 100;

const headingKey = (name: string) =>
    String(name || "").normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9]/g, "");

const headingsMatch = (name: string, candidates: string[]) => {
    const key = headingKey(name);
    return candidates.some(candidate => {
        const other = headingKey(candidate);
        return key === other || key === `${other}s` || other === `${key}s`;
    });
};
/** Name of a trial balance node */
const nodeName = (node: TrialBalanceNode) => text(node.name || node.account);

const findTrialHead = (tree: TrialBalanceNode[], candidates: string[]) =>
    tree.find(node => headingsMatch(nodeName(node), candidates));

const signedDebit = (node?: TrialBalanceNode) => {
    if (!node) return 0;
    if (typeof node.closingSigned === "number") return money(node.closingSigned);
    return money(Number(node.closingDebit || 0) - Number(node.closingCredit || 0));
};

const expenseAmount = (node?: TrialBalanceNode) => signedDebit(node);
const incomeAmount = (node?: TrialBalanceNode) => money(-signedDebit(node));
/** Balance Sheet liability side: net closing credit. */
const liabilityAmount = (node?: TrialBalanceNode) => incomeAmount(node);
/** Balance Sheet asset side: net closing debit. */
const assetAmount = (node?: TrialBalanceNode) => expenseAmount(node);

const firstLevelItems = (
    node: TrialBalanceNode | undefined,
    amountOf: (child: TrialBalanceNode) => number
): StatementItem[] => {
    if (!node?.children?.length) return [];
    const parent = headingKey(nodeName(node));
    return node.children
        .filter(child => headingKey(nodeName(child)) !== parent)
        .map(child => ({ name: nodeName(child), amount: amountOf(child) }))
        .filter(item => item.name);
};

const sectionRows = (name: string, amount: number | null, items: StatementItem[]) => {
    const rows: unknown[][] = [[name, null, amount]];
    for (const item of items) {
        rows.push([item.name, item.amount === 0 ? null : item.amount, null]);
    }
    return rows;
};

const sumItems = (items: StatementItem[]) =>
    money(items.reduce((sum, item) => sum + Number(item.amount || 0), 0));

const currentAssetsBalanceSheetItems = (
    node: TrialBalanceNode | undefined,
    closingStock: number
): StatementItem[] => {
    const items = firstLevelItems(node, assetAmount);
    const hasCashInHand = items.some(item => headingKey(item.name) === headingKey("Cash-in-hand"));
    const withoutDuplicateCash = hasCashInHand
        ? items.filter(item => headingKey(item.name) !== headingKey("Cash"))
        : items;

    const replaced: StatementItem[] = [];
    let openingReplaced = false;
    for (const item of withoutDuplicateCash) {
        if (headingKey(item.name) === headingKey("Opening Stock")) {
            replaced.push({ name: "Closing Stock", amount: closingStock });
            openingReplaced = true;
        } else {
            replaced.push(item);
        }
    }
    if (!openingReplaced && closingStock) {
        replaced.unshift({ name: "Closing Stock", amount: closingStock });
    }
    return replaced;
};

const computeNettProfit = (
    tree: TrialBalanceNode[],
    openingStock: number,
    closingStock: number
) => {
    const purchaseAccounts = expenseAmount(findTrialHead(tree, ["Purchase Accounts"]));
    const directExpenses = expenseAmount(findTrialHead(tree, ["Direct Expenses", "Direct Expense"]));
    const indirectExpenses = expenseAmount(findTrialHead(tree, ["Indirect Expenses", "Indirect Expense"]));
    const salesAccounts = incomeAmount(findTrialHead(tree, ["Sales Accounts"]));
    const indirectIncomes = incomeAmount(findTrialHead(tree, ["Indirect Incomes", "Indirect Income"]));
    const grossProfit = money(
        (salesAccounts + closingStock) - (openingStock + purchaseAccounts + directExpenses)
    );
    return money(grossProfit + indirectIncomes - indirectExpenses);
};

/** Trading / P&L roots — never placed on the Balance Sheet. */
const isProfitAndLossTradingHead = (name: string) =>
    headingsMatch(name, [
        "Purchase Accounts",
        "Sales Accounts",
        "Direct Expenses",
        "Direct Expense",
        "Direct Incomes",
        "Direct Income",
        "Indirect Expenses",
        "Indirect Expense",
        "Indirect Incomes",
        "Indirect Income",
        "Expenses",
        "Income"
    ]);

/** Handled separately from net Dr/Cr classification. */
const isProfitAndLossAccountHead = (name: string) =>
    headingsMatch(name, ["Profit & Loss A/c", "Profit & Loss"]);

const isSuspenseHead = (name: string) =>
    headingsMatch(name, ["Suspense A/c", "Suspense Account", "Suspense"]);

const isCurrentAssetsHead = (name: string) =>
    headingsMatch(name, ["Current Assets"]);

/** Preferred Excel-like order; unknown heads keep TB alphabetical order after these. */
const LIABILITY_HEAD_ORDER = [
    "Capital Account",
    "Loans (Liability)",
    "Current Liabilities",
    "Branch / Divisions"
];
const ASSET_HEAD_ORDER = [
    "Fixed Assets",
    "Investments",
    "Current Assets"
];

const sortBalanceSheetHeads = (heads: TrialBalanceNode[], preferred: string[]) => {
    const rank = (name: string) => {
        const index = preferred.findIndex(candidate => headingsMatch(name, [candidate]));
        return index >= 0 ? index : preferred.length;
    };
    return [...heads].sort((a, b) => {
        const left = rank(nodeName(a));
        const right = rank(nodeName(b));
        if (left !== right) return left - right;
        return nodeName(a).localeCompare(nodeName(b));
    });
};

const classifyBalanceSheetHeads = (tree: TrialBalanceNode[]) => {
    const liabilityHeads: TrialBalanceNode[] = [];
    const assetHeads: TrialBalanceNode[] = [];
    let profitAndLossHead: TrialBalanceNode | undefined;
    let suspenseHead: TrialBalanceNode | undefined;

    for (const head of tree) {
        const name = nodeName(head);
        if (!name || isProfitAndLossTradingHead(name)) continue;
        if (isProfitAndLossAccountHead(name)) {
            profitAndLossHead = head;
            continue;
        }
        if (isSuspenseHead(name)) {
            suspenseHead = head;
            continue;
        }

        const closing = signedDebit(head);
        // closingSigned = closingDebit - closingCredit
        // net Cr (closing < 0) → Liabilities (left)
        // net Dr (closing > 0) → Assets (right)
        if (closing < 0) liabilityHeads.push(head);
        else if (closing > 0) assetHeads.push(head);
    }

    return {
        liabilityHeads: sortBalanceSheetHeads(liabilityHeads, LIABILITY_HEAD_ORDER),
        assetHeads: sortBalanceSheetHeads(assetHeads, ASSET_HEAD_ORDER),
        profitAndLossHead,
        suspenseHead
    };
};

const balanceSheetSectionFromHead = (
    head: TrialBalanceNode,
    closingStock: number
): unknown[][] => {
    const name = nodeName(head);
    if (isCurrentAssetsHead(name)) {
        const items = currentAssetsBalanceSheetItems(head, closingStock);
        return sectionRows(name, sumItems(items) || null, items);
    }

    const amountOf = signedDebit(head) < 0 ? liabilityAmount : assetAmount;
    const items = firstLevelItems(head, amountOf);
    const total = amountOf(head);
    return sectionRows(name, total || null, items);
};

const isoKolkata = (value: Date | string) =>
    new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
    }).format(new Date(value));

const loadOpeningStockItems = async (): Promise<StatementItem[]> => {
    const products = await prisma.product.findMany({
        where: {
            OR: [
                { openingStockKG: { gt: 0 } },
                { openingStockKG: { lt: 0 } }
            ]
        },
        select: {
            name: true,
            openingStockKG: true,
            sellPricePerUnit: true
        },
        orderBy: { name: "asc" }
    });

    const byName = new Map<string, number>();
    for (const product of products) {
        const name = text(product.name);
        if (!name) continue;
        const amount = money(Number(product.openingStockKG) * Number(product.sellPricePerUnit || 0));
        byName.set(name, money((byName.get(name) || 0) + amount));
    }
    return [...byName.entries()].map(([name, amount]) => ({ name, amount }));
};

const loadClosingStockItems = async (): Promise<StatementItem[]> => {
    const products = await prisma.product.findMany({
        where: {
            OR: [
                { tempClosingBalance: { gt: 0 } },
                { tempClosingBalance: { lt: 0 } }
            ]
        },
        select: {
            name: true,
            tempClosingBalance: true
        },
        orderBy: { name: "asc" }
    });

    const byName = new Map<string, number>();
    for (const product of products) {
        const name = text(product.name);
        if (!name) continue;
        const amount = money(Number(product.tempClosingBalance || 0));
        byName.set(name, money((byName.get(name) || 0) + amount));
    }
    return [...byName.entries()].map(([name, amount]) => ({ name, amount }));
};

const balanceSheetRows = (source: PureBalanceSheet) => {
    const liabilities = flattenSections(source.liabilities);
    const assets = flattenSections(source.assets);
    const rows: unknown[][] = reportHeaderRows(source.company, source.report, periodLabel(source.period));
    rows.push(["", "", null, "", "", null]);
    rows.push(["Liabilities", `as at ${displayDate(source.period.to)}`, null, "Assets", `as at ${displayDate(source.period.to)}`, null]);
    rows.push(...pairStatementSides(liabilities, assets));
    rows.push(["Total", null, source.totals.liabilities, "Total", null, source.totals.assets]);
    return rows;
};

const fullStatementRows = (source: FullStatementWorkbook) => {
    const worksheet = source.sheets?.[0];
    if (!worksheet?.rows?.length) throw new Error("The full P&L workbook JSON does not contain worksheet rows");

    const columnIndexes: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };
    const rows: unknown[][] = Array.from(
        { length: Math.max(...worksheet.rows.map(row => row.rowNumber)) },
        () => Array(6).fill(null)
    );

    for (const sourceRow of worksheet.rows) {
        const row = rows[sourceRow.rowNumber - 1];
        for (const cell of sourceRow.cells) {
            const columnIndex = columnIndexes[cell.column];
            if (columnIndex !== undefined) row[columnIndex] = cell.value === "" ? null : cell.value ?? null;
        }
    }

    return rows;
};

const reorderProfitAndLossSectionsForExport = (rows: unknown[][]) => {
    const sectionIndex = (name: string) => rows.findIndex(row =>
        text(row[3]).toLocaleLowerCase() === name.toLocaleLowerCase()
    );
    const salesStart = sectionIndex("Sales Accounts");
    const stockStart = sectionIndex("Closing Stock");
    if (salesStart < 0 || stockStart <= salesStart) return;

    const nextSection = (start: number) => {
        for (let index = start + 1; index < rows.length; index++) {
            if (text(rows[index][3]) && rows[index][5] != null) return index;
        }
        return rows.length;
    };

    const salesEnd = nextSection(salesStart);
    const stockEnd = nextSection(stockStart);
    if (salesEnd !== stockStart || stockEnd <= stockStart) return;

    // Reorder only the right-hand account groups; the left-hand cost sections
    // stay on their original rows and the response JSON remains unchanged.
    const reorderedRightSide = [
        ...rows.slice(stockStart, stockEnd).map(row => row.slice(3, 6)),
        ...rows.slice(salesStart, salesEnd).map(row => row.slice(3, 6))
    ];
    reorderedRightSide.forEach((cells, offset) => {
        rows[salesStart + offset].splice(3, 3, ...cells);
    });
};

export class Srv1FinancialStatementsService {
    static getProfitAndLossReport() {
        const rows = fullStatementRows(profitAndLossWorkbook as FullStatementWorkbook);
        const company = text(rows[0]?.[0]);
        const reportName = text(rows[5]?.[0]);
        const period = text(rows[6]?.[0]);
        return {
            statementType: "PROFIT_AND_LOSS" as const,
            reportName,
            company,
            period,
            companyDetails: {
                address: [text(rows[1]?.[0]), text(rows[2]?.[0])].filter(Boolean),
                identifier: text(rows[3]?.[0]),
                email: text(rows[4]?.[0])
            },
            rows
        };
    }

    static getBalanceSheetReport() {
        const source = balanceSheetSource as PureBalanceSheet;
        return {
            statementType: "BALANCE_SHEET" as const,
            reportName: source.report,
            company: source.company,
            period: periodLabel(source.period),
            companyDetails: { address: companyAddress, identifier: companyIdentifier, email: companyEmail },
            rows: balanceSheetRows(source)
        };
    }

    static async exportExcel(
        res: Response,
        report: FinancialStatementReport,
        filename: string,
        sheetName: string
    ) {
        const workbook = new ExcelJS.Workbook();
        workbook.creator = "A G ERP";
        workbook.subject = report.reportName;
        workbook.title = `${report.company} - ${report.reportName}`;
        const worksheet = workbook.addWorksheet(sheetName);
        const rows = report.rows.map(row => [...row]);
        const periodStart = report.period.split(" to ")[0];
        const companyPeriod = `${report.company} (from ${periodStart})`;
        rows[7] = rows[7] ?? [];
        rows[7][1] = companyPeriod;
        rows[7][4] = companyPeriod;
        if (report.statementType === "PROFIT_AND_LOSS") {
            reorderProfitAndLossSectionsForExport(rows);
        }

        worksheet.views = [{ state: "frozen", ySplit: 9 }];
        worksheet.pageSetup = {
            orientation: "landscape",
            fitToPage: true,
            fitToWidth: 1,
            fitToHeight: 0,
            paperSize: 9,
            margins: { left: 0.25, right: 0.25, top: 0.45, bottom: 0.45, header: 0.2, footer: 0.2 }
        };
        worksheet.getColumn(1).width = 43;
        worksheet.getColumn(2).width = 16;
        worksheet.getColumn(3).width = 17;
        worksheet.getColumn(4).width = 43;
        worksheet.getColumn(5).width = 16;
        worksheet.getColumn(6).width = 17;
        worksheet.properties.defaultRowHeight = 15;

        rows.forEach((sourceRow, index) => {
            const rowNumber = index + 1;
            const cells = Array.from({ length: 6 }, (_, columnIndex) => sourceRow[columnIndex] ?? null);
            const row = worksheet.addRow(cells);
            row.height = rowNumber <= 7 ? 18 : 16;
            row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
                cell.font = { name: "Arial", size: 9, color: { argb: "FF202A35" } };
                cell.alignment = {
                    vertical: "middle",
                    horizontal: [2, 3, 5, 6].includes(columnNumber) ? "right" : "left"
                };
                if ([2, 3, 5, 6].includes(columnNumber) && typeof cell.value === "number") {
                    cell.numFmt = amountFormat;
                }
            });

            if (rowNumber <= 5) {
                worksheet.mergeCells(rowNumber, 1, rowNumber, 6);
                row.getCell(1).font = {
                    name: "Arial", size: rowNumber === 1 ? 11 : 9,
                    bold: rowNumber === 1, color: { argb: "FF263445" }
                };
            } else if (rowNumber === 6) {
                worksheet.mergeCells(6, 1, 6, 6);
                const title = row.getCell(1);
                title.font = { name: "Arial", size: 14, bold: true, color: { argb: "FFFFFFFF" } };
                title.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF263445" } };
                title.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
                row.height = 25;
                for (let column = 1; column <= 6; column++) {
                    row.getCell(column).border = { bottom: { style: "medium", color: { argb: "FFF2C94C" } } };
                }
            } else if (rowNumber === 7) {
                worksheet.mergeCells(7, 1, 7, 6);
                row.getCell(1).font = { name: "Arial", size: 10, italic: true, color: { argb: "FF526273" } };
            } else if (rowNumber === 8) {
                for (const column of [2, 5]) {
                    row.getCell(column).font = { name: "Arial", size: 9, bold: true, color: { argb: "FF263445" } };
                    row.getCell(column).alignment = { horizontal: "center", vertical: "middle", wrapText: true };
                }
                row.height = 24;
            } else if (rowNumber === 9) {
                row.eachCell({ includeEmpty: true }, cell => {
                    cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF202A35" } };
                    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE699" } };
                    cell.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
                    cell.border = {
                        top: { style: "thin", color: { argb: "FFB7A45A" } },
                        bottom: { style: "thin", color: { argb: "FFB7A45A" } }
                    };
                });
                row.height = 22;
            } else {
                const leftLabel = text(sourceRow[0]);
                const rightLabel = text(sourceRow[3]);
                const total = /^total$/i.test(leftLabel) || /^total$/i.test(rightLabel);
                const section = !total && Boolean(sourceRow[2] != null || sourceRow[5] != null);
                if (section || total) {
                    const yellowHeaderOnly = section;
                    if (yellowHeaderOnly) {
                        const headerColumns = [
                            ...(sourceRow[2] != null ? [1, 3] : []),
                            ...(sourceRow[5] != null ? [4, 6] : [])
                        ];
                        for (const column of headerColumns) {
                            const cell = row.getCell(column);
                            cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF202A35" } };
                            cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFE699" } };
                            cell.border = { top: { style: "thin", color: { argb: "FFD6C37A" } } };
                        }
                    } else {
                        row.eachCell({ includeEmpty: true }, cell => {
                            cell.font = { name: "Arial", size: 9, bold: true, color: { argb: "FF202A35" } };
                            cell.fill = {
                                type: "pattern", pattern: "solid",
                                fgColor: { argb: total ? "FFFFE699" : "FFFFF5D6" }
                            };
                            cell.border = { top: { style: "thin", color: { argb: "FFD6C37A" } } };
                        });
                    }
                }
            }
        });

        const buffer = await workbook.xlsx.writeBuffer();
        res.status(200);
        res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}.xlsx"`);
        return res.send(Buffer.from(buffer));
    }

    /** Live Balance Sheet Service  */
    static async getLiveBalanceSheetReport(
        actor: any,
        query?: LiveStatementQuery
    ): Promise<FinancialStatementReport> {
        const [trial, openingStockItems, closingStockItems] = await Promise.all([
            ReportingService.getTrialBalanceReport(actor, {
                branchId: query?.branchId,
                startDate: query?.startDate,
                endDate: query?.endDate,
                includeZero: query?.includeZero
            }),
            loadOpeningStockItems(),
            loadClosingStockItems()
        ]);

        const tree = (trial.tree || []) as TrialBalanceNode[];
        const openingStock = sumItems(openingStockItems);
        const closingStock = sumItems(closingStockItems);
        const nettProfit = computeNettProfit(tree, openingStock, closingStock);

        const {
            liabilityHeads,
            assetHeads,
            profitAndLossHead,
            suspenseHead
        } = classifyBalanceSheetHeads(tree);

        const leftRows: unknown[][] = [];
        for (const head of liabilityHeads) {
            leftRows.push(...balanceSheetSectionFromHead(head, closingStock));
        }

        const suspenseItems = suspenseHead
            ? firstLevelItems(suspenseHead, liabilityAmount)
            : [{ name: "SUSPENSE", amount: 0 }];
        leftRows.push(...sectionRows(nodeName(suspenseHead || { name: "Suspense A/c" }), 0, suspenseItems));

        const profitAndLossOpening = profitAndLossHead ? liabilityAmount(profitAndLossHead) : 0;
        const profitAndLossTotal = money(profitAndLossOpening + nettProfit);
        leftRows.push(...sectionRows("Profit & Loss A/c", profitAndLossTotal || null, [
            { name: "Opening Balance", amount: profitAndLossOpening },
            { name: "Current Period", amount: nettProfit }
        ]));

        const rightRows: unknown[][] = [];
        for (const head of assetHeads) {
            rightRows.push(...balanceSheetSectionFromHead(head, closingStock));
        }

        const liabilitiesTotal = money(
            liabilityHeads.reduce((sum, head) => sum + liabilityAmount(head), 0) + profitAndLossTotal
        );
        const assetsTotal = money(
            assetHeads.reduce((sum, head) => {
                if (isCurrentAssetsHead(nodeName(head))) {
                    return sum + sumItems(currentAssetsBalanceSheetItems(head, closingStock));
                }
                return sum + assetAmount(head);
            }, 0)
        );

        const startIso = isoKolkata(trial.period.startDate);
        const endIso = isoKolkata(trial.period.endDate);
        const period = periodLabel({ from: startIso, to: endIso });
        const company = text(trial.branch?.name) || "A G Ashtavinayaka Petrochem Pvt Ltd - Maharashtra";
        const asAt = `as at ${displayDate(endIso)}`;

        const rows: unknown[][] = reportHeaderRows(company, "Balance Sheet", period);
        rows.push(["", "", null, "", "", null]);
        rows.push(["Liabilities", asAt, null, "Assets", asAt, null]);
        rows.push(...pairStatementSides(leftRows, rightRows));
        rows.push(["Total", null, liabilitiesTotal, "Total", null, assetsTotal]);

        return {
            statementType: "BALANCE_SHEET",
            reportName: "Balance Sheet",
            company,
            period,
            companyDetails: {
                address: [...companyAddress],
                identifier: companyIdentifier,
                email: companyEmail
            },
            rows
        };
    }

    /** Live Profit and Loss Service  */
    static async getLiveProfitAndLossReport(
        actor: any,
        query?: LiveStatementQuery
    ): Promise<FinancialStatementReport> {
        const [trial, openingStockItems, closingStockItems] = await Promise.all([
            ReportingService.getTrialBalanceReport(actor, {
                branchId: query?.branchId,
                startDate: query?.startDate,
                endDate: query?.endDate,
                includeZero: query?.includeZero
            }),
            loadOpeningStockItems(),
            loadClosingStockItems()
        ]);

        const tree = (trial.tree || []) as TrialBalanceNode[];
        const purchaseHead = findTrialHead(tree, ["Purchase Accounts"]);
        const directExpenseHead = findTrialHead(tree, ["Direct Expenses", "Direct Expense"]);
        const indirectExpenseHead = findTrialHead(tree, ["Indirect Expenses", "Indirect Expense"]);
        const salesHead = findTrialHead(tree, ["Sales Accounts"]);
        const indirectIncomeHead = findTrialHead(tree, ["Indirect Incomes", "Indirect Income"]);

        const openingStock = money(openingStockItems.reduce((sum, item) => sum + item.amount, 0));
        const closingStock = money(closingStockItems.reduce((sum, item) => sum + item.amount, 0));

        const purchaseAccounts = expenseAmount(purchaseHead);
        const directExpenses = expenseAmount(directExpenseHead);
        const indirectExpenses = expenseAmount(indirectExpenseHead);
        const salesAccounts = incomeAmount(salesHead);
        const indirectIncomes = incomeAmount(indirectIncomeHead);

        const grossProfit = money(
            (salesAccounts + closingStock) - (openingStock + purchaseAccounts + directExpenses)
        );
        const nettProfit = money(grossProfit + indirectIncomes - indirectExpenses);

        const leftRows: unknown[][] = [
            ...sectionRows("Opening Stock", openingStock, openingStockItems),
            ...sectionRows("Purchase Accounts", purchaseAccounts, firstLevelItems(purchaseHead, expenseAmount)),
            ...sectionRows("Direct Expenses", directExpenses, firstLevelItems(directExpenseHead, expenseAmount))
        ];
        const rightRows: unknown[][] = [
            ...sectionRows("Sales Accounts", salesAccounts, firstLevelItems(salesHead, incomeAmount)),
            ...sectionRows("Closing Stock", closingStock || null, closingStockItems)
        ];

        if (grossProfit >= 0) {
            leftRows.push(["Gross Profit c/o", null, grossProfit]);
        } else {
            rightRows.push(["Gross Loss c/o", null, money(-grossProfit)]);
        }

        const tradingTotal = money(
            openingStock + purchaseAccounts + directExpenses + Math.max(grossProfit, 0)
        );
        leftRows.push([null, tradingTotal || null, null]);
        rightRows.push([null, tradingTotal || null, null]);

        if (grossProfit < 0) {
            leftRows.push(["Gross Loss b/f", null, money(-grossProfit)]);
        }
        leftRows.push(
            ...sectionRows("Indirect Expenses", indirectExpenses, firstLevelItems(indirectExpenseHead, expenseAmount))
        );

        if (grossProfit >= 0) {
            rightRows.push(["Gross Profit b/f", null, grossProfit]);
        }
        rightRows.push(
            ...sectionRows("Indirect Incomes", indirectIncomes, firstLevelItems(indirectIncomeHead, incomeAmount))
        );

        if (nettProfit >= 0) {
            leftRows.push(["Nett Profit", null, nettProfit]);
        } else {
            rightRows.push(["Nett Loss", null, money(-nettProfit)]);
        }

        const debitTotal = money(
            (grossProfit < 0 ? money(-grossProfit) : 0) + indirectExpenses + Math.max(nettProfit, 0)
        );
        const creditTotal = money(
            (grossProfit >= 0 ? grossProfit : 0) + indirectIncomes + Math.max(-nettProfit, 0)
        );

        const startIso = isoKolkata(trial.period.startDate);
        const endIso = isoKolkata(trial.period.endDate);
        const period = periodLabel({ from: startIso, to: endIso });
        const company = text(trial.branch?.name) || "A G Ashtavinayaka Petrochem Pvt Ltd - Maharashtra";

        const rows: unknown[][] = reportHeaderRows(company, "Profit & Loss A/c", period);
        rows.push(["", "", null, "", "", null]);
        rows.push(["Particulars", period, null, "Particulars", period, null]);
        rows.push(...pairStatementSides(leftRows, rightRows));
        rows.push(["Total", null, debitTotal as any, "Total", null, creditTotal]);

        return {
            statementType: "PROFIT_AND_LOSS",
            reportName: "Profit & Loss A/c",
            company,
            period,
            companyDetails: {
                address: [...companyAddress],
                identifier: companyIdentifier,
                email: companyEmail
            },
            rows
        };
    }
}

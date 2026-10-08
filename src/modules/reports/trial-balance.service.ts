import tallyTrialBalance from "./Trial/TALLYTRIALBAL.json";
import newTrialBalance from "./Trial/NEWTRIAL.json";

type BalanceSides = { debit?: number | null; credit?: number | null };
type TallyAccount = {
    name: string;
    type: "group" | "ledger";
    opening?: BalanceSides;
    children?: TallyAccount[];
};

const amount = (value: unknown) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
};
const cleanName = (value: unknown) => String(value ?? "").replace(/_x000D_/gi, "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim();
const parseTallyDate = (value: string) => {
    const match = value.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
    if (!match) return null;
    const month = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"].indexOf(match[2].toUpperCase());
    if (month < 0) return null;
    let year = Number(match[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return new Date(Date.UTC(year, month, Number(match[1])));
};

export class Srv1TrialBalanceService {
    static getSrv1TrialBalanceReport() {
        const hierarchy = tallyTrialBalance as { company: string; accounts: TallyAccount[]; grandTotal?: { opening?: BalanceSides } };
        const data = newTrialBalance as any;
        const matrix: any[][] = data.sheets["Trial Balance"].rows;
        const company = cleanName(matrix[0]?.[0]) || hierarchy.company;
        const periodLabel = cleanName(matrix[6]?.[0]);
        const [fromLabel, toLabel] = periodLabel.split(/\s+to\s+/i);
        const grandIndex = matrix.findIndex((row: any[]) => cleanName(row?.[0]).toUpperCase() === "GRAND TOTAL");
        const sourceRows: any[][] = matrix.slice(11, grandIndex < 0 ? matrix.length : grandIndex);
        const totalSourceRow: any[] = grandIndex >= 0 ? matrix[grandIndex] : [];
        const rows: any[] = [];
        const nameMismatches: Array<{ hierarchyName: string; sourceName: string }> = [];
        let sourceIndex = 0;
        let sequence = 0;

        const buildNode = (account: TallyAccount, parentId: string | null, path: string[], level: number): any => {
            const sourceRow = sourceRows[sourceIndex++];
            const sourceName = cleanName(sourceRow?.[0]);
            if (sourceName !== cleanName(account.name)) nameMismatches.push({ hierarchyName: account.name, sourceName });
            const openingDebit = amount(account.opening?.debit);
            const openingCredit = amount(account.opening?.credit);
            const transactionDebit = amount(sourceRow?.[2]);
            const transactionCredit = amount(sourceRow?.[3]);
            const closingSigned = Number((openingDebit - openingCredit + transactionDebit - transactionCredit).toFixed(2));
            const isGroup = account.type === "group";
            const id = `srv1:${[...path, account.name].join("/")}`;
            const code = [...path, account.name].join("_").replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").toUpperCase();
            const node: any = {
                id, name: account.name, account: account.name,
                rowType: isGroup ? "accountingHeader" : "ledger",
                ledgerId: isGroup ? null : id, ledgerCode: isGroup ? undefined : code,
                groupCode: code, groupId: id, parentId, parentGroup: path[path.length - 1] || "", level,
                openingDebit, openingCredit, transactionDebit, transactionCredit,
                periodDebit: transactionDebit, periodCredit: transactionCredit,
                closingBalance: Math.abs(closingSigned), closingBalanceSigned: closingSigned,
                closingBalanceType: closingSigned > 0 ? "Dr" : closingSigned < 0 ? "Cr" : null,
                sourceClosingBalance: amount(sourceRow?.[4]),
                children: []
            };
            rows.push(node);
            if (isGroup) {
                node.children = (account.children || []).map(child => buildNode(child, id, [...path, account.name], level + 1));
                node.hasChildren = node.children.length > 0;
            } else {
                sequence++;
                Object.assign(node, {
                    srNo: sequence,
                    reportParentCode: path[0]?.toUpperCase().replace(/[^A-Z0-9]+/g, "_") || "",
                    reportParentName: path[0] || "",
                    ledgerCategory: "TALLY",
                    ledgerNature: closingSigned >= 0 ? "DEBIT" : "CREDIT",
                    branchId: null, branchName: company, agencyId: null, agencyName: null,
                    debit: node.closingBalanceType === "Dr" ? node.closingBalance : 0,
                    credit: node.closingBalanceType === "Cr" ? node.closingBalance : 0,
                    closingDebit: node.closingBalanceType === "Dr" ? node.closingBalance : 0,
                    closingCredit: node.closingBalanceType === "Cr" ? node.closingBalance : 0
                });
            }
            return node;
        };

        const tree = hierarchy.accounts.map(account => buildNode(account, null, [], 0));
        const openingDebit = amount(hierarchy.grandTotal?.opening?.debit);
        const openingCredit = amount(hierarchy.grandTotal?.opening?.credit);
        const totalPeriodDebit = amount(totalSourceRow?.[2]);
        const totalPeriodCredit = amount(totalSourceRow?.[3]);
        const closingTotalSigned = Number((openingDebit - openingCredit + totalPeriodDebit - totalPeriodCredit).toFixed(2));
        const sourceClosingMismatchCount = rows.filter(row => row.rowType === "ledger" && Math.abs(row.closingBalance - row.sourceClosingBalance) > 0.02).length;

        return {
            reportName: cleanName(matrix[5]?.[0]) || "Trial Balance",
            generatedAt: new Date(),
            branchId: null,
            branch: { id: null, name: company },
            company,
            companyDetails: {
                addressLines: [cleanName(matrix[1]?.[0]), cleanName(matrix[2]?.[0])],
                identifier: cleanName(matrix[3]?.[0]),
                email: cleanName(matrix[4]?.[0])
            },
            branchHeading: cleanName(matrix[7]?.[1]),
            period: { startDate: parseTallyDate(fromLabel), endDate: parseTallyDate(toLabel) || new Date(), normalizedFromBeginning: false, label: periodLabel },
            layout: { style: "tally-trial-balance", hierarchy: ["source-order"], columns: [
                { key: "account", label: "Particulars" },
                { key: "openingDebit", label: "Opening Debit" }, { key: "openingCredit", label: "Opening Credit" },
                { key: "transactionDebit", label: "Transaction Debit" }, { key: "transactionCredit", label: "Transaction Credit" },
                { key: "closingBalance", label: "Closing Balance" }
            ] },
            summary: {
                totalDebit: totalPeriodDebit, totalCredit: totalPeriodCredit,
                totalPeriodDebit, totalPeriodCredit,
                totalOpeningDebit: openingDebit, totalOpeningCredit: openingCredit,
                closingBalance: Math.abs(closingTotalSigned), closingBalanceSigned: closingTotalSigned,
                closingBalanceType: closingTotalSigned > 0 ? "Dr" : closingTotalSigned < 0 ? "Cr" : null,
                totalClosingDebit: closingTotalSigned > 0 ? closingTotalSigned : 0,
                totalClosingCredit: closingTotalSigned < 0 ? Math.abs(closingTotalSigned) : 0,
                periodDifference: Number((totalPeriodDebit - totalPeriodCredit).toFixed(2)),
                closingDifference: closingTotalSigned,
                isPeriodBalanced: Math.abs(totalPeriodDebit - totalPeriodCredit) < 0.01,
                isClosingBalanced: Math.abs(closingTotalSigned) < 0.01,
                isBalanced: Math.abs(closingTotalSigned) < 0.01
            },
            diagnostics: {
                source: "SRV1/Trial/NEWTRIAL.json",
                openingSideSource: "SRV1/Trial/TALLYTRIALBAL.json",
                movementsAvailable: true,
                hierarchyNameMismatches: nameMismatches,
                sourceClosingMismatchCount,
                message: "Opening debit/credit sides come from TALLYTRIALBAL.json because NEWTRIAL.json supplies one net opening balance. Transactions and calculated closing balances come from NEWTRIAL.json."
            },
            rows,
            ledgerRows: rows.filter(row => row.rowType === "ledger"),
            tree,
            accountGroups: tree
        };
    }
}

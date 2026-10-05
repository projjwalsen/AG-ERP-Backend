import tallyTrialBalance from "./fakeTrial/TALLYTRIALBAL.json";

type TallySideBalance = {
    debit?: number | null;
    credit?: number | null;
};

type TallyAccount = {
    name: string;
    type: "group" | "ledger";
    opening?: TallySideBalance;
    closing?: TallySideBalance;
    children?: TallyAccount[];
};

const amount = (value: unknown) => {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? Number(parsed.toFixed(2)) : 0;
};

const signedBalance = (balance?: TallySideBalance) =>
    amount(balance?.debit) - amount(balance?.credit);

const parseTallyDate = (value: string) => {
    const match = value.trim().match(/^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$/);
    if (!match) return null;

    const monthIndex = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"]
        .indexOf(match[2].toUpperCase());
    if (monthIndex < 0) return null;

    let year = Number(match[3]);
    if (year < 100) year += year >= 70 ? 1900 : 2000;
    return new Date(Date.UTC(year, monthIndex, Number(match[1])));
};

export class FakeTrialBalanceService {
    static getFakeTrialBalanceReport() {
        const source = tallyTrialBalance as {
            company: string;
            report: string;
            period: string;
            accounts: TallyAccount[];
            grandTotal?: {
                opening?: TallySideBalance;
                closing?: TallySideBalance;
            };
        };

        const [fromLabel, toLabel] = source.period.split(/\s+to\s+/i);
        const startDate = parseTallyDate(fromLabel);
        const endDate = parseTallyDate(toLabel);
        const rows: any[] = [];
        let sequence = 0;

        const buildNode = (
            account: TallyAccount,
            parentId: string | null,
            parentGroup: string,
            path: string[],
            level: number
        ): any => {
            const id = `fake:${[...path, account.name].join("/")}`;
            const openingDebit = amount(account.opening?.debit);
            const openingCredit = amount(account.opening?.credit);
            const closingDebit = amount(account.closing?.debit);
            const closingCredit = amount(account.closing?.credit);
            const closingSigned = Number((closingDebit - closingCredit).toFixed(2));
            const isGroup = account.type === "group";
            const groupCode = [...path, account.name]
                .join("_")
                .replace(/[^a-z0-9]+/gi, "_")
                .replace(/^_|_$/g, "")
                .toUpperCase();
            const node: any = {
                id,
                name: account.name,
                account: account.name,
                rowType: isGroup ? "accountingHeader" : "ledger",
                ledgerId: isGroup ? null : id,
                ledgerCode: isGroup ? undefined : groupCode,
                groupCode,
                groupId: id,
                parentGroup,
                parentId,
                level,
                openingDebit,
                openingCredit,
                periodDebit: 0,
                periodCredit: 0,
                closingDebit,
                closingCredit,
                closingSigned,
                closingBalance: Math.abs(closingSigned),
                closingBalanceType: closingSigned > 0 ? "Dr" : closingSigned < 0 ? "Cr" : null,
                hasChildren: false,
                children: []
            };

            if (isGroup) {
                node.children = (account.children || []).map(child =>
                    buildNode(child, id, account.name, [...path, account.name], level + 1)
                );
                node.hasChildren = node.children.length > 0;
            } else {
                sequence += 1;
                rows.push({
                    srNo: sequence,
                    rowType: "ledger",
                    level: 0,
                    ledgerId: id,
                    ledgerCode: groupCode,
                    account: account.name,
                    parentGroup,
                    groupCode: path.length ? path[path.length - 1].toUpperCase().replace(/[^A-Z0-9]+/g, "_") : "",
                    groupId: parentId,
                    reportParentCode: path[0]?.toUpperCase().replace(/[^A-Z0-9]+/g, "_") || "",
                    reportParentName: path[0] || "",
                    reportChildCode: path[path.length - 1]?.toUpperCase().replace(/[^A-Z0-9]+/g, "_") || "",
                    reportChildName: parentGroup,
                    ledgerCategory: "FAKE",
                    ledgerNature: closingSigned >= 0 ? "DEBIT" : "CREDIT",
                    branchId: null,
                    branchName: source.company,
                    agencyId: null,
                    agencyName: null,
                    debit: closingDebit,
                    credit: closingCredit,
                    periodDebit: 0,
                    periodCredit: 0,
                    openingDebit,
                    openingCredit,
                    closingDebit,
                    closingCredit,
                    closingSigned,
                    closingBalance: Math.abs(closingSigned),
                    closingBalanceType: closingSigned > 0 ? "Dr" : closingSigned < 0 ? "Cr" : null
                });
            }

            return node;
        };

        const tree = source.accounts.map(account => buildNode(account, null, "", [], 0));
        const openingDebit = amount(source.grandTotal?.opening?.debit) ||
            Number(rows.reduce((sum, row) => sum + row.openingDebit, 0).toFixed(2));
        const openingCredit = amount(source.grandTotal?.opening?.credit) ||
            Number(rows.reduce((sum, row) => sum + row.openingCredit, 0).toFixed(2));
        const totalClosingDebit = amount(source.grandTotal?.closing?.debit) ||
            Number(rows.reduce((sum, row) => sum + row.closingDebit, 0).toFixed(2));
        const totalClosingCredit = amount(source.grandTotal?.closing?.credit) ||
            Number(rows.reduce((sum, row) => sum + row.closingCredit, 0).toFixed(2));
        const closingDifference = Number((totalClosingDebit - totalClosingCredit).toFixed(2));

        return {
            reportName: "Trial Balance",
            generatedAt: new Date(),
            branchId: null,
            branch: { id: null, name: source.company },
            period: {
                startDate,
                endDate: endDate || new Date(),
                normalizedFromBeginning: false,
                label: source.period
            },
            layout: {
                style: "tally-trial-balance",
                hierarchy: ["accountingHeader", "accountingHeader", "ledger"],
                columns: [
                    { key: "name", label: "Particulars", rowKey: "account" },
                    { key: "periodDebit", label: "Debit", section: "Transactions" },
                    { key: "periodCredit", label: "Credit", section: "Transactions" },
                    { key: "closingDebit", label: "Debit", section: "Closing" },
                    { key: "closingCredit", label: "Credit", section: "Closing" }
                ]
            },
            summary: {
                totalDebit: 0,
                totalCredit: 0,
                totalPeriodDebit: 0,
                totalPeriodCredit: 0,
                totalOpeningDebit: openingDebit,
                totalOpeningCredit: openingCredit,
                totalClosingDebit,
                totalClosingCredit,
                periodDifference: 0,
                closingDifference,
                isPeriodBalanced: true,
                isClosingBalanced: Math.abs(closingDifference) < 0.01,
                isBalanced: Math.abs(closingDifference) < 0.01
            },
            diagnostics: {
                source: "TALLYTRIALBAL.json",
                movementsAvailable: false,
                message: "The source JSON has opening and closing balances but no transaction debit/credit totals."
            },
            rows,
            tree,
            accountGroups: tree
        };
    }
}

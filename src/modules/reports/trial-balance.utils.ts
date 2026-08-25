import { EntryType, LedgerNature } from "@prisma/client";

export type TrialBalanceMovement = {
    debit: number;
    credit: number;
};

export type TrialBalanceLedgerInput = {
    nature: LedgerNature;
    openingBalance: unknown;
    openingDebit: unknown;
    openingCredit: unknown;
    openingBalanceDate?: Date | null;
};

const roundMoney = (value: number) =>
    Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const atStartOfDay = (value: Date) => {
    const result = new Date(value);
    result.setHours(0, 0, 0, 0);
    return result;
};

const atEndOfDay = (value: Date) => {
    const result = new Date(value);
    result.setHours(23, 59, 59, 999);
    return result;
};

/**
 * "Beginning" reports use the most recently completed Indian financial year.
 * For example, an as-at date of 25 Aug 2026 resolves to 1 Apr 2025–31 Mar 2026.
 */
export const resolveTrialBalancePeriod = (
    requestedStart: Date | undefined,
    requestedEnd: Date
) => {
    if (requestedStart) {
        return {
            startDate: atStartOfDay(requestedStart),
            endDate: atEndOfDay(requestedEnd),
            normalizedFromBeginning: false
        };
    }

    const asAt = atEndOfDay(requestedEnd);
    const containingFinancialYearStart =
        asAt.getMonth() >= 3
            ? asAt.getFullYear()
            : asAt.getFullYear() - 1;

    return {
        startDate: new Date(containingFinancialYearStart - 1, 3, 1, 0, 0, 0, 0),
        endDate: new Date(containingFinancialYearStart, 2, 31, 23, 59, 59, 999),
        normalizedFromBeginning: true
    };
};

/**
 * Entry branch wins when present. Voucher branch is only the legacy fallback
 * for entries whose branch was not populated.
 */
export const buildTrialBalanceBranchFilter = (branchId?: string) =>
    branchId
        ? {
            OR: [
                { branchId },
                {
                    branchId: null,
                    voucher: { branchId }
                }
            ]
        }
        : undefined;

export const openingAppliesAt = (
    openingBalanceDate: Date | null | undefined,
    reportEnd: Date
) => !openingBalanceDate || openingBalanceDate <= reportEnd;

export const effectiveMovementStart = (
    periodStart: Date,
    openingBalanceDate: Date | null | undefined,
    reportEnd: Date
) => {
    if (
        openingBalanceDate &&
        openingBalanceDate <= reportEnd &&
        openingBalanceDate > periodStart
    ) {
        return atStartOfDay(openingBalanceDate);
    }

    return periodStart;
};

export const calculateTrialBalanceAmounts = (
    ledger: TrialBalanceLedgerInput,
    prior: TrialBalanceMovement,
    period: TrialBalanceMovement,
    useOpening: boolean
) => {
    const openingDebit = Number(ledger.openingDebit || 0);
    const openingCredit = Number(ledger.openingCredit || 0);
    const hasExplicitOpening = openingDebit !== 0 || openingCredit !== 0;
    const legacyOpening = ledger.nature === LedgerNature.CREDIT
        ? -Number(ledger.openingBalance || 0)
        : Number(ledger.openingBalance || 0);
    const openingSigned = useOpening
        ? hasExplicitOpening
            ? openingDebit - openingCredit
            : legacyOpening
        : 0;

    const periodDebit = roundMoney(period.debit);
    const periodCredit = roundMoney(period.credit);
    const openingForPeriod = roundMoney(
        openingSigned + prior.debit - prior.credit
    );
    const closingSigned = roundMoney(
        openingForPeriod + periodDebit - periodCredit
    );

    return {
        openingSigned: roundMoney(openingSigned),
        openingDebit: openingForPeriod > 0 ? openingForPeriod : 0,
        openingCredit: openingForPeriod < 0 ? Math.abs(openingForPeriod) : 0,
        periodDebit,
        periodCredit,
        closingSigned,
        closingDebit: closingSigned > 0 ? closingSigned : 0,
        closingCredit: closingSigned < 0 ? Math.abs(closingSigned) : 0
    };
};

export const hasTrialBalanceActivity = (row: {
    openingDebit?: number;
    openingCredit?: number;
    periodDebit: number;
    periodCredit: number;
    closingDebit: number;
    closingCredit: number;
}) =>
    [
        row.openingDebit,
        row.openingCredit,
        row.periodDebit,
        row.periodCredit,
        row.closingDebit,
        row.closingCredit
    ].some(value => Number(value || 0) !== 0);

export const sumTrialBalanceEntryGroups = (
    groups: Array<{
        ledgerId: string;
        entryType: EntryType;
        _sum: { amount: unknown };
    }>
) => {
    const map = new Map<string, TrialBalanceMovement>();

    for (const group of groups) {
        const current = map.get(group.ledgerId) || { debit: 0, credit: 0 };
        const amount = Number(group._sum.amount || 0);

        if (group.entryType === EntryType.DEBIT) current.debit += amount;
        else current.credit += amount;

        map.set(group.ledgerId, current);
    }

    return map;
};

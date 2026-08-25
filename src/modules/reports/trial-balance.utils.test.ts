import assert from "node:assert/strict";
import test from "node:test";
import { EntryType, LedgerNature } from "@prisma/client";
import {
    buildTrialBalanceBranchFilter,
    calculateTrialBalanceAmounts,
    effectiveMovementStart,
    hasTrialBalanceActivity,
    resolveTrialBalancePeriod,
    sumTrialBalanceEntryGroups
} from "./trial-balance.utils";
import { areVoucherTotalsBalanced } from
    "../accounting/ledger/voucher-balance.utils";

test("Beginning to 25 Aug 2026 resolves to FY 2025-26", () => {
    const period = resolveTrialBalancePeriod(
        undefined,
        new Date(2026, 7, 25)
    );

    assert.deepEqual(
        [
            period.startDate.getFullYear(),
            period.startDate.getMonth(),
            period.startDate.getDate()
        ],
        [2025, 3, 1]
    );
    assert.deepEqual(
        [
            period.endDate.getFullYear(),
            period.endDate.getMonth(),
            period.endDate.getDate()
        ],
        [2026, 2, 31]
    );
    assert.equal(period.normalizedFromBeginning, true);
});

test("explicit report dates are preserved", () => {
    const period = resolveTrialBalancePeriod(
        new Date(2025, 3, 1),
        new Date(2025, 7, 25)
    );

    assert.equal(period.startDate.getDate(), 1);
    assert.equal(period.endDate.getDate(), 25);
    assert.equal(period.normalizedFromBeginning, false);
});

test("each ledger uses its own opening cutoff", () => {
    const periodStart = new Date(2025, 3, 1);
    const reportEnd = new Date(2026, 2, 31);

    assert.equal(
        effectiveMovementStart(
            periodStart,
            new Date(2025, 5, 1),
            reportEnd
        ).getMonth(),
        5
    );
    assert.equal(
        effectiveMovementStart(
            periodStart,
            new Date(2024, 3, 1),
            reportEnd
        ).getTime(),
        periodStart.getTime()
    );
});

test("opening, turnover, and closing follow debit-positive convention", () => {
    const amounts = calculateTrialBalanceAmounts(
        {
            nature: LedgerNature.DEBIT,
            openingBalance: 0,
            openingDebit: 100,
            openingCredit: 0,
            openingBalanceDate: new Date(2025, 3, 1)
        },
        { debit: 25, credit: 10 },
        { debit: 40, credit: 155 },
        true
    );

    assert.equal(amounts.openingDebit, 115);
    assert.equal(amounts.periodDebit, 40);
    assert.equal(amounts.periodCredit, 155);
    assert.equal(amounts.closingDebit, 0);
    assert.equal(amounts.closingCredit, 0);
});

test("opposite-side opening balances remain credit balances", () => {
    const amounts = calculateTrialBalanceAmounts(
        {
            nature: LedgerNature.DEBIT,
            openingBalance: 0,
            openingDebit: 0,
            openingCredit: 100,
            openingBalanceDate: new Date(2025, 3, 1)
        },
        { debit: 0, credit: 0 },
        { debit: 25, credit: 10 },
        true
    );

    assert.equal(amounts.closingDebit, 0);
    assert.equal(amounts.closingCredit, 85);
});

test("zero-closing ledgers with turnover remain visible", () => {
    assert.equal(
        hasTrialBalanceActivity({
            periodDebit: 500,
            periodCredit: 500,
            closingDebit: 0,
            closingCredit: 0
        }),
        true
    );
});

test("entry branch overrides voucher branch", () => {
    assert.deepEqual(
        buildTrialBalanceBranchFilter("branch-a"),
        {
            OR: [
                { branchId: "branch-a" },
                {
                    branchId: null,
                    voucher: { branchId: "branch-a" }
                }
            ]
        }
    );
});

test("entry aggregation keeps debit and credit turnover separate", () => {
    const map = sumTrialBalanceEntryGroups([
        {
            ledgerId: "ledger-1",
            entryType: EntryType.DEBIT,
            _sum: { amount: 20 }
        },
        {
            ledgerId: "ledger-1",
            entryType: EntryType.CREDIT,
            _sum: { amount: 20 }
        }
    ]);

    assert.deepEqual(map.get("ledger-1"), {
        debit: 20,
        credit: 20
    });
});

test("voucher totals must balance to the cent", () => {
    assert.equal(areVoucherTotalsBalanced(100, 100), true);
    assert.equal(areVoucherTotalsBalanced(100, 100.01), false);
    assert.equal(areVoucherTotalsBalanced(100, 104), false);
});

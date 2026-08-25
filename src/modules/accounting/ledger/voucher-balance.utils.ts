const money = (value: unknown) =>
    Math.round(Number(value || 0) * 100) / 100;

export const areVoucherTotalsBalanced = (
    totalDebit: number,
    totalCredit: number
) => money(totalDebit) === money(totalCredit);

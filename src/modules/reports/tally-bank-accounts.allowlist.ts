/** Tally Bank Accounts ledger list for A G Ashtavinayaka Petrochem Pvt Ltd - Maharashtra. */
export const TALLY_BANK_ACCOUNT_BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";

export const TALLY_BANK_ACCOUNT_NAMES = [
    "FD WITH BOM 60481155324",
    "FD WITH BOM 60522865556",
    "FD WITH YES BANK 024840600029570",
    "KARNATAKA BANK FD AC NO - 5201500200202401",
    "KARNATAKA BANK FD AC NO - 5201500202084001",
    "BOM CA 60435349267",
    "YES BANK CA - 024863700003291",
    "KARNATAKA CA 5207000300027101"
];

export const normalizeTallyBankAccountName = (value: unknown) =>
    String(value ?? "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[\u2013\u2014\u2212]/g, "-")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();

export const TALLY_BANK_ACCOUNT_ALLOWLIST = new Set(
    TALLY_BANK_ACCOUNT_NAMES.map(normalizeTallyBankAccountName)
);

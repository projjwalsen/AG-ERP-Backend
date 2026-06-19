import {
    AgencyType,
    EntryType,
    LedgerNature,
    LedgerType,
    PaymentType,
    Prisma,
    TransactionDirection,
    TransactionPaymentType,
    VoucherType
} from "@prisma/client";
import { randomUUID } from "crypto";
import { prisma } from "../../../config/db";
import { ApiError } from "../../../core/middleware/errorHandler";
import { parseDate, resolveBalanceType } from "../../../core/utils/loc.utils";

type DbClient = any;
type TaxKind = "CGST" | "SGST" | "IGST";

type LedgerMasterPayload = {
    name: string;
    code?: string;
    category: LedgerType;
    groupId?: string;
    groupCode?: string;
    branchId?: string;
    agencyId?: string;
    productId?: string;
    gstApplicable?: boolean;
    gstin?: string;
    pan?: string;
    openingBalance?: number;
    creditLimit?: number;
};

type VoucherEntryPayload = {
    ledgerId: string;
    entryType: EntryType;
    amount: number;
    branchId?: string | null;
    productId?: string | null;
    narration?: string;
};

type CreateVoucherPayload = {
    voucherNo?: string;
    voucherType: VoucherType;
    sourceId?: string;
    branchId?: string;
    narration?: string;
    voucherDate?: Date;
    entries: VoucherEntryPayload[];
};

type LedgerSeed = {
    code: string;
    name: string;
    category: LedgerType;
    groupCode: string;
    nature: LedgerNature;
    branchId?: string | null;
    agencyId?: string | null;
    productId?: string | null;
    gstApplicable?: boolean;
    gstin?: string | null;
    pan?: string | null;
    openingBalance?: number;
    creditLimit?: number | null;
    createdById?: string | null;
};

const money = (value: unknown) => Math.round(Number(value || 0) * 100) / 100;

const ROOT_GROUPS: Record<string, { name: string; nature: LedgerNature }> = {
    ASSETS: { name: "Assets", nature: LedgerNature.DEBIT },
    LIABILITIES: { name: "Liabilities", nature: LedgerNature.CREDIT },
    INCOME: { name: "Income", nature: LedgerNature.CREDIT },
    EXPENSES: { name: "Expenses", nature: LedgerNature.DEBIT }
};

const CHILD_GROUPS: Record<string, { name: string; parentCode: string; nature: LedgerNature }> = {
    CASH_IN_HAND: { name: "Cash-in-Hand", parentCode: "ASSETS", nature: LedgerNature.DEBIT },
    BANK_ACCOUNTS: { name: "Bank Accounts", parentCode: "ASSETS", nature: LedgerNature.DEBIT },
    SUNDRY_DEBTORS: { name: "Sundry Debtors", parentCode: "ASSETS", nature: LedgerNature.DEBIT },
    FIXED_ASSETS: { name: "Fixed Assets", parentCode: "ASSETS", nature: LedgerNature.DEBIT },
    INPUT_GST_CGST: { name: "Input GST CGST", parentCode: "ASSETS", nature: LedgerNature.DEBIT },
    INPUT_GST_SGST: { name: "Input GST SGST", parentCode: "ASSETS", nature: LedgerNature.DEBIT },
    INPUT_GST_IGST: { name: "Input GST IGST", parentCode: "ASSETS", nature: LedgerNature.DEBIT },

    SUNDRY_CREDITORS: { name: "Sundry Creditors", parentCode: "LIABILITIES", nature: LedgerNature.CREDIT },
    LOANS: { name: "Loans", parentCode: "LIABILITIES", nature: LedgerNature.CREDIT },
    DUTIES_AND_TAXES: { name: "Duties & Taxes", parentCode: "LIABILITIES", nature: LedgerNature.CREDIT },
    OUTPUT_GST_CGST: { name: "Output GST CGST", parentCode: "DUTIES_AND_TAXES", nature: LedgerNature.CREDIT },
    OUTPUT_GST_SGST: { name: "Output GST SGST", parentCode: "DUTIES_AND_TAXES", nature: LedgerNature.CREDIT },
    OUTPUT_GST_IGST: { name: "Output GST IGST", parentCode: "DUTIES_AND_TAXES", nature: LedgerNature.CREDIT },
    SUSPENSE_ACCOUNT: { name: "Suspense Account", parentCode: "LIABILITIES", nature: LedgerNature.CREDIT },

    SALES: { name: "Sales", parentCode: "INCOME", nature: LedgerNature.CREDIT },
    DIRECT_INCOME: { name: "Direct Income", parentCode: "INCOME", nature: LedgerNature.CREDIT },
    INDIRECT_INCOME: { name: "Indirect Income", parentCode: "INCOME", nature: LedgerNature.CREDIT },

    PURCHASE: { name: "Purchase", parentCode: "EXPENSES", nature: LedgerNature.DEBIT },
    DIRECT_EXPENSE: { name: "Direct Expense", parentCode: "EXPENSES", nature: LedgerNature.DEBIT },
    INDIRECT_EXPENSE: { name: "Indirect Expense", parentCode: "EXPENSES", nature: LedgerNature.DEBIT }
};

export class LedgerService {
    private static normalizeCode(value: string) {
        return value.replace(/[^A-Z0-9]/gi, "_").replace(/_+/g, "_").replace(/^_|_$/g, "").toUpperCase();
    }

    private static voucherPrefix(voucherType: VoucherType) {
        const prefixes: Record<string, string> = {
            SALE: "SALE",
            PURCHASE: "PUR",
            RECEIPT: "RCPT",
            PAYMENT: "PAY",
            JOURNAL: "JRN",
            CONTRA: "CTR",
            OPENING_BALANCE: "OPN"
        };

        return prefixes[voucherType] || voucherType;
    }

    private static generateVoucherNo(voucherType: VoucherType, sourceId?: string) {
        const unique = randomUUID().replace(/-/g, "").substring(0, 10).toUpperCase();
        const source = sourceId ? `-${sourceId.substring(0, 8).toUpperCase()}` : "";
        return `${this.voucherPrefix(voucherType)}${source}-${unique}`;
    }

    private static async getBranchCode(client: DbClient, branchId: string) {
        const branch = await client.branch.findUnique({
            where: { id: branchId },
            select: { code: true }
        });

        if (!branch) {
            throw new ApiError("Branch not found", 404);
        }

        return this.normalizeCode(branch.code);
    }

    private static async getAgency(client: DbClient, agencyId: string) {
        const agency = await client.agency.findUnique({
            where: { id: agencyId },
            select: { id: true, name: true, type: true, gstin: true, stateCode: true }
        });

        if (!agency) {
            throw new ApiError("Agency not found", 404);
        }

        return agency;
    }

    private static async getOrCreateGroup(client: DbClient, code: string) {
        const existing = await client.ledgerGroup.findUnique({
            where: { code }
        });

        if (existing) {
            return existing;
        }

        const root = ROOT_GROUPS[code];
        if (root) {
            return client.ledgerGroup.upsert({
                where: { code },
                update: {
                    name: root.name,
                    nature: root.nature
                },
                create: {
                    code,
                    name: root.name,
                    nature: root.nature
                }
            });
        }

        const child = CHILD_GROUPS[code];
        if (!child) {
            throw new ApiError(`Invalid ledger group code ${code}`, 400);
        }

        const parent = await this.getOrCreateGroup(client, child.parentCode);

        return client.ledgerGroup.upsert({
            where: { code },
            update: {
                name: child.name,
                parentId: parent.id,
                nature: child.nature
            },
            create: {
                code,
                name: child.name,
                parentId: parent.id,
                nature: child.nature
            }
        });
    }

    static async ensureDefaultLedgerGroups(client: DbClient = prisma) {
        for (const code of Object.keys(ROOT_GROUPS)) {
            await this.getOrCreateGroup(client, code);
        }

        for (const code of Object.keys(CHILD_GROUPS)) {
            await this.getOrCreateGroup(client, code);
        }
    }

    static async getLedgerGroups() {
        await this.ensureDefaultLedgerGroups();

        return prisma.ledgerGroup.findMany({
            include: {
                parent: true,
                children: true,
                _count: {
                    select: { ledgers: true }
                }
            },
            orderBy: [{ parentId: "asc" }, { name: "asc" }]
        });
    }

    private static async resolveGroupForLedger(
        client: DbClient,
        payload: Pick<LedgerMasterPayload, "groupId" | "groupCode" | "category">
    ) {
        if (payload.groupId) {
            const group = await client.ledgerGroup.findUnique({
                where: { id: payload.groupId }
            });

            if (!group) {
                throw new ApiError("Ledger group not found", 404);
            }

            return group;
        }

        if (payload.groupCode) {
            return this.getOrCreateGroup(client, payload.groupCode);
        }

        const defaultGroupCodeByType: Record<LedgerType, string> = {
            CUSTOMER: "SUNDRY_DEBTORS",
            VENDOR: "SUNDRY_CREDITORS",
            BANK: "BANK_ACCOUNTS",
            CASH: "CASH_IN_HAND",
            GST: "DUTIES_AND_TAXES",
            SALES: "SALES",
            PURCHASE: "PURCHASE",
            PRODUCT: "ASSETS",
            SUSPENSE: "SUSPENSE_ACCOUNT"
        };

        return this.getOrCreateGroup(client, defaultGroupCodeByType[payload.category]);
    }

    private static cacheDelta(nature: LedgerNature, entryType: EntryType, amount: number) {
        if (nature === LedgerNature.DEBIT) {
            return entryType === EntryType.DEBIT ? money(amount) : money(-amount);
        }

        return entryType === EntryType.CREDIT ? money(amount) : money(-amount);
    }

    private static async syncCachedBalance(client: DbClient, ledgerId: string) {
        const balance = await this.calculateLedgerBalance(ledgerId, client);

        await client.ledger.update({
            where: { id: ledgerId },
            data: { currentBalance: balance.closingBalance }
        });

        return balance;
    }

    private static async getOrCreateLedger(client: DbClient, seed: LedgerSeed) {
        const existing = await client.ledger.findUnique({
            where: { code: seed.code }
        });

        if (existing) {
            return existing;
        }

        const group = await this.getOrCreateGroup(client, seed.groupCode);

        try {
            return await client.ledger.create({
                data: {
                    code: seed.code,
                    name: seed.name,
                    category: seed.category,
                    groupId: group.id,
                    nature: seed.nature,
                    branchId: seed.branchId || null,
                    agencyId: seed.agencyId || null,
                    productId: seed.productId || null,
                    gstApplicable: seed.gstApplicable || false,
                    gstin: seed.gstin || null,
                    pan: seed.pan || null,
                    openingBalance: money(seed.openingBalance),
                    currentBalance: money(seed.openingBalance),
                    creditLimit: seed.creditLimit ?? null,
                    createdById: seed.createdById || null
                }
            });
        } catch {
            const raced = await client.ledger.findUnique({
                where: { code: seed.code }
            });

            if (raced) {
                return raced;
            }

            throw new ApiError(`Unable to create ledger ${seed.code}`, 500);
        }
    }

    static async createLedgerMaster(actor: any, payload: LedgerMasterPayload) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if (!payload.name?.trim()) {
            throw new ApiError("Ledger name is required", 400);
        }

        if (!payload.category) {
            throw new ApiError("Ledger category is required", 400);
        }

        if (payload.openingBalance !== undefined && payload.openingBalance < 0) {
            throw new ApiError("Opening balance cannot be negative", 400);
        }

        if (payload.creditLimit !== undefined && payload.creditLimit < 0) {
            throw new ApiError("Credit limit cannot be negative", 400);
        }

        return prisma.$transaction(async (tx) => {
            const group = await this.resolveGroupForLedger(tx, payload);
            const code = this.normalizeCode(payload.code || `${payload.name}-${group.code}-${payload.branchId || "GLOBAL"}`);

            const existing = await tx.ledger.findUnique({
                where: { code }
            });

            if (existing) {
                throw new ApiError("Ledger code already exists", 409);
            }

            return tx.ledger.create({
                data: {
                    code,
                    name: payload.name.trim(),
                    category: payload.category,
                    groupId: group.id,
                    nature: group.nature,
                    branchId: payload.branchId || null,
                    agencyId: payload.agencyId || null,
                    productId: payload.productId || null,
                    gstApplicable: payload.gstApplicable || false,
                    gstin: payload.gstin?.trim().toUpperCase() || null,
                    pan: payload.pan?.trim().toUpperCase() || null,
                    openingBalance: money(payload.openingBalance),
                    currentBalance: money(payload.openingBalance),
                    creditLimit: payload.creditLimit ?? null,
                    createdById: actor.id
                },
                include: { group: true, branch: true, agency: true, product: true }
            });
        });
    }

    static async updateLedgerMaster(
        actor: any,
        ledgerId: string,
        payload: Partial<LedgerMasterPayload> & { isActive?: boolean }
    ) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const existing = await prisma.ledger.findUnique({
            where: { id: ledgerId }
        });

        if (!existing) {
            throw new ApiError("Ledger not found", 404);
        }

        if (payload.openingBalance !== undefined && payload.openingBalance < 0) {
            throw new ApiError("Opening balance cannot be negative", 400);
        }

        return prisma.$transaction(async (tx) => {
            const group = payload.groupId || payload.groupCode || payload.category
                ? await this.resolveGroupForLedger(tx, {
                    groupId: payload.groupId,
                    groupCode: payload.groupCode,
                    category: payload.category || existing.category
                })
                : null;

            const updated = await tx.ledger.update({
                where: { id: ledgerId },
                data: {
                    name: payload.name?.trim(),
                    category: payload.category,
                    groupId: group?.id,
                    nature: group?.nature,
                    branchId: payload.branchId,
                    agencyId: payload.agencyId,
                    productId: payload.productId,
                    gstApplicable: payload.gstApplicable,
                    gstin: payload.gstin !== undefined ? payload.gstin?.trim().toUpperCase() || null : undefined,
                    pan: payload.pan !== undefined ? payload.pan?.trim().toUpperCase() || null : undefined,
                    openingBalance: payload.openingBalance !== undefined ? money(payload.openingBalance) : undefined,
                    creditLimit: payload.creditLimit,
                    isActive: payload.isActive
                },
                include: { group: true, branch: true, agency: true, product: true }
            });

            if (payload.openingBalance !== undefined || group) {
                await this.syncCachedBalance(tx, ledgerId);
            }

            return updated;
        });
    }

    static async getLedgers(
        actor: any,
        query?: {
            branchId?: string;
            view?: "BRANCH" | "AGENCY" | "SUSPENSE";
            category?: LedgerType;
            search?: string;
            isActive?: boolean;
            page?: number;
            limit?: number;
            startDate?: string;
            endDate?: string;
            export?: boolean;
        }
    ) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const page = query?.page || 1;
        const limit = query?.limit || 25;
        const skip = (page - 1) * limit;

        const startDate =
            query?.startDate
                ? parseDate(query.startDate, "startDate")
                : undefined;

        const endDate =
            query?.endDate
                ? parseDate(query.endDate, "endDate")
                : undefined;

        if (startDate) {
            startDate.setHours(0, 0, 0, 0);
        }

        if (endDate) {
            endDate.setHours(23, 59, 59, 999);
        }

        const branchId = actor.branchAccessType === "ALL" ? query?.branchId : actor.branchId;

        const andFilters: Prisma.LedgerWhereInput[] = [];

        if (branchId) {
            andFilters.push({ OR: [{ branchId }, { branchId: null }] });
        }

        if (query?.search) {
            andFilters.push({
                OR: [
                    { name: { contains: query.search, mode: "insensitive" } },
                    { code: { contains: query.search, mode: "insensitive" } },
                    { gstin: { contains: query.search, mode: "insensitive" } },
                    { pan: { contains: query.search, mode: "insensitive" } }
                ]
            });
        }

        let viewFilter: Prisma.LedgerWhereInput = {};

        if (query?.view === "BRANCH") {

            const branches =
                await prisma.branch.findMany({
                    where: {
                        ...(branchId && {
                            id: branchId
                        })
                    },

                    select: {
                        id: true,
                        code: true,
                        name: true,
                        gstin: true,
                        createdAt: true,
                        updatedAt: true,

                        _count: {
                            select: {
                                ledger: true
                            }
                        }
                    },

                    orderBy: {
                        name: "asc"
                    }
                });

            const branchRows = await Promise.all(
                branches.map(async branch => {

                    const ledgers =
                        await prisma.ledger.findMany({
                            where: {
                                branchId: branch.id
                            }
                        });

                    let openingBalance = 0;
                    let closingBalance = 0;
                    let totalDebit = 0;
                    let totalCredit = 0;

                    for (const ledger of ledgers) {

                        const balance =
                            await this.calculateLedgerBalance(
                                ledger.id
                            );

                        openingBalance +=
                            Number(ledger.openingBalance);

                        closingBalance +=
                            Math.abs(balance.closingBalance);

                        totalDebit +=
                            balance.totalDebit;

                        totalCredit +=
                            balance.totalCredit;
                    }

                    return {
                        id: branch.id,

                        code: branch.code,

                        name: branch.name,

                        gstin: branch.gstin,

                        ledgerCount:
                            branch._count.ledger,

                        openingBalance:
                            money(openingBalance),

                        totalDebit:
                            money(totalDebit),

                        totalCredit:
                            money(totalCredit),

                        closingBalance:
                            money(closingBalance),

                        createdAt:
                            branch.createdAt,

                        updatedAt:
                            branch.updatedAt
                    };
                })
            );

            return {
                data: branchRows
            };
        }

        if (query?.view === "AGENCY") {

            const agencies =
                await prisma.agency.findMany({

                    where: {
                        isActive: true,
                        ledger: {
                            some: {}
                        }
                    },

                    select: {
                        id: true,
                        name: true,
                        gstin: true,
                        createdAt: true,
                        updatedAt: true,

                        _count: {
                            select: {
                                ledger: true
                            }
                        }
                    },

                    orderBy: {
                        name: "asc"
                    }
                });

            const agencyRows = await Promise.all(
                agencies.map(async agency => {

                    const ledgers =
                        await prisma.ledger.findMany({
                            where: {
                                agencyId: agency.id
                            }
                        });

                    let openingBalance = 0;
                    let closingBalance = 0;
                    let totalDebit = 0;
                    let totalCredit = 0;

                    for (const ledger of ledgers) {

                        const balance =
                            await this.calculateLedgerBalance(
                                ledger.id
                            );

                        openingBalance +=
                            Number(ledger.openingBalance);

                        closingBalance +=
                            Math.abs(balance.closingBalance);

                        totalDebit +=
                            balance.totalDebit;

                        totalCredit +=
                            balance.totalCredit;
                    }

                    return {
                        id: agency.id,

                        name: agency.name,

                        gstin: agency.gstin,

                        ledgerCount:
                            agency._count.ledger,

                        openingBalance:
                            money(openingBalance),

                        totalDebit:
                            money(totalDebit),

                        totalCredit:
                            money(totalCredit),

                        closingBalance:
                            money(closingBalance),

                        createdAt:
                            agency.createdAt,

                        updatedAt:
                            agency.updatedAt
                    };
                })
            );

            return {
                data: agencyRows
            };
        }

        if (query?.view === "SUSPENSE") {

            const transactions =
                await prisma.transaction.findMany({
                    where: {
                        suspenseAccount: true,

                        ...(branchId && {
                            branchId
                        })
                    },

                    include: {
                        branch: true,
                        agency: true
                    },

                    orderBy: {
                        createdAt: "desc"
                    }
                });

            return {

                summary: {

                    totalTransactions:
                        transactions.length,

                    totalInward:
                        money(
                            transactions
                                .filter(
                                    x =>
                                        x.direction ===
                                        TransactionDirection.INWARD
                                )
                                .reduce(
                                    (sum, x) =>
                                        sum + Number(x.amount),
                                    0
                                )
                        ),

                    totalOutward:
                        money(
                            transactions
                                .filter(
                                    x =>
                                        x.direction ===
                                        TransactionDirection.OUTWARD
                                )
                                .reduce(
                                    (sum, x) =>
                                        sum + Number(x.amount),
                                    0
                                )
                        )
                },

                data: transactions.map(
                    transaction => ({
                        id: transaction.id,

                        transactionNo:
                            transaction.transactionNo,

                        branch:
                            transaction.branch,

                        agency:
                            transaction.agency,

                        direction:
                            transaction.direction,

                        amount:
                            money(
                                transaction.amount
                            ),

                        paymentMode:
                            transaction.paymentMode,

                        paymentType:
                            transaction.paymentType,

                        remarks:
                            transaction.remarks,

                        createdAt:
                            transaction.createdAt,

                        updatedAt:
                            transaction.updatedAt
                    })
                )
            };
        }

        const where: Prisma.LedgerWhereInput = {
            ...(andFilters.length > 0 && { AND: andFilters }),
            ...(viewFilter && viewFilter),
            ...(query?.category && { category: query.category }),
            ...(query?.isActive !== undefined && { isActive: query.isActive }),
            ...(startDate || endDate
                ? {
                    createdAt: {
                        ...(startDate && { gte: startDate }),
                        ...(endDate && { lte: endDate })
                    }
                }
                : {}
            ),
        };

        const [ledgers, total] = await Promise.all([
            prisma.ledger.findMany({
                where,
                include: { group: true, branch: true, agency: true, product: true },
                orderBy: [{ group: { code: "asc" } }, { name: "asc" }],
                ...(query?.export ? {} : { skip, take: limit })
            }),
            prisma.ledger.count({ where })
        ]);

        const rows = await Promise.all(
            ledgers.map(async ledger => {

                const balance =
                    await this.calculateLedgerBalance(
                        ledger.id
                    );

                return {
                    id: ledger.id,

                    code: ledger.code,

                    name: ledger.name,

                    category: ledger.category,

                    nature: ledger.nature,

                    group: {
                        code: ledger.group.code,
                        name: ledger.group.name
                    },

                    branch: ledger.branch
                        ? {
                            id: ledger.branch.id,
                            code: ledger.branch.code,
                            name: ledger.branch.name
                        }
                        : null,

                    agency: ledger.agency
                        ? {
                            id: ledger.agency.id,
                            name: ledger.agency.name
                        }
                        : null,

                    openingBalance:
                        money(ledger.openingBalance),

                    debit:
                        balance.totalDebit,

                    credit:
                        balance.totalCredit,

                    closingBalance:
                        Math.abs(balance.closingBalance),

                    balanceType:
                        balance.closingBalance >= 0
                            ? (
                                ledger.nature === LedgerNature.DEBIT
                                    ? "DR"
                                    : "CR"
                            )
                            : (
                                ledger.nature === LedgerNature.DEBIT
                                    ? "CR"
                                    : "DR"
                            ),

                    gstin: ledger.gstin,

                    pan: ledger.pan,

                    isActive: ledger.isActive,

                    createdAt: ledger.createdAt,
                    updatedAt: ledger.updatedAt,
                };
            })
        );

        return {
            data: rows,
            meta: {
                total,
                page,
                limit,
                totalPages: Math.ceil(total / limit),
                hasNextPage: page * limit < total,
                hasPreviousPage: page > 1
            }
        };
    }

    static async getLedgerById(
        actor: any,
        ledgerId: string
    ) {
        if (!actor?.id) {
            throw new ApiError(
                "Unauthorized",
                401
            );
        }

        const ledger =
            await prisma.ledger.findUnique({
                where: {
                    id: ledgerId
                },

                include: {
                    group: true,
                    branch: true,
                    agency: true,
                    createdBy: true
                }
            });

        if (!ledger) {
            throw new ApiError(
                "Ledger not found",
                404
            );
        }

        if (
            actor.branchAccessType !== "ALL" &&
            ledger.branchId &&
            ledger.branchId !== actor.branchId
        ) {
            throw new ApiError(
                "You do not have access to this ledger",
                403
            );
        }

        const [
            balance,
            voucherCount,
            outstanding
        ] = await Promise.all([

            this.calculateLedgerBalance(
                ledgerId
            ),

            prisma.ledgerEntry.count({
                where: {
                    ledgerId
                }
            }),

            ledger.agencyId && ledger.branchId
                ? await prisma.agencyOutstanding.findUnique({
                    where: {
                        agencyId_branchId: {
                            agencyId: ledger.agencyId,
                            branchId: ledger.branchId
                        }
                    }
                })
                : Promise.resolve(null)
        ]);

        let agencies: { id: string; name: string }[] = [];

        if (
            ledger.category === LedgerType.SALES ||
            ledger.category === LedgerType.PURCHASE
        ) {
            const voucherEntries =
                await prisma.ledgerEntry.findMany({
                    where: {
                        ledgerId
                    },
                    select: {
                        voucher: {
                            select: {
                                sourceId: true
                            }
                        }
                    }
                });

            const sourceIds =
                voucherEntries
                    .map(x => x.voucher.sourceId)
                    .filter(Boolean);

            if (ledger.category === LedgerType.SALES) {

                const sales =
                    await prisma.sale.findMany({
                        where: {
                            id: {
                                in: sourceIds
                            }
                        },
                        select: {
                            agency: {
                                select: {
                                    id: true,
                                    name: true
                                }
                            }
                        }
                    });

                agencies =
                    sales.map(x => x.agency);
            }

            if (ledger.category === LedgerType.PURCHASE) {

                const purchases =
                    await prisma.purchase.findMany({
                        where: {
                            id: {
                                in: sourceIds
                            }
                        },
                        select: {
                            agency: {
                                select: {
                                    id: true,
                                    name: true
                                }
                            }
                        }
                    });

                agencies =
                    purchases.map(x => x.agency);
            }
        }

        const ledgerData: any = {
            id: ledger.id,
            code: ledger.code,
            name: ledger.name,
            category: ledger.category,
            nature: ledger.nature,

            gstApplicable: ledger.gstApplicable,
            gstin: ledger.gstin,
            pan: ledger.pan,

            creditLimit: ledger.creditLimit
                ? money(ledger.creditLimit)
                : null,

            group: {
                id: ledger.group.id,
                code: ledger.group.code,
                name: ledger.group.name
            },

            branch: ledger.branch,

            isActive: ledger.isActive,

            createdBy: ledger.createdBy
        };

        if (ledger.agency) {
            ledgerData.agency = ledger.agency;
        }

        if (agencies.length > 0) {
            ledgerData.agencies = agencies;
        }

        return {

            ledger: ledgerData,

            balances: {

                openingBalance:
                    money(
                        ledger.openingBalance
                    ),
                
                currentBalance:
                    money(
                        ledger.currentBalance
                    ),

                debit:
                    balance.totalDebit,

                credit:
                    balance.totalCredit,

                closingBalance:
                    Math.abs(
                        balance.closingBalance
                    ),

                balanceType:
                    balance.closingBalance >= 0
                        ? (
                            ledger.nature === LedgerNature.DEBIT
                                ? "DR"
                                : "CR"
                        )
                        : (
                            ledger.nature === LedgerNature.DEBIT
                                ? "CR"
                                : "DR"
                        )
            },

            outstanding:
                ledger.category === LedgerType.CUSTOMER ||
                ledger.category === LedgerType.VENDOR
                    ? {
                        amount: Math.abs(balance.closingBalance),

                        type:
                            ledger.category === LedgerType.CUSTOMER
                                ? "RECEIVABLE"
                                : "PAYABLE"
                    }
                    : null,

            statistics: {

                voucherCount
            }
        };
    }

    static async getLedgerByBranchId(
        actor: any,
        branchId: string,
        category?:
            | "ACCOUNTING_LEDGER"
            | "CASH"
            | "GST"
            | "DEBTORS"
            | "CREDITORS"
    ) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if (
            actor.branchAccessType !== "ALL" &&
            actor.branchId !== branchId
        ) {
            throw new ApiError(
                "You do not have access to this branch",
                403
            );
        }

        const branch =
            await prisma.branch.findUnique({
                where: {
                    id: branchId
                }
            });

        if (!branch) {
            throw new ApiError(
                "Branch not found",
                404
            );
        }

        const ledgers =
            await prisma.ledger.findMany({
                where: {
                    branchId
                },

                include: {
                    group: true,
                    branch: true,
                    agency: true
                },

                orderBy: {
                    name: "asc"
                }
            });

        const ledgerRows =
            await Promise.all(
                ledgers.map(async ledger => {

                    const balance =
                        await this.calculateLedgerBalance(
                            ledger.id
                        );

                    return {
                        id: ledger.id,
                        code: ledger.code,
                        name: ledger.name,
                        category: ledger.category,
                        nature: ledger.nature,

                        group: {
                            code: ledger.group.code,
                            name: ledger.group.name
                        },

                        branch: ledger.branch
                            ? {
                                id: ledger.branch.id,
                                code: ledger.branch.code,
                                name: ledger.branch.name
                            }
                            : null,

                        agency: ledger.agency
                            ? {
                                id: ledger.agency.id,
                                name: ledger.agency.name
                            }
                            : null,

                        openingBalance:
                            money(ledger.openingBalance),

                        debit:
                            balance.totalDebit,

                        credit:
                            balance.totalCredit,

                        closingBalance:
                            Math.abs(balance.closingBalance),

                        balanceType:
                            resolveBalanceType(
                                balance.closingBalance,
                                ledger.nature
                            ),

                        gstin: ledger.gstin,
                        pan: ledger.pan,

                        isActive:
                            ledger.isActive,

                        createdAt:
                            ledger.createdAt,

                        updatedAt:
                            ledger.updatedAt
                    };
                })
            );

        const inward =
            await prisma.transaction.aggregate({
                where: {
                    branchId,
                    direction: TransactionDirection.INWARD
                },
                _sum: {
                    amount: true
                }
            });

        const outward =
            await prisma.transaction.aggregate({
                where: {
                    branchId,
                    direction: TransactionDirection.OUTWARD
                },
                _sum: {
                    amount: true
                }
            });

        switch (category) {

            case "ACCOUNTING_LEDGER":

                const transactions =
                    await prisma.transaction.findMany({
                        where: {
                            branchId
                        },
                        orderBy: {
                            createdAt: "desc"
                        }
                    });

                return {
                    branch: {
                        id: branch.id,
                        code: branch.code,
                        name: branch.name
                    },

                    category: "ACCOUNTING_LEDGER",

                    summary: {
                        totalTransactions:
                            transactions.length,

                        inward:
                            money(inward._sum.amount ?? 0),

                        outward:
                            money(outward._sum.amount ?? 0),

                        netMovement:
                            money(
                                Number(inward._sum.amount ?? 0) -
                                Number(outward._sum.amount ?? 0)
                            )
                    },

                    ledgers:
                        transactions.map(t => ({
                            id: t.id,

                            transactionNo: t.transactionNo,

                            direction: t.direction,

                            amount: money(t.amount),

                            narration: t.remarks,

                            createdAt: t.createdAt
                        }))
                };

            case "CASH":

                const cashLedgers =
                    ledgerRows.filter(
                        x =>
                            x.category === LedgerType.CASH ||
                            x.category === LedgerType.BANK
                    );

                return {
                    branch: {
                        id: branch.id,
                        code: branch.code,
                        name: branch.name
                    },

                    category: "CASH",
                    summary: {
                        totalLedgers:
                            cashLedgers.length,

                        totalDebit:
                            money(
                                cashLedgers.reduce(
                                    (sum, x) => sum + x.debit,
                                    0
                                )
                            ),

                        totalCredit:
                            money(
                                cashLedgers.reduce(
                                    (sum, x) => sum + x.credit,
                                    0
                                )
                            ),

                        totalBalance:
                            money(
                                cashLedgers.reduce(
                                    (sum, x) => sum + x.closingBalance,
                                    0
                                )
                            ),

                        createdAt: 
                            cashLedgers.length 
                                ? cashLedgers.reduce(
                                    (a, b) => a.createdAt < b.createdAt ? a : b
                                ).createdAt
                            : null,
                    },

                    ledgers:
                        cashLedgers
                };

                case "GST":

                    const gstLedgers =
                        ledgerRows.filter(
                            x =>
                                x.category === LedgerType.GST
                        );

                    return {
                        branch: {
                            id: branch.id,
                            code: branch.code,
                            name: branch.name
                        },

                        category: "GST",

                        summary: {
                            totalGSTLedgers:
                                gstLedgers.length,

                            totalDebit:
                                money(
                                    gstLedgers.reduce(
                                        (sum, x) => sum + x.debit,
                                        0
                                    )
                                ),

                            totalCredit:
                                money(
                                    gstLedgers.reduce(
                                        (sum, x) => sum + x.credit,
                                        0
                                    )
                                ),

                            totalBalance:
                                money(
                                    gstLedgers.reduce(
                                        (sum, x) => sum + x.closingBalance,
                                        0
                                    )
                                ),

                            createdAt:
                                gstLedgers.length
                                    ? gstLedgers.reduce(
                                        (a, b) =>
                                            a.createdAt < b.createdAt
                                                ? a
                                                : b
                                    ).createdAt
                                    : null,

                            updatedAt:
                                gstLedgers.length
                                    ? gstLedgers.reduce(
                                        (a, b) =>
                                            a.updatedAt > b.updatedAt
                                                ? a
                                                : b
                                    ).updatedAt
                                    : null
                        },

                        ledgers: gstLedgers
                    };

            case "DEBTORS":

                const debtors =
                    ledgerRows.filter(
                        x =>
                            x.category === LedgerType.CUSTOMER
                    );

                return {
                    branch: {
                        id: branch.id,
                        code: branch.code,
                        name: branch.name
                    },

                    category: "DEBTORS",

                    summary: {
                        totalDebtors:
                            debtors.length,

                        totalReceivable:
                            money(
                                debtors.reduce(
                                    (sum, x) => sum + x.closingBalance,
                                    0
                                )
                            ),

                        createdAt: 
                            debtors.length 
                                ? debtors.reduce(
                                    (a, b) => a.createdAt < b.createdAt ? a : b
                                ).createdAt
                            : null,
                    },

                    ledgers:
                        debtors
                };

            case "CREDITORS":

                const creditors =
                    ledgerRows.filter(
                        x =>
                            x.category === LedgerType.VENDOR
                    );

                return {
                    branch: {
                        id: branch.id,
                        code: branch.code,
                        name: branch.name
                    },

                    category: "CREDITORS",

                    summary: {
                        totalCreditors:
                            creditors.length,

                        totalPayable:
                            money(
                                creditors.reduce(
                                    (sum, x) => sum + x.closingBalance,
                                    0
                                )
                            ),

                        createdAt: 
                            creditors.length 
                                ? creditors.reduce(
                                    (a, b) => a.createdAt < b.createdAt ? a : b
                                ).createdAt
                            : null,
                    },

                    ledgers:
                        creditors
                };

            default:

                return {
                    branch: {
                        id: branch.id,
                        code: branch.code,
                        name: branch.name
                    },

                    summary: {
                        totalLedgers:
                            ledgerRows.length,

                        totalDebit:
                            money(
                                ledgerRows.reduce(
                                    (sum, x) => sum + x.debit,
                                    0
                                )
                            ),

                        totalCredit:
                            money(
                                ledgerRows.reduce(
                                    (sum, x) => sum + x.credit,
                                    0
                                )
                            )
                    },

                    ledgers:
                        ledgerRows
                };
        }
    }

    static async getLedgerByAgencyId(
        actor: any,
        agencyId: string,
        category?: 
            | "ACCOUNTING_LEDGER"
            | "CASH"
            | "DEBTORS"
            | "CREDITORS"
    ) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const agency =
            await prisma.agency.findUnique({
                where: {
                    id: agencyId
                }
            });

        if (!agency) {
            throw new ApiError("Agency not found", 404);
        }

        const ledgers = await prisma.ledger.findMany({
            where: {
                agencyId
            },

            include: {
                group: true,
                branch: true,
                agency: true
            },

            orderBy: {
                name: "asc"
            }
        });

        const ledgerRows =
            await Promise.all(
                ledgers.map(async ledger => {

                    const balance =
                        await this.calculateLedgerBalance(
                            ledger.id
                        );

                    return {
                        id: ledger.id,
                        code: ledger.code,
                        name: ledger.name,
                        category: ledger.category,
                        nature: ledger.nature,

                        group: {
                            code: ledger.group.code,
                            name: ledger.group.name
                        },

                        branch: ledger.branch
                            ? ledger.branch
                            : null,

                        agency: ledger.agency!,

                        openingBalance:
                            money(ledger.openingBalance),

                        debit:
                            balance.totalDebit,

                        credit:
                            balance.totalCredit,

                        closingBalance:
                            Math.abs(balance.closingBalance),

                        balanceType:
                            resolveBalanceType(
                                balance.closingBalance,
                                ledger.nature
                            ),

                        gstin: ledger.gstin,

                        isActive:
                            ledger.isActive,

                        createdAt:
                            ledger.createdAt,

                        updatedAt:
                            ledger.updatedAt
                    };
                })
            );

        switch (category) {
            case "ACCOUNTING_LEDGER":
                const transactions =
                    await prisma.transaction.findMany({
                        where: {
                            agencyId
                        },

                        orderBy: {
                            createdAt: "desc"
                        }
                    });

                return {
                    agency,

                    category: "ACCOUNTING_LEDGER",

                    summary: {
                        totalTransactions:
                            transactions.length,

                        inward:
                            money(
                                transactions
                                    .filter(x => x.direction === TransactionDirection.INWARD)
                                    .reduce((s, x) => s + Number(x.amount), 0)
                            ),

                        outward:
                            money(
                                transactions
                                    .filter(x => x.direction === TransactionDirection.OUTWARD)
                                    .reduce((s, x) => s + Number(x.amount), 0)
                            )
                    },

                    ledgers:
                        transactions
                };

            case "CASH":
                const cashLedgers =
                    ledgerRows.filter(
                        x =>
                            x.category === LedgerType.CASH ||
                            x.category === LedgerType.BANK
                    );

                return {
                    agency,

                    category: "CASH",

                    summary: {
                        totalLedgers:
                            cashLedgers.length,

                        totalBalance:
                            money(
                                cashLedgers.reduce(
                                    (sum, x) =>
                                        sum + x.closingBalance,
                                    0
                                )
                            )
                    },

                    ledgers:
                        cashLedgers
                };

            case "DEBTORS":
                const debtors =
                    ledgerRows.filter(
                        x =>
                            x.category === LedgerType.CUSTOMER
                    );

                return {
                    agency,

                    category: "DEBTORS",

                    summary: {
                        totalDebtors:
                            debtors.length,

                        totalReceivable:
                            money(
                                debtors.reduce(
                                    (sum, x) => sum + x.closingBalance,
                                    0
                                )
                            )
                    },

                    ledgers:
                        debtors
                };

            case "CREDITORS":
                const creditors =
                    ledgerRows.filter(
                        x =>
                            x.category === LedgerType.VENDOR
                    );

                return {
                    agency,

                    category: "CREDITORS",

                    summary: {
                        totalCreditors:
                            creditors.length,

                        totalPayable:
                            money(
                                creditors.reduce(
                                    (sum, x) => sum + x.closingBalance,
                                    0
                                )
                            )
                    },

                    ledgers:
                        creditors
                };

            default:
                return {
                    agency,

                    summary: {
                        totalLedgers:
                            ledgerRows.length,

                        totalBalance:
                            money(
                                ledgerRows.reduce(
                                    (sum, x) => sum + x.closingBalance,
                                    0
                                )
                            )
                    },

                    ledgers:
                        ledgerRows
                };
        }
    }

    static async getLedgerBySuspenseId(
        actor: any,
        branchId: string,
        category?: "ACCOUNTING_LEDGER" | "CASH"
    ) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if (
            actor.branchAccessType !== "ALL" &&
            actor.branchId !== branchId
        ) {
            throw new ApiError(
                "You do not have access to this branch",
                403
            );
        }

        const branch =
            await prisma.branch.findUnique({
                where: {
                    id: branchId
                }
            });

        if (!branch) {
            throw new ApiError(
                "Branch not found",
                404
            );
        }

        const transactions =
            await prisma.transaction.findMany({
                where: {
                    branchId,
                    suspenseAccount: true
                },

                include: {
                    agency: true,
                    thirdPartyAgency: true
                },

                orderBy: {
                    createdAt: "desc"
                }
            });

        const transactionRows =
            transactions.map(transaction => ({

                id:
                    transaction.id,

                transactionNo:
                    transaction.transactionNo,

                direction:
                    transaction.direction,

                amount:
                    money(transaction.amount),

                paymentMode:
                    transaction.paymentMode,

                paymentType:
                    transaction.paymentType,

                paymentThrough:
                    transaction.paymentThrough,

                transactionRefNo:
                    transaction.transactionRefNo,

                referenceNo:
                    transaction.referenceNo,

                agency:
                    transaction.agency
                        ? {
                            id: transaction.agency.id,
                            name: transaction.agency.name,
                            gstin: transaction.agency.gstin
                        }
                        : null,

                thirdPartyAgency:
                    transaction.thirdPartyAgency
                        ? {
                            id: transaction.thirdPartyAgency.id,
                            name: transaction.thirdPartyAgency.name,
                            gstin: transaction.thirdPartyAgency.gstin
                        }
                        : null,

                remarks:
                    transaction.remarks,

                createdAt:
                    transaction.createdAt,

                updatedAt:
                    transaction.updatedAt
            }));


        switch (category) {

            case "ACCOUNTING_LEDGER": {

                const inward =
                    transactions
                        .filter(
                            x =>
                                x.direction ===
                                TransactionDirection.INWARD
                        )
                        .reduce(
                            (sum, x) =>
                                sum + Number(x.amount),
                            0
                        );

                const outward =
                    transactions
                        .filter(
                            x =>
                                x.direction ===
                                TransactionDirection.OUTWARD
                        )
                        .reduce(
                            (sum, x) =>
                                sum + Number(x.amount),
                            0
                        );

                return {

                    branch: {
                        id: branch.id,
                        code: branch.code,
                        name: branch.name,
                        gstin: branch.gstin
                    },

                    category: "ACCOUNTING_LEDGER",

                    summary: {

                        totalTransactions:
                            transactions.length,

                        totalInward:
                            money(inward),

                        totalOutward:
                            money(outward),

                        closingBalance:
                            money(inward - outward)
                    },

                    transactions:
                        transactionRows
                };
            }

            case "CASH": {

                const cashTransactions =
                    transactions.filter(
                        x =>
                            x.paymentThrough ===
                            PaymentType.CASH
                    );

                const cashInward =
                    cashTransactions
                        .filter(
                            x =>
                                x.direction ===
                                TransactionDirection.INWARD
                        )
                        .reduce(
                            (sum, x) =>
                                sum + Number(x.amount),
                            0
                        );

                const cashOutward =
                    cashTransactions
                        .filter(
                            x =>
                                x.direction ===
                                TransactionDirection.OUTWARD
                        )
                        .reduce(
                            (sum, x) =>
                                sum + Number(x.amount),
                            0
                        );

                return {

                    branch: {
                        id: branch.id,
                        code: branch.code,
                        name: branch.name,
                        gstin: branch.gstin
                    },

                    category: "CASH",

                    summary: {

                        totalTransactions:
                            cashTransactions.length,

                        totalInward:
                            money(cashInward),

                        totalOutward:
                            money(cashOutward),

                        closingBalance:
                            money(
                                cashInward -
                                cashOutward
                            )
                    },

                    transactions:
                        transactionRows.filter(
                            x =>
                                x.paymentThrough ===
                                PaymentType.CASH
                        )
                };
            }

            default:

                return {

                    branch: {
                        id: branch.id,
                        code: branch.code,
                        name: branch.name,
                        gstin: branch.gstin
                    },

                    categories: [

                        {
                            category:
                                "ACCOUNTING_LEDGER",

                            totalTransactions:
                                transactions.length
                        },

                        {
                            category:
                                "CASH",

                            totalTransactions:
                                transactions.filter(
                                    x =>
                                        x.paymentThrough ===
                                        PaymentType.CASH
                                ).length
                        }
                    ]
                };
        }
    }

    static async calculateLedgerBalance( //✅
        ledgerId: string,
        client: DbClient = prisma,
        dateFilter?: { startDate?: Date; endDate?: Date }
    ) {
        const ledger = await client.ledger.findUnique({
            where: { id: ledgerId },
            include: { group: true }
        });

        if (!ledger) {
            throw new ApiError("Ledger not found", 404);
        }

        const where: Prisma.LedgerEntryWhereInput = {
            ledgerId,
            ...(dateFilter?.startDate || dateFilter?.endDate
                ? {
                    voucher: {
                        voucherDate: {
                            ...(dateFilter?.startDate && { gte: dateFilter.startDate }),
                            ...(dateFilter?.endDate && { lte: dateFilter.endDate })
                        }
                    }
                }
                : {})
        };

        const aggregates = await client.ledgerEntry.groupBy({
            by: ["entryType"],
            where,
            _sum: { amount: true }
        });

        const debitAgg = aggregates.find((row) => row.entryType === EntryType.DEBIT);
        const creditAgg = aggregates.find((row) => row.entryType === EntryType.CREDIT);

        const debit = money(debitAgg?._sum?.amount || 0);
        const credit = money(creditAgg?._sum?.amount || 0);
        const opening = money(ledger.openingBalance);
        const closing = ledger.nature === LedgerNature.CREDIT
            ? money(opening + credit - debit)
            : money(opening + debit - credit);

        const debitBalance = ledger.nature === LedgerNature.DEBIT
            ? Math.max(closing, 0)
            : Math.max(-closing, 0);

        const creditBalance = ledger.nature === LedgerNature.CREDIT
            ? Math.max(closing, 0)
            : Math.max(-closing, 0);

        return {
            openingBalance: opening,
            totalDebit: debit,
            totalCredit: credit,
            closingBalance: closing,
            debitBalance: money(debitBalance),
            creditBalance: money(creditBalance)
        };
    }

    static async createVoucher( //✅
        payload: CreateVoucherPayload,
        txClient?: Prisma.TransactionClient
    ) {
        const execute = async (tx: Prisma.TransactionClient) => {
            if (!payload.entries || payload.entries.length < 2) {
                throw new ApiError("A voucher must contain at least two ledger entries", 400);
            }

            const lines = payload.entries.filter((entry) => money(entry.amount) > 0);
            const totalDebit = money(lines
                .filter((entry) => entry.entryType === EntryType.DEBIT)
                .reduce((sum, entry) => sum + money(entry.amount), 0));
            const totalCredit = money(lines
                .filter((entry) => entry.entryType === EntryType.CREDIT)
                .reduce((sum, entry) => sum + money(entry.amount), 0));

            if (lines.length < 2 || totalDebit <= 0 || totalCredit <= 0 || totalDebit !== totalCredit) {
                throw new ApiError(`Double entry validation failed. Debit ${totalDebit}, Credit ${totalCredit}`, 400);
            }

            const sourceId = payload.sourceId || randomUUID();

            const existingBySource = await tx.voucher.findFirst({
                where: {
                    voucherType: payload.voucherType,
                    sourceId
                },
                include: { entries: true }
            });

            if (existingBySource) {
                return existingBySource;
            }

            const voucherNo = payload.voucherNo || this.generateVoucherNo(payload.voucherType, sourceId);
            const existingVoucherNo = await tx.voucher.findUnique({
                where: { voucherNo }
            });

            if (existingVoucherNo) {
                throw new ApiError("Voucher number already exists", 409);
            }

            let voucher;
            try {
                voucher = await tx.voucher.create({
                    data: {
                        voucherNo,
                        voucherType: payload.voucherType,
                        sourceId,
                        branchId: payload.branchId || null,
                        narration: payload.narration,
                        totalDebit,
                        totalCredit,
                        voucherDate: payload.voucherDate || new Date(),
                        entries: {
                            create: lines.map((entry) => ({
                                ledgerId: entry.ledgerId,
                                branchId: entry.branchId || payload.branchId || null,
                                productId: entry.productId || null,
                                entryType: entry.entryType,
                                amount: money(entry.amount),
                                narration: entry.narration || payload.narration
                            }))
                        }
                    },
                    include: { entries: true }
                });
            } catch {
                const raced = await tx.voucher.findFirst({
                    where: {
                        voucherType: payload.voucherType,
                        sourceId
                    },
                    include: { entries: true }
                });

                if (raced) {
                    return raced;
                }

                throw new ApiError("Unable to create accounting voucher", 500);
            }

            const ledgerIds = [...new Set(lines.map((entry) => entry.ledgerId))];
            for (const ledgerId of ledgerIds) {
                await this.syncCachedBalance(tx, ledgerId);
            }

            return voucher;
        };

        return txClient ? execute(txClient) : prisma.$transaction(execute);
    }

    static async getLedgerStatement(
        actor: any,
        ledgerId: string,
        query?: {
            startDate?: string;
            endDate?: string;
            page?: number;
            limit?: number;
        }
    ) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const page = query?.page || 1;
        const limit = query?.limit || 50;
        const skip = (page - 1) * limit;

        const startDate = query?.startDate
            ? parseDate(query.startDate, "startDate")
            : undefined;

        const endDate = query?.endDate
            ? parseDate(query.endDate, "endDate")
            : new Date();

        endDate.setHours(23, 59, 59, 999);

        const ledger = await prisma.ledger.findUnique({
            where: { id: ledgerId },
            include: {
                group: true,
                branch: true,
                agency: true
            }
        });

        if (!ledger) {
            throw new ApiError("Ledger not found", 404);
        }

        if (
            actor.branchAccessType !== "ALL" &&
            ledger.branchId &&
            ledger.branchId !== actor.branchId
        ) {
            throw new ApiError(
                "You do not have access to this ledger",
                403
            );
        }

        const periodWhere: Prisma.LedgerEntryWhereInput = {
            ledgerId,
            ...(startDate || endDate
                ? {
                    voucher: {
                        voucherDate: {
                            ...(startDate && { gte: startDate }),
                            ...(endDate && { lte: endDate })
                        }
                    }
                }
                : {})
        };

        const priorWhere: Prisma.LedgerEntryWhereInput = {
            ledgerId,
            ...(startDate
                ? {
                    voucher: {
                        voucherDate: {
                            lt: startDate
                        }
                    }
                }
                : {
                    id: "__never__"
                })
        };

        const [
            entries,
            total,
            periodAggregates,
            priorAggregates,
            outstanding
        ] = await Promise.all([
            prisma.ledgerEntry.findMany({
                where: periodWhere,

                include: {
                    branch: true,
                    product: true,

                    voucher: {
                        include: {
                            entries: {
                                include: {
                                    ledger: true
                                }
                            }
                        }
                    }
                },

                orderBy: [
                    {
                        voucher: {
                            voucherDate: "asc"
                        }
                    },
                    {
                        createdAt: "asc"
                    }
                ],

                skip,
                take: limit
            }),

            prisma.ledgerEntry.count({
                where: periodWhere
            }),

            prisma.ledgerEntry.groupBy({
                by: ["entryType"],
                where: periodWhere,
                _sum: {
                    amount: true
                }
            }),

            startDate
                ? prisma.ledgerEntry.groupBy({
                    by: ["entryType"],
                    where: priorWhere,
                    _sum: {
                        amount: true
                    }
                })
                : Promise.resolve([]),

            ledger.agency?.id && ledger.branch?.id
                ? prisma.agencyOutstanding.findUnique({
                    where: {
                        agencyId_branchId: {
                            agencyId: ledger.agency.id,
                            branchId: ledger.branch.id
                        }
                    }
                })
                : Promise.resolve(null)
        ]);



        const priorDebit =
            money(
                priorAggregates.find(
                    x => x.entryType === EntryType.DEBIT
                )?._sum?.amount || 0
            );

        const priorCredit =
            money(
                priorAggregates.find(
                    x => x.entryType === EntryType.CREDIT
                )?._sum?.amount || 0
            );

        const periodDebit =
            money(
                periodAggregates.find(
                    x => x.entryType === EntryType.DEBIT
                )?._sum?.amount || 0
            );

        const periodCredit =
            money(
                periodAggregates.find(
                    x => x.entryType === EntryType.CREDIT
                )?._sum?.amount || 0
            );

        const baseOpening =
            money(ledger.openingBalance);

        const periodOpening =
            ledger.nature === LedgerNature.CREDIT
                ? money(
                    baseOpening +
                    priorCredit -
                    priorDebit
                )
                : money(
                    baseOpening +
                    priorDebit -
                    priorCredit
                );

        let runningBalance = periodOpening;

        const statementRows: any[] = [];

        if (startDate) {
            statementRows.push({
                type: "OPENING",
                date: startDate,
                voucherNo: null,
                voucherType: null,
                narration: "Opening Balance",

                debit: 0,
                credit: 0,

                runningBalance:
                    Math.abs(periodOpening),

                balanceType:
                    resolveBalanceType(
                        periodOpening,
                        ledger.nature
                    )
            });
        }
                
        statementRows.push(...entries.map(entry => {

            const debit =
                entry.entryType === EntryType.DEBIT
                    ? money(entry.amount)
                    : 0;

            const credit =
                entry.entryType === EntryType.CREDIT
                    ? money(entry.amount)
                    : 0;

            runningBalance =
                ledger.nature === LedgerNature.DEBIT
                    ? money(
                        runningBalance +
                        debit -
                        credit
                    )
                    : money(
                        runningBalance +
                        credit -
                        debit
                    );

            const counterLedgers =
                entry.voucher.entries
                    .filter(x => x.ledgerId !== ledgerId)
                    .map(x => ({
                        id: x.ledger.id,
                        code: x.ledger.code,
                        name: x.ledger.name
                    }));

            const invoiceNo =
                entry.narration
                    ?.match(/Invoice:([^ ]+)/)?.[1]
                || null;

            return {
                id: entry.id,

                date:
                    entry.voucher.voucherDate,

                voucherId:
                    entry.voucher.id,

                voucherNo:
                    entry.voucher.voucherNo,

                voucherType:
                    entry.voucher.voucherType,

                invoiceNo,

                sourceId:
                    entry.voucher.sourceId,

                branch: entry.branch
                    ? {
                        id: entry.branch.id,
                        name: entry.branch.name,
                        code: entry.branch.code
                    }
                    : null,

                counterLedgers,

                debit,
                credit,

                runningBalance:
                    Math.abs(runningBalance),

                balanceType:
                    resolveBalanceType(
                        runningBalance,
                        ledger.nature
                    ),

                narration:
                    entry.narration ||
                    entry.voucher.narration,

                sourceDocument: {
                    sourceId:
                        entry.voucher.sourceId,

                    voucherType:
                        entry.voucher.voucherType,

                    voucherNo:
                        entry.voucher.voucherNo
                }
            };
            })
        );

        const periodClosing =
            runningBalance;

        return {
            ledger: {
                id: ledger.id,
                code: ledger.code,
                name: ledger.name,

                category: ledger.category,

                nature: ledger.nature,

                group: {
                    id: ledger.group.id,
                    code: ledger.group.code,
                    name: ledger.group.name
                },

                branch: ledger.branch,
                agency: ledger.agency
            },

            summary: {
                openingBalance:
                    Math.abs(periodOpening),

                openingBalanceType:
                    periodOpening >= 0
                        ? (
                            ledger.nature === LedgerNature.DEBIT
                                ? "DR"
                                : "CR"
                        )
                        : (
                            ledger.nature === LedgerNature.DEBIT
                                ? "CR"
                                : "DR"
                        ),

                totalDebit:
                    periodDebit,

                totalCredit:
                    periodCredit,

                closingBalance:
                    Math.abs(periodClosing),

                closingBalanceType:
                    periodClosing >= 0
                        ? (
                            ledger.nature === LedgerNature.DEBIT
                                ? "DR"
                                : "CR"
                        )
                        : (
                            ledger.nature === LedgerNature.DEBIT
                                ? "CR"
                                : "DR"
                        ),
            },
            outstanding:
                outstanding
                    ? {
                        receivable: money(outstanding.amountReceivable),
                        payable: money(outstanding.amountPayable)
                    }
                    : null,

            entries: statementRows,

            meta: {
                total,
                page,
                limit,

                totalPages:
                    Math.ceil(total / limit),

                hasNextPage:
                    page * limit < total,

                hasPreviousPage:
                    page > 1
            }
        };
    }

    private static async getGroupCodesWithChildren(code: string): Promise<string[]> {
        const group = await prisma.ledgerGroup.findUnique({
            where: { code },
            include: { children: true }
        });

        if (!group) {
            throw new ApiError("Ledger group not found", 404);
        }

        const codes = [group.code];
        for (const child of group.children) {
            codes.push(...await this.getGroupCodesWithChildren(child.code));
        }

        return [...new Set(codes)];
    }

    static async getTrialBalance(
        actor: any,
        query?: {
            branchId?: string;
            groupCode?: string;
            includeZero?: boolean;
        }
    ) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const branchId = actor.branchAccessType === "ALL" ? query?.branchId : actor.branchId;
        const groupCodes = query?.groupCode ? await this.getGroupCodesWithChildren(query.groupCode) : undefined;

        const ledgers = await prisma.ledger.findMany({
            where: {
                isActive: true,
                ...(branchId && { OR: [{ branchId }, { branchId: null }] }),
                ...(groupCodes && { group: { is: { code: { in: groupCodes } } } })
            },
            include: { group: { include: { parent: true } }, branch: true, agency: true },
            orderBy: [{ group: { code: "asc" } }, { name: "asc" }]
        });

        const rows = [];
        for (const ledger of ledgers) {
            const balance = await this.calculateLedgerBalance(ledger.id);

            if (!query?.includeZero && balance.closingBalance === 0) {
                continue;
            }

            rows.push({
                ledgerId: ledger.id,
                code: ledger.code,
                name: ledger.name,
                category: ledger.category,
                group: ledger.group,
                nature: ledger.nature,
                branch: ledger.branch,
                agency: ledger.agency,
                openingBalance: balance.openingBalance,
                debit: balance.totalDebit,
                credit: balance.totalCredit,
                closingBalance: balance.closingBalance,
                debitBalance: balance.debitBalance,
                creditBalance: balance.creditBalance,
                cachedCurrentBalance: money(ledger.currentBalance)
            });
        }

        const totalDebit = money(rows.reduce((sum, row) => sum + row.debitBalance, 0));
        const totalCredit = money(rows.reduce((sum, row) => sum + row.creditBalance, 0));

        return {
            branchId: branchId || null,
            totals: {
                debit: totalDebit,
                credit: totalCredit,
                difference: money(totalDebit - totalCredit)
            },
            rows
        };
    }

    static async setOpeningBalance(actor: any, ledgerId: string, openingBalance: number) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        if (openingBalance < 0) {
            throw new ApiError("Opening balance cannot be negative", 400);
        }

        const ledger = await prisma.ledger.findUnique({
            where: { id: ledgerId }
        });

        if (!ledger) {
            throw new ApiError("Ledger not found", 404);
        }

        if (actor.branchAccessType !== "ALL" && ledger.branchId && ledger.branchId !== actor.branchId) {
            throw new ApiError("You do not have access to this ledger", 403);
        }

        return prisma.$transaction(async (tx) => {
            await tx.ledger.update({
                where: { id: ledgerId },
                data: {
                    openingBalance: money(openingBalance)
                }
            });

            await this.syncCachedBalance(tx, ledgerId);

            return tx.ledger.findUnique({
                where: { id: ledgerId },
                include: { group: true, branch: true, agency: true }
            });
        });
    }

    private static gstSplit(
        totalGST: number,
        branchStateCode?: string | null,
        agencyStateCode?: string | null
    ): Array<{ taxKind: TaxKind; amount: number }> {
        const amount = money(totalGST);
        if (amount <= 0) {
            return [];
        }

        const sameState = branchStateCode && agencyStateCode && branchStateCode === agencyStateCode;
        if (!sameState) {
            return [{ taxKind: "IGST", amount }];
        }

        const cgst = money(amount / 2);
        return [
            { taxKind: "CGST", amount: cgst },
            { taxKind: "SGST", amount: money(amount - cgst) }
        ];
    }

    private static async getCashLedger(client: DbClient, branchId: string) {
        const branchCode = await this.getBranchCode(client, branchId);

        return this.getOrCreateLedger(client, {
            code: `CASH-${branchCode}`,
            name: `Cash-in-Hand - ${branchCode}`,
            category: LedgerType.CASH,
            groupCode: "CASH_IN_HAND",
            nature: LedgerNature.DEBIT,
            branchId
        });
    }

    private static async getBankLedger(client: DbClient, branchId: string) {
        const branchCode = await this.getBranchCode(client, branchId);

        return this.getOrCreateLedger(client, {
            code: `BANK-${branchCode}`,
            name: `Bank Accounts - ${branchCode}`,
            category: LedgerType.BANK,
            groupCode: "BANK_ACCOUNTS",
            nature: LedgerNature.DEBIT,
            branchId
        });
    }

    private static async getPaymentLedger(
        client: DbClient,
        branchId: string,
        paymentThrough?: PaymentType | null
    ) {
        return paymentThrough === PaymentType.CASH
            ? this.getCashLedger(client, branchId)
            : this.getBankLedger(client, branchId);
    }

    static async getOrCreateCustomerLedger(client: DbClient, branchId: string, agencyId: string) {
        const [branchCode, agency] = await Promise.all([
            this.getBranchCode(client, branchId),
            this.getAgency(client, agencyId)
        ]);

        return this.getOrCreateLedger(client, {
            code: `DEBTOR-${branchCode}-${agencyId.substring(0, 8).toUpperCase()}`,
            name: `${agency.name} - Sundry Debtor`,
            category: LedgerType.CUSTOMER,
            groupCode: "SUNDRY_DEBTORS",
            nature: LedgerNature.DEBIT,
            branchId,
            agencyId,
            gstApplicable: Boolean(agency.gstin),
            gstin: agency.gstin
        });
    }

    static async getOrCreateVendorLedger(client: DbClient, branchId: string, agencyId: string) {
        const [branchCode, agency] = await Promise.all([
            this.getBranchCode(client, branchId),
            this.getAgency(client, agencyId)
        ]);

        return this.getOrCreateLedger(client, {
            code: `CREDITOR-${branchCode}-${agencyId.substring(0, 8).toUpperCase()}`,
            name: `${agency.name} - Sundry Creditor`,
            category: LedgerType.VENDOR,
            groupCode: "SUNDRY_CREDITORS",
            nature: LedgerNature.CREDIT,
            branchId,
            agencyId,
            gstApplicable: Boolean(agency.gstin),
            gstin: agency.gstin
        });
    }

    private static async getSalesLedger(client: DbClient, branchId: string) {
        const branchCode = await this.getBranchCode(client, branchId);

        return this.getOrCreateLedger(client, {
            code: `SALES-${branchCode}`,
            name: `Sales - ${branchCode}`,
            category: LedgerType.SALES,
            groupCode: "SALES",
            nature: LedgerNature.CREDIT,
            branchId
        });
    }

    private static async getPurchaseLedger(client: DbClient, branchId: string) {
        const branchCode = await this.getBranchCode(client, branchId);

        return this.getOrCreateLedger(client, {
            code: `PURCHASE-${branchCode}`,
            name: `Purchase - ${branchCode}`,
            category: LedgerType.PURCHASE,
            groupCode: "PURCHASE",
            nature: LedgerNature.DEBIT,
            branchId
        });
    }

    private static async getInputGstLedger(client: DbClient, branchId: string, taxKind: TaxKind) {
        const branchCode = await this.getBranchCode(client, branchId);

        return this.getOrCreateLedger(client, {
            code: `INPUT-GST-${taxKind}-${branchCode}`,
            name: `Input GST ${taxKind} - ${branchCode}`,
            category: LedgerType.GST,
            groupCode: `INPUT_GST_${taxKind}`,
            nature: LedgerNature.DEBIT,
            branchId,
            gstApplicable: true
        });
    }

    private static async getOutputGstLedger(client: DbClient, branchId: string, taxKind: TaxKind) {
        const branchCode = await this.getBranchCode(client, branchId);

        return this.getOrCreateLedger(client, {
            code: `OUTPUT-GST-${taxKind}-${branchCode}`,
            name: `Output GST ${taxKind} - ${branchCode}`,
            category: LedgerType.GST,
            groupCode: `OUTPUT_GST_${taxKind}`,
            nature: LedgerNature.CREDIT,
            branchId,
            gstApplicable: true
        });
    }

    private static async getSuspenseLedger(client: DbClient, branchId: string) {
        const branchCode = await this.getBranchCode(client, branchId);

        return this.getOrCreateLedger(client, {
            code: `SUSPENSE-${branchCode}`,
            name: `Suspense Account - ${branchCode}`,
            category: LedgerType.SUSPENSE,
            groupCode: "SUSPENSE_ACCOUNT",
            nature: LedgerNature.CREDIT,
            branchId
        });
    }

    static async ensureAgencyLedgers(
        tx: Prisma.TransactionClient,
        agencyId: string,
        branchIds: string[],
        agencyType: AgencyType
    ) {
        const uniqueBranchIds = [...new Set(branchIds.filter(Boolean))];

        for (const branchId of uniqueBranchIds) {
            if (agencyType === AgencyType.CLIENT || agencyType === AgencyType.BOTH) {
                await this.getOrCreateCustomerLedger(tx, branchId, agencyId);
            }

            if (agencyType === AgencyType.VENDOR || agencyType === AgencyType.BOTH) {
                await this.getOrCreateVendorLedger(tx, branchId, agencyId);
            }
        }
    }

    /** Post Purchase, Sale, Transaction entries */

    static async postPurchaseApproval(
        tx: Prisma.TransactionClient,
        purchaseId: string
    ) {
        const purchase = await tx.purchase.findUnique({
            where: { id: purchaseId },
            include: {
                agency: true,
                branch: true,
                allocations: true
            }
        });

        if (!purchase) {
            throw new ApiError("Purchase not found", 404);
        }

        const [purchaseLedger, vendorLedger] =
            await Promise.all([
                this.getPurchaseLedger(tx, purchase.branchId),
                this.getOrCreateVendorLedger(
                    tx,
                    purchase.branchId,
                    purchase.agencyId
                )
            ]);

        const gstEntries: VoucherEntryPayload[] = [];

        for (const tax of this.gstSplit(
            Number(purchase.totalGSTAmount),
            purchase.branch.stateCode,
            purchase.agency.stateCode
        )) {

            const gstLedger =
                await this.getInputGstLedger(
                    tx,
                    purchase.branchId,
                    tax.taxKind
                );

            gstEntries.push({
                ledgerId: gstLedger.id,
                entryType: EntryType.DEBIT,
                amount: tax.amount,
                branchId: purchase.branchId,
                narration:
                    `Invoice:${purchase.invoiceNo} GST:${tax.taxKind}`
            });
        }

        return this.createVoucher({
            voucherType: VoucherType.PURCHASE,
            sourceId: purchase.id,
            branchId: purchase.branchId,
            voucherDate: purchase.approvedAt,

            narration:
                `PURCHASE|${purchase.invoiceNo}|${purchase.agency.name}`,

            entries: [
                {
                    ledgerId: purchaseLedger.id,
                    entryType: EntryType.DEBIT,
                    amount: Number(purchase.subtotalAmount),
                    branchId: purchase.branchId,
                    narration:
                        `Invoice:${purchase.invoiceNo} Purchase Value`
                },

                ...gstEntries,

                {
                    ledgerId: vendorLedger.id,
                    entryType: EntryType.CREDIT,
                    amount: Number(purchase.grandTotal),
                    branchId: purchase.branchId,
                    narration:
                        `Invoice:${purchase.invoiceNo} Vendor Payable`
                }
            ]
        }, tx);
    }

    static async postSaleApproval(
        tx: Prisma.TransactionClient,
        saleId: string
    ) {
        const sale = await tx.sale.findUnique({
            where: { id: saleId },
            include: {
                agency: true,
                branch: true,
                allocations: true
            }
        });

        if (!sale) {
            throw new ApiError("Sale not found", 404);
        }

        const [customerLedger, salesLedger] = await Promise.all([
            this.getOrCreateCustomerLedger(
                tx,
                sale.branchId,
                sale.agencyId
            ),
            this.getSalesLedger(tx, sale.branchId)
        ]);

        const gstLines: VoucherEntryPayload[] = [];

        const taxes = [
            { taxKind: "CGST" as TaxKind, amount: Number(sale.totalCGSTAmount) },
            { taxKind: "SGST" as TaxKind, amount: Number(sale.totalSGSTAmount) },
            { taxKind: "IGST" as TaxKind, amount: Number(sale.totalIGSTAmount) }
        ];

        for (const tax of taxes) {

            if (tax.amount <= 0) continue;

            const gstLedger =
                await this.getOutputGstLedger(
                    tx,
                    sale.branchId,
                    tax.taxKind
                );

            gstLines.push({
                ledgerId: gstLedger.id,
                entryType: EntryType.CREDIT,
                amount: tax.amount,
                branchId: sale.branchId,
                narration:
                    `Invoice:${sale.invoiceNo} GST:${tax.taxKind}`
            });
        }

        return this.createVoucher({
            voucherType: VoucherType.SALE,
            sourceId: sale.id,
            branchId: sale.branchId,
            voucherDate: sale.invoiceDate,

            narration:
                `SALE|${sale.invoiceNo}|${sale.agency.name}`,

            entries: [
                {
                    ledgerId: customerLedger.id,
                    entryType: EntryType.DEBIT,
                    amount: Number(sale.grandTotal),
                    branchId: sale.branchId,
                    narration:
                        `Invoice:${sale.invoiceNo} Customer Receivable`
                },

                {
                    ledgerId: salesLedger.id,
                    entryType: EntryType.CREDIT,
                    amount: Number(sale.subTotalAmount),
                    branchId: sale.branchId,
                    narration:
                        `Invoice:${sale.invoiceNo} Sales Value`
                },

                ...gstLines
            ]
        }, tx);
    }

    static async postTransactionApproval(tx: Prisma.TransactionClient, transactionId: string) {
        const transaction = await tx.transaction.findUnique({
            where: {
                id: transactionId
            },
            include: {
                agency: true,
                thirdPartyAgency: true,
                branch: true,

                allocations: {
                    include: {
                        sale: {
                            select: {
                                id: true,
                                invoiceNo: true,
                                grandTotal: true
                            }
                        },

                        purchase: {
                            select: {
                                id: true,
                                invoiceNo: true,
                                grandTotal: true
                            }
                        }
                    }
                }
            }
        });

        if (!transaction) {
            throw new ApiError("Transaction not found for accounting posting", 404);
        }

        const allocationNarration =
        transaction.allocations
            .map(a => {

                if (a.sale) {
                    return `SALE:${a.sale.invoiceNo}:${a.allocatedAmount}`;
                }

                if (a.purchase) {
                    return `PURCHASE:${a.purchase.invoiceNo}:${a.allocatedAmount}`;
                }

                return "";
            })
            .filter(Boolean)
            .join(",");

        const amount = Number(transaction.amount);
        const paymentLedger = await this.getPaymentLedger(tx, transaction.branchId, transaction.paymentThrough);
        
        const narration =
        [
            `TXN:${transaction.transactionNo}`,
            transaction.agency?.name,
            allocationNarration
        ]
        .filter(Boolean)
        .join(" | ");



        if (transaction.suspenseAccount || !transaction.agencyId) {
            const suspenseLedger = await this.getSuspenseLedger(tx, transaction.branchId);

            return this.createVoucher({
                voucherType: transaction.direction === TransactionDirection.INWARD ? VoucherType.RECEIPT : VoucherType.PAYMENT,
                sourceId: transaction.id,
                branchId: transaction.branchId,
                voucherDate: transaction.updatedAt || new Date(),
                narration:
                `${
                    transaction.direction === TransactionDirection.INWARD
                        ? "RECEIPT"
                        : "PAYMENT"
                } | ${narration}`,
                entries: transaction.direction === TransactionDirection.INWARD
                    ? [
                        { ledgerId: paymentLedger.id, entryType: EntryType.DEBIT, amount, branchId: transaction.branchId, narration: `Receipt ${transaction.transactionNo}` },
                        { ledgerId: suspenseLedger.id, entryType: EntryType.CREDIT, amount, branchId: transaction.branchId, narration: `Suspense adjustment` }
                    ]
                    : [
                        { ledgerId: suspenseLedger.id, entryType: EntryType.DEBIT, amount, branchId: transaction.branchId, narration: `Suspense adjustment` },
                        { ledgerId: paymentLedger.id, entryType: EntryType.CREDIT, amount, branchId: transaction.branchId, narration: `Payment ${transaction.transactionNo}` }
                    ]
            }, tx);
        }

        if (transaction.paymentType === TransactionPaymentType.THIRD_PARTY && transaction.thirdPartyAgencyId) {
            if (transaction.direction === TransactionDirection.INWARD) {
                const [thirdPartyVendorLedger, customerLedger] = await Promise.all([
                    this.getOrCreateVendorLedger(tx, transaction.branchId, transaction.thirdPartyAgencyId),
                    this.getOrCreateCustomerLedger(tx, transaction.branchId, transaction.agencyId)
                ]);

                return this.createVoucher({
                    voucherType: VoucherType.CONTRA,
                    sourceId: transaction.id,
                    branchId: transaction.branchId,
                    voucherDate: transaction.updatedAt || new Date(),
                    narration: `CONTRA | ${narration} | THIRD PARTY INWARD`,
                    entries: [
                        { ledgerId: thirdPartyVendorLedger.id, entryType: EntryType.DEBIT, amount, branchId: transaction.branchId, narration: `Third party Vendor adjustment` },
                        { ledgerId: customerLedger.id, entryType: EntryType.CREDIT, amount, branchId: transaction.branchId, narration: allocationNarration || `Third party Customer adjustment` }
                    ]
                }, tx);
            }

            const [vendorLedger, thirdPartyCustomerLedger] = await Promise.all([
                this.getOrCreateVendorLedger(tx, transaction.branchId, transaction.agencyId),
                this.getOrCreateCustomerLedger(tx, transaction.branchId, transaction.thirdPartyAgencyId)
            ]);

            return this.createVoucher({
                voucherType: VoucherType.CONTRA,
                sourceId: transaction.id,
                branchId: transaction.branchId,
                voucherDate: transaction.updatedAt || new Date(),
                narration: `CONTRA | ${narration} | THIRD PARTY OUTWARD`,
                entries: [
                    { ledgerId: vendorLedger.id, entryType: EntryType.DEBIT, amount, branchId: transaction.branchId, narration: allocationNarration || `Vendor Settlement` },
                    { ledgerId: thirdPartyCustomerLedger.id, entryType: EntryType.CREDIT, amount, branchId: transaction.branchId, narration: `Third party Customer adjustment` }
                ]
            }, tx);
        }

        if (transaction.direction === TransactionDirection.INWARD) {
            const customerLedger = await this.getOrCreateCustomerLedger(tx, transaction.branchId, transaction.agencyId);

            return this.createVoucher({
                voucherType: VoucherType.RECEIPT,
                sourceId: transaction.id,
                branchId: transaction.branchId,
                voucherDate: transaction.updatedAt || new Date(),
                narration: `RECEIPT | ${narration}`,
                entries: [
                    { ledgerId: paymentLedger.id, entryType: EntryType.DEBIT, amount, branchId: transaction.branchId, narration: `Receipt ${transaction.transactionNo}` },
                    { ledgerId: customerLedger.id, entryType: EntryType.CREDIT, amount, branchId: transaction.branchId, narration: allocationNarration || `Settlement against Customer` }
                ]
            }, tx);
        }

        const vendorLedger = await this.getOrCreateVendorLedger(tx, transaction.branchId, transaction.agencyId);

        return this.createVoucher({
            voucherType: VoucherType.PAYMENT,
            sourceId: transaction.id,
            branchId: transaction.branchId,
            voucherDate: transaction.updatedAt || new Date(),
            narration: `PAYMENT | ${narration}`,
            entries: [
                { ledgerId: vendorLedger.id, entryType: EntryType.DEBIT, amount, branchId: transaction.branchId, narration: allocationNarration || `Settlement against Vendor` },
                { ledgerId: paymentLedger.id, entryType: EntryType.CREDIT, amount, branchId: transaction.branchId, narration: `Payment ${transaction.transactionNo}` }
            ]
        }, tx);
    }
}

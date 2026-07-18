export interface CreateJournalHeadDto {

    name: string;

    type: "INWARD" | "OUTWARD";

    groupCode?: string;

}

export interface UpdateJournalHeadDto {

    name?: string;

    type?: "INWARD" | "OUTWARD";

    isActive?: boolean;

}

import {
    EntryType,
    JournalHeadType,
    JournalStatus,
    LedgerNature,
    LedgerType,
    PaymentMode,
    PaymentType,
    VoucherType
} from "@prisma/client";

export interface CreateJournalDto {

    branchId: string;

    journalHeadId: string;

    amount: number;

    importKey?: string;

    paymentMode: PaymentMode;

    paymentThrough?: PaymentType;

    remarks?: string;

    journalDate?: Date;

}

export interface UpdateJournalDto {

    branchId?: string;

    journalHeadId?: string;

    amount?: number;

    paymentMode?: PaymentMode;

    paymentThrough?: PaymentType;

    remarks?: string;

    journalDate?: Date;

}

import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { LedgerService } from "../accounting/ledger/ledger.service";

export class JournalService {

    private static async getPaymentLedger(
        tx: any,
        paymentThrough?: PaymentType
    ) {

        if (paymentThrough === PaymentType.CASH) {

            let ledger = await tx.ledger.findFirst({
                where: {
                    category: LedgerType.CASH,
                    isActive: true
                }
            });

            if (!ledger) {

                try {
                    ledger = await LedgerService.getOrCreateLedger(tx, {
                        code: "CASH_GLOBAL",
                        name: "CASH",
                        category: LedgerType.CASH,
                        groupCode: "CASH_IN_HAND",
                        nature: LedgerNature.DEBIT
                    });
                    
                } catch (error) {
                    console.error("Error creating CASH ledger:", error);
                }
            }

            return ledger;
        }

        return tx.ledger.findFirst({

            where: {

                category: LedgerType.BANK,

                isActive: true

            }

        });

    }

    static async createJournalHead(
        actor: any,
        dto: CreateJournalHeadDto
    ) {

        const exists =
            await prisma.journalHead.findFirst({

                where: {

                    name: {

                        equals: dto.name.trim(),

                        mode: "insensitive"

                    }

                }

            });

        if (exists) {

            throw new Error(
                "Journal Head already exists."
            );

        }

        const ledger =
            await LedgerService.createLedgerMaster(actor, {

                name: dto.name.trim(),

                category: LedgerType.JOURNAL,

                groupCode:
                    dto.groupCode ??
                    (dto.type === "INWARD"
                        ? "INDIRECT_INCOME"
                        : "INDIRECT_EXPENSE")

            });

        return prisma.journalHead.create({

            data: {

                name: dto.name.trim(),

                type: dto.type,

                ledgerId: ledger.id

            },

            include: {

                ledger: true

            }

        });

    }

    static async updateJournalHead(

        id: string,

        dto: UpdateJournalHeadDto

    ) {

        const head =
            await prisma.journalHead.findUnique({

                where: {
                    id
                }

            });

        if (!head) {

            throw new Error(
                "Journal Head not found."
            );

        }

        if (dto.name) {

            const duplicate =
                await prisma.journalHead.findFirst({

                    where: {

                        id: {
                            not: id
                        },

                        name: {

                            equals: dto.name,

                            mode: "insensitive"

                        }

                    }

                });

            if (duplicate) {

                throw new Error(
                    "Journal Head already exists."
                );

            }

        }

        return prisma.journalHead.update({
            where: { id },
            data: {
                name: dto.name,
                type: dto.type,
                isActive: dto.isActive
            },
            include: {
                ledger: true
            }
        });

    }

    static async deleteJournalHead(
        id: string
    ) {

        const used =
            await prisma.journal.findFirst({

                where: {

                    journalHeadId: id

                }

            });

        if (used) {

            throw new Error(

                "Journal Head is already used in Journals."

            );

        }

        return prisma.journalHead.delete({

            where: {

                id

            }

        });

    }

    static async getJournalHeadById(
        id: string
    ) {

        const journalHead =
            await prisma.journalHead.findUnique({

                where: {

                    id

                },

                include: {

                    ledger: true

                }

            });

        if (!journalHead) {

            throw new Error(
                "Journal Head not found."
            );

        }

        return journalHead;

    }

    static async listJournalHeads(
        params: {

            search?: string;

            type?: "INWARD" | "OUTWARD";

            isActive?: boolean;

        }
    ) {

        const {

            search,

            type,

            isActive

        } = params;

        return prisma.journalHead.findMany({

            where: {

                ...(search && {

                    name: {

                        contains: search,

                        mode: "insensitive"

                    }

                }),

                ...(type && {

                    type

                }),

                ...(isActive !== undefined && {

                    isActive

                })

            },

            include: {

                ledger: {

                    select: {

                        id: true,

                        code: true,

                        name: true,

                        category: true,

                        nature: true

                    }

                }

            },

            orderBy: {

                name: "asc"

            }

        });

    }

    /** ------------ JOURNAL SERVICE ------------- */
    static async createJournal(
        actor: any,
        dto: CreateJournalDto
    ) {

        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const [
            branch,
            journalHead
        ] = await Promise.all([

            prisma.branch.findUnique({
                where: {
                    id: dto.branchId
                }
            }),

            prisma.journalHead.findUnique({
                where: {
                    id: dto.journalHeadId
                },
                include: {
                    ledger: true
                }
            })

        ]);

        if (!branch) {
            throw new ApiError(
                "Branch not found.",
                404
            );
        }

        if (!journalHead) {
            throw new ApiError(
                "Journal Head not found.",
                404
            );
        }

        if (
            dto.amount <= 0
        ) {
            throw new ApiError(
                "Amount must be greater than zero.",
                400
            );
        }

        return prisma.journal.create({

            data: {

                branchId:
                    dto.branchId,

                journalHeadId:
                    dto.journalHeadId,

                paymentMode:
                    dto.paymentMode,

                paymentThrough:
                    dto.paymentThrough,

                importKey:
                    dto.importKey ?? null,

                amount:
                    dto.amount,

                remarks:
                    dto.remarks,

                journalDate:
                    dto.journalDate ??
                    new Date(),

                status:
                    "PENDING",

                createdById:
                    actor.id

            },

            include: {

                branch: true,

                journalHead: {
                    include: {
                        ledger: true
                    }
                },

                createdBy: {
                    select: {
                        id: true,
                        name: true
                    }
                }
            }

        });

    }

    static async updateJournal(
        actor: any,
        id: string,
        dto: UpdateJournalDto
    ) {

        if (!actor?.id) {

            throw new ApiError(
                "Unauthorized",
                401
            );

        }

        const journal =
            await prisma.journal.findUnique({

                where: {
                    id
                }

            });

        if (!journal) {

            throw new ApiError(
                "Journal not found.",
                404
            );

        }

        if (
            journal.status !== "PENDING"
        ) {

            throw new ApiError(

                "Approved Journal cannot be modified.",

                400

            );

        }

        if (
            dto.branchId
        ) {

            const exists =
                await prisma.branch.findUnique({

                    where: {
                        id: dto.branchId
                    }

                });

            if (!exists) {

                throw new ApiError(
                    "Branch not found.",
                    404
                );

            }

        }

        if (
            dto.journalHeadId
        ) {

            const head =
                await prisma.journalHead.findUnique({

                    where: {
                        id: dto.journalHeadId
                    }

                });

            if (!head) {

                throw new ApiError(
                    "Journal Head not found.",
                    404
                );

            }

        }


        if (
            dto.amount !== undefined &&
            dto.amount <= 0
        ) {

            throw new ApiError(

                "Amount must be greater than zero.",

                400

            );

        }

        return prisma.journal.update({

            where: {

                id

            },

            data: {

                branchId:
                    dto.branchId,

                journalHeadId:
                    dto.journalHeadId,

                paymentMode:
                    dto.paymentMode,

                paymentThrough:
                    dto.paymentThrough,

                amount:
                    dto.amount,

                remarks:
                    dto.remarks,

                journalDate:
                    dto.journalDate

            },

            include: {

                branch: true,

                journalHead: {

                    include: {

                        ledger: true

                    }

                }

            }

        });

    }

    static async getJournalById(
        id: string
    ) {

        const journal =
            await prisma.journal.findUnique({

                where: {
                    id
                },

                include: {
                    branch: {
                        select: {
                            id: true,
                            code: true,
                            name: true
                        }
                    },

                    journalHead: {
                        include: {
                            ledger: true
                        }
                    },

                    voucher: {
                        select: {
                            id: true,
                            voucherNo: true,
                            voucherType: true
                        }

                    },

                    createdBy: {
                        select: {
                            id: true,
                            name: true,
                            email: true
                        }

                    },

                    approvedBy: {
                        select: {
                            id: true,
                            name: true,
                            email: true
                        }
                    }
                }
            });

        if (!journal) {
            throw new ApiError(
                "Journal not found.",
                404
            );
        }

        return journal;

    }

    static async listJournals(
        params: {
            page?: number;
            limit?: number;
            search?: string;
            branchId?: string;
            status?: JournalStatus;
            journalHeadId?: string;
            fromDate?: Date;
            toDate?: Date;
        }
    ) {

        const {
            page = 1,
            limit = 20,
            search,
            branchId,
            status,
            journalHeadId,
            fromDate,
            toDate
        } = params;

        const where: any = {
            ...(branchId && {
                branchId
            }),

            ...(status && {
                status
            }),

            ...(journalHeadId && {
                journalHeadId
            }),

            ...(fromDate || toDate
                ? {
                    journalDate: {
                        ...(fromDate && {
                            gte: fromDate
                        }),

                        ...(toDate && {
                            lte: toDate
                        })
                    }
                }
                : {}),

            ...(search
                ? {
                    OR: [
                        {
                            remarks: {
                                contains: search,
                                mode: "insensitive"
                            }
                        },

                        {
                            journalHead: {
                                name: {
                                    contains: search,
                                    mode: "insensitive"
                                }
                            }
                        },

                        {
                            branch: {
                                name: {
                                    contains: search,
                                    mode: "insensitive"
                                }
                            }
                        }
                    ]
                }
            : {})
        };

        const [
            total,
            journals
        ] = await prisma.$transaction([

            prisma.journal.count({
                where
            }),

            prisma.journal.findMany({
                where,
                skip:
                    (page - 1) * limit,
                take:
                    limit,
                orderBy: {
                    journalDate: "desc"
                },

                include: {
                    branch: {
                        select: {
                            id: true,
                            code: true,
                            name: true
                        }
                    },

                    journalHead: {
                        include: {
                            ledger: true
                        }
                    },

                    voucher: {
                        select: {
                            id: true,
                            voucherNo: true,
                            voucherType: true
                        }
                    },

                    createdBy: {
                        select: {
                            id: true,
                            name: true
                        }
                    },

                    approvedBy: {
                        select: {
                            id: true,
                            name: true
                        }
                    }
                }
            })
        ]);

        return {
            data: journals,
            meta: {
                page,
                limit,
                total,
                totalPages:
                    Math.ceil(total / limit)
            }

        };

    }

    static async approveJournal(
        actor: any,
        journalId: string
    ) {

        if (!actor?.id) {

            throw new ApiError(
                "Unauthorized",
                401
            );

        }

        return prisma.$transaction(async (tx) => {

            const journal =
                await tx.journal.findUnique({

                    where: {
                        id: journalId
                    },

                    include: {

                        branch: true,

                        journalHead: {

                            include: {

                                ledger: true

                            }

                        }

                    }

                });

            if (!journal) {

                throw new ApiError(
                    "Journal not found.",
                    404
                );

            }

            if (

                journal.status !== JournalStatus.PENDING

            ) {

                throw new ApiError(

                    "Journal already processed.",

                    400

                );

            }

            /**
             * Resolve Payment Ledger
             */

            const paymentLedger =
                await this.getPaymentLedger(

                    tx,

                    journal.paymentThrough

                );

            if (!paymentLedger) {

                throw new ApiError(

                    "Payment Ledger not configured.",

                    400

                );

            }

            /**
             * Create Voucher
             */

            const voucher =
                await LedgerService.createVoucher(
                    {

                        voucherType:
                            VoucherType.JOURNAL,

                        sourceId:
                            journal.id,

                        branchId:
                            journal.branchId,

                        narration:
                            journal.remarks,

                        voucherDate:
                            journal.journalDate,

                        entries:

                            journal.journalHead.type ===
                                JournalHeadType.OUTWARD

                                ?

                                [

                                    {

                                        ledgerId:
                                            journal.journalHead.ledgerId,

                                        entryType:
                                            EntryType.DEBIT,

                                        amount:
                                            Number(
                                                journal.amount
                                            )

                                    },

                                    {

                                        ledgerId:
                                            paymentLedger.id,

                                        entryType:
                                            EntryType.CREDIT,

                                        amount:
                                            Number(
                                                journal.amount
                                            )

                                    }

                                ]

                                :

                                [

                                    {

                                        ledgerId:
                                            paymentLedger.id,

                                        entryType:
                                            EntryType.DEBIT,

                                        amount:
                                            Number(
                                                journal.amount
                                            )

                                    },

                                    {

                                        ledgerId:
                                            journal.journalHead.ledgerId,

                                        entryType:
                                            EntryType.CREDIT,

                                        amount:
                                            Number(
                                                journal.amount
                                            )

                                    }

                                ]

                    },
                    tx
                );

            /**
             * Approve Journal
             */

            return tx.journal.update({

                where: {

                    id: journal.id

                },

                data: {

                    status:
                        JournalStatus.APPROVED,

                    approvedById:
                        actor.id,

                    approvedAt:
                        new Date(),

                    voucherId:
                        voucher.id

                },

                include: {

                    voucher: {

                        include: {

                            entries: {

                                include: {

                                    ledger: true

                                }

                            }

                        }

                    },

                    journalHead: {

                        include: {

                            ledger: true

                        }

                    },

                    branch: true,

                    approvedBy: {

                        select: {

                            id: true,

                            name: true

                        }

                    }

                }

            });

        });

    }

    static async rejectJournal(
        actor: any,
        journalId: string,
        remarks?: string
    ) {

        if (!actor?.id) {

            throw new ApiError(
                "Unauthorized",
                401
            );

        }

        const journal =
            await prisma.journal.findUnique({

                where: {
                    id: journalId
                }

            });

        if (!journal) {

            throw new ApiError(
                "Journal not found.",
                404
            );

        }

        if (

            journal.status !== JournalStatus.PENDING

        ) {

            throw new ApiError(

                "Journal already processed.",

                400

            );

        }

        return prisma.journal.update({

            where: {

                id: journalId

            },

            data: {

                status:
                    JournalStatus.REJECTED,

                approvedById:
                    actor.id,

                approvedAt:
                    new Date(),

                remarks:
                    remarks
                        ? `${journal.remarks ?? ""}\nRejected: ${remarks}`.trim()
                        : journal.remarks

            },

            include: {

                branch: {

                    select: {

                        id: true,

                        code: true,

                        name: true

                    }

                },

                journalHead: {

                    include: {

                        ledger: true

                    }

                },

                createdBy: {

                    select: {

                        id: true,

                        name: true

                    }

                },

                approvedBy: {

                    select: {

                        id: true,

                        name: true

                    }

                }

            }

        });

    }

}


import {
    DebitCreditNoteSourceType,
    DebitCreditNoteStatus,
    DebitCreditNoteType,
    OutstandingType,
    Prisma,
    PurchaseStatus,
    SalesStatus,
    VoucherType
} from "@prisma/client";

import { randomUUID } from "crypto";

import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { LedgerService } from "../accounting/ledger/ledger.service";
import { RBACService } from "../rbac/rbac.service";
import { TransactionService } from "../transaction/transac.service";
import { DebitCreditNoteMapper } from "../../core/utils/DRCRNoteMapper";
import { DebitCreditNoteRenderer } from "../../core/utils/DRCRRender";

/* ============================================================
 * TYPES
 * ============================================================ */

type NoteParticularPayload = {
    description: string;
    amount: number;
};

type CreateNotePayload = {
    type: DebitCreditNoteType;

    sourceType: DebitCreditNoteSourceType;

    agencyId: string;
    branchId: string;

    saleId?: string;
    purchaseId?: string;
    noteNo?: string;
    purchaseVoucherType?: VoucherType;
    importKey?: string;

    noteDate?: string | Date;
    narration?: string;
    taxableAmount?: number;
    cgstAmount?: number;
    sgstAmount?: number;
    igstAmount?: number;

    particulars: NoteParticularPayload[];
};

type ListNoteQuery = {
    page?: number;
    limit?: number;

    agencyId?: string;
    branchId?: string;

    saleId?: string;
    purchaseId?: string;

    sourceType?: DebitCreditNoteSourceType;
    type?: DebitCreditNoteType;
    status?: DebitCreditNoteStatus;
};

/* ============================================================
 * HELPERS
 * ============================================================ */

const money = (value: unknown) =>
    Math.round(Number(value || 0) * 100) / 100;

const includeNoteDetails = {
    agency: true,

    branch: true,

    sale: {
        select: {
            id: true,
            invoiceNo: true,
            invoiceDate: true,
            grandTotal: true
        }
    },

    purchase: {
        select: {
            id: true,
            invoiceNo: true,
            invoiceDate: true,
            grandTotal: true
        }
    },

    particulars: true,

    voucher: {
        include: {
            entries: {
                include: {
                    ledger: true
                }
            }
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
} as const;

/* ============================================================
 * SERVICE
 * ============================================================ */

export class DebitCreditNoteService {

    /* --------------------------------------------------------
     * NOTE NUMBER
     * -------------------------------------------------------- */

    private static generateNoteNo(
        type: DebitCreditNoteType
    ) {
        const prefix =
            type === DebitCreditNoteType.DEBIT_NOTE
                ? "DBN"
                : "CRN";

        const unique = randomUUID()
            .replace(/-/g, "")
            .substring(0, 10)
            .toUpperCase();

        return `${prefix}-${unique}`;
    }

    /* --------------------------------------------------------
     * PERMISSION
     * -------------------------------------------------------- */

    private static async ensurePermission(
        actor: any,
        permission: string
    ) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const allowed =
            await RBACService.hasPermission(
                actor.id,
                permission
            );

        if (!allowed) {
            throw new ApiError("Forbidden", 403);
        }
    }

    /* --------------------------------------------------------
     * BRANCH ACCESS
     * -------------------------------------------------------- */

    private static validateBranchAccess(
        actor: any,
        branchId: string
    ) {
        if (
            actor.branchAccessType !== "ALL" &&
            branchId !== actor.branchId
        ) {
            throw new ApiError(
                "You do not have access to this branch",
                403
            );
        }
    }

    /* --------------------------------------------------------
     * PARTICULARS
     * -------------------------------------------------------- */

    private static normalizeParticulars(
        particulars?: NoteParticularPayload[]
    ) {
        if (!particulars?.length) {
            throw new ApiError(
                "At least one particular is required",
                400
            );
        }

        return particulars.map(
            (particular, index) => {

                const description =
                    particular.description?.trim();

                const amount =
                    money(particular.amount);

                if (!description) {
                    throw new ApiError(
                        `Particular ${index + 1} description is required`,
                        400
                    );
                }

                if (amount <= 0) {
                    throw new ApiError(
                        `Particular ${index + 1} amount must be greater than zero`,
                        400
                    );
                }

                return {
                    description,
                    amount
                };
            }
        );
    }

    /* ========================================================
     * VALIDATE SELECTED INVOICE
     *
     * IMPORTANT:
     * We DO NOT check:
     *
     * - TransactionAllocation
     * - paidAmount
     * - outstandingAmount
     * - fully settled
     * - partially settled
     *
     * Payment status is irrelevant for Debit/Credit Note.
     * ======================================================== */

    private static async validateInvoiceContext(
        tx: Prisma.TransactionClient,
        payload: Pick<
            CreateNotePayload,
            | "agencyId"
            | "branchId"
            | "sourceType"
            | "saleId"
            | "purchaseId"
        >
    ) {

        /* ---------------- SALE ---------------- */

        if (
            payload.sourceType ===
            DebitCreditNoteSourceType.SALE
        ) {
            if (!payload.saleId) {
                throw new ApiError(
                    "Sale ID is required",
                    400
                );
            }

            if (payload.purchaseId) {
                throw new ApiError(
                    "purchaseId cannot be provided for SALE note",
                    400
                );
            }

            const sale =
                await tx.sale.findUnique({
                    where: {
                        id: payload.saleId
                    },
                    select: {
                        id: true,
                        invoiceNo: true,
                        invoiceDate: true,

                        agencyId: true,
                        branchId: true,

                        status: true,
                        grandTotal: true
                    }
                });

            if (!sale) {
                throw new ApiError(
                    "Sale invoice not found",
                    404
                );
            }

            if (
                sale.status !==
                SalesStatus.APPROVED
            ) {
                throw new ApiError(
                    "Debit/Credit note can only be created against an approved sale invoice",
                    400
                );
            }

            if (
                sale.agencyId !==
                payload.agencyId
            ) {
                throw new ApiError(
                    "Selected sale invoice belongs to another agency",
                    400
                );
            }

            if (
                sale.branchId !==
                payload.branchId
            ) {
                throw new ApiError(
                    "Selected sale invoice belongs to another branch",
                    400
                );
            }

            return sale;
        }

        /* ---------------- PURCHASE ---------------- */

        if (
            payload.sourceType ===
            DebitCreditNoteSourceType.PURCHASE
        ) {
            if (!payload.purchaseId) {
                throw new ApiError(
                    "Purchase ID is required",
                    400
                );
            }

            if (payload.saleId) {
                throw new ApiError(
                    "saleId cannot be provided for PURCHASE note",
                    400
                );
            }

            const purchase =
                await tx.purchase.findUnique({
                    where: {
                        id: payload.purchaseId
                    },
                    select: {
                        id: true,
                        invoiceNo: true,
                        invoiceDate: true,

                        agencyId: true,
                        branchId: true,

                        status: true,
                        grandTotal: true
                    }
                });

            if (!purchase) {
                throw new ApiError(
                    "Purchase invoice not found",
                    404
                );
            }

            if (
                purchase.status !==
                PurchaseStatus.APPROVED
            ) {
                throw new ApiError(
                    "Debit/Credit note can only be created against an approved purchase invoice",
                    400
                );
            }

            if (
                purchase.agencyId !==
                payload.agencyId
            ) {
                throw new ApiError(
                    "Selected purchase invoice belongs to another agency",
                    400
                );
            }

            if (
                purchase.branchId !==
                payload.branchId
            ) {
                throw new ApiError(
                    "Selected purchase invoice belongs to another branch",
                    400
                );
            }

            return purchase;
        }

        throw new ApiError(
            "Invalid source type",
            400
        );
    }

    /* ========================================================
     * GET INVOICES
     *
     * Returns every APPROVED invoice for Agency + Branch.
     *
     * It does NOT care whether:
     *
     * invoice is unpaid
     * invoice is partially paid
     * invoice is fully paid
     *
     * That's intentional.
     * ======================================================== */

    static async getAgencyInvoices(
        actor: any,
        query: {
            agencyId?: string;
            branchId?: string;
            sourceType?: DebitCreditNoteSourceType;
            search?: string;
        }
    ) {
        if (!actor?.id) {
            throw new ApiError(
                "Unauthorized",
                401
            );
        }

        /* ============================================================
         * VALIDATE SOURCE TYPE
         * ============================================================ */

        if (
            !query.sourceType ||
            !Object.values(
                DebitCreditNoteSourceType
            ).includes(query.sourceType)
        ) {
            throw new ApiError(
                "Valid source type is required",
                400
            );
        }

        const agencyId =
            query.agencyId?.trim() || undefined;

        const search =
            query.search?.trim() || undefined;

        /* ============================================================
         * RESOLVE BRANCH
         *
         * RESTRICTED USER:
         * Always actor.branchId
         *
         * ALL ACCESS USER:
         * branchId provided -> filter branch
         * branchId missing  -> all branches
         * ============================================================ */

        let branchId: string | undefined;

        if (
            actor.branchAccessType === "ALL"
        ) {
            branchId =
                query.branchId?.trim() ||
                undefined;

        } else {

            if (!actor.branchId) {
                throw new ApiError(
                    "Actor branch is not configured",
                    400
                );
            }

            branchId =
                actor.branchId;
        }

        /* ============================================================
         * PURCHASE
         * ============================================================ */

        if (
            query.sourceType ===
            DebitCreditNoteSourceType.PURCHASE
        ) {

            const purchases =
                await prisma.purchase.findMany({

                    where: {

                        status:
                            PurchaseStatus.APPROVED,

                        ...(branchId && {
                            branchId
                        }),

                        ...(agencyId && {
                            agencyId
                        }),

                        ...(search && {

                            OR: [

                                /* Invoice search */

                                {
                                    invoiceNo: {
                                        contains:
                                            search,

                                        mode:
                                            "insensitive"
                                    }
                                },

                                /* Agency search */

                                {
                                    agency: {
                                        name: {
                                            contains:
                                                search,

                                            mode:
                                                "insensitive"
                                        }
                                    }
                                }

                            ]

                        })

                    },

                    select: {

                        id: true,

                        invoiceNo: true,

                        invoiceDate: true,

                        grandTotal: true,

                        status: true,

                        remarks: true,

                        otherReference: true,

                        agency: {

                            select: {
                                id: true,
                                name: true
                            }

                        },

                        branch: {

                            select: {
                                id: true,
                                name: true,
                                code: true
                            }

                        }

                    },

                    orderBy: [
                        {
                            agency: {
                                name: "asc"
                            }
                        },
                        {
                            invoiceDate: "desc"
                        }
                    ]

                });

            return purchases.map(
                purchase => ({

                    id:
                        purchase.id,

                    sourceType:
                        DebitCreditNoteSourceType.PURCHASE,

                    invoiceNo:
                        purchase.invoiceNo,

                    invoiceDate:
                        purchase.invoiceDate,

                    grandTotal:
                        purchase.grandTotal,

                    status:
                        purchase.status,

                    narration:
                        purchase.remarks ??
                        purchase.otherReference ??
                        null,

                    agency:
                        purchase.agency,

                    branch:
                        purchase.branch

                })
            );
        }

        /* ============================================================
         * SALE
         * ============================================================ */

        const sales =
            await prisma.sale.findMany({

                where: {

                    status:
                        SalesStatus.APPROVED,

                    ...(branchId && {
                        branchId
                    }),

                    ...(agencyId && {
                        agencyId
                    }),

                    ...(search && {

                        OR: [

                            /* Invoice search */

                            {
                                invoiceNo: {
                                    contains:
                                        search,

                                    mode:
                                        "insensitive"
                                }
                            },

                            /* Agency search */

                            {
                                agency: {
                                    name: {
                                        contains:
                                            search,

                                        mode:
                                            "insensitive"
                                    }
                                }
                            }

                        ]

                    })

                },

                select: {

                    id: true,

                    invoiceNo: true,

                    invoiceDate: true,

                    grandTotal: true,

                    status: true,

                    remarks: true,

                    otherReference: true,

                    agency: {

                        select: {
                            id: true,
                            name: true
                        }

                    },

                    branch: {

                        select: {
                            id: true,
                            name: true,
                            code: true
                        }

                    }

                },

                orderBy: [
                    {
                        agency: {
                            name: "asc"
                        }
                    },
                    {
                        invoiceDate: "desc"
                    }
                ]

            });

        return sales.map(
            sale => ({

                id:
                    sale.id,

                sourceType:
                    DebitCreditNoteSourceType.SALE,

                invoiceNo:
                    sale.invoiceNo,

                invoiceDate:
                    sale.invoiceDate,

                grandTotal:
                    sale.grandTotal,

                status:
                    sale.status,

                narration:
                    sale.remarks ??
                    sale.otherReference ??
                    null,

                agency:
                    sale.agency,

                branch:
                    sale.branch

            })
        );
    }

    /* ========================================================
     * CREATE NOTE
     *
     * Only creates PENDING document.
     *
     * NO outstanding update.
     * NO ledger posting.
     * NO voucher.
     * ======================================================== */

    static async createNote(
        actor: any,
        payload: CreateNotePayload
    ) {

        await this.ensurePermission(
            actor,
            "SALE:WRITE"
        );

        if (
            !payload.agencyId ||
            !payload.branchId
        ) {
            throw new ApiError(
                "Agency ID and Branch ID are required",
                400
            );
        }

        this.validateBranchAccess(
            actor,
            payload.branchId
        );

        if (
            !payload.type ||
            !Object.values(
                DebitCreditNoteType
            ).includes(payload.type)
        ) {
            throw new ApiError(
                "Valid note type is required",
                400
            );
        }

        if (
            !payload.sourceType ||
            !Object.values(
                DebitCreditNoteSourceType
            ).includes(payload.sourceType)
        ) {
            throw new ApiError(
                "Valid source type is required",
                400
            );
        }

        const particulars =
            this.normalizeParticulars(
                payload.particulars
            );

        const totalAmount =
            money(
                particulars.reduce(
                    (sum, item) =>
                        sum + item.amount,
                    0
                )
            );

        return prisma.$transaction(
            async tx => {

                await this.validateInvoiceContext(
                    tx,
                    payload
                );

                return tx.debitCreditNote.create({
                    data: {
                        noteNo:
                            payload.noteNo?.trim() || this.generateNoteNo(payload.type),

                        importKey:
                            payload.importKey || null,

                        type:
                            payload.type,

                        sourceType:
                            payload.sourceType,

                        agencyId:
                            payload.agencyId,

                        branchId:
                            payload.branchId,

                        saleId:
                            payload.sourceType ===
                            DebitCreditNoteSourceType.SALE
                                ? payload.saleId
                                : null,

                        purchaseId:
                            payload.sourceType ===
                            DebitCreditNoteSourceType.PURCHASE
                                ? payload.purchaseId
                                : null,

                        purchaseVoucherType:
                            payload.sourceType === DebitCreditNoteSourceType.PURCHASE
                                ? payload.purchaseVoucherType || null
                                : null,

                        noteDate:
                            payload.noteDate
                                ? new Date(
                                    payload.noteDate
                                )
                                : new Date(),

                        narration:
                            payload.narration?.trim() ||
                            null,

                        taxableAmount: money(payload.taxableAmount),
                        cgstAmount: money(payload.cgstAmount),
                        sgstAmount: money(payload.sgstAmount),
                        igstAmount: money(payload.igstAmount),

                        totalAmount,

                        status:
                            DebitCreditNoteStatus.PENDING,

                        createdById:
                            actor.id,

                        particulars: {
                            create: particulars
                        }
                    },

                    include:
                        includeNoteDetails
                });
            }
        );
    }

    /* ========================================================
     * OUTSTANDING EFFECT
     *
     * AgencyOutstanding semantics in your project:
     *
     * DEBIT  = payable / amount due
     * CREDIT = receivable
     *
     * PURCHASE:
     *
     * Debit Note:
     * vendor payable decreases
     * => CREDIT adjustment
     *
     * Credit Note:
     * vendor payable increases
     * => DEBIT adjustment
     *
     *
     * SALE:
     *
     * Debit Note:
     * customer receivable increases
     * => CREDIT adjustment
     *
     * Credit Note:
     * customer receivable decreases
     * => DEBIT adjustment
     * ======================================================== */

    private static resolveOutstandingType(
        sourceType: DebitCreditNoteSourceType,
        noteType: DebitCreditNoteType
    ): OutstandingType {

        /**
         * SALE
         *
         * Debit Note:
         * Customer owes us MORE
         * => receivable increases
         * => CREDIT
         *
         * Credit Note:
         * Customer owes us LESS
         * => receivable decreases
         * => DEBIT offsets CREDIT
         */

        if (
            sourceType ===
            DebitCreditNoteSourceType.SALE
        ) {
            return noteType ===
                DebitCreditNoteType.DEBIT_NOTE
                ? OutstandingType.CREDIT
                : OutstandingType.DEBIT;
        }

        /**
         * PURCHASE
         *
         * Debit Note:
         * We owe vendor LESS
         * => DEBIT payable reduced by CREDIT
         *
         * Credit Note:
         * We owe vendor MORE
         * => DEBIT payable increases
         */

        return noteType ===
            DebitCreditNoteType.DEBIT_NOTE
            ? OutstandingType.CREDIT
            : OutstandingType.DEBIT;
    }

    /* ========================================================
     * APPROVE NOTE
     *
     * Approval performs accounting effect.
     * ======================================================== */

    static async approveNote(
        actor: any,
        noteId: string
    ) {

        await this.ensurePermission(
            actor,
            "SALE:APPROVE"
        );

        /*
         * FIRST:
         * Complete accounting approval transaction.
         */
        const approvedNote =
            await prisma.$transaction(
                async tx => {

                    const note =
                        await tx.debitCreditNote.findUnique({
                            where: {
                                id: noteId
                            },

                            include: {
                                particulars: true
                            }
                        });

                    if (!note) {
                        throw new ApiError(
                            "Debit/Credit note not found",
                            404
                        );
                    }

                    this.validateBranchAccess(
                        actor,
                        note.branchId
                    );

                    if (
                        note.status !==
                        DebitCreditNoteStatus.PENDING
                    ) {
                        throw new ApiError(
                            "Only pending Debit/Credit notes can be approved",
                            400
                        );
                    }

                    /*
                     * Revalidate source invoice.
                     */
                    await this.validateInvoiceContext(
                        tx,
                        {
                            agencyId:
                                note.agencyId,

                            branchId:
                                note.branchId,

                            sourceType:
                                note.sourceType,

                            saleId:
                                note.saleId || undefined,

                            purchaseId:
                                note.purchaseId || undefined
                        }
                    );

                    /*
                     * Lock note.
                     */
                    const lock =
                        await tx.debitCreditNote.updateMany({
                            where: {
                                id: note.id,

                                status:
                                    DebitCreditNoteStatus.PENDING
                            },

                            data: {
                                status:
                                    DebitCreditNoteStatus.APPROVED,

                                approvedById:
                                    actor.id,

                                approvedAt:
                                    new Date()
                            }
                        });

                    if (!lock.count) {
                        throw new ApiError(
                            "Debit/Credit note already processed",
                            409
                        );
                    }

                    /*
                     * Update AgencyOutstanding.
                     */
                    const outstandingType =
                        this.resolveOutstandingType(
                            note.sourceType,
                            note.type
                        );

                    await TransactionService
                        .updatePersistentOutstanding(
                            tx,
                            note.agencyId,
                            note.branchId,
                            Number(note.totalAmount),
                            outstandingType,
                            "ADD"
                        );

                    /*
                     * Post accounting voucher / ledger.
                     */
                    const voucher =
                        await LedgerService
                            .postDebitCreditNoteApproval(
                                tx,
                                note.id
                            );

                    /*
                     * Attach voucher.
                     */
                    return tx.debitCreditNote.update({
                        where: {
                            id: note.id
                        },

                        data: {
                            voucherId:
                                voucher.id
                        },

                        include:
                            includeNoteDetails
                    });
                }
            );

        /*
         * Transaction has COMMITTED here.
         *
         * Now generate PDF.
         */
        const setting =
            await prisma.setting.findFirst();

        const templateData =
            DebitCreditNoteMapper.map(
                approvedNote,
                setting
            );

        const pdf =
            await DebitCreditNoteRenderer
                .generatePdf(
                    templateData
                );

        return {
            note: approvedNote,
            pdf
        };
    }

    /* ========================================================
     * REJECT NOTE
     *
     * No accounting effect.
     * ======================================================== */

    static async rejectNote(
        actor: any,
        noteId: string,
        remarks?: string
    ) {

        await this.ensurePermission(
            actor,
            "SALE:APPROVE"
        );

        const note =
            await prisma.debitCreditNote.findUnique({
                where: {
                    id: noteId
                }
            });

        if (!note) {
            throw new ApiError(
                "Debit/Credit note not found",
                404
            );
        }

        this.validateBranchAccess(
            actor,
            note.branchId
        );

        if (
            note.status !==
            DebitCreditNoteStatus.PENDING
        ) {
            throw new ApiError(
                "Only pending Debit/Credit notes can be rejected",
                400
            );
        }

        return prisma.debitCreditNote.update({
            where: {
                id: noteId
            },

            data: {
                status:
                    DebitCreditNoteStatus.REJECTED,

                approvedById:
                    actor.id,

                approvedAt:
                    new Date(),

                rejectionRemarks:
                    remarks?.trim() ||
                    null
            },

            include:
                includeNoteDetails
        });
    }

    /* ========================================================
     * GET NOTE
     * ======================================================== */

    static async getNoteById(
        actor: any,
        noteId: string
    ) {

        if (!actor?.id) {
            throw new ApiError(
                "Unauthorized",
                401
            );
        }

        const note =
            await prisma.debitCreditNote.findUnique({
                where: {
                    id: noteId
                },

                include:
                    includeNoteDetails
            });

        if (!note) {
            throw new ApiError(
                "Debit/Credit note not found",
                404
            );
        }

        this.validateBranchAccess(
            actor,
            note.branchId
        );

        return note;
    }

    /* ========================================================
     * LIST NOTES
     * ======================================================== */

    static async listNotes(
        actor: any,
        query: ListNoteQuery = {}
    ) {

        if (!actor?.id) {
            throw new ApiError(
                "Unauthorized",
                401
            );
        }

        const page =
            Math.max(
                Number(query.page) || 1,
                1
            );

        const limit =
            Math.max(
                Number(query.limit) || 10,
                1
            );

        const skip =
            (page - 1) * limit;

        if (
            query.type &&
            !Object.values(
                DebitCreditNoteType
            ).includes(query.type)
        ) {
            throw new ApiError(
                "Invalid note type",
                400
            );
        }

        if (
            query.status &&
            !Object.values(
                DebitCreditNoteStatus
            ).includes(query.status)
        ) {
            throw new ApiError(
                "Invalid note status",
                400
            );
        }

        if (
            query.sourceType &&
            !Object.values(
                DebitCreditNoteSourceType
            ).includes(query.sourceType)
        ) {
            throw new ApiError(
                "Invalid source type",
                400
            );
        }

        const where:
            Prisma.DebitCreditNoteWhereInput = {

            ...(query.agencyId && {
                agencyId:
                    query.agencyId
            }),

            ...(query.saleId && {
                saleId:
                    query.saleId
            }),

            ...(query.purchaseId && {
                purchaseId:
                    query.purchaseId
            }),

            ...(query.sourceType && {
                sourceType:
                    query.sourceType
            }),

            ...(query.type && {
                type:
                    query.type
            }),

            ...(query.status && {
                status:
                    query.status
            })
        };

        if (
            actor.branchAccessType !== "ALL"
        ) {
            where.branchId =
                actor.branchId;

        } else if (query.branchId) {

            where.branchId =
                query.branchId;
        }

        const [notes, total] =
            await Promise.all([

                prisma.debitCreditNote.findMany({
                    where,

                    include:
                        includeNoteDetails,

                    orderBy: {
                        createdAt: "desc"
                    },

                    skip,
                    take: limit
                }),

                prisma.debitCreditNote.count({
                    where
                })
            ]);

        return {
            data: notes,

            meta: {
                page,
                limit,
                total,

                totalPages:
                    Math.ceil(
                        total / limit
                    ),

                hasNextPage:
                    page * limit < total,

                hasPreviousPage:
                    page > 1
            }
        };
    }

    static async generatePdf(
        actor: any,
        noteId: string
    ) {

        await this.ensurePermission(
            actor,
            "SALE:VIEW"
        );

        const note =
            await this.getNoteById(
                actor,
                noteId
            );

        if (
            note.status !==
            DebitCreditNoteStatus.APPROVED
        ) {
            throw new ApiError(
                "PDF can only be generated for an approved Debit/Credit note",
                400
            );
        }

        if (!note.voucherId) {
            throw new ApiError(
                "Accounting voucher is missing for this approved Debit/Credit note",
                409
            );
        }

        const setting =
            await prisma.setting.findFirst();

        const templateData =
            DebitCreditNoteMapper.map(
                note,
                setting
            );

        const pdf =
            await DebitCreditNoteRenderer
                .generatePdf(
                    templateData
                );

        return {
            pdf,
            note
        };
    }
}

import { Request, Response, NextFunction } from "express";
import { DebitCreditNoteService } from "./debitCreditNote.service";

const actor = (req: Request) => (req as any).user;

export const getAgencyInvoices = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const invoices = await DebitCreditNoteService.getAgencyInvoices(actor(req), {
            agencyId: req.query.agencyId as string,
            branchId: req.query.branchId as string,
            sourceType: req.query.sourceType as any,
            search: req.query.search as string
        });

        return res.status(200).json({
            success: true,
            message: "Invoices retrieved successfully",
            data: {
                invoices
            }
        });
    } catch (error) {
        next(error);
    }
};

export const createNote = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const note = await DebitCreditNoteService.createNote(actor(req), req.body);

        return res.status(201).json({
            success: true,
            message: "Debit/Credit note created successfully",
            data: {
                note
            }
        });
    } catch (error) {
        next(error);
    }
};

export const listNotes = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const notes = await DebitCreditNoteService.listNotes(actor(req), {
            page:
                Number(req.query.page) || 1,

            limit:
                Number(req.query.limit) || 10,

            agencyId:
                req.query.agencyId as string,

            branchId:
                req.query.branchId as string,

            saleId:
                req.query.saleId as string,

            purchaseId:
                req.query.purchaseId as string,

            sourceType:
                req.query.sourceType as any,

            type:
                req.query.type as any,

            status:
                req.query.status as any
        });

        return res.status(200).json({
            success: true,
            message: "Debit/Credit notes retrieved successfully",
            data: notes
        });
    } catch (error) {
        next(error);
    }
};

export const getNoteById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const note = await DebitCreditNoteService.getNoteById(actor(req), (req as any).params.noteId);

        return res.status(200).json({
            success: true,
            message: "Debit/Credit note retrieved successfully",
            data: {
                note
            }
        });
    } catch (error) {
        next(error);
    }
};

export const approveNote = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const note = await DebitCreditNoteService.approveNote(actor(req), (req as any).params.noteId);

        return res.status(200).json({
            success: true,
            message: "Debit/Credit note approved successfully",
            data: {
                note
            }
        });
    } catch (error) {
        next(error);
    }
};

export const rejectNote = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const note = await DebitCreditNoteService.rejectNote(
            actor(req),
            (req as any).params.noteId,
            req.body?.remarks
        );

        return res.status(200).json({
            success: true,
            message: "Debit/Credit note rejected successfully",
            data: {
                note
            }
        });
    } catch (error) {
        next(error);
    }
};

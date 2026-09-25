import {
    Request,
    Response,
    NextFunction
} from "express";

import { JournalService } from "./journal.service";

export const createJournalCategory = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const category = await JournalService.createJournalCategory(
            (req as any).user,
            req.body
        );
        return res.status(201).json({
            success: true,
            message: "Journal category created successfully.",
            data: { category }
        });
    } catch (error) {
        next(error);
    }
};

export const updateJournalCategory = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const category = await JournalService.updateJournalCategory(
            (req as any).user,
            (req as any).params.categoryId,
            req.body
        );
        return res.status(200).json({
            success: true,
            message: "Journal category updated successfully.",
            data: { category }
        });
    } catch (error) {
        next(error);
    }
};

export const getJournalCategoryById = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const category = await JournalService.getJournalCategoryById(
            (req as any).params.categoryId
        );
        return res.status(200).json({ success: true, data: { category } });
    } catch (error) {
        next(error);
    }
};

export const listJournalCategories = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const categories = await JournalService.listJournalCategories({
            search: req.query.search as string,
            isActive: req.query.isActive !== undefined
                ? req.query.isActive === "true"
                : undefined
        });
        return res.status(200).json({ success: true, data: { categories } });
    } catch (error) {
        next(error);
    }
};

/** ---------------- JOURNAL HEAD ---------------- */

export const createJournalHead = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const actor = (req as any).user;

        const {
            name,
            type,
            headType,
            parentId,
        } = req.body;

        const journalHead =
            await JournalService.createJournalHead(
                actor,
                {
                    name,
                    type,
                    headType,
                    parentId
                }
            );

        return res.status(201).json({
            success: true,
            message: "Journal Head created successfully.",
            data: {
                journalHead
            }
        });
    }

    catch (error) {
        next(error);
    }

};

export const updateJournalHead = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const actor = (req as any).user;

        const {
            journalHeadId
        } = (req as any).params;

        const {
            name,
            type,
            headType,
            parentId,
            isActive
        } = req.body;

        const journalHead =
            await JournalService.updateJournalHead(

                journalHeadId,

                {
                    name,
                    type,
                    headType,
                    parentId,
                    isActive
                }

            );

        return res.status(200).json({
            success: true,
            message: "Journal Head updated successfully.",
            data: {
                journalHead
            }
        });

    }

    catch (error) {
        next(error);
    }

};

export const deleteJournalHead = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const {
            journalHeadId
        } = (req as any).params;

        await JournalService.deleteJournalHead(
            journalHeadId
        );

        return res.status(200).json({
            success: true,
            message: "Journal Head deleted successfully."
        });

    }

    catch (error) {
        next(error);
    }

};

export const getJournalHeadById = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const {

            journalHeadId

        } = (req as any).params;

        const journalHead =
            await JournalService.getJournalHeadById(
                journalHeadId
            );

        return res.status(200).json({
            success: true,
            message: "Journal Head retrieved successfully.",
            data: {
                journalHead
            }
        });

    }

    catch (error) {
        next(error);
    }

};

export const listJournalHeads = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const {
            search,
            type,
            headType,
            parentId,
            isActive
        } = (req as any).query;

        const journalHeads =
            await JournalService.listJournalHeads({
                search: search as string,
                type: type as any,
                headType: headType as any,
                parentId: parentId as string,
                isActive:
                    isActive !== undefined
                        ? isActive === "true"
                        : undefined
            });

        return res.status(200).json({
            success: true,
            message: "Journal Heads retrieved successfully.",
            data: {
                journalHeads
            }
        });

    }

    catch (error) {
        next(error);
    }

};

/** ---------------- JOURNAL ---------------- */

export const createJournal = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const actor =
            (req as any).user;

        const {
            branchId,
            agencyId,
            journalHeadId,
            categoryId,
            direction,
            type,
            amount,
            cgstAmount,
            sgstAmount,
            igstAmount,
            paymentMode,
            paymentThrough,
            remarks,
            journalDate
        } = req.body;

        const journal =
            await JournalService.createJournal(

                actor,

                {
                    branchId,
                    agencyId,
                    journalHeadId,
                    categoryId,
                    direction,
                    type,
                    amount,
                    cgstAmount,
                    sgstAmount,
                    igstAmount,
                    paymentMode,
                    paymentThrough,
                    remarks,
                    journalDate
                }
            );

        return res.status(201).json({
            success: true,
            message: "Journal created successfully.",
            data: {
                journal
            }
        });

    }

    catch (error) {
        next(error);
    }

};

export const updateJournal = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const actor =
            (req as any).user;

        const {
            journalId
        } = (req as any).params;

        const {
            branchId,
            agencyId,
            journalHeadId,
            categoryId,
            direction,
            type,
            amount,
            cgstAmount,
            sgstAmount,
            igstAmount,
            paymentMode,
            paymentThrough,
            remarks,
            journalDate
        } = req.body;

        const journal =
            await JournalService.updateJournal(
                actor,
                journalId,
                {
                    branchId,
                    agencyId,
                    journalHeadId,
                    categoryId,
                    direction,
                    type,
                    amount,
                    cgstAmount,
                    sgstAmount,
                    igstAmount,
                    paymentMode,
                    paymentThrough,
                    remarks,
                    journalDate
                }
            );

        return res.status(200).json({
            success: true,
            message: "Journal updated successfully.",
            data: {
                journal
            }
        });
    }

    catch (error) {
        next(error);
    }

};

export const getJournalById = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const {
            journalId
        } = (req as any).params;

        const journal =
            await JournalService.getJournalById(
                journalId
            );

        return res.status(200).json({
            success: true,
            message: "Journal retrieved successfully.",
            data: {
                journal
            }
        });
    }

    catch (error) {
        next(error);
    }

};

export const listJournals = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const {
            search,
            branchId,
            status,
            journalHeadId,
            agencyId,
            categoryId,
            fromDate,
            toDate
        } = req.query;

        const page =
            parseInt(
                req.query.page as string
            ) || 1;

        const limit =
            parseInt(
                req.query.limit as string
            ) || 20;

        const result =
            await JournalService.listJournals({

                page,

                limit,

                search: search as string,

                branchId: branchId as string,

                status: status as any,

                journalHeadId: journalHeadId as string,

                agencyId: agencyId as string,

                categoryId: categoryId as string,

                fromDate:
                    fromDate
                        ? new Date(fromDate as string)
                        : undefined,

                toDate:
                    toDate
                        ? new Date(toDate as string)
                        : undefined

            });

        return res.status(200).json({
            success: true,
            message: "Journals retrieved successfully.",
            data: result
        });

    }

    catch (error) {
        next(error);
    }

};

export const approveJournal = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const actor =
            (req as any).user;

        const {

            journalId

        } = (req as any).params;

        const journal =
            await JournalService.approveJournal(
                actor,
                journalId
            );

        return res.status(200).json({
            success: true,
            message: "Journal approved successfully.",
            data: {
                journal
            }
        });

    }

    catch (error) {
        next(error);
    }

};

export const rejectJournal = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const actor =
            (req as any).user;

        const {
            journalId
        } = (req as any).params;

        const {
            remarks
        } = (req as any).body;

        const journal =
            await JournalService.rejectJournal(
                actor,
                journalId,
                remarks
            );

        return res.status(200).json({
            success: true,
            message: "Journal rejected successfully.",
            data: {
                journal
            }
        });
    }

    catch (error) {
        next(error);
    }

};

export const deleteJournal = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const { journalId } = (req as any).params;
        await JournalService.deleteJournal(journalId);
        return res.status(200).json({
            success: true,
            message: "Journal deleted successfully."
        });
    } catch (error) {
        next(error);
    }
};

import { Request, Response, NextFunction } from 'express';
import { TransactionService } from './transac.service';


export const createTransaction = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const {
            branchId,
            direction,
            suspense,
            agencyId,
            paymentType,
            thirdPartyAgencyId,
            amount,
            paymentMode,
            transactionRefNo,
            remarks
        } = req.body;

        const transaction = await TransactionService.createTransaction(actor, {
            branchId,
            direction,
            suspense,
            agencyId,
            paymentType,
            thirdPartyAgencyId,
            amount,
            paymentMode,
            transactionRefNo,
            remarks
        });

        return res.status(201).json({
            success: true,
            message: "Transaction created successfully",
            data: transaction
        });
    } catch (error) {
        next(error);
    }
}

export const getAllTransactions = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const {
            page,
            limit,
            branchId,
            agencyId,
            status,
            direction,
            paymentType,
            search,
            suspenseAccount
        } = (req as any).query;

        const transactions = await TransactionService.getAllTransactions(actor, {
            page: Number(page) || 1,
            limit: Number(limit) || 10,
            branchId,
            agencyId,
            status,
            direction,
            paymentType,
            search,
            suspenseAccount
        });

        return res.status(200).json({
            success: true,
            message: "Transactions retrieved successfully",
            data: transactions
        });
    } catch (error) {
        next(error);
    }
}

export const getTransactionById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { transactionId } = (req as any).params;

        const transaction = await TransactionService.getTransactionById(actor, transactionId);

        return res.status(200).json({
            success: true,
            message: "Transaction retrieved successfully",
            data: transaction
        });
    } catch (error) {
        next(error);
    }
}


export const getAgencyOutstanding = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;

        const {
            branchId,
            agencyId,
            direction
        } = (req as any).query;

        const outstanding = await TransactionService.getAgencyOutstanding(
            actor,
            agencyId,
            branchId,
            direction
        );

        return res.status(200).json({
            success: true,
            message: "Agency outstanding retrieved successfully",
            data: outstanding
        });
    } catch (error) {
        next(error);
    }
}


export const approveTransaction = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { transactionId } = (req as any).params;

        const transaction = await TransactionService.approveTransaction(actor, transactionId);

        return res.status(200).json({
            success: true,
            message: "Transaction approved successfully",
            data: transaction
        });
    } catch (error) {
        next(error);
    }
}


export const rejectTransaction = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { transactionId } = (req as any).params;
        const { remarks } = req.body;

        const transaction = await TransactionService.rejectTransaction(actor, transactionId, remarks);

        return res.status(200).json({
            success: true,
            message: "Transaction rejected successfully",
            data: transaction
        });
    } catch (error) {
        next(error);
    }
}


export const updateTransaction = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { transactionId } = (req as any).params;
        const {
            branchId,
            direction,
            suspense,
            agencyId,
            paymentType,
            thirdPartyAgencyId,
            amount,
            paymentMode,
            transactionRefNo,
            remarks
        } = req.body;

        const transaction = await TransactionService.updateTransaction(actor, transactionId, {
            branchId,
            direction,
            suspense,
            agencyId,
            paymentType,
            thirdPartyAgencyId,
            amount,
            paymentMode,
            transactionRefNo,
            remarks
        });

        return res.status(200).json({
            success: true,
            message: "Transaction updated successfully",
            data: transaction
        });
    } catch (error) {
        next(error);
    }
}
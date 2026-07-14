import { Request, Response, NextFunction } from 'express';
import { TransactionService } from './transac.service';
import { ExcelService } from '../../core/utils/export.service';
import { transactionColumns } from '../exports/transaction.export';


export const createTransaction = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const {
            branchId,
            bankAccountId,
            direction,
            settlementType,

            suspense,

            agencyId,
            thirdPartyAgencyId,

            saleId,
            purchaseId,

            amount,

            paymentThrough,
            transactionRefNo,
            referenceNo,

            remarks
        } = req.body;

        const transaction = await TransactionService.createTransaction(actor, {
            branchId,
            bankAccountId,
            direction,

            settlementType,

            suspense,

            agencyId,
            thirdPartyAgencyId,

            saleId,
            purchaseId,

            amount,

            paymentThrough,
            transactionRefNo,
            referenceNo,

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
            settlementType,
            search,
            suspenseAccount,
        } = (req as any).query;
        const isExport = (req.query.export as string) === "true" || false;

        const transactions = await TransactionService.getAllTransactions(actor, {
            page: Number(page) || 1,
            limit: Number(limit) || 10,
            branchId,
            agencyId,
            status,
            direction,
            settlementType,
            search,
            suspenseAccount,
            export: isExport
        });

        if (isExport) {

            return ExcelService.export(
                res,
                {
                    filename: `transactions_${Date.now()}`,

                    title: "TRANSACTIONS",

                    sheetName: "Transactions",

                    columns: transactionColumns,

                    data: transactions.data
                }
            );
        }

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
        } = (req as any).query;

        const outstanding = await TransactionService.getAgencyOutstanding(
            actor,
            agencyId,
            branchId,
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
            bankAccountId,
            direction,

            settlementType,

            suspense,

            agencyId,
            thirdPartyAgencyId,

            saleId,
            purchaseId,

            amount,

            paymentThrough,
            transactionRefNo,
            referenceNo,

            remarks
        } = req.body;

        const transaction = await TransactionService.updateTransaction(actor, transactionId, {
            branchId,
            bankAccountId,
            direction,

            settlementType,

            suspense,

            agencyId,
            thirdPartyAgencyId,

            saleId,
            purchaseId,

            amount,

            paymentThrough,
            transactionRefNo,
            referenceNo,

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


export const getOutstandingInvoices = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const actor = (req as any).user;

        const {
            branchId,
            agencyId,
            direction,
            search
        } = req.query as any;

        const invoices =
            await TransactionService.getOutstandingInvoices(
                actor,
                {
                    branchId,
                    agencyId,
                    direction,
                    search
                }
            );

        return res.status(200).json({

            success: true,

            message: "Outstanding invoices fetched successfully",

            data: invoices

        });

    } catch (err) {
        next(err);
    }

};


export const previewFIFOAllocation = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;

        const {
            primaryAgencyId,
            thirdPartyAgencyId,
            branchId,
            direction,
            amount,
        } = (req as any).body;

        const preview = 
            await TransactionService.previewFIFOAllocation(
                actor,
                {
                    primaryAgencyId,
                    thirdPartyAgencyId,
                    branchId,
                    direction,
                    amount,
                }
            );

        return res.status(200).json({
            success: true,
            message: "FIFO allocation preview generated successfully",
            data: preview
        });
    } catch (error) {
        next(error);
    }
}
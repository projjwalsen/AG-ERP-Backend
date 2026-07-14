import { NextFunction, Request, Response } from "express";
import { BankService } from "./bank.service";

export const createBankAccount = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {

        const bankAccount =
            await BankService.createBankAccount(
                (req as any).user,
                req.body
            );

        return res.status(201).json({
            success: true,
            data: bankAccount
        });

    } catch (error) {
        next(error);
    }
};

export const getAllBankAccounts = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {

        const result =
            await BankService.getAllBankAccounts(
                (req as any).user,
                {
                    branchId:
                        req.query.branchId as string,

                    search:
                        req.query.search as string
                }
            );

        return res.status(200).json({
            success: true,
            ...result
        });

    } catch (error) {
        next(error);
    }
};

export const getBankAccountById = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {

        const bankAccount =
            await BankService.getBankAccountById(
                (req as any).user,
                (req.params.bankAccountId as string)
            );

        return res.status(200).json({
            success: true,
            data: bankAccount
        });

    } catch (error) {
        next(error);
    }
};

export const updateBankAccount = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {

        const bankAccount =
            await BankService.updateBankAccount(
                (req as any).user,
                (req.params.bankAccountId as string),
                req.body
            );

        return res.status(200).json({
            success: true,
            data: bankAccount
        });

    } catch (error) {
        next(error);
    }
};

export const toggleBankAccountStatus = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {

        const bankAccount =
            await BankService.toggleBankAccountStatus(
                (req as any).user,
                (req.params.bankAccountId as string),
                req.body
            );

        return res.status(200).json({
            success: true,
            data: bankAccount
        });

    } catch (error) {
        next(error);
    }
};

export const getBranchBankAccounts = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {

        const accounts =
            await BankService.getBranchBankAccounts(
                (req as any).user,
                (req.params.branchId as string)
            );

        return res.status(200).json({
            success: true,
            data: accounts
        });

    } catch (error) {
        next(error);
    }
};
import { Request, Response, NextFunction } from "express";
import { LedgerService } from "./ledger.service"; // Adjust path as needed
import { LedgerType } from "@prisma/client";
import { agencyLedgerColumns, branchLedgerColumns, ledgerColumns, suspenseLedgerColumns } from "../../exports/ledger.export";
import { ExcelService } from "../../../core/utils/export.service";
import { accountingLedgerColumns, bankAccCashColumns, cashBookColumns, creditorLedgerColumns, debtorLedgerColumns } from "../../exports/branch.export";

/**
 * @route   POST /api/ledgers
 * @desc    Create a new manual ledger master
 * @access  Protected
 */
// export const createLedger = async (req: Request, res: Response, next: NextFunction) => {
//     try {
//         const actor = (req as any).user; 
//         const payload = req.body;

//         const ledger = await LedgerService.createLedgerMaster(actor, payload);

//         res.status(201).json({
//             success: true,
//             message: "Ledger created successfully",
//             data: ledger
//         });
//     } catch (error) {
//         next(error);
//     }
// };

/**
 * @route   PUT /api/ledgers/:id
 * @desc    Update an existing ledger master
 * @access  Protected
 */
// export const updateLedger = async (req: Request, res: Response, next: NextFunction) => {
//     try {
//         const actor = (req as any).user;
//         const ledgerId = (req as any).params.id;
//         const payload = req.body;

//         const ledger = await LedgerService.updateLedgerMaster(actor, ledgerId, payload);

//         res.status(200).json({
//             success: true,
//             message: "Ledger updated successfully",
//             data: ledger
//         });
//     } catch (error) {
//         next(error);
//     }
// };

/**
 * @route   GET /api/ledgers
 * @desc    Get all ledgers with pagination and filters
 * @access  Protected
 */
export const getLedgers = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const isExport = (req.query.export as string) === "true" || false;
        
        const query = {
            branchId: (req as any).query.branchId as string,
            view: (req as any).query.view as
                "BRANCH" | "AGENCY" | "SUSPENSE" | undefined,
            category: (req as any).query.category as LedgerType,
            search: (req as any).query.search as string,
            isActive: (req as any).query.isActive !== undefined ? (req as any).query.isActive === "true" : undefined,
            page: (req as any).query.page ? parseInt((req as any).query.page as string, 10) : undefined,
            limit: (req as any).query.limit ? parseInt((req as any).query.limit as string, 10) : undefined,
            startDate: (req as any).query.startDate as string,
            endDate: (req as any).query.endDate as string,
            export: isExport,
        };

        const result = await LedgerService.getLedgers(actor, query);

        if (isExport) {

            let columns = ledgerColumns;

            if (query.view === "BRANCH") {
                columns = branchLedgerColumns;
            }

            if (query.view === "AGENCY") {
                columns = agencyLedgerColumns;
            }

            if (query.view === "SUSPENSE") {
                columns = suspenseLedgerColumns;
            }

            return ExcelService.export(
                res,
                {
                    filename: `ledger_${query.view || "default"}`,

                    sheetName:
                        query.view || "Ledgers",

                    columns,

                    data:
                        result.data
                }
            );
        }

        res.status(200).json({
            success: true,
            data: result.data,
            meta: result.meta
        });
    } catch (error) {
        next(error);
    }
};

export const getCompanyLedger = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {

        const actor =
            (req as any).user;

        const query = {

            branchId:
                req.query.branchId as string,

            startDate:
                req.query.startDate as string,

            endDate:
                req.query.endDate as string,

            page:
                Number(req.query.page || 1),

            limit:
                Number(req.query.limit || 50)
        };

        const isExport =
            String(req.query.export)
                .toLowerCase() === "true";

        const result =
            await LedgerService.getCompanyLedger(
                actor,
                {
                    ...query,
                    export: isExport
                }
            );

        if (isExport) {

            return ExcelService.exportAccountingLedger(
                res,
                {
                    filename:
                        "company-ledger",

                    title:
                        "ASHTAVINAYAKA COMPANY LEDGER",

                    period:
                        `${query.startDate || ""} - ${query.endDate || ""}`,

                    data:
                        result.entries
                }
            );
        }

        return res.status(200).json({

            success: true,

            message:
                "Company ledger fetched successfully",

            data:
                result
        });

    } catch (error) {
        next(error);
    }
};




/**
 * @route   GET /api/ledgers/:id
 * @desc    Get a single ledger by ID with current balance
 * @access  Protected
 */
export const getLedgerById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const ledgerId = (req as any).params.ledgerId;

        const ledger = await LedgerService.getLedgerById(actor, ledgerId);

        res.status(200).json({
            success: true,
            data: ledger
        });
    } catch (error) {
        next(error);
    }
};



export const getLedgerByBranchId = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {

        const actor = (req as any).user;

        const { branchId } = (req as any).params;

        const category =
            req.query.category as
                | "ACCOUNTING_LEDGER"
                | "CASH"
                | "DEBTORS"
                | "CREDITORS"
                | "GST"
                | undefined;
        const isExport = (req as any).query.export === "true" || false;
        const query = {
            startDate:
                req.query.startDate as string,
            endDate:
                req.query.endDate as string,
        }

        const result =
            await LedgerService.getLedgerByBranchId(
                actor,
                branchId,
                category,
                query
            );

        if (isExport) {

            switch (category) {

                case "ACCOUNTING_LEDGER":

                    return ExcelService.exportAccountingLedger(
                        res,
                        {
                            filename:
                                `branch-ledger-${result.branch.code}`,

                            title:
                                `${result.branch.name} BRANCH LEDGER`,

                            period:
                                `${req.query.startDate || ""} - ${req.query.endDate || ""}`,

                            data:
                                result.entries
                        }
                    );

                case "CASH":

                    return ExcelService.exportAccountingLedger(
                        res,
                        {
                            filename:
                                `branch-ledger-${result.branch.code}`,

                            title:
                                `${result.branch.name} BRANCH LEDGER`,

                            period:
                                `${req.query.startDate || ""} - ${req.query.endDate || ""}`,

                            data:
                                result.entries
                        }
                    );

                case "DEBTORS": {

                    const rows:any[] = [];

                    result.data.forEach((block:any) => {

                        block.entries.forEach((entry:any) => {

                            rows.push({

                                ledgerCode:
                                    block.ledger.code,

                                ledgerName:
                                    block.ledger.name,

                                date:
                                    entry.date,

                                voucherNo:
                                    entry.voucherNo,

                                voucherType:
                                    entry.voucherType,

                                debit:
                                    entry.debit,

                                credit:
                                    entry.credit,

                                runningBalance:
                                    entry.runningBalance,

                                balanceType:
                                    entry.balanceType,

                                narration:
                                    entry.narration
                            });
                        });
                    });

                    return ExcelService.export(
                        res,
                        {
                            filename:
                                "debtors-ledger",

                            sheetName:
                                "Debtors",

                            columns:
                                debtorLedgerColumns,

                            data:
                                rows
                        }
                    );
                }

                case "CREDITORS": {

                    const rows:any[] = [];

                    result.data.forEach((block:any) => {

                        block.entries.forEach((entry:any) => {

                            rows.push({

                                ledgerCode:
                                    block.ledger.code,

                                ledgerName:
                                    block.ledger.name,

                                date:
                                    entry.date,

                                voucherNo:
                                    entry.voucherNo,

                                voucherType:
                                    entry.voucherType,

                                debit:
                                    entry.debit,

                                credit:
                                    entry.credit,

                                runningBalance:
                                    entry.runningBalance,

                                balanceType:
                                    entry.balanceType,

                                narration:
                                    entry.narration
                            });
                        });
                    });

                    return ExcelService.export(
                        res,
                        {
                            filename:
                                "creditors-ledger",

                            sheetName:
                                "Creditors",

                            columns:
                                creditorLedgerColumns,

                            data:
                                rows
                        }
                    );
                }
            }
        }

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        next(error);
    }
};



export const getLedgerByAgencyId = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {

        const actor = (req as any).user;

        const { agencyId } = (req as any).params;

        const category =
            req.query.category as
                | "ACCOUNTING_LEDGER"
                | "CASH"
                | "DEBTORS"
                | "CREDITORS"
                | undefined;

        const isExport =
            req.query.export === "true";

        const query = {
            startDate:
                req.query.startDate as string,
            endDate:
                req.query.endDate as string,
        }

        const result =
            await LedgerService.getLedgerByAgencyId(
                actor,
                agencyId,
                category,
                query
            );

        if (isExport) {

            switch (category) {

                case "ACCOUNTING_LEDGER":

                    return ExcelService.export(
                        res,
                        {
                            filename:
                                "agency-accounting-ledger",

                            sheetName:
                                "Accounting Ledger",

                            columns:
                                accountingLedgerColumns,

                            data:
                                result.entries as any[]
                        }
                    );

                case "CASH":

                    return ExcelService.export(
                        res,
                        {
                            filename:
                                "agency-cash-book",

                            sheetName:
                                "Cash Book",

                            columns:
                                cashBookColumns,

                            data:
                                result.entries as any[]
                        }
                    );

                case "DEBTORS": {

                    const rows: any[] = [];

                    result.data.forEach((block: any) => {

                        block.entries.forEach((entry: any) => {

                            rows.push({

                                ledgerCode:
                                    block.ledger.code,

                                ledgerName:
                                    block.ledger.name,

                                ...entry
                            });
                        });
                    });

                    return ExcelService.export(
                        res,
                        {
                            filename:
                                "agency-debtors",

                            sheetName:
                                "Debtors",

                            columns:
                                debtorLedgerColumns,

                            data:
                                rows
                        }
                    );
                }

                case "CREDITORS": {

                    const rows: any[] = [];

                    result.data.forEach((block: any) => {

                        block.entries.forEach((entry: any) => {

                            rows.push({

                                ledgerCode:
                                    block.ledger.code,

                                ledgerName:
                                    block.ledger.name,

                                ...entry
                            });
                        });
                    });

                    return ExcelService.export(
                        res,
                        {
                            filename:
                                "agency-creditors",

                            sheetName:
                                "Creditors",

                            columns:
                                creditorLedgerColumns,

                            data:
                                rows
                        }
                    );
                }

                default:

                    return ExcelService.export(
                        res,
                        {
                            filename:
                                "agency-accounting-ledger",

                            sheetName:
                                "Accounting Ledger",

                            columns:
                                accountingLedgerColumns,

                            data:
                                result.entries as any[]
                        }
                    );
            }
        }

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        next(error);
    }
};


export const getLedgerBySuspenseId = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {

        const actor = (req as any).user;

        const { branchId } = (req as any).params;

        const category =
            req.query.category as
                | "ACCOUNTING_LEDGER"
                | "CASH"
                | undefined;

        const result =
            await LedgerService.getLedgerBySuspenseId(
                actor,
                branchId,
                category
            );

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        next(error);
    }
};


/**
 * @route   GET /api/ledgers/:id/statement
 * @desc    Get detailed account statement (Passbook) for a ledger
 * @access  Protected
 */
export const getLedgerStatement = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const ledgerId = (req as any).params.ledgerId;

        const query = {
            startDate: (req as any).query.startDate as string,
            endDate: (req as any).query.endDate as string,
            page: (req as any).query.page ? parseInt((req as any).query.page as string, 10) : undefined,
            limit: (req as any).query.limit ? parseInt((req as any).query.limit as string, 10) : undefined,
        };

        const statement = await LedgerService.getLedgerStatement(actor, ledgerId, query);

        res.status(200).json({
            success: true,
            data: statement
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @route   POST /api/ledgers/:id/opening-balance
 * @desc    Set or update the opening balance for a ledger
 * @access  Protected
 */
export const setOpeningBalance = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const ledgerId = (req as any).params.ledgerId;
        const { openingBalance } = req.body;

        if (openingBalance === undefined || openingBalance === null) {
            return res.status(400).json({
                success: false,
                message: "openingBalance is required in request body"
            });
        }

        const result = await LedgerService.setOpeningBalance(actor, ledgerId, Number(openingBalance));

        res.status(200).json({
            success: true,
            message: "Opening balance updated successfully",
            data: result
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @route   GET /api/reports/trial-balance
 * @desc    Generate a Trial Balance report
 * @access  Protected
 */
export const getTrialBalance = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;

        const query = {
            branchId: req.query.branchId as string,
            groupCode: req.query.groupCode as string,
            includeZero: req.query.includeZero === "true",
        };

        const trialBalance = await LedgerService.getTrialBalance(actor, query);

        res.status(200).json({
            success: true,
            data: trialBalance
        });
    } catch (error) {
        next(error);
    }
};

/**
 * @route   GET /api/ledger-groups
 * @desc    Get all hierarchical Tally-style ledger groups
 * @access  Protected
 */
export const getLedgerGroups = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const groups = await LedgerService.getLedgerGroups();

        res.status(200).json({
            success: true,
            data: groups
        });
    } catch (error) {
        next(error);
    }
};
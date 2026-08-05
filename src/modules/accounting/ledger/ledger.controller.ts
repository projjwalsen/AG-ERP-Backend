import { Request, Response, NextFunction } from "express";
import { LedgerService } from "./ledger.service"; // Adjust path as needed
import { LedgerType } from "@prisma/client";
import { agencyLedgerColumns, branchLedgerColumns, ledgerColumns, suspenseLedgerColumns } from "../../exports/ledger.export";
import { ExcelService } from "../../../core/utils/export.service";
import { accountingLedgerColumns, bankAccCashColumns, cashBookColumns, creditorLedgerColumns, debtorLedgerColumns } from "../../exports/branch.export";
import { formatISTDate } from "../../../core/utils/loc.utils";
import { prisma } from "../../../config/db";

const buildSundryLedgerRows = (blocks: any[]) => {
    return blocks
        .map((block: any) => {
            const dates = block.entries
                .map((entry: any) => new Date(entry.date))
                .filter((date: Date) => !isNaN(date.getTime()))
                .sort(
                    (a: Date, b: Date) =>
                        a.getTime() - b.getTime()
                );

            const firstDate = dates[0];
            const lastDate = dates[dates.length - 1];

            const rowDate = firstDate
                ? firstDate.getTime() === lastDate.getTime()
                    ? formatISTDate(firstDate)
                    : `${formatISTDate(firstDate)} - ${formatISTDate(lastDate)}`
                : "";

            return {
                date: rowDate,
                rawStartDate: firstDate,
                rawEndDate: lastDate,
                particulars: block.ledger.name,
                openingBalance:
                    `${block.summary.openingBalance.toFixed(2)} ${block.summary.openingBalanceType}`,
                debit: Number(block.summary.totalDebit || 0),
                credit: Number(block.summary.totalCredit || 0),
                balance:
                    `${block.summary.closingBalance.toFixed(2)} ${block.summary.closingBalanceType}`
            };
        })
        .sort(
            (a: any, b: any) =>
                a.particulars.localeCompare(b.particulars)
        );
};

const getSundryLedgerPeriod = (
    rows: any[],
    startDate?: string,
    endDate?: string
) => {
    if (startDate || endDate) {
        return `${startDate || ""} - ${endDate || ""}`;
    }

    const startDates = rows
        .map(row => row.rawStartDate)
        .filter(Boolean);

    const endDates = rows
        .map(row => row.rawEndDate)
        .filter(Boolean);

    if (!startDates.length || !endDates.length) {
        return "";
    }

    const firstDate = startDates.reduce(
        (earliest, date) =>
            date.getTime() < earliest.getTime()
                ? date
                : earliest
    );

    const lastDate = endDates.reduce(
        (latest, date) =>
            date.getTime() > latest.getTime()
                ? date
                : latest
    );

    return `${formatISTDate(firstDate)} - ${formatISTDate(lastDate)}`;
};

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
            let title = `Ledger - ${query.view || "All"}`;

            if (query.view === "BRANCH") {
                title = `Branch Ledger - ${query.branchId || "All"}`;
                columns = branchLedgerColumns;
            }

            if (query.view === "AGENCY") {
                title = `Agency Ledger - All`;
                columns = agencyLedgerColumns;
            }

            if (query.view === "SUSPENSE") {
                title = `Suspense Ledger - All`;
                columns = suspenseLedgerColumns;
            }

            return ExcelService.export(
                res,
                {
                    filename: `ledger_${query.view || "default"}`,

                    title: title,

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
                Number(req.query.limit || 10)
        };

        console.log("getCompanyLedger query :", query);

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

                    companyName:
                        "ASHTAVINAYAKA",

                    fromDate:
                        req.query.startDate as string,

                    toDate:
                        req.query.endDate as string,

                    openingBalance:
                        result.summary.openingBalance,

                    totalIncome:
                        result.summary.totalIncome,

                    totalExpense:
                        result.summary.totalExpense,

                    closingBalance:
                        result.summary.closingBalance,

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

        if (
            !query.startDate &&
            (category === "DEBTORS" || category === "CREDITORS")
        ) {

            const firstVoucher =
                await prisma.voucher.findFirst({

                    where: {
                        entries: {
                            some: {
                                ledger: {
                                    branchId,
                                    category:
                                        category === "DEBTORS"
                                            ? LedgerType.CUSTOMER
                                            : LedgerType.VENDOR
                                }
                            }
                        }
                    },

                    orderBy: {
                        voucherDate: "asc"
                    },

                    select: {
                        voucherDate: true
                    }
                });

            if (firstVoucher) {

                query.startDate =
                    firstVoucher.voucherDate
                        .toISOString()
                        .split("T")[0];
            }

            query.endDate =
                new Date()
                    .toISOString()
                    .split("T")[0];
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

                            sheetName:
                                "Accounting Ledger",

                            title:
                                `${result.branch.name} BRANCH ACCOUNTING LEDGER`,

                            companyName:
                                result.branch.name,

                            fromDate:
                                req.query.startDate as string,

                            toDate:
                                req.query.endDate as string,

                            openingBalance:
                                result.summary.openingBalance,

                            totalIncome:
                                result.summary.totalIncome,

                            totalExpense:
                                result.summary.totalExpense,

                            closingBalance:
                                result.summary.closingBalance,

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

                            sheetName:
                                "Cash Ledger",

                            title:
                                `${result.branch.name} BRANCH CASH LEDGER`,

                            companyName:
                                result.branch.name,

                            fromDate:
                                req.query.startDate as string,

                            toDate:
                                req.query.endDate as string,

                            openingBalance:
                                0,

                            totalIncome:
                                result.summary.totalIncome,

                            totalExpense:
                                result.summary.totalExpense,

                            closingBalance:
                                result.summary.closingBalance,

                            data:
                                result.entries
                        }
                    );

                case "DEBTORS": {

                    const rows =
                        buildSundryLedgerRows(
                            result.data
                        );

                    const exportPeriod =
                        getSundryLedgerPeriod(
                            rows,
                            query.startDate,
                            query.endDate
                        );

                    return ExcelService.exportSundryLedger(
                        res,
                        {
                            filename:
                                "debtors-ledger",

                            sheetName:
                                "Sundry Debtors",

                            title:
                                "Sundry Debtors",

                            companyName:
                                result.branch.name,

                            period: exportPeriod,

                            data:
                                result.data
                        }
                    );
                }

                case "CREDITORS": {

                    const rows =
                        buildSundryLedgerRows(
                            result.data
                        );

                    const exportPeriod =
                        getSundryLedgerPeriod(
                            rows,
                            query.startDate,
                            query.endDate
                        );

                    return ExcelService.exportSundryLedger(
                        res,
                        {
                            filename:
                                "creditors-ledger",

                            sheetName:
                                "Sundry Creditors",

                            title:
                                "Sundry Creditors",

                            companyName:
                                result.branch.name,

                            period: exportPeriod,

                            data:
                                result.data
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

                            title:
                                `${result.agency.name} ACCOUNTING LEDGER`,

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

                            title:
                                `${result.agency.name} CASH BOOK`,

                            sheetName:
                                "Cash Book",

                            columns:
                                cashBookColumns,

                            data:
                                result.entries as any[]
                        }
                    );
                default:

                    return ExcelService.export(
                        res,
                        {
                            filename:
                                "agency-accounting-ledger",

                            title:
                                `${result.agency.name} ACCOUNTING LEDGER`,

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

export const getGSTLedger =
async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const actor =
            (req as any).user;

        const result =
            await LedgerService.getGSTLedger(
                actor,
                {
                    branchId:
                        req.query.branchId as string,

                    startDate:
                        req.query.startDate as string,

                    endDate:
                        req.query.endDate as string
                }
            );

        const isExport =
            String(
                req.query.export
            ).toLowerCase() === "true";

        if (isExport) {

            return ExcelService.exportGSTLedger(
                res,
                result
            );
        }

        return res.status(200).json({

            success: true,

            message:
                "GST Ledger fetched successfully",

            data:
                result
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

        const result =
            await LedgerService.getLedgerBySuspenseId(
                actor,
                branchId,
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

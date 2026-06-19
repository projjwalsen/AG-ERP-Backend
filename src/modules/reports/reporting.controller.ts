import { Request, Response, NextFunction } from "express";
import { LedgerService } from "../accounting/ledger/ledger.service";
import { ReportingService } from "./reporting.service";


export const getBranchDayBook = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const actor = (req as any).user;
        const { branchId } = (req as any).params;

        const query = {
            startDate: (req as any).query.startDate as string,
            endDate: (req as any).query.endDate as string
        };

        const result = await ReportingService.getBranchDayBook(
            actor,
            branchId,
            query
        );

        return res.status(200).json({
            success: true,
            data: result
        });

    } catch (error) {
        next(error);
    }
}

import { Request, Response, NextFunction } from "express";
import { KPIService } from "./kpi.service";


export const getDashboardKPIs = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {

        const actor =
            (req as any).user;

        const result =
            await KPIService.getDashboardKPIs(
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

        return res.status(200).json({

            success: true,

            message:
                "Dashboard KPIs fetched successfully",

            data: result
        });

    } catch (error) {

        next(error);
    }
};
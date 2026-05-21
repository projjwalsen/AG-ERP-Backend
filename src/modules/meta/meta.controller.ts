import { Request, Response, NextFunction } from "express";
import { LocationService } from "./meta.loc.service";
import { ApiError } from "../../core/middleware/errorHandler";

export const getIndianStates = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const states =
            await LocationService.getIndianStates();

        return res.status(200).json({
            success: true,
            message: "Indian states fetched successfully",
            data: {
                states,
            },
        });
    } catch (error) {
        next(error);
    }
}

export const getCitiesByState = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const { isoCode } = (req as any).params;

        if(!isoCode) {
            throw new ApiError(
                "State ISO Code is required",
                400
            )
        }

        const cities = await LocationService.getCitiesByState(isoCode);

        return res.status(200).json({
            success: true,
            message: "Cities fetched successfully",
            data: {
                cities,
            },
        });
    } catch (error) {
        next(error);
    }
}
import { Request, Response, NextFunction } from "express";
import { SettingService } from "./setting.service";

export const getSettings = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const settings = await SettingService.getSettings(actor);
        
        return res.status(200).json({
            success: true,
            message: "Settings retrieved successfully",
            data: settings
        });
    } catch (error) {
        next(error);
    }
}


export const updateSettings = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { allowNegativeInventory, allowNegativeTransaction } = (req as any).body;

        const updatedSettings = await SettingService.updateSettings(actor, {
            allowNegativeInventory,
            allowNegativeTransaction
        });

        return res.status(200).json({
            success: true,
            message: "Settings updated successfully",
            data: updatedSettings
        });
    } catch (error) {
        next(error);
    }
}
import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";

export class SettingService {

    static async getSettings(actor: any) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        let settings = await prisma.setting.findFirst();

        if (!settings) {
            settings = await prisma.setting.create({
                data: {}
            });
        }

        return settings;
    }

    static async updateSettings(
        actor: any,
        payload: {
            allowNegativeInventory?: boolean;
            allowNegativeTransaction?: boolean;
        }
    ) {
        if (!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        let settings = await prisma.setting.findFirst();

        if (!settings) {
            settings = await prisma.setting.create({
                data: {}
            });
        }

        return prisma.setting.update({
            where: {
                id: settings.id
            },
            data: {
                ...(payload.allowNegativeInventory !== undefined && {
                    allowNegativeInventory:
                        payload.allowNegativeInventory
                }),
                ...(payload.allowNegativeTransaction !== undefined && {
                    allowNegativeTransaction:
                        payload.allowNegativeTransaction
                })
            }
        });
    }
}
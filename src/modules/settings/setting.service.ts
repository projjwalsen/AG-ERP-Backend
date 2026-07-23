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
            sellerLogo?: string | null;
            sellerCIN?: string | null;
            companyPAN?: string | null;
            signatureImage?: string | null;
            jurisdictionText?: string | null;
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
                }),
                ...(payload.sellerLogo !== undefined && {
                    sellerLogo: payload.sellerLogo?.trim() || null
                }),
                ...(payload.sellerCIN !== undefined && {
                    sellerCIN: payload.sellerCIN?.trim() || null
                }),
                ...(payload.companyPAN !== undefined && {
                    companyPAN: payload.companyPAN?.trim() || null
                }),
                ...(payload.signatureImage !== undefined && {
                    signatureImage:
                        payload.signatureImage?.trim() || null
                }),
                ...(payload.jurisdictionText !== undefined && {
                    jurisdictionText:
                        payload.jurisdictionText?.trim() || null
                })
            }
        });
    }
}
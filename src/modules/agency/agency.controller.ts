import { Request, Response, NextFunction } from "express";
import { AgencyService } from "./agency.service";
import { ExcelService } from "../../core/utils/export.service";
import { agencyExportColumns } from "../exports/agency.export";

export const createAgency = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;

        const {
            name, type, gstin, contactPerson, mobileNumber, email, 
            addressLine1, addressLine2, city, state, stateCode ,pinCode, branches
        } = req.body;

        const agency = await AgencyService.createAgency(actor, {
            name, type, gstin, contactPerson, mobileNumber, email,
            addressLine1, addressLine2, city, state, stateCode ,pinCode, branches
        });

        return res.status(201).json({
            success: true,
            message: "Agency created successfully",
            data: { agency }
        });

    } catch (error) {
        next(error);
    }
}


export const getAllAgencies = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;

        const page  = parseInt(req.query.page as string)  || 1;
        const limit = parseInt(req.query.limit as string) || 100;
        const isExport = (req.query.export as string) === "true" || false;
        const result = await AgencyService.getAllAgencies(actor, {
            search: req.query.search as string | undefined,
            type: req.query.type as any,
            branch: req.query.branch as string | undefined,
            page,
            limit,
            export: isExport
        });

        if (isExport) {

            const rows = result.data.flatMap(
                agency =>
                    agency.branches.map(
                        branch => ({
                            agencyName:
                                agency.name,

                            type:
                                agency.type,

                            gstin:
                                agency.gstin,

                            contactPerson:
                                agency.contactPerson,

                            mobileNumber:
                                agency.mobileNumber,

                            email:
                                agency.email,

                            city:
                                agency.city,

                            state:
                                agency.state,

                            branchName:
                                branch.branch.name,

                            branchCode:
                                branch.branch.code,

                            openingBalance:
                                branch.openingBalance,

                            isActive:
                                agency.isActive
                        })
                    )
            );

            return ExcelService.export(
                res,
                {
                    filename: "agencies",

                    title: "AGENCIES",

                    sheetName: "Agencies",

                    columns:
                        agencyExportColumns,

                    data: rows
                }
            );
        }

        return res.status(200).json({
            success: true,
            message: "Agencies retrieved successfully",
            data: {
                agencies: result.data,
                meta: result.meta
            }
        });
    } catch (error) {
        next(error);
    }
}


export const getAgencyById = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { agencyId } = (req as any).params;

        const agency = await AgencyService.getAgencyById(actor, agencyId);

        return res.status(200).json({
            success: true,
            message: "Agency retrieved successfully",
            data: { agency }
        });
    } catch (error) {
        next(error);
    }
}


export const updateAgency = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { agencyId } = (req as any).params;

        const {
            name, type, gstin, contactPerson, mobileNumber, email,
            addressLine1, addressLine2, city, state, stateCode ,pinCode, branches
        } = req.body;

        const agency = await AgencyService.updateAgency(actor, agencyId, {
            name, type, gstin, contactPerson, mobileNumber, email,
            addressLine1, addressLine2, city, state, stateCode ,pinCode, branches
        });

        return res.status(200).json({
            success: true,
            message: "Agency updated successfully",
            data: { agency }
        });
    } catch (error) {
        next(error);
    }
}


export const toggleAgencyStatus = async (req: Request, res: Response, next: NextFunction) => {
    try {
        const actor = (req as any).user;
        const { agencyId } = (req as any).params;
        const { isActive } = req.body;

        const agency = await AgencyService.toggleAgencyStatus(actor, agencyId, { isActive });

        return res.status(200).json({
            success: true,
            message: `Agency ${isActive ? "activated" : "deactivated"} successfully`,
            data: { agency }
        });
    } catch (error) {
        next(error);
    }
}
import {
    Request,
    Response,
    NextFunction
} from "express";

import {
    ProductUnit,
    PurchaseOrderStatus
} from "@prisma/client";
import { PurchaseOrderService } from "./po.service";




const actor = (req: Request) =>
    (req as any).user;


/* ============================================================
 * CREATE PURCHASE ORDER
 * ============================================================ */

export const createPurchaseOrder = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const {
            agencyId,
            branchId,
            remarks,
            items
        } = req.body;

        const purchaseOrder =
            await PurchaseOrderService
                .createPurchaseOrder(
                    actor(req),
                    {
                        agencyId,
                        branchId,
                        remarks,

                        items:
                            Array.isArray(items)
                                ? items.map(
                                    (item: any) => ({
                                        productId:
                                            item.productId,

                                        quantity:
                                            Number(
                                                item.quantity
                                            ),

                                        unit:
                                            item.unit as ProductUnit,

                                        purchasePrice:
                                            Number(
                                                item.purchasePrice
                                            )
                                    })
                                )
                                : items
                    }
                );

        return res.status(201).json({
            success: true,

            message:
                "Purchase order created successfully",

            data: {
                purchaseOrder
            }
        });

    } catch (error) {

        next(error);

    }
};


/* ============================================================
 * LIST PURCHASE ORDERS
 * ============================================================ */

export const listPurchaseOrders = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const purchaseOrders =
            await PurchaseOrderService
                .listPurchaseOrders(
                    actor(req),
                    {
                        page:
                            req.query.page
                                ? Number(req.query.page)
                                : undefined,

                        limit:
                            req.query.limit
                                ? Number(req.query.limit)
                                : undefined,

                        agencyId:
                            req.query.agencyId
                                ? String(
                                    req.query.agencyId
                                )
                                : undefined,

                        branchId:
                            req.query.branchId
                                ? String(
                                    req.query.branchId
                                )
                                : undefined,

                        status:
                            req.query.status
                                ? req.query.status as
                                    PurchaseOrderStatus
                                : undefined,

                        search:
                            req.query.search
                                ? String(
                                    req.query.search
                                )
                                : undefined
                    }
                );

        return res.status(200).json({
            success: true,

            message:
                "Purchase orders retrieved successfully",

            data:
                purchaseOrders
        });

    } catch (error) {

        next(error);

    }
};


/* ============================================================
 * GET PURCHASE ORDER BY ID
 * ============================================================ */

export const getPurchaseOrderById = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const purchaseOrder =
            await PurchaseOrderService
                .getPurchaseOrderById(
                    actor(req),
                    (req as any).params.purchaseOrderId
                );

        return res.status(200).json({
            success: true,

            message:
                "Purchase order retrieved successfully",

            data: {
                purchaseOrder
            }
        });

    } catch (error) {

        next(error);

    }
};


/* ============================================================
 * APPROVE PURCHASE ORDER
 * ============================================================ */

export const approvePurchaseOrder = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const purchaseOrder =
            await PurchaseOrderService
                .approvePurchaseOrder(
                    actor(req),
                    (req as any).params.purchaseOrderId
                );

        return res.status(200).json({
            success: true,

            message:
                "Purchase order approved successfully",

            data: {
                purchaseOrder
            }
        });

    } catch (error) {

        next(error);

    }
};


/* ============================================================
 * REJECT PURCHASE ORDER
 * ============================================================ */

export const rejectPurchaseOrder = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const purchaseOrder =
            await PurchaseOrderService
                .rejectPurchaseOrder(
                    actor(req),
                    (req as any).params.purchaseOrderId,
                    req.body?.remarks
                );

        return res.status(200).json({
            success: true,

            message:
                "Purchase order rejected successfully",

            data: {
                purchaseOrder
            }
        });

    } catch (error) {

        next(error);

    }
};


/* ============================================================
 * PURCHASE INVOICE ENTRY -- Form population endpoint
 * ============================================================ */

export const getPurchaseInvoiceEntry = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const data =
            await PurchaseOrderService
                .getPurchaseInvoiceEntry(
                    actor(req),
                    (req as any).params.purchaseOrderId
                );

        return res.status(200).json({
            success: true,

            message:
                "Purchase invoice entry data retrieved successfully",

            data
        });

    } catch (error) {

        next(error);
    }
};



/**
 * ============================================================
 * CREATE PURCHASE INVOICE
 * ============================================================
 */

// export const createPurchaseFromOrder = async (
//     req: Request,
//     res: Response,
//     next: NextFunction
// ) => {

//     try {

//         const purchase =
//             await PurchaseOrderService
//                 .createPurchaseFromOrder(
//                     actor(req),
//                     (req as any).params.purchaseOrderId,
//                     req.body
//                 );

//         return res.status(201).json({

//             success: true,

//             message:
//                 "Purchase invoice created successfully from purchase order",

//             data: {
//                 purchase
//             }
//         });

//     } catch (error) {

//         next(error);
//     }
// };


export const purchaseOrderPdf =
    async (
        req: Request,
        res: Response,
        next: NextFunction
    ) => {

        try {

            const {
                purchaseOrderId
            } = (req as any).params;


            const download =
                String(
                    req.query.download
                ).toLowerCase() ===
                "true";


            const result =
                await PurchaseOrderService
                    .generatePurchaseOrderPdf(
                        actor(req),
                        purchaseOrderId
                    );


            const safePoNo =
                result.poNo
                    .replace(
                        /[^a-zA-Z0-9-_]/g,
                        "_"
                    );


            const fileName =
                `Purchase-Order-${safePoNo}.pdf`;


            res.setHeader(
                "Content-Type",
                "application/pdf"
            );


            res.setHeader(
                "Content-Disposition",

                download
                    ? `attachment; filename="${fileName}"`
                    : `inline; filename="${fileName}"`
            );


            return res.send(
                result.pdf
            );

        } catch (error) {

            next(error);

        }
    };
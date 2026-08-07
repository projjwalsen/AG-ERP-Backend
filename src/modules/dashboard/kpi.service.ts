import { Prisma, PurchaseStatus, SalesStatus, TransactionDirection, TransactionStatus } from "@prisma/client";
import { ApiError } from "../../core/middleware/errorHandler";
import { parseDate } from "../../core/utils/loc.utils";
import { prisma } from "../../config/db";

export class KPIService {

    static async getDashboardKPIs(
        actor: any,
        query?: {
            branchId?: string,
            startDate?: string,
            endDate?: string
        }
    ) {
        if(!actor?.id) {
            throw new ApiError("Unauthorized", 401);
        }

        const branchId = actor.branchAccessType === "ALL"
            ? query?.branchId
            : actor.branchId;

        const startDate =
            query?.startDate
                ? parseDate(
                    query.startDate,
                    "startDate"
                )
                : undefined;

        const endDate =
            query?.endDate
                ? parseDate(
                    query.endDate,
                    "endDate"
                )
                : new Date();

        if (startDate) {
            startDate.setHours(0, 0, 0, 0);
        }

        if (endDate) {
            endDate.setHours(23, 59, 59, 999);
        }

        const dateFilter =
        startDate || endDate
            ? {
                createdAt: {
                    ...(startDate && {
                        gte: startDate
                    }),
                    ...(endDate && {
                        lte: endDate
                    })
                }
            }
            : {};

            
        const [
            revenue,
            purchases,
            sales,
            users,
            inventoryBatches,
            agencies,
            branchRevenue,
            inventories,
            recentTransactions
        ] = await Promise.all([
            /** ---------- REVENUE -------------- */
            prisma.transaction.aggregate({
                where: {
                    status: TransactionStatus.APPROVED,
                    direction: TransactionDirection.INWARD,
                    ...(branchId && { branchId }),
                    ...dateFilter
                },
                _sum: {
                    amount: true
                }
            }),

            /** ---------- PURCHASES -------------- */
            prisma.purchase.aggregate({
                where: {
                    status: PurchaseStatus.APPROVED,

                    ...(branchId && {
                        branchId
                    }),

                    ...dateFilter
                },
                _sum: {
                    grandTotal: true
                }
            }),

            /** ---------- SALES -------------- */
            prisma.sale.aggregate({
                where: {
                    status: SalesStatus.APPROVED,
                    ...(branchId && { branchId }),
                    ...dateFilter
                },
                _sum: {
                    grandTotal: true
                }
            }),

            /** ---------- USERS -------------- */
            prisma.user.count({
                where: {
                    isActive: true,
                }
            }),

            /** ---------- INVENTORY BATCHES -------------- */
            prisma.inventoryBatch.findMany({
                where: {
                    isActive: true,
                    ...(branchId && { branchId })
                },
                select: {
                    availableQtyKG: true,
                    purchasePrice: true,
                }
            }),

            /** ---------- AGENCIES -------------- */
            prisma.agency.findMany({
                select: {
                    amountReceivable: true,
                    amountPayable: true 
                }
            }),

            /** ---------- BRANCH MONTHLY REVENUE -------------- */
            prisma.$queryRaw<
                {
                    branchId: string;
                    month: number;
                    year: number;
                    revenue: number;
                }[]
            >`
            SELECT
                "branchId",
                EXTRACT(MONTH FROM "createdAt")::int AS month,
                EXTRACT(YEAR FROM "createdAt")::int AS year,
                SUM("amount")::numeric AS revenue
            FROM "Transaction"
            WHERE
                status = 'APPROVED'
                AND direction = 'INWARD'
                ${branchId ? Prisma.sql`AND "branchId" = ${branchId}` : Prisma.sql``}
                ${startDate ? Prisma.sql`AND "createdAt" >= ${startDate}` : Prisma.sql``}
                ${endDate ? Prisma.sql`AND "createdAt" <= ${endDate}` : Prisma.sql``}
            GROUP BY
                "branchId",
                year,
                month
            ORDER BY
                year,
                month
            `,

            /** ---------- INVENTORIES -------------- */
            prisma.inventory.findMany({

                where: {
                    ...(branchId && {
                        branchId
                    })
                },

                include: {
                    product: true
                }
            }),

            /** ---------- RECENT TRANSACTIONS -------------- */
            prisma.transaction.findMany({
                where: {

                    status:
                        TransactionStatus.APPROVED,

                    ...(branchId && {
                        branchId
                    })
                },
                include: {
                    agency: true,
                    branch: true
                },
                take: 10,
                orderBy: {
                    createdAt: "desc"
                }
            })
        ])


        const inventoryValues = inventoryBatches.reduce(
            (sum, batch) => 
                sum +
                Number(batch.availableQtyKG) * Number(batch.purchasePrice),
            0
        );

        const outstanding = agencies.reduce(
            (sum, agency) =>
                sum +
                Number(agency.amountReceivable) +
                Number(agency.amountPayable),
            0
        );

        let healthy = 0;
        let low = 0;
        let critical = 0;

        inventories.forEach(inventory => {
            const current = Number(inventory.currentStockKG);
            const min = Number(inventory.product.minimumStockKG);

            if (current <= 0) {
                critical++;
            } else if (current <= min) {
                low++;
            } else {
                healthy++;
            }
        });

        

        const branches =
            await prisma.branch.findMany({

                where: {
                    isActive: true
                },

                select: {
                    id: true,
                    name: true
                },

                orderBy: {
                    name: "asc"
                }
            });

            const monthNames = [
                "Jan",
                "Feb",
                "Mar",
                "Apr",
                "May",
                "Jun",
                "Jul",
                "Aug",
                "Sep",
                "Oct",
                "Nov",
                "Dec"
            ];

            const branchRevenueChart =
                branches.map(branch => {

                    const rows =
                        branchRevenue
                            .filter(
                                x =>
                                    x.branchId === branch.id
                            )
                            .map(x => ({

                                month:
                                    monthNames[
                                        x.month - 1
                                    ],

                                year:
                                    x.year,

                                revenue:
                                    Number(
                                        x.revenue
                                    )
                            }));

                    return {

                        branchId:
                            branch.id,

                        branchName:
                            branch.name,

                        monthlyRevenue:
                            rows
                    };
                });


        return {
            summary: {

            revenue:
                Number(
                    revenue._sum.amount || 0
                ),

            purchases:
                Number(
                    purchases._sum.grandTotal || 0
                ),

            sales:
                Number(
                    sales._sum.grandTotal || 0
                ),

            inventoryValues,

            outstanding,

            users
        },

        branchMonthlyRevenue:
            branchRevenueChart,

        stockDistribution: {

            healthy,

            low,

            critical
        },

        recentTransactions:
            recentTransactions.map(txn => ({

                transactionNo:
                    txn.transactionNo,

                agency:
                    txn.agency?.name,

                branch:
                    txn.branch.name,

                amount:
                    Number(txn.amount),

                direction:
                    txn.direction,

                paymentMode:
                    txn.paymentThrough,

                createdAt:
                    txn.createdAt
            }))
        }
    }
}
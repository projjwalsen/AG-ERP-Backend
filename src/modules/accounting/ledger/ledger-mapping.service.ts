import { LedgerNature, LedgerType, Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { prisma } from "../../../config/db";
import { ApiError } from "../../../core/middleware/errorHandler";
import { LedgerService } from "./ledger.service";
import { buildDuplicateLedgerGroupDisplayMap, resolveLedgerGroupDisplayId } from "./ledger-group-display";

type GroupInput = {
    name?: string;
    parentId?: string | null;
    nature?: LedgerNature;
};

const normalizeName = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();

const isLedgerNature = (value: unknown): value is LedgerNature =>
    value === LedgerNature.DEBIT || value === LedgerNature.CREDIT;

export class LedgerMappingService {
    static async getTree(options: { branchId?: string; includeInactive?: boolean } = {}) {
        const { branchId, includeInactive = false } = options;
        const ledgerWhere = {
            ...(includeInactive ? {} : { isActive: true }),
            ...(branchId ? { OR: [{ branchId }, { branchId: null }] } : {})
        };
        const [groups, ledgerCounts, groupCounts] = await Promise.all([
            prisma.ledgerGroup.findMany({
                include: {
                    ledgers: {
                        where: ledgerWhere,
                        select: {
                            id: true, code: true, name: true, category: true, nature: true,
                            branchId: true, agencyId: true, isActive: true, currentBalance: true
                        },
                        orderBy: [{ name: "asc" }, { id: "asc" }]
                    }
                },
                orderBy: [{ name: "asc" }, { id: "asc" }]
            }),
            prisma.$queryRaw<Array<{ ledgerId: string; voucherCount: number }>>(Prisma.sql`
                SELECT le."ledgerId" AS "ledgerId", COUNT(DISTINCT v."id")::int AS "voucherCount"
                FROM "LedgerEntry" le
                JOIN "Voucher" v ON v."id" = le."voucherId"
                JOIN "Ledger" l ON l."id" = le."ledgerId"
                WHERE ${includeInactive ? Prisma.sql`TRUE` : Prisma.sql`l."isActive" = TRUE`}
                ${branchId ? Prisma.sql`AND v."branchId" = ${branchId}` : Prisma.empty}
                GROUP BY le."ledgerId"
            `),
            prisma.$queryRaw<Array<{ groupId: string; voucherCount: number }>>(Prisma.sql`
                WITH RECURSIVE descendants("rootId", "descendantId", "path") AS (
                    SELECT g."id", g."id", ARRAY[g."id"] FROM "LedgerGroup" g
                    UNION ALL
                    SELECT d."rootId", child."id", d."path" || child."id"
                    FROM descendants d
                    JOIN "LedgerGroup" child ON child."parentId" = d."descendantId"
                    WHERE NOT child."id" = ANY(d."path")
                )
                SELECT d."rootId" AS "groupId", COUNT(DISTINCT le."voucherId")::int AS "voucherCount"
                FROM descendants d
                JOIN "Ledger" l ON l."groupId" = d."descendantId"
                JOIN "LedgerEntry" le ON le."ledgerId" = l."id"
                JOIN "Voucher" v ON v."id" = le."voucherId"
                WHERE ${includeInactive ? Prisma.sql`TRUE` : Prisma.sql`l."isActive" = TRUE`}
                ${branchId ? Prisma.sql`AND v."branchId" = ${branchId}` : Prisma.empty}
                GROUP BY d."rootId"
            `)
        ]);

        const leafCounts = new Map<string, number>(ledgerCounts.map(row => [row.ledgerId, Number(row.voucherCount)] as const));
        const hierarchyCounts = new Map<string, number>(groupCounts.map(row => [row.groupId, Number(row.voucherCount)] as const));
        const groupById = new Map<string, any>();

        for (const group of groups) {
            groupById.set(group.id, {
                id: group.id,
                code: group.code,
                name: group.name,
                nature: group.nature,
                parentId: group.parentId,
                fullPath: "",
                voucherCount: hierarchyCounts.get(group.id) || 0,
                directLedgerCount: group.ledgers.length,
                ledgerCount: group.ledgers.length,
                children: [] as any[],
                ledgers: group.ledgers.map(ledger => ({
                    ...ledger,
                    currentBalance: Number(ledger.currentBalance),
                    voucherCount: leafCounts.get(ledger.id) || 0,
                    fullPath: ""
                }))
            });
        }

        // Imported group names often differ only by spaces, punctuation, or
        // casing (for example Cash in Hand / Cash-in-Hand). Present those as
        // one heading while keeping every underlying ledger in the tree.
        const displayAliases = buildDuplicateLedgerGroupDisplayMap(
            groups,
            groups.flatMap(group => group.ledgers.map(ledger => ({ groupId: group.id, name: ledger.name })))
        );
        for (const group of groups) {
            const displayId = resolveLedgerGroupDisplayId(displayAliases, group.id);
            if (displayId === group.id) continue;
            const source = groupById.get(group.id);
            const target = groupById.get(displayId);
            if (!source || !target) continue;
            target.ledgers.push(...source.ledgers);
            target.directLedgerCount += source.directLedgerCount;
            target.ledgerCount += source.ledgerCount;
            let ancestorId = group.parentId;
            let isAlreadyIncludedInTarget = false;
            const ancestry = new Set<string>();
            while (ancestorId && !ancestry.has(ancestorId)) {
                if (resolveLedgerGroupDisplayId(displayAliases, ancestorId) === displayId) {
                    isAlreadyIncludedInTarget = true;
                    break;
                }
                ancestry.add(ancestorId);
                ancestorId = groups.find(item => item.id === ancestorId)?.parentId || null;
            }
            if (!isAlreadyIncludedInTarget) target.voucherCount += source.voucherCount;
        }

        const roots: any[] = [];
        for (const group of groups) {
            if (resolveLedgerGroupDisplayId(displayAliases, group.id) !== group.id) continue;
            const node = groupById.get(group.id);
            node.parentId = group.parentId
                ? resolveLedgerGroupDisplayId(displayAliases, group.parentId)
                : null;
            const parent = node.parentId ? groupById.get(node.parentId) : undefined;
            if (parent) parent.children.push(node);
            else roots.push(node);
        }

        const visit = (node: any, parentPath: string, ancestry = new Set<string>()) => {
            if (ancestry.has(node.id)) return;
            const path = parentPath ? `${parentPath} > ${node.name}` : node.name;
            node.fullPath = path;
            for (const ledger of node.ledgers) ledger.fullPath = `${path} > ${ledger.name}`;
            const nextAncestry = new Set(ancestry).add(node.id);
            node.ledgerCount = node.directLedgerCount;
            for (const child of node.children) {
                visit(child, path, nextAncestry);
                node.ledgerCount += child.ledgerCount;
            }
        };
        roots.forEach(root => visit(root, ""));

        const countGroups = (node: any): number => 1 + node.children.reduce(
            (count: number, child: any) => count + countGroups(child), 0
        );
        return { branchId: branchId || null, roots, groupCount: roots.reduce((count, root) => count + countGroups(root), 0) };
    }

    static async createGroup(actor: any, input: GroupInput) {
        if (!actor?.id) throw new ApiError("Unauthorized", 401);
        const name = normalizeName(input.name);
        if (!name) throw new ApiError("Group name is required", 400);
        if (!isLedgerNature(input.nature)) throw new ApiError("Group nature must be DEBIT or CREDIT", 400);
        const parentId = input.parentId || null;

        return prisma.$transaction(async tx => {
            const parent = parentId ? await tx.ledgerGroup.findUnique({ where: { id: parentId } }) : null;
            if (parentId && !parent) throw new ApiError("Parent group not found", 404);
            if (parent && parent.nature !== input.nature) {
                throw new ApiError("A child group must have the same debit/credit nature as its parent", 400);
            }
            const duplicate = await tx.ledgerGroup.findFirst({
                where: { parentId, name: { equals: name, mode: "insensitive" } },
                select: { id: true }
            });
            if (duplicate) throw new ApiError("A group with this name already exists under the selected parent", 409);
            const hash = createHash("sha1").update(`${parentId || "ROOT"}|${name.toLocaleLowerCase()}`).digest("hex").slice(0, 12);
            const label = name.replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "").slice(0, 32).toUpperCase() || "GROUP";
            return tx.ledgerGroup.create({
                data: { code: `MAP_${label}_${hash}`, name, parentId, nature: input.nature },
                include: { parent: true, children: true, _count: { select: { ledgers: true } } }
            });
        });
    }

    static async updateGroup(groupId: string, input: GroupInput) {
        return prisma.$transaction(async tx => {
            const current = await tx.ledgerGroup.findUnique({
                where: { id: groupId },
                include: { children: { select: { id: true } }, _count: { select: { ledgers: true } } }
            });
            if (!current) throw new ApiError("Ledger group not found", 404);
            const name = input.name === undefined ? current.name : normalizeName(input.name);
            if (!name) throw new ApiError("Group name cannot be empty", 400);
            const parentId = input.parentId === undefined ? current.parentId : input.parentId || null;
            const nature = input.nature === undefined ? current.nature : input.nature;
            if (!isLedgerNature(nature)) throw new ApiError("Group nature must be DEBIT or CREDIT", 400);

            let parent = null;
            if (parentId) {
                parent = await tx.ledgerGroup.findUnique({ where: { id: parentId }, select: { id: true, parentId: true, nature: true } });
                if (!parent) throw new ApiError("Parent group not found", 404);
                if (parent.id === groupId) throw new ApiError("A group cannot be its own parent", 400);
                let cursor: string | null = parent.parentId;
                while (cursor) {
                    if (cursor === groupId) throw new ApiError("A group cannot be moved under one of its descendants", 400);
                    const ancestor: { parentId: string | null } | null = await tx.ledgerGroup.findUnique({
                        where: { id: cursor }, select: { parentId: true }
                    });
                    cursor = ancestor?.parentId || null;
                }
                if (parent.nature !== nature) throw new ApiError("A child group must have the same debit/credit nature as its parent", 400);
            }

            const natureChanged = nature !== current.nature;
            if (natureChanged && (current.children.length || current._count.ledgers)) {
                throw new ApiError("Group nature cannot change while it contains child groups or ledgers", 409);
            }
            const duplicate = await tx.ledgerGroup.findFirst({
                where: { id: { not: groupId }, parentId, name: { equals: name, mode: "insensitive" } },
                select: { id: true }
            });
            if (duplicate) throw new ApiError("A group with this name already exists under the selected parent", 409);

            return tx.ledgerGroup.update({
                where: { id: groupId }, data: { name, parentId, nature },
                include: { parent: true, children: true, _count: { select: { ledgers: true } } }
            });
        });
    }

    static async deleteEmptyGroup(groupId: string) {
        return prisma.$transaction(async tx => {
            const group = await tx.ledgerGroup.findUnique({
                where: { id: groupId },
                include: { _count: { select: { children: true, ledgers: true } } }
            });
            if (!group) throw new ApiError("Ledger group not found", 404);
            if (group._count.children || group._count.ledgers) {
                throw new ApiError("Move its child groups and ledgers before deleting this group", 409);
            }
            await tx.ledgerGroup.delete({ where: { id: groupId } });
            return { id: groupId, deleted: true };
        });
    }

    static async moveLedger(ledgerId: string, groupId: string) {
        if (!groupId) throw new ApiError("groupId is required; ledgers must always belong to a group", 400);
        return prisma.$transaction(async tx => {
            const [ledger, targetGroup] = await Promise.all([
                tx.ledger.findUnique({ where: { id: ledgerId }, include: { group: true } }),
                tx.ledgerGroup.findUnique({ where: { id: groupId } })
            ]);
            if (!ledger) throw new ApiError("Ledger not found", 404);
            if (!targetGroup) throw new ApiError("Target group not found", 404);
            if (ledger.nature !== targetGroup.nature) {
                throw new ApiError("Cannot move a ledger to a group with a different debit/credit nature", 400);
            }
            const duplicate = await tx.ledger.findFirst({
                where: {
                    id: { not: ledger.id }, groupId,
                    category: ledger.category,
                    branchId: ledger.branchId,
                    agencyId: ledger.agencyId,
                    name: { equals: ledger.name, mode: "insensitive" }
                },
                select: { id: true, name: true }
            });
            if (duplicate) throw new ApiError(`A matching ledger already exists under the target group (${duplicate.id})`, 409);

            const updated = await tx.ledger.update({
                where: { id: ledger.id }, data: { groupId },
                include: { group: true, branch: true, agency: true }
            });
            await LedgerService.syncCachedBalance(tx, ledger.id);
            return updated;
        });
    }

    static createLedger(actor: any, input: {
        name: string; code?: string; category: LedgerType; groupId: string;
        branchId?: string; agencyId?: string; gstApplicable?: boolean; gstin?: string; pan?: string;
        openingBalance?: number; creditLimit?: number;
    }) {
        if (!input.groupId) throw new ApiError("groupId is required", 400);
        if (!Object.values(LedgerType).includes(input.category)) throw new ApiError("Invalid ledger category", 400);
        return LedgerService.createLedgerMaster(actor, input);
    }
}

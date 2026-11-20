import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/db";

export type SyncEntityName =
  | "branch"
  | "bankAccount"
  | "role"
  | "permission"
  | "rolePermission"
  | "user"
  | "userRole"
  | "agency"
  | "agencyBranch"
  | "agencyOutstanding"
  | "product"
  | "inventory"
  | "inventoryBatch"
  | "productLedger"
  | "purchaseOrder"
  | "purchase"
  | "purchaseItem"
  | "purchaseTransport"
  | "sale"
  | "salesItem"
  | "saleTransport"
  | "productLedgerEntry"
  | "transaction";

export type SyncScopeFilter =
  | "FULL"
  | "PRODUCTS"
  | "AGENCIES"
  | "USERS"
  | "PURCHASES"
  | "SALES"
  | "TRANSACTIONS"
  | "BRANCHES";

/**
 * Physical timestamp column used for keyset pagination on Srv1.
 * Always exposed to Srv2 as cursor.updatedAt for a stable contract.
 */
export type CursorSourceField =
  | "updatedAt"
  | "createdAt"
  | "lastUpdated"
  | "assignedAt";

export interface EntitySyncConfig {
  entity: SyncEntityName;
  cursorField: CursorSourceField;
  /**
   * Optional Prisma include for nested rows that travel with the parent.
   * Child entities that are synced separately should NOT be nested here.
   */
  include?: Record<string, unknown>;
  /**
   * Optional scope-based extra filters (used by productLedgerEntry).
   */
  scopeWhere?: (
    scope?: string,
  ) => Record<string, unknown> | undefined;
  /**
   * Strip sensitive fields before returning to Srv2.
   */
  sanitize?: (row: Record<string, unknown>) => Record<string, unknown>;
  findMany: (args: {
    where: Record<string, unknown>;
    orderBy: Array<Record<string, "asc" | "desc">>;
    take: number;
    include?: Record<string, unknown>;
  }) => Promise<Array<Record<string, unknown>>>;
}

function asRows(
  rows: unknown[],
): Array<Record<string, unknown>> {
  return rows as Array<Record<string, unknown>>;
}

export const SYNC_ENTITY_NAMES: SyncEntityName[] = [
  "branch",
  "bankAccount",
  "role",
  "permission",
  "rolePermission",
  "user",
  "userRole",
  "agency",
  "agencyBranch",
  "agencyOutstanding",
  "product",
  "inventory",
  "inventoryBatch",
  "productLedger",
  "purchaseOrder",
  "purchase",
  "purchaseItem",
  "purchaseTransport",
  "sale",
  "salesItem",
  "saleTransport",
  "productLedgerEntry",
  "transaction",
];

/**
 * Registry of every entity Srv2 is allowed to pull.
 * Keep this list aligned with Srv2 DocumentEntity/CoreEntity unions.
 */
export const ENTITY_REGISTRY: Record<SyncEntityName, EntitySyncConfig> = {
  branch: {
    entity: "branch",
    cursorField: "updatedAt",
    findMany: async (args) =>
      asRows(await prisma.branch.findMany(args as Prisma.BranchFindManyArgs)),
  },

  bankAccount: {
    entity: "bankAccount",
    cursorField: "updatedAt",
    findMany: async (args) =>
      asRows(
        await prisma.bankAccount.findMany(
          args as Prisma.BankAccountFindManyArgs,
        ),
      ),
  },

  role: {
    entity: "role",
    cursorField: "updatedAt",
    findMany: async (args) =>
      asRows(await prisma.role.findMany(args as Prisma.RoleFindManyArgs)),
  },

  permission: {
    entity: "permission",
    cursorField: "updatedAt",
    findMany: async (args) =>
      asRows(
        await prisma.permission.findMany(
          args as Prisma.PermissionFindManyArgs,
        ),
      ),
  },

  // Join table: createdAt only. Deletion detection must be snapshot-based on Srv2.
  rolePermission: {
    entity: "rolePermission",
    cursorField: "createdAt",
    findMany: async (args) =>
      asRows(
        await prisma.rolePermission.findMany(
          args as Prisma.RolePermissionFindManyArgs,
        ),
      ),
  },

  user: {
    entity: "user",
    cursorField: "updatedAt",
    // Password hash is synced as-is for replica fidelity.
    // Never log these rows. Prefer network TLS between Srv1 and Srv2.
    findMany: async (args) =>
      asRows(await prisma.user.findMany(args as Prisma.UserFindManyArgs)),
  },

  // Join table: assignedAt only. Snapshot reconcile deletions on Srv2.
  userRole: {
    entity: "userRole",
    cursorField: "assignedAt",
    findMany: async (args) =>
      asRows(
        await prisma.userRole.findMany(args as Prisma.UserRoleFindManyArgs),
      ),
  },

  agency: {
    entity: "agency",
    cursorField: "updatedAt",
    findMany: async (args) =>
      asRows(await prisma.agency.findMany(args as Prisma.AgencyFindManyArgs)),
  },

  agencyBranch: {
    entity: "agencyBranch",
    cursorField: "updatedAt",
    findMany: async (args) =>
      asRows(
        await prisma.agencyBranch.findMany(
          args as Prisma.AgencyBranchFindManyArgs,
        ),
      ),
  },

  agencyOutstanding: {
    entity: "agencyOutstanding",
    cursorField: "updatedAt",
    findMany: async (args) =>
      asRows(
        await prisma.agencyOutstanding.findMany(
          args as Prisma.AgencyOutstandingFindManyArgs,
        ),
      ),
  },

  product: {
    entity: "product",
    cursorField: "updatedAt",
    findMany: async (args) =>
      asRows(await prisma.product.findMany(args as Prisma.ProductFindManyArgs)),
  },

  inventory: {
    entity: "inventory",
    cursorField: "lastUpdated",
    findMany: async (args) =>
      asRows(
        await prisma.inventory.findMany(args as Prisma.InventoryFindManyArgs),
      ),
  },

  inventoryBatch: {
    entity: "inventoryBatch",
    cursorField: "lastUpdated",
    findMany: async (args) =>
      asRows(
        await prisma.inventoryBatch.findMany(
          args as Prisma.InventoryBatchFindManyArgs,
        ),
      ),
  },

  productLedger: {
    entity: "productLedger",
    cursorField: "updatedAt",
    findMany: async (args) =>
      asRows(
        await prisma.productLedger.findMany(
          args as Prisma.ProductLedgerFindManyArgs,
        ),
      ),
  },

  purchaseOrder: {
    entity: "purchaseOrder",
    cursorField: "updatedAt",
    findMany: async (args) =>
      asRows(
        await prisma.purchaseOrder.findMany(
          args as Prisma.PurchaseOrderFindManyArgs,
        ),
      ),
  },

  purchase: {
    entity: "purchase",
    cursorField: "updatedAt",
    findMany: async (args) =>
      asRows(
        await prisma.purchase.findMany(args as Prisma.PurchaseFindManyArgs),
      ),
  },

  // No updatedAt in schema — cursor uses createdAt.
  purchaseItem: {
    entity: "purchaseItem",
    cursorField: "createdAt",
    findMany: async (args) =>
      asRows(
        await prisma.purchaseItem.findMany(
          args as Prisma.PurchaseItemFindManyArgs,
        ),
      ),
  },

  purchaseTransport: {
    entity: "purchaseTransport",
    cursorField: "updatedAt",
    findMany: async (args) =>
      asRows(
        await prisma.purchaseTransport.findMany(
          args as Prisma.PurchaseTransportFindManyArgs,
        ),
      ),
  },

  sale: {
    entity: "sale",
    cursorField: "updatedAt",
    findMany: async (args) =>
      asRows(await prisma.sale.findMany(args as Prisma.SaleFindManyArgs)),
  },

  // No updatedAt in schema — cursor uses createdAt.
  salesItem: {
    entity: "salesItem",
    cursorField: "createdAt",
    findMany: async (args) =>
      asRows(
        await prisma.salesItem.findMany(args as Prisma.SalesItemFindManyArgs),
      ),
  },

  saleTransport: {
    entity: "saleTransport",
    cursorField: "updatedAt",
    findMany: async (args) =>
      asRows(
        await prisma.saleTransport.findMany(
          args as Prisma.SaleTransportFindManyArgs,
        ),
      ),
  },

  productLedgerEntry: {
    entity: "productLedgerEntry",
    cursorField: "createdAt",
    scopeWhere: (scope) => {
      if (scope === "PURCHASES") {
        return { purchaseId: { not: null } };
      }
      if (scope === "SALES") {
        return { saleId: { not: null } };
      }
      return undefined;
    },
    findMany: async (args) =>
      asRows(
        await prisma.productLedgerEntry.findMany(
          args as Prisma.ProductLedgerEntryFindManyArgs,
        ),
      ),
  },

  transaction: {
    entity: "transaction",
    cursorField: "updatedAt",
    // Allocations are nested because TransactionAllocation has no updatedAt
    // and is owned by the transaction aggregate for phase-1 sync.
    include: {
      allocations: true,
    },
    findMany: async (args) =>
      asRows(
        await prisma.transaction.findMany(
          args as Prisma.TransactionFindManyArgs,
        ),
      ),
  },
};

export function isSyncEntityName(value: string): value is SyncEntityName {
  return SYNC_ENTITY_NAMES.includes(value as SyncEntityName);
}

export function getEntityConfig(entity: string): EntitySyncConfig {
  if (!isSyncEntityName(entity)) {
    throw new Error(`Unsupported sync entity: ${entity}`);
  }
  return ENTITY_REGISTRY[entity];
}

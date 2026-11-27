import "dotenv/config";
import { PrismaClient, Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import * as XLSX from "xlsx";
import * as path from "path";
import * as fs from "fs";

const DOWNLOADS = "c:\\Users\\razon\\Downloads";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });

type Row = Record<string, any>;

function readSheet(fileName: string): Row[] {
    const filePath = path.join(DOWNLOADS, fileName);
    if (!fs.existsSync(filePath)) {
        throw new Error(`Missing file: ${filePath}`);
    }
    const wb = XLSX.read(fs.readFileSync(filePath), {
        type: "buffer",
        cellDates: true,
        raw: false
    });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json<Row>(sheet, { defval: null, raw: false });
}

function asString(value: unknown): string | null {
    if (value === null || value === undefined) return null;
    const text = String(value).trim();
    return text === "" || text.toLowerCase() === "null" ? null : text;
}

function asBool(value: unknown, fallback = true): boolean {
    if (value === null || value === undefined || value === "") return fallback;
    if (typeof value === "boolean") return value;
    const text = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(text)) return true;
    if (["false", "0", "no", "n"].includes(text)) return false;
    return fallback;
}

function asDate(value: unknown): Date | null {
    if (value === null || value === undefined || value === "") return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    const text = String(value).trim();
    if (!text) return null;
    // "2026-09-01 07:38:32.843" / ISO
    const normalized = text.includes("T") ? text : text.replace(" ", "T");
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
}

function asDecimal(value: unknown, fallback: string | null = "0"): Prisma.Decimal | null {
    if (value === null || value === undefined || value === "") {
        return fallback === null ? null : new Prisma.Decimal(fallback);
    }
    const text = String(value).replace(/,/g, "").trim();
    if (!text) return fallback === null ? null : new Prisma.Decimal(fallback);
    return new Prisma.Decimal(text);
}

async function upsertMany<T extends { id: string }>(
    label: string,
    rows: T[],
    upsert: (row: T) => Promise<unknown>
) {
    let ok = 0;
    for (const row of rows) {
        await upsert(row);
        ok++;
        if (ok % 100 === 0 || ok === rows.length) {
            process.stdout.write(`\r[${label}] ${ok}/${rows.length}`);
        }
    }
    process.stdout.write(`\n[${label}] done ${ok}\n`);
    return ok;
}

async function main() {
    console.log("Reading Excel dumps...");

    const permissions = readSheet("Permission.xlsx").map(r => ({
        id: asString(r.id)!,
        module: asString(r.module)!,
        action: asString(r.action)!,
        key: asString(r.key)!,
        description: asString(r.description),
        isActive: asBool(r.isActive, true),
        createdAt: asDate(r.createdAt) ?? undefined,
        updatedAt: asDate(r.updatedAt) ?? undefined
    }));

    const roles = readSheet("Role.xlsx").map(r => ({
        id: asString(r.id)!,
        name: asString(r.name)!,
        code: asString(r.code)!,
        isActive: asBool(r.isActive, true),
        isDefault: asBool(r.isDefault, false),
        createdAt: asDate(r.createdAt) ?? undefined,
        updatedAt: asDate(r.updatedAt) ?? undefined
    }));

    const branches = readSheet("Branch.xlsx").map(r => ({
        id: asString(r.id)!,
        name: asString(r.name)!,
        code: asString(r.code)!,
        gstin: asString(r.gstin),
        stateCode: asString(r.stateCode),
        addressLine1: asString(r.addressLine1),
        addressLine2: asString(r.addressLine2),
        city: asString(r.city),
        state: asString(r.state),
        pinCode: asString(r.pinCode),
        email: asString(r.email),
        phnNumber: asString(r.phnNumber),
        isActive: asBool(r.isActive, true),
        createdAt: asDate(r.createdAt) ?? undefined,
        updatedAt: asDate(r.updatedAt) ?? undefined
    }));

    const rolePermissions = readSheet("RolePermission.xlsx").map(r => ({
        id: asString(r.id)!,
        roleId: asString(r.roleId)!,
        permissionId: asString(r.permissionId)!,
        createdAt: asDate(r.createdAt) ?? undefined
    }));

    const users = readSheet("User.xlsx").map(r => ({
        id: asString(r.id)!,
        name: asString(r.name)!,
        email: asString(r.email)!,
        phone: asString(r.phone),
        password: asString(r.password)!,
        status: (asString(r.status) || "ACTIVE") as "ACTIVE" | "INACTIVE" | "SUSPENDED",
        isActive: asBool(r.isActive, true),
        branchAccessType: (asString(r.branchAccessType) || "SELECTED") as "ALL" | "SELECTED",
        createdById: asString(r.createdById),
        lastLoginAt: asDate(r.lastLoginAt),
        branchId: asString(r.branchId),
        createdAt: asDate(r.createdAt) ?? undefined,
        updatedAt: asDate(r.updatedAt) ?? undefined
    }));

    const userRoles = readSheet("UserRole.xlsx").map(r => ({
        id: asString(r.id)!,
        userId: asString(r.userId)!,
        roleId: asString(r.roleId)!,
        assignedAt: asDate(r.assignedAt) ?? undefined
    }));

    const agencies = readSheet("Agency.xlsx").map(r => ({
        id: asString(r.id)!,
        name: asString(r.name)!,
        type: asString(r.type)! as "VENDOR" | "CLIENT" | "BOTH",
        gstin: asString(r.gstin),
        contactPerson: asString(r.contactPerson),
        mobileNumber: asString(r.mobileNumber),
        email: asString(r.email),
        addressLine1: asString(r.addressLine1),
        addressLine2: asString(r.addressLine2),
        city: asString(r.city),
        state: asString(r.state),
        stateCode: asString(r.stateCode),
        pinCode: asString(r.pinCode),
        isActive: asBool(r.isActive, true),
        amountPayable: asDecimal(r.amountPayable, "0")!,
        amountReceivable: asDecimal(r.amountReceivable, "0")!,
        cstNo: asString(r.cstNo),
        panNo: asString(r.panNo),
        // Bank accounts are not in this dump; keep null to avoid FK failures.
        bankAccountId: null as string | null,
        createdAt: asDate(r.createdAt) ?? undefined,
        updatedAt: asDate(r.updatedAt) ?? undefined
    }));

    const agencyBranches = readSheet("AgencyBranch.xlsx").map(r => ({
        id: asString(r.id)!,
        agencyId: asString(r.agencyId)!,
        branchId: asString(r.branchId)!,
        openingBalance: asDecimal(r.openingBalance, "0")!,
        isActive: asBool(r.isActive, true),
        createdAt: asDate(r.createdAt) ?? undefined,
        updatedAt: asDate(r.updatedAt) ?? undefined
    }));

    const agencyOutstandings = readSheet("AgencyOutstanding.xlsx").map(r => ({
        id: asString(r.id)!,
        agencyId: asString(r.agencyId)!,
        branchId: asString(r.branchId)!,
        type: asString(r.type)! as "DEBIT" | "CREDIT",
        amount: asDecimal(r.amount, "0")!,
        createdAt: asDate(r.createdAt) ?? undefined,
        updatedAt: asDate(r.updatedAt) ?? undefined
    }));

    const products = readSheet("Product.xlsx").map(r => ({
        id: asString(r.id)!,
        sku: asString(r.sku)!,
        name: asString(r.name)!,
        category: asString(r.category),
        description: asString(r.description),
        disclaimer: asString(r.disclaimer),
        baseUnit: (asString(r.baseUnit) || "KG") as "KG" | "LTR" | "MT" | "NOS",
        density: asDecimal(r.density, null),
        operationalUnit: (asString(r.operationalUnit) || "KG") as "KG" | "LTR" | "MT" | "NOS",
        minimumStockKG: asDecimal(r.minimumStockKG, null),
        isActive: asBool(r.isActive, true),
        applicableGST: asDecimal(r.applicableGST, null),
        hsnNo: asString(r.hsnNo),
        sellPricePerUnit: asDecimal(r.sellPricePerUnit, "0")!,
        openingStockKG: asDecimal(r.openingStockKG, "0")!,
        sellPriceLTR: asDecimal(r.sellPriceLTR, null),
        productType: (asString(r.productType) || "PURCHASED") as "PURCHASED" | "MANUFACTURED" | "BOTH",
        tempClosingBalance: asDecimal(r.tempClosingBalance, null),
        createdAt: asDate(r.createdAt) ?? undefined,
        updatedAt: asDate(r.updatedAt) ?? undefined
    }));

    const productLedgers = readSheet("ProductLedger.xlsx").map(r => ({
        id: asString(r.id)!,
        productId: asString(r.productId)!,
        code: asString(r.code)!,
        isActive: asBool(r.isActive, true),
        createdAt: asDate(r.createdAt) ?? undefined,
        updatedAt: asDate(r.updatedAt) ?? undefined
    }));

    console.log({
        permissions: permissions.length,
        roles: roles.length,
        branches: branches.length,
        rolePermissions: rolePermissions.length,
        users: users.length,
        userRoles: userRoles.length,
        agencies: agencies.length,
        agencyBranches: agencyBranches.length,
        agencyOutstandings: agencyOutstandings.length,
        products: products.length,
        productLedgers: productLedgers.length
    });

    await upsertMany("Permission", permissions, row =>
        prisma.permission.upsert({
            where: { id: row.id },
            create: row,
            update: {
                module: row.module,
                action: row.action,
                key: row.key,
                description: row.description,
                isActive: row.isActive,
                updatedAt: row.updatedAt
            }
        })
    );

    await upsertMany("Role", roles, row =>
        prisma.role.upsert({
            where: { id: row.id },
            create: row,
            update: {
                name: row.name,
                code: row.code,
                isActive: row.isActive,
                isDefault: row.isDefault,
                updatedAt: row.updatedAt
            }
        })
    );

    await upsertMany("Branch", branches, row =>
        prisma.branch.upsert({
            where: { id: row.id },
            create: row,
            update: {
                name: row.name,
                code: row.code,
                gstin: row.gstin,
                stateCode: row.stateCode,
                addressLine1: row.addressLine1,
                addressLine2: row.addressLine2,
                city: row.city,
                state: row.state,
                pinCode: row.pinCode,
                email: row.email,
                phnNumber: row.phnNumber,
                isActive: row.isActive,
                updatedAt: row.updatedAt
            }
        })
    );

    await upsertMany("RolePermission", rolePermissions, row =>
        prisma.rolePermission.upsert({
            where: { id: row.id },
            create: row,
            update: {
                roleId: row.roleId,
                permissionId: row.permissionId
            }
        })
    );

    await upsertMany("User", users, row =>
        prisma.user.upsert({
            where: { id: row.id },
            create: row,
            update: {
                name: row.name,
                email: row.email,
                phone: row.phone,
                password: row.password,
                status: row.status,
                isActive: row.isActive,
                branchAccessType: row.branchAccessType,
                createdById: row.createdById,
                lastLoginAt: row.lastLoginAt,
                branchId: row.branchId,
                updatedAt: row.updatedAt
            }
        })
    );

    await upsertMany("UserRole", userRoles, row =>
        prisma.userRole.upsert({
            where: { id: row.id },
            create: row,
            update: {
                userId: row.userId,
                roleId: row.roleId,
                assignedAt: row.assignedAt
            }
        })
    );

    await upsertMany("Agency", agencies, row =>
        prisma.agency.upsert({
            where: { id: row.id },
            create: row,
            update: {
                name: row.name,
                type: row.type,
                gstin: row.gstin,
                contactPerson: row.contactPerson,
                mobileNumber: row.mobileNumber,
                email: row.email,
                addressLine1: row.addressLine1,
                addressLine2: row.addressLine2,
                city: row.city,
                state: row.state,
                stateCode: row.stateCode,
                pinCode: row.pinCode,
                isActive: row.isActive,
                amountPayable: row.amountPayable,
                amountReceivable: row.amountReceivable,
                cstNo: row.cstNo,
                panNo: row.panNo,
                bankAccountId: row.bankAccountId,
                updatedAt: row.updatedAt
            }
        })
    );

    await upsertMany("AgencyBranch", agencyBranches, row =>
        prisma.agencyBranch.upsert({
            where: { id: row.id },
            create: row,
            update: {
                agencyId: row.agencyId,
                branchId: row.branchId,
                openingBalance: row.openingBalance,
                isActive: row.isActive,
                updatedAt: row.updatedAt
            }
        })
    );

    await upsertMany("AgencyOutstanding", agencyOutstandings, row =>
        prisma.agencyOutstanding.upsert({
            where: { id: row.id },
            create: row,
            update: {
                agencyId: row.agencyId,
                branchId: row.branchId,
                type: row.type,
                amount: row.amount,
                updatedAt: row.updatedAt
            }
        })
    );

    await upsertMany("Product", products, row =>
        prisma.product.upsert({
            where: { id: row.id },
            create: row,
            update: {
                sku: row.sku,
                name: row.name,
                category: row.category,
                description: row.description,
                disclaimer: row.disclaimer,
                baseUnit: row.baseUnit,
                density: row.density,
                operationalUnit: row.operationalUnit,
                minimumStockKG: row.minimumStockKG,
                isActive: row.isActive,
                applicableGST: row.applicableGST,
                hsnNo: row.hsnNo,
                sellPricePerUnit: row.sellPricePerUnit,
                openingStockKG: row.openingStockKG,
                sellPriceLTR: row.sellPriceLTR,
                productType: row.productType,
                tempClosingBalance: row.tempClosingBalance,
                updatedAt: row.updatedAt
            }
        })
    );

    await upsertMany("ProductLedger", productLedgers, row =>
        prisma.productLedger.upsert({
            where: { id: row.id },
            create: row,
            update: {
                productId: row.productId,
                code: row.code,
                isActive: row.isActive,
                updatedAt: row.updatedAt
            }
        })
    );

    const counts = {
        permission: await prisma.permission.count(),
        role: await prisma.role.count(),
        rolePermission: await prisma.rolePermission.count(),
        user: await prisma.user.count(),
        userRole: await prisma.userRole.count(),
        branch: await prisma.branch.count(),
        agency: await prisma.agency.count(),
        agencyBranch: await prisma.agencyBranch.count(),
        agencyOutstanding: await prisma.agencyOutstanding.count(),
        product: await prisma.product.count(),
        productLedger: await prisma.productLedger.count()
    };
    console.log("Final DB counts:", counts);
}

main()
    .catch(error => {
        console.error("\nImport failed:", error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
        await pool.end();
    });

import bcrypt from "bcryptjs";
import { BranchAccessType } from "@prisma/client";
import { prisma } from "../../config/db";


const OWNER = {
    name: "AG Admin",
    email: "admin@ashtavinayaka.com",
    password: "AGERP@2026",
    phone: "9876543210"
};

const defaultPermissions = [
    { module: "USER", action: "WRITE", key: "USER:WRITE" },
    { module: "USER", action: "VIEW", key: "USER:VIEW" },

    { module: "ROLE", action: "WRITE", key: "ROLE:WRITE" },
    { module: "ROLE", action: "VIEW", key: "ROLE:VIEW" },

    { module: "BRANCH", action: "WRITE", key: "BRANCH:WRITE" },
    { module: "BRANCH", action: "VIEW", key: "BRANCH:VIEW" },

    { module: "AGENCY", action: "WRITE", key: "AGENCY:WRITE" },
    { module: "AGENCY", action: "VIEW", key: "AGENCY:VIEW" },

    { module: "PRODUCT", action: "WRITE", key: "PRODUCT:WRITE" },
    { module: "PRODUCT", action: "VIEW", key: "PRODUCT:VIEW" },

    { module: "PURCHASE", action: "WRITE", key: "PURCHASE:WRITE" },
    { module: "PURCHASE", action: "VIEW", key: "PURCHASE:VIEW" },
    { module: "PURCHASE", action: "APPROVE", key: "PURCHASE:APPROVE" },

    { module: "SALE", action: "WRITE", key: "SALE:WRITE" },
    { module: "SALE", action: "VIEW", key: "SALE:VIEW" },
    { module: "SALE", action: "APPROVE", key: "SALE:APPROVE" },

    { module: "TRANSACTION", action: "VIEW", key: "TRANSACTION:VIEW" },
    { module: "TRANSACTION", action: "WRITE", key: "TRANSACTION:WRITE" },
    { module: "TRANSACTION", action: "APPROVE", key: "TRANSACTION:APPROVE" },

    { module: "LEDGER", action: "VIEW", key: "LEDGER:VIEW" },

    { module: "JOURNAL", action: "WRITE", key: "JOURNAL:WRITE" },
    { module: "JOURNAL", action: "VIEW", key: "JOURNAL:VIEW" },
    { module: "JOURNAL", action: "APPROVE", key: "JOURNAL:APPROVE" },

    { module: "DRCR_NOTE", action: "WRITE", key: "DRCR_NOTE:WRITE" },
    { module: "DRCR_NOTE", action: "VIEW", key: "DRCR_NOTE:VIEW" },
    { module: "DRCR_NOTE", action: "APPROVE", key: "DRCR_NOTE:APPROVE" },

    { module: "OUTSTANDING_REPORT", action: "VIEW", key: "OUTSTANDING_REPORT:VIEW" },
    { module: "GSTR1", action: "VIEW", key: "GSTR1:VIEW" },
    { module: "DAY_BOOK", action: "VIEW", key: "DAY_BOOK:VIEW" },
    { module: "TRIAL_BALANCE", action: "VIEW", key: "TRIAL_BALANCE:VIEW" },
    { module: "GST_SUSPENSE_LOG", action: "VIEW", key: "GST_SUSPENSE_LOG:VIEW" },
    { module: "STOCK_INVENTORY", action: "VIEW", key: "STOCK_INVENTORY:VIEW" }
];

async function main() {

    // ------------------------------------
    // Seed Permissions
    // ------------------------------------

    for (const permission of defaultPermissions) {

        await prisma.permission.upsert({

            where: {
                key: permission.key
            },

            update: {
                module: permission.module,
                action: permission.action,
                isActive: true
            },

            create: {
                ...permission,
                isActive: true
            }

        });

    }

    // ------------------------------------
    // OWNER Role
    // ------------------------------------

    const ownerRole =
        await prisma.role.upsert({

            where: {
                code: "OWNER"
            },

            update: {
                name: "AG Admin",
                isDefault: true,
                isActive: true
            },

            create: {
                code: "OWNER",
                name: "AG Admin",
                isDefault: true,
                isActive: true
            }

        });

    // ------------------------------------
    // Give OWNER every permission
    // ------------------------------------

    const permissions =
        await prisma.permission.findMany({

            select: {
                id: true
            }

        });

    await prisma.rolePermission.createMany({

        data:
            permissions.map(permission => ({

                roleId: ownerRole.id,

                permissionId: permission.id

            })),

        skipDuplicates: true

    });

    // ------------------------------------
    // Create OWNER User
    // ------------------------------------

    const password =
        await bcrypt.hash(
            OWNER.password,
            10
        );

    const owner =
        await prisma.user.upsert({

            where: {
                email: OWNER.email.toLowerCase()
            },

            update: {

                name: OWNER.name,

                phone: OWNER.phone,

                password,

                isActive: true,

                status: "ACTIVE",

                branchAccessType:
                    BranchAccessType.ALL

            },

            create: {

                name: OWNER.name,

                email: OWNER.email.toLowerCase(),

                phone: OWNER.phone,

                password,

                isActive: true,

                status: "ACTIVE",

                branchAccessType:
                    BranchAccessType.ALL

            }

        });

    // ------------------------------------
    // Assign OWNER Role
    // ------------------------------------

    await prisma.userRole.upsert({

        where: {

            userId_roleId: {

                userId: owner.id,

                roleId: ownerRole.id

            }

        },

        update: {},

        create: {

            userId: owner.id,

            roleId: ownerRole.id

        }

    });

    console.log("=====================================");
    console.log("OWNER SEEDED SUCCESSFULLY");
    console.log("=====================================");
    console.log("Email :", OWNER.email);
    console.log("Password :", OWNER.password);
    console.log("Role : OWNER");
    console.log("Branch Access : ALL");
    console.log("Permissions :", permissions.length);
    console.log("=====================================");
}

main()
    .catch(console.error)
    .finally(async () => {
        await prisma.$disconnect();
    });
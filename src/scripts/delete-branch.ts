import { prisma } from "../config/db";

const branchKeys = [
    {
        name: "A G Ashtavinayaka Petrochem Pvt Ltd - Maharashtra",
        code: "A_G_ASHTAVINAYAKA_PETROCHEM_PVT_LTD_-_MAHARASHTRA",
        gstin: "27AAKCA0034H1Z0"
    }
];

async function main() {
    for (const branch of branchKeys) {
        const existing = await prisma.branch.findFirst({
            where: {
                OR: [
                    { gstin: branch.gstin },
                    { code: branch.code }
                ]
            }
        });

        if (!existing) {
            console.log(`Branch not found: ${branch.name}`);
            continue;
        }

        await prisma.branch.delete({
            where: {
                id: existing.id
            }
        });

        console.log(`Deleted branch: ${branch.name}`);
    }
}

main()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

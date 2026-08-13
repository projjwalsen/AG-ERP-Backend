import { prisma } from "../src/config/db";

const branches = [
    {
        name: "A G Ashtavinayaka Petrochem Pvt Ltd - Maharashtra",
        code: "AG_ASHTAVINAYAKA_PETROCHEM-MH",
        gstin: "27AAKCA0034H1Z0",
        stateCode: "27",
        addressLine1: "SURVEY NO - 222, VILLAGE - HEDAVALI",
        addressLine2: "Tl- SUDHAGAD, KHOPOLI - PALI ROAD, KHOPOLI, DIST - RAIGAD",
        city: "KHOPOLI",
        state: "Maharashtra",
        pinCode: "400705",
        isActive: true,
        email: "info@ashtvinayakapetrochem.com",
        phnNumber: null,
        createdAt: new Date(),
        updatedAt: new Date()
    }
];

export async function mainBranchSeed() {
    for (const branch of branches) {
        const existing = await prisma.branch.findFirst({
            where: {
                OR: [
                    { code: branch.code },
                    {
                        name: "A G Ashtavinayaka Petrochem Pvt Ltd - Maharashtra"
                    },
                    {
                        code: "A_G_ASHTAVINAYAKA_PETROCHEM_PVT_LTD_-_MAHARASHTRA"
                    }
                ]
            }
        });

        if (existing) {
            await prisma.branch.update({
                where: {
                    id: existing.id
                },
                data: {
                    name: branch.name,
                    code: branch.code,
                    gstin: branch.gstin,
                    stateCode: branch.stateCode,
                    addressLine1: branch.addressLine1,
                    addressLine2: branch.addressLine2,
                    city: branch.city,
                    state: branch.state,
                    pinCode: branch.pinCode,
                    isActive: branch.isActive,
                    email: branch.email,
                    phnNumber: branch.phnNumber,
                    updatedAt: branch.updatedAt
                }
            });

            console.log(`Updated branch: ${branch.name}`);
            continue;
        }

        await prisma.branch.create({
            data: {
                name: branch.name,
                code: branch.code,
                gstin: branch.gstin,
                stateCode: branch.stateCode,
                addressLine1: branch.addressLine1,
                addressLine2: branch.addressLine2,
                city: branch.city,
                state: branch.state,
                pinCode: branch.pinCode,
                isActive: branch.isActive,
                email: branch.email,
                phnNumber: branch.phnNumber,
                createdAt: branch.createdAt,
                updatedAt: branch.updatedAt
            }
        });

        console.log(`Created branch: ${branch.name}`);
    }
}

mainBranchSeed()
    .catch(error => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

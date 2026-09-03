import "dotenv/config";
import {
    JournalHeadType,
    LedgerNature,
    LedgerType
} from "@prisma/client";
import { prisma } from "../config/db";
import { LedgerService } from "../modules/accounting/ledger/ledger.service";

const HEAD_NAME = "Interest on Tata Capital FD";
const LEDGER_CODE = "INTEREST-ON-TATA-CAPITAL-FD";
const AGENCY_NAME = "A G ART PETROCHEM LLP";

async function main() {
    const result = await prisma.$transaction(async tx => {
        await LedgerService.ensureDefaultLedgerGroups(tx);

        const indirectIncome = await tx.ledgerGroup.findUnique({
            where: { code: "INDIRECT_INCOME" }
        });
        if (!indirectIncome) {
            throw new Error("INDIRECT_INCOME ledger group was not found");
        }

        const agencies = await tx.agency.findMany({
            where: {
                name: { equals: AGENCY_NAME, mode: "insensitive" },
                isActive: true
            },
            select: { id: true, name: true }
        });
        if (agencies.length !== 1) {
            throw new Error(
                `Expected exactly one active agency named ${AGENCY_NAME}; found ${agencies.length}`
            );
        }
        const agency = agencies[0];

        const matchingHeads = await tx.journalHead.findMany({
            where: { name: { equals: HEAD_NAME, mode: "insensitive" } },
            include: { ledger: true }
        });
        if (matchingHeads.length > 1) {
            throw new Error(
                `More than one JournalHead already uses the name ${HEAD_NAME}`
            );
        }

        const existingHead = matchingHeads[0];
        const ledger = existingHead
            ? await tx.ledger.update({
                where: { id: existingHead.ledgerId },
                data: {
                    name: HEAD_NAME,
                    category: LedgerType.JOURNAL,
                    groupId: indirectIncome.id,
                    nature: LedgerNature.CREDIT,
                    agencyId: agency.id,
                    isActive: true
                }
            })
            : await LedgerService.getOrCreateLedger(tx, {
                code: LEDGER_CODE,
                name: HEAD_NAME,
                category: LedgerType.JOURNAL,
                groupCode: "INDIRECT_INCOME",
                nature: LedgerNature.CREDIT,
                agencyId: agency.id
            });

        const journalHead = existingHead
            ? await tx.journalHead.update({
                where: { id: existingHead.id },
                data: {
                    name: HEAD_NAME,
                    type: JournalHeadType.INWARD,
                    isActive: true,
                    ledgerId: ledger.id
                }
            })
            : await tx.journalHead.create({
                data: {
                    name: HEAD_NAME,
                    type: JournalHeadType.INWARD,
                    ledgerId: ledger.id
                }
            });

        return { journalHead, ledger, agency };
    });

    console.log(JSON.stringify({
        journalHead: {
            id: result.journalHead.id,
            name: result.journalHead.name,
            type: result.journalHead.type
        },
        ledger: {
            id: result.ledger.id,
            code: result.ledger.code,
            name: result.ledger.name,
            category: result.ledger.category,
            group: "Indirect Income",
            nature: result.ledger.nature,
            agency: result.agency.name
        },
        note: "No journal voucher or ledger entry was created."
    }, null, 2));
}

main()
    .catch(error => {
        console.error(error?.message || error);
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });

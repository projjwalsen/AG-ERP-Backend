import "dotenv/config";
import { prisma } from "../config/db";

const n = (value: unknown) => String(value ?? "").replace(/\s+/g, " ").trim();
const compact = (value: unknown) => n(value).replace(/[^A-Z0-9]/gi, "").toUpperCase();
const apply = process.argv.includes("--apply");

const TARGET_BY_ALIAS: Record<string, string> = {
    SALARYWAGES: "Employee Benefit Expenses",
    STAFFWELFARE: "Employee Benefit Expenses",
    ADMINCHARGES: "Employee Benefit Expenses",
    INCENTIVES: "Employee Benefit Expenses",
    EMPLOYERCONTRIBUTIONTOPF: "Employee Benefit Expenses",
    DIRECTORSREMUNERATIONSANDEEPSINGH: "Employee Benefit Expenses",
    DIRECTORSREMUNERATIONMAHIMAMENDA: "Employee Benefit Expenses",
    ANILMENDASALARY: "Salary Paid to Related Person",
    VANISHKAANILMENDASALARY: "Salary Paid to Related Person",
    PRARTHANAANILMENDASALARY: "Salary Paid to Related Person",
    BANKCHARGES: "Financial Expenses",
    LCCHARGES: "Financial Expenses",
    PROCESSINGCHARGES: "Financial Expenses",
    ODINTEREST: "Interest on Loans",
    INTERESTONUNSECUREDLOAN: "Interest on Loans",
    INTERESTONTERMLOAN60435104974: "Interest on Loans",
    INTERESTONTERMLOANYESBANK: "Interest on Loans",
    INTERESTONVEHICLELOAN: "Interest on Loans",
    INTERESTONGECL: "Interest on Loans",
    INTERESTONFDOD: "Interest on Loans",
    INTERESTONCORPORATECARD: "Interest on Loans",
    INTERESTONLETTERCREDITLC: "Interest on Letter Credit ( LC)",
    ELECTRICITYCHARGESFACTORY: "Electricity Expenses",
    ELECTRICITYCHARGESBUNGLOW: "Electricity Expenses",
    ELECTRICITYCHARGESDHULE: "Electricity Expenses",
    ELECTRICITYCHARGESMAHIMAMENDA: "Electricity Expenses",
    ELECTRICITYOFFICE24THFLOOR: "Electricity Expenses",
    INSURANCE: "Insurance",
    PROPERTYINSURANCE: "Insurance",
    FACTORYINSURANCE: "Insurance",
    FIREINSURANCE: "Insurance",
    INSURANCEVEHICLES: "Insurance",
    INSURANCEONLOAN: "Insurance",
    CARGOINSURANCE: "Insurance",
    REPAIRMAINTENANCEOFVEHICLES: "Repairs and maintenance",
    REPAIRSMAINTENANCEOFCOMPUTER9: "Repairs and maintenance",
    REPAIRSMAINTENANCETOOTHERS: "Repairs and maintenance",
    REPAIRSMAINTENCEOFPM: "Repairs and maintenance",
    REPAIRSMAINTENANCEBUILDING: "Repairs and maintenance",
    REPAIRSMAINTENANCETOVEHICLE18: "Repairs and maintenance",
    PENALTYPAID: "Disallowance",
    DONATION: "Disallowance",
    GSTVOLUNTARYPAYMENT: "Disallowance",
    CGSTLATEFEE: "Disallowance",
    SGSTLATEFEE: "Disallowance",
    INTERESTONTDS: "Disallowance",
    INTERESTONPTRC: "Disallowance",
    INTERESTONTCS: "Disallowance",
    INELIGIBLEITC175SGST: "Rates and Taxes",
    INELIGIBLEITC175CGST: "Rates and Taxes",
    INELIGIBLEITC175IGST: "Rates and Taxes",
    PTECCOMPANY: "Rates and Taxes",
    CARRIAGEOUTWARDURD: "Carriage Outward-URD"
};

async function main() {
    const groups = await prisma.ledgerGroup.findMany({ select: { id: true, name: true, parentId: true } });
    const byId = new Map(groups.map(g => [g.id, g]));
    const pathOf = (id: string) => {
        const names: string[] = [];
        let cur: typeof groups[0] | undefined = byId.get(id);
        while (cur) {
            names.unshift(n(cur.name));
            cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
        return names.join(" > ");
    };
    const ieIds = new Set(
        groups.filter(g => pathOf(g.id).toLowerCase().includes("indirect expense")).map(g => g.id)
    );
    const targetGroups = new Map<string, string>();
    for (const g of groups) {
        if (!ieIds.has(g.id)) continue;
        const key = compact(g.name);
        if (["INDIRECTEXPENSE", "INDIRECTEXPENSES", "EXPENSES"].includes(key)) continue;
        targetGroups.set(key, g.id);
    }
    const ledgers = await prisma.ledger.findMany({
        where: { groupId: { in: [...ieIds] } },
        select: { id: true, name: true, groupId: true, code: true }
    });
    const moves: Array<{ id: string; name: string; from: string; to: string; toName: string }> = [];
    for (const ledger of ledgers) {
        const alias = compact(ledger.name);
        const targetName = TARGET_BY_ALIAS[alias];
        if (!targetName) continue;
        const targetId = targetGroups.get(compact(targetName));
        if (!targetId || ledger.groupId === targetId) continue;
        const fromPath = pathOf(ledger.groupId);
        const toPath = pathOf(targetId);
        if (fromPath === toPath) continue;
        if (fromPath.includes(toPath) && fromPath !== toPath) continue;
        moves.push({
            id: ledger.id,
            name: ledger.name,
            from: fromPath,
            to: targetId,
            toName: toPath
        });
    }
    console.log(JSON.stringify({
        dryRun: !apply,
        moveCount: moves.length,
        moves: moves.map(m => ({ name: m.name, from: m.from, to: m.toName }))
    }, null, 2));
    if (!apply) return;
    for (const move of moves) {
        await prisma.ledger.update({ where: { id: move.id }, data: { groupId: move.to } });
    }
    console.log(JSON.stringify({ moved: moves.length }));
}

main().catch(error => {
    console.error(error instanceof Error ? error.stack || error.message : error);
    process.exitCode = 1;
}).finally(() => prisma.$disconnect());

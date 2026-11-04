import "dotenv/config";
import { ReportingService } from "./src/modules/reports/reporting.service";

const ACTOR = "c7feaec8-d19f-480b-8bf3-036745415849";
const BRANCH_ID = "47fdc8aa-83ba-46f9-93ec-4517e0eb13bb";
const cents = (v: unknown) => Math.round(Number(v || 0) * 100);

const PDF: Record<string, { od: number; oc: number; cd: number; cc: number }> = {
    "ACCELERATOR GENERAL TRADING LLC": { od: 21011561.77, oc: 0, cd: 21011561.77, cc: 0 },
    "AINUMPUDI SURESH VARMA": { od: 0, oc: 0, cd: 50000, cc: 0 },
    "ALOIS BUILDERS AND INF": { od: 0, oc: 0, cd: 1000000, cc: 0 },
    "AML MOTORS PVT LTD": { od: 0, oc: 0, cd: 29344, cc: 0 },
    "Anjali Electricals": { od: 44110, oc: 0, cd: 44110, cc: 0 },
    "ASPHALTERA PRIVATE LIMITED": { od: 3800000, oc: 0, cd: 237900, cc: 0 },
    "AVNTIKA ENTERPRISE CRS": { od: 0, oc: 0, cd: 6329258, cc: 0 },
    "CLASSIC PETRO & ENERGY PRIVATE LIMITED CRS": { od: 0, oc: 0, cd: 0, cc: 0 },
    "Darsh Enterprises (CR)": { od: 0, oc: 0, cd: 0, cc: 0 },
    "DREAMZZ MAKERS EVENTS AN": { od: 0, oc: 0, cd: 100000, cc: 0 },
    "EKVIRA TRANSPORT AND LOGISTICS": { od: 0, oc: 316155, cd: 236958, cc: 0 },
    "EMIT INTERNATIONAL FZ LLC": { od: 32691837.61, oc: 0, cd: 13515828.93, cc: 0 },
    "GLOBAL PLASTO CHEM": { od: 0, oc: 0, cd: 1199, cc: 0 },
    "HINDUSTAN PETROLEUM CORPORATION LIMITED": { od: 1487825.21, oc: 0, cd: 45824.05, cc: 0 },
    "INDIAIDEAS.COM": { od: 0, oc: 0, cd: 6478.36, cc: 0 },
    "Indian Oil Corporation Limited-GJ": { od: 91016, oc: 0, cd: 91313, cc: 0 },
    "INDIAN OIL CORPORATION LIMITED - MH": { od: 0, oc: 0, cd: 6664, cc: 0 },
    "JALDEV SHIPPING AGENCY": { od: 0, oc: 0, cd: 87886, cc: 0 },
    "KHANDOBA BIOREFINERIES PRIVATE LIMITED": { od: 9836656, oc: 0, cd: 0, cc: 0 },
    "K M ENTERPRISE": { od: 0, oc: 0, cd: 0, cc: 0 },
    "KS Oil Corporation - CR": { od: 0, oc: 0, cd: 4080, cc: 0 },
    "M1 EXCHANGE": { od: 0, oc: 0, cd: 0, cc: 0 },
    "MAYRA PETROLEUM FZCO": { od: 11475470.6, oc: 0, cd: 11475470.6, cc: 0 },
    "MSTC LTD": { od: 275208, oc: 0, cd: 274028, cc: 0 },
    "Mynd Solutions Pvt. Ltd.": { od: 0, oc: 0, cd: 2156, cc: 0 },
    "NAYARA ENERGY LIMITED": { od: 0, oc: 2028, cd: 0, cc: 0 },
    "NAZPAL OIL ENERGY L.L.C": { od: 5850826.45, oc: 0, cd: 5850826.45, cc: 0 },
    "NEPTUNE PETROCHEMICALS LIMITED - UP CRS": { od: 0, oc: 0, cd: 0, cc: 0 },
    "RAAJ UNOCAL LUBRICANTS LTD": { od: 0, oc: 86650707.39, cd: 7071843.37, cc: 0 },
    "ROYAL AUTOCRYSTAL SERVICES PRIVATE LIMITED": { od: 0, oc: 0, cd: 3594, cc: 0 },
    "ROYAL ENTERPRISES": { od: 0, oc: 0, cd: 416, cc: 0 },
    "SANDEEPDADA THAKUR FOUNDATION": { od: 0, oc: 0, cd: 100000, cc: 0 },
    "SHANTI HEAVY DUTY EARTH MOVERS": { od: 0, oc: 0, cd: 49500, cc: 0 },
    "SHREE HARI ENTERPRISES": { od: 0, oc: 39141, cd: 26334, cc: 0 },
    "SIDDHARTH TRADERS": { od: 2100000, oc: 0, cd: 2100000, cc: 0 },
    "SIGMA PETROCHEM": { od: 0, oc: 0, cd: 1490, cc: 0 },
    "SILVERBACK INFRA PRIVATE LIMITED": { od: 0, oc: 0, cd: 0, cc: 0 },
    "STAR MOTORS": { od: 0, oc: 0, cd: 0, cc: 0 },
    "SUKHMANI OIL AND LUBE CRS": { od: 0, oc: 0, cd: 5783, cc: 0 },
};

(async () => {
    const report = await ReportingService.getTrialBalanceReport(
        { id: ACTOR, branchAccessType: "ALL" },
        { branchId: BRANCH_ID, startDate: "2025-04-01", endDate: "2026-03-31" }
    );
    const walk = (nodes: any[], path: string[] = []): any[] =>
        nodes.flatMap(node => {
            const next = [...path, node.name];
            return [{ path: next.join(" > "), node }, ...walk(node.children || [], next)];
        });
    const all = walk(report.tree || []);
    const parent = all.find(x => x.path === "Current Assets > Loans & Advances (Asset) > Advance to S. Creditors");
    const loans = all.find(x => x.path === "Current Assets > Loans & Advances (Asset)");
    const salary = all.find(x => x.path === "Current Assets > Loans & Advances (Asset) > Advance Salary");
    const children = all.filter(x => x.path.startsWith("Current Assets > Loans & Advances (Asset) > Advance to S. Creditors > "));
    const mismatches = [];
    for (const c of children) {
        const pdf = PDF[c.node.name];
        if (!pdf) { mismatches.push({ name: c.node.name, issue: "extra" }); continue; }
        if (
            cents(c.node.openingDebit) !== cents(pdf.od) ||
            cents(c.node.openingCredit) !== cents(pdf.oc) ||
            cents(c.node.closingDebit) !== cents(pdf.cd) ||
            cents(c.node.closingCredit) !== cents(pdf.cc)
        ) {
            mismatches.push({
                name: c.node.name,
                tb: { od: c.node.openingDebit, oc: c.node.openingCredit, cd: c.node.closingDebit, cc: c.node.closingCredit },
                pdf
            });
        }
    }
    const missing = Object.keys(PDF).filter(n => !children.some(c => c.node.name === n && (c.node.closingDebit || c.node.closingCredit || c.node.openingDebit || c.node.openingCredit || PDF[n].cd || PDF[n].cc || PDF[n].od || PDF[n].oc)));
    const guard = {
        SC: all.find(x => x.path === "Current Liabilities > Sundry Creditors"),
        Duties: all.find(x => x.path === "Current Liabilities > Duties & Taxes"),
        OD: all.find(x => x.path === "Loans (Liability) > Bank OD A/c & CC A/c"),
        Unsec: all.find(x => x.path === "Loans (Liability) > Unsecured Loans"),
        Cash: all.find(x => x.path === "Current Assets > Cash-in-Hand"),
        Karnataka: all.find(x => x.path.endsWith("A G ASHTAVINAYAKA PETROCHEM PVT LTD-KARNATAKA")),
        Branch: all.find(x => x.path === "Branch / Divisions"),
    };
    const snap = (n: any) => n && { od: n.node.openingDebit, oc: n.node.openingCredit, cd: n.node.closingDebit, cc: n.node.closingCredit };
    console.log(JSON.stringify({
        parent: snap(parent),
        parentOk: parent && cents(parent.node.closingDebit) === cents(69759846.53) && cents(parent.node.closingCredit) === 0
            && cents(parent.node.openingDebit) === cents(88664511.64) && cents(parent.node.openingCredit) === cents(87008031.39),
        loans: snap(loans),
        salary: snap(salary),
        childCount: children.length,
        mismatchCount: mismatches.length,
        mismatches,
        missingPdfWithBalance: missing,
        guard: {
            SC: snap(guard.SC),
            Duties: snap(guard.Duties),
            OD: snap(guard.OD),
            Unsec: snap(guard.Unsec),
            Cash: snap(guard.Cash),
            Karnataka: snap(guard.Karnataka),
            Branch: snap(guard.Branch)
        }
    }, null, 2));
})().catch(e => { console.error(e); process.exitCode = 1; });

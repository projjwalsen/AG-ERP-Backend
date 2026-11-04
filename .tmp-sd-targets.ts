import * as fs from "fs";

const tally = JSON.parse(fs.readFileSync("src/modules/reports/Trial/TALLYTRIALBAL.json", "utf8"));

function findGroup(nodes: any[], name: string): any | null {
    for (const n of nodes || []) {
        if (String(n.name).trim() === name) return n;
        const hit = findGroup(n.children || [], name);
        if (hit) return hit;
    }
    return null;
}

const sd = findGroup(tally.accounts || tally, "Sundry Debtors");
if (!sd) throw new Error("Sundry Debtors not found");

function flatten(node: any, acc: any[] = [], isRoot = true): any[] {
    if (!isRoot) {
        acc.push({
            name: node.name,
            type: node.type,
            od: Number(node.opening?.debit || 0),
            oc: Number(node.opening?.credit || 0),
            cd: Number(node.closing?.debit || 0),
            cc: Number(node.closing?.credit || 0)
        });
    }
    for (const c of node.children || []) flatten(c, acc, false);
    return acc;
}

const leaves = flatten(sd);
const sum = (k: string) => Number(leaves.reduce((s, r) => s + Math.round(r[k] * 100), 0) / 100);
const out = {
    group: {
        od: sd.opening?.debit, oc: sd.opening?.credit,
        cd: sd.closing?.debit, cc: sd.closing?.credit
    },
    leafN: leaves.length,
    leafSum: { od: sum("od"), oc: sum("oc"), cd: sum("cd"), cc: sum("cc") },
    leaves
};
fs.writeFileSync(".tmp-sd-targets.json", JSON.stringify(out, null, 2));
console.log(JSON.stringify({ group: out.group, leafN: out.leafN, leafSum: out.leafSum }, null, 2));

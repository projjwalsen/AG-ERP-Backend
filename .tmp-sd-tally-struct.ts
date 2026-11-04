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
const sd = findGroup(tally.accounts, "Sundry Debtors");
function walk(node: any, depth = 0, acc: any[] = []): any[] {
    acc.push({
        depth, type: node.type, name: node.name,
        od: node.opening?.debit, oc: node.opening?.credit,
        cd: node.closing?.debit, cc: node.closing?.credit,
        childN: (node.children || []).length
    });
    for (const c of node.children || []) walk(c, depth + 1, acc);
    return acc;
}
const rows = walk(sd);
const groups = rows.filter(r => r.type === "group" && r.depth > 0);
console.log(JSON.stringify({
    total: rows.length,
    groups,
    depthCounts: rows.reduce((a: any, r) => { a[r.depth] = (a[r.depth] || 0) + 1; return a; }, {}),
    types: rows.reduce((a: any, r) => { a[r.type] = (a[r.type] || 0) + 1; return a; }, {})
}, null, 2));

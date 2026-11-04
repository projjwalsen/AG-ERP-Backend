/**
 * Builds a display-only alias map for duplicate group headings. Imported
 * ledgers can differ only by punctuation/case, or repeat a heading as a
 * child of itself. Keep the source records intact; consumers can present one
 * canonical tree while retaining all ledgers and their voucher history.
 */
export type LedgerGroupDisplayRow = {
    id: string;
    code: string;
    name: string;
    parentId: string | null;
};
type LedgerDisplayRow = { groupId: string; name: string };

const normalizeHeading = (name: string) =>
    String(name || "").normalize("NFKC").toLocaleLowerCase().replace(/[^a-z0-9]/g, "");

export const buildDuplicateLedgerGroupDisplayMap = <T extends LedgerGroupDisplayRow>(
    groups: T[],
    ledgers: LedgerDisplayRow[] = []
) => {
    const byId = new Map(groups.map(group => [group.id, group]));
    const depthOf = (group: T) => {
        let depth = 0;
        let parentId = group.parentId;
        const visited = new Set([group.id]);
        while (parentId && !visited.has(parentId)) {
            visited.add(parentId);
            depth += 1;
            parentId = byId.get(parentId)?.parentId || null;
        }
        return depth;
    };
    const preferred = (a: T, b: T) => {
        const aImported = /^(JRNIMP|MAP)_/i.test(a.code);
        const bImported = /^(JRNIMP|MAP)_/i.test(b.code);
        return Number(aImported) - Number(bImported) || a.id.localeCompare(b.id);
    };

    const aliases = new Map<string, string>();
    const canonicalId = (id: string) => {
        let current = id;
        const visited = new Set<string>();
        while (aliases.has(current) && !visited.has(current)) {
            visited.add(current);
            current = aliases.get(current)!;
        }
        return current;
    };

    for (const group of [...groups].sort((a, b) => depthOf(a) - depthOf(b) || a.id.localeCompare(b.id))) {
        const nameKey = normalizeHeading(group.name);
        if (!nameKey) continue;
        const parent = group.parentId ? byId.get(group.parentId) : undefined;
        // A same-named child is a repeated heading; show its contents under
        // the parent instead of repeating the label.
        if (parent && normalizeHeading(parent.name) === nameKey) {
            aliases.set(group.id, canonicalId(parent.id));
            continue;
        }

        const canonicalParentId = parent ? canonicalId(parent.id) : null;
        const sibling = groups
            .filter(candidate => candidate.id !== group.id && normalizeHeading(candidate.name) === nameKey)
            .filter(candidate => {
                const candidateParent = candidate.parentId ? byId.get(candidate.parentId) : undefined;
                return (candidateParent ? canonicalId(candidateParent.id) : null) === canonicalParentId;
            })
            .map(candidate => canonicalId(candidate.id))
            .map(id => byId.get(id))
            .filter((candidate): candidate is T => Boolean(candidate))
            .sort(preferred)[0];
        if (sibling && sibling.id !== group.id) {
            const winner = [group, sibling].sort(preferred)[0];
            const loser = winner.id === group.id ? sibling : group;
            aliases.set(loser.id, winner.id);
        }
    }

    // Tally imports sometimes create a subgroup whose only ledger repeats
    // the subgroup's exact name (e.g. Branch / Divisions > Tamilnadu >
    // Tamilnadu). The ledger is the actual account; flatten the redundant
    // subgroup into its parent while retaining the ledger and its postings.
    const groupsWithChildren = new Set(
        groups.map(group => group.parentId).filter((id): id is string => Boolean(id))
    );
    for (const group of groups) {
        if (!group.parentId || groupsWithChildren.has(group.id)) continue;
        const directLedgers = ledgers.filter(ledger => ledger.groupId === group.id);
        if (
            directLedgers.length > 0 &&
            directLedgers.every(ledger => normalizeHeading(ledger.name) === normalizeHeading(group.name))
        ) {
            aliases.set(group.id, canonicalId(group.parentId));
        }
    }
    return aliases;
};

export const resolveLedgerGroupDisplayId = (aliases: Map<string, string>, id: string) => {
    let current = id;
    const visited = new Set<string>();
    while (aliases.has(current) && !visited.has(current)) {
        visited.add(current);
        current = aliases.get(current)!;
    }
    return current;
};

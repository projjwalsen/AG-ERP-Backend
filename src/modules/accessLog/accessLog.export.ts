import ExcelJS from "exceljs";

export type AccessLogExportFormat = "xlsx" | "csv";

interface ExportRow {
    operation: string;
    module: string;
    status: string;
    entityType: string | null;
    entityId: string | null;
    description: string | null;
    performedByName: string | null;
    performedByEmail: string | null;
    ipAddress: string | null;
    createdAt: Date;
}

const COLUMNS: { header: string; key: string; width: number }[] = [
    { header: "Date & Time (IST)", key: "when", width: 24 },
    { header: "User", key: "user", width: 22 },
    { header: "Email", key: "email", width: 30 },
    { header: "Status", key: "status", width: 10 },
    { header: "Description", key: "description", width: 60 },
    { header: "IP Address", key: "ip", width: 18 },
    { header: "Entity Type", key: "entityType", width: 18 },
    { header: "Entity ID", key: "entityId", width: 38 }
];

const formatIst = (date: Date): string =>
    new Intl.DateTimeFormat("en-IN", {
        timeZone: "Asia/Kolkata",
        year: "numeric",
        month: "short",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
    }).format(date);

/**
 * Cells that start with = + - @ are executed as formulas by Excel.
 * Descriptions and names come from users, so neutralise them.
 */
const safeText = (value: unknown): string => {
    const text = value === null || value === undefined ? "" : String(value);
    return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
};

const toRecord = (row: ExportRow): Record<string, string> => ({
    when: formatIst(row.createdAt),
    user: safeText(row.performedByName),
    email: safeText(row.performedByEmail),
    status: safeText(row.status),
    description: safeText(row.description),
    ip: safeText(row.ipAddress),
    entityType: safeText(row.entityType),
    entityId: safeText(row.entityId)
});

const csvCell = (value: string): string =>
    /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;

export const buildAccessLogCsv = (rows: ExportRow[]): Buffer => {
    const lines = [COLUMNS.map(column => csvCell(column.header)).join(",")];

    for (const row of rows) {
        const record = toRecord(row);
        lines.push(COLUMNS.map(column => csvCell(record[column.key])).join(","));
    }

    // BOM so Excel opens the file as UTF-8.
    return Buffer.from("\uFEFF" + lines.join("\r\n"), "utf8");
};

export const buildAccessLogXlsx = async (rows: ExportRow[]): Promise<Buffer> => {
    const workbook = new ExcelJS.Workbook();
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Activity Log", {
        views: [{ state: "frozen", ySplit: 1 }]
    });

    sheet.columns = COLUMNS.map(column => ({
        header: column.header,
        key: column.key,
        width: column.width
    }));

    for (const row of rows) {
        sheet.addRow(toRecord(row));
    }

    const header = sheet.getRow(1);
    header.font = { bold: true };
    header.alignment = { vertical: "middle" };
    header.eachCell(cell => {
        cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } };
        cell.border = { bottom: { style: "thin", color: { argb: "FFD1D5DB" } } };
    });

    sheet.autoFilter = { from: "A1", to: { row: 1, column: COLUMNS.length } };

    const output = await workbook.xlsx.writeBuffer();
    return Buffer.from(output as ArrayBuffer);
};

export const exportFileName = (format: AccessLogExportFormat): string => {
    const stamp = new Date().toISOString().slice(0, 10);
    return `activity-log-${stamp}.${format}`;
};

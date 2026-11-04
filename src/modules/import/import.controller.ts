import {
    Request,
    Response,
    NextFunction
} from "express";
import {
    getImportErrorReport,
    ImportService
} from "./multer.import";
import { JournalImportService } from "./journalImport.service";
import { OpeningBalanceJournalImportService } from "./opening-balance-journal-import.service";
import { InwardDebitCreditNoteImportService } from "./inwardDebitCreditNoteImport.service";
import { ProductMasterImportService } from "./productImport.service";
import { AgencyImportService } from "./agencyImport.service";
import { TdsAssetsReconciliationService } from "./tds-assets-reconciliation.service";
import { AgencyLedgerReconciliationService } from "./agency-ledger-reconciliation.service";
import { TrialBalanceLedgerVoucherService } from "./trial-balance-ledger-voucher.service";
import { PaymentVoucherRepairService } from "./payment-voucher-repair.service";


export const importWorkbook = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const actor = (req as any).user;
        // Set headers for Server-Sent Events (SSE)
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");

        const file = req.file;

        if (!file) {

            return res.status(400).json({

                success: false,

                message: "Excel file is required."

            });

        }

        const type =
            String(req.body.type).toUpperCase()



        if (
            type !== "PURCHASE" &&
            type !== "SALE"
        ) {

            return res.status(400).json({

                success: false,

                message:
                    "Type must be PURCHASE or SALE."

            });

        }

        const result =
            await ImportService.importWorkbook(
                actor,
                file,
                type,
                (progress) => {
                    res.write(
                        `data: ${JSON.stringify(progress)}\n\n`
                    );
                }
            );

        // final event streaming message to indicate completion
        res.write(
            `event: completed\n`
            + `data: ${JSON.stringify({
                success: true,
                message: `${type} Register imported successfully.`,
                data: {
                    ...result,
                    ...(result.errorReport
                        ? {
                            errorReportUrl:
                                `${req.baseUrl}/import/error-report/${result.errorReport.reportId}`
                        }
                        : {})
                }
            })}\n\n`
        );

        res.end();

    }

    catch (error) {

        next(error);

    }

};

export const importProductWorkbook = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const actor =
            (req as any).user;

        res.setHeader(
            "Content-Type",
            "text/event-stream"
        );

        res.setHeader(
            "Cache-Control",
            "no-cache"
        );

        res.setHeader(
            "Connection",
            "keep-alive"
        );

        const file =
            req.file;

        if (!file) {

            return res.status(400).json({

                success: false,

                message:
                    "Excel file is required."

            });

        }

        const result =
            await ProductMasterImportService.importWorkbook(

                actor,

                file,

                summary => {

                    res.write(

                        `data: ${JSON.stringify(summary)}\n\n`

                    );

                }

            );

        res.write(

            `event: completed\n` +

            `data: ${JSON.stringify({

                success: true,

                message:
                    "Product Master imported successfully.",

                data: result

            })}\n\n`

        );

        res.end();

    }

    catch (error) {

        next(error);

    }

};

export const importAgencyWorkbook = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {

        const actor =
            (req as any).user;

        res.setHeader(
            "Content-Type",
            "text/event-stream"
        );

        res.setHeader(
            "Cache-Control",
            "no-cache"
        );

        res.setHeader(
            "Connection",
            "keep-alive"
        );

        const file =
            req.file;

        if (!file) {

            return res.status(400).json({

                success: false,

                message:
                    "Excel file is required."

            });

        }

        const result =
            await AgencyImportService.importWorkbook(

                actor,

                file,

                summary => {

                    res.write(

                        `data: ${JSON.stringify(summary)}\n\n`

                    );

                }

            );

        res.write(

            `event: completed\n` +

            `data: ${JSON.stringify({

                success: true,

                message:
                    "Agency Master imported successfully.",

                data: result

            })}\n\n`

        );

        res.end();

    }

    catch (error) {

        next(error);

    }

};


export const importJournalWorkbook = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {

    try {
        const actor =
            (req as any).user;

        res.setHeader(
            "Content-Type",
            "text/event-stream"
        );

        res.setHeader(
            "Cache-Control",
            "no-cache"
        );

        res.setHeader(
            "Connection",
            "keep-alive"
        );

        const file =
            req.file;

        if (!file) {
            return res.status(400).json({
                success: false,
                message:
                    "Excel file is required."
            });
        }

        const type =
            String(req.query.type || "JOURNAL")
                .toUpperCase() as
                    "JOURNAL" | "TRANSACTION" | "BOTH";

        const fromDate =
            typeof req.body.fromDate === "string"
                ? req.body.fromDate.trim()
                : "";

        const toDate =
            typeof req.body.toDate === "string"
                ? req.body.toDate.trim()
                : "";

        const result =
            await JournalImportService.importWorkbook(
                actor,
                file,
                type,
                fromDate ? new Date(fromDate) : undefined,
                toDate ? new Date(toDate) : undefined,
                summary => {
                    res.write(
                        `data: ${JSON.stringify(summary)}\n\n`
                    );
                }
            );

        res.write(
            `event: completed\n` +
            `data: ${JSON.stringify({
                success: true,
                message:
                    "Journal imported successfully.",
                data: {
                    ...result,
                    ...(result.errorReport
                        ? {
                            errorReportUrl:
                                `${req.baseUrl}/import/error-report/${result.errorReport.reportId}`
                        }
                        : {})
                }
            })}\n\n`
        );

        res.end();
    }

    catch (error) {
        next(error);
    }

};

export const importOpeningBalanceJournalWorkbook = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const file = req.file;
        if (!file) {
            return res.status(400).json({ success: false, message: "Excel file is required." });
        }
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        const openingDate = typeof req.body.openingDate === "string" && req.body.openingDate
            ? new Date(req.body.openingDate)
            : undefined;
        const result = await OpeningBalanceJournalImportService.importWorkbook(
            (req as any).user,
            file,
            typeof req.body.branchId === "string" ? req.body.branchId : undefined,
            openingDate,
            summary => res.write(`data: ${JSON.stringify(summary)}\n\n`)
        );
        res.write(`event: completed\ndata: ${JSON.stringify({
            success: true,
            message: "Opening-balance journals imported successfully.",
            data: {
                ...result,
                ...(result.errorReport
                    ? {
                        errorReportUrl:
                            `${req.baseUrl}/import/error-report/${result.errorReport.reportId}`
                    }
                    : {})
            }
        })}\n\n`);
        res.end();
    } catch (error) {
        next(error);
    }
};

export const reconcileTdsAssetsWorkbook = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "Excel file is required." });
        }
        const dryRun = String(req.query.dryRun ?? req.body.dryRun ?? "false").toLowerCase() === "true";
        const result = await TdsAssetsReconciliationService.reconcile(req.file.buffer, dryRun);
        return res.status(200).json({
            success: true,
            message: dryRun
                ? "TDS Assets reconciliation validated successfully; no changes were applied."
                : "TDS Assets vouchers reconciled successfully.",
            data: result
        });
    } catch (error) {
        next(error);
    }
};

export const reconcileAgencyLedgerWorkbook = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "Excel file is required." });
        }
        const agencyName = String(req.body.agencyName || req.query.agencyName || "").trim();
        if (!agencyName) {
            return res.status(400).json({ success: false, message: "agencyName is required." });
        }
        const apply = String(req.query.apply ?? req.body.apply ?? "false").toLowerCase() === "true";
        const branchId = String(req.body.branchId || req.query.branchId || "").trim() || undefined;
        const result = await AgencyLedgerReconciliationService.reconcile(
            (req as any).user,
            agencyName,
            req.file.buffer,
            branchId,
            apply
        );
        return res.status(200).json({
            success: true,
            message: apply
                ? "Agency ledger reconciliation completed."
                : "Agency ledger reconciliation preview completed; no changes were applied.",
            data: result
        });
    } catch (error) {
        next(error);
    }
};

export const unlinkExtraAgencyLedgerVouchers = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "Excel file is required." });
        }
        const agencyName = String(req.body.agencyName || req.query.agencyName || "").trim();
        if (!agencyName) {
            return res.status(400).json({ success: false, message: "agencyName is required." });
        }
        const rawAllowUnlink = req.body.allowUnlink ?? req.query.allowUnlink ?? false;
        const normalizedAllowUnlink = String(rawAllowUnlink).trim().toLowerCase();
        if (!["true", "false"].includes(normalizedAllowUnlink)) {
            return res.status(400).json({ success: false, message: "allowUnlink must be true or false." });
        }
        const allowUnlink = normalizedAllowUnlink === "true";
        const branchId = String(req.body.branchId || req.query.branchId || "").trim() || undefined;
        const result = await AgencyLedgerReconciliationService.unlinkExtraCreditPostings(
            (req as any).user,
            agencyName,
            req.file.buffer,
            branchId,
            allowUnlink
        );
        return res.status(200).json({
            success: true,
            message: allowUnlink
                ? "Extra agency credit postings checked; safe postings were unlinked."
                : "Extra agency credit posting preview completed; no changes were applied.",
            data: result
        });
    } catch (error) {
        next(error);
    }
};

export const importTrialBalanceLedgerVouchers = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "Excel file is required." });
        const ledgerName = String(req.body.ledgerName || req.query.ledgerName || "").trim();
        if (!ledgerName) return res.status(400).json({ success: false, message: "ledgerName is required." });
        const rawAccept = req.body.accept ?? req.query.accept ?? "false";
        const acceptValue = String(rawAccept).trim().toLowerCase();
        if (!["true", "false"].includes(acceptValue)) return res.status(400).json({ success: false, message: "accept must be true or false." });
        const branchId = String(req.body.branchId || req.query.branchId || "").trim() || undefined;
        const offsetLedgerName = String(req.body.offsetLedgerName || req.query.offsetLedgerName || "").trim() || undefined;
        const rawAllowUnlink = req.body.allowUnlink ?? req.query.allowUnlink ?? "false";
        const allowUnlinkValue = String(rawAllowUnlink).trim().toLowerCase();
        if (!["true", "false"].includes(allowUnlinkValue)) {
            return res.status(400).json({ success: false, message: "allowUnlink must be true or false." });
        }
        if (acceptValue === "true" && allowUnlinkValue === "true") {
            return res.status(400).json({
                success: false,
                message: "Run voucher creation and extra-posting unlinking as separate requests so each change can be reviewed independently."
            });
        }
        const result = await TrialBalanceLedgerVoucherService.import(
            (req as any).user, ledgerName, req.file.buffer, acceptValue === "true", branchId, offsetLedgerName,
            allowUnlinkValue === "true"
        );
        return res.status(200).json({
            success: true,
            message: [
                acceptValue === "true" ? "Missing dated PAYMENT, RECEIPT, and JOURNAL vouchers were imported." : "Missing vouchers were previewed.",
                allowUnlinkValue === "true" ? "Safe extra postings were reassigned to their unique counter-ledgers." : "Extra postings were previewed; no unlinking was applied."
            ].join(" "),
            data: result
        });
    } catch (error) {
        next(error);
    }
};

export const reconcilePaymentVoucherRegister = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    const rawEntry = req.body?.entry ?? req.query.entry ?? req.body?.enable ?? req.query.enable ?? "false";
    const entryValue = String(rawEntry).trim().toLowerCase();
    const repairValue = String(req.body?.repairExisting ?? req.query.repairExisting ?? "false").trim().toLowerCase();
    const repairAmbiguousValue = String(req.body?.repairAmbiguous ?? req.query.repairAmbiguous ?? "false").trim().toLowerCase();
    const repairPostingValue = String(req.body?.repairPostingIssues ?? req.query.repairPostingIssues ?? "false").trim().toLowerCase();
    const includeCorrectValue = String(req.body?.includeCorrectVouchers ?? req.query.includeCorrectVouchers ?? "false").trim().toLowerCase();
    const rawLedgerMappings = req.body?.ledgerMappings ?? req.query.ledgerMappings;
    // Stream preview and entry runs by default. Clients can explicitly send
    // stream=false to retain the single JSON response format.
    const streamValue = String(req.body?.stream ?? req.query.stream ?? "true").trim().toLowerCase();
    const streaming = streamValue === "true";
    try {
        if (!req.file) return res.status(400).json({ success: false, message: "Excel file is required." });
        if (!["true", "false"].includes(repairValue)) {
            return res.status(400).json({ success: false, message: "repairExisting must be true or false." });
        }
        if (!["true", "false"].includes(repairAmbiguousValue)) {
            return res.status(400).json({ success: false, message: "repairAmbiguous must be true or false." });
        }
        if (!["true", "false"].includes(repairPostingValue)) {
            return res.status(400).json({ success: false, message: "repairPostingIssues must be true or false." });
        }
        if (entryValue === "true" && (repairValue === "true" || repairAmbiguousValue === "true" || repairPostingValue === "true")) {
            return res.status(400).json({ success: false, message: "Run missing voucher creation and existing voucher reconciliation separately." });
        }
        if (!["true", "false"].includes(entryValue)) {
            return res.status(400).json({ success: false, message: "entry must be true or false." });
        }
        if (!["true", "false"].includes(streamValue)) {
            return res.status(400).json({ success: false, message: "stream must be true or false." });
        }
        if (!["true", "false"].includes(includeCorrectValue)) {
            return res.status(400).json({ success: false, message: "includeCorrectVouchers must be true or false." });
        }
        let ledgerMappings: Record<string, string> = {};
        if (rawLedgerMappings !== undefined) {
            try {
                const parsed = typeof rawLedgerMappings === "string" ? JSON.parse(rawLedgerMappings) : rawLedgerMappings;
                if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) ||
                    Object.entries(parsed).some(([path, id]) => !path.trim() || typeof id !== "string" || !id.trim())) {
                    throw new Error("ledgerMappings must be a JSON object mapping full Excel paths to candidate ledger IDs");
                }
                ledgerMappings = parsed as Record<string, string>;
            } catch (error) {
                return res.status(400).json({
                    success: false,
                    message: error instanceof Error ? error.message : "ledgerMappings must be valid JSON"
                });
            }
        }
        if (repairAmbiguousValue === "true" && !Object.keys(ledgerMappings).length) {
            return res.status(400).json({ success: false, message: "Provide ledgerMappings to select the exact candidate ledger ID for each ambiguous full path." });
        }
        if (repairAmbiguousValue !== "true" && Object.keys(ledgerMappings).length) {
            return res.status(400).json({ success: false, message: "ledgerMappings can only be used with repairAmbiguous=true." });
        }
        const branchId = String(req.body.branchId || req.query.branchId || "").trim() || undefined;
        if (streaming) {
            res.status(200);
            res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
            res.setHeader("Cache-Control", "no-cache, no-transform");
            res.setHeader("X-Accel-Buffering", "no");
            res.flushHeaders();
            res.write(`${JSON.stringify({ event: "started", data: { branchId, entry: entryValue === "true", repairExisting: repairValue === "true", repairAmbiguous: repairAmbiguousValue === "true", repairPostingIssues: repairPostingValue === "true" } })}\n`);
            (res as any).flush?.();
        }
        let lastProgressSent = 0;
        const result = await PaymentVoucherRepairService.reconcile(
            (req as any).user,
            req.file.buffer,
            entryValue === "true",
            branchId,
            streaming
                ? voucher => {
                    const isCorrectExistingVoucher = voucher.status === "skipped" &&
                        voucher.reconciliationStatus === "existsCorrectly";
                    if (includeCorrectValue !== "true" && isCorrectExistingVoucher) return;
                    res.write(`${JSON.stringify({ event: "voucher", data: voucher })}\n`);
                    (res as any).flush?.();
                }
                : undefined,
            streaming
                ? progress => {
                    const processed = Math.min(progress.processed + 1, progress.total);
                    if (processed !== 1 && processed !== progress.total && processed - lastProgressSent < 250) return;
                    lastProgressSent = processed;
                    res.write(`${JSON.stringify({ event: "progress", data: { ...progress, processed } })}\n`);
                    (res as any).flush?.();
                }
                : undefined,
            repairValue === "true",
            repairAmbiguousValue === "true",
            ledgerMappings,
            repairPostingValue === "true"
        );
        if (streaming) {
            res.write(`${JSON.stringify({
                event: "complete",
                data: {
                    branchId: result.branchId,
                    entry: result.entry,
                    repairExisting: result.repairExisting,
                    repairAmbiguous: result.repairAmbiguous,
                    repairPostingIssues: result.repairPostingIssues,
                    voucherType: result.voucherType,
                    workbookVouchers: result.workbookVouchers,
                    created: result.created,
                    repaired: result.repaired,
                    summary: result.summary
                }
            })}\n`);
            return res.end();
        }
        const allVouchers = result.vouchers;
        const returnedVouchers = includeCorrectValue === "true"
            ? allVouchers
            : allVouchers.filter(voucher => !(voucher.status === "skipped" &&
                voucher.reconciliationStatus === "existsCorrectly"));
        const omittedCorrectVouchers = allVouchers.length - returnedVouchers.length;
        const summary = {
            ...result.summary,
            totalVouchers: allVouchers.length,
            returnedVouchers: returnedVouchers.length,
            omittedCorrectVouchers
        };
        return res.status(200).json({
            success: true,
            message: repairValue === "true"
                ? repairPostingValue === "true"
                    ? "Validated existing Payment voucher rows were reconciled where one-to-one matching and final balance checks passed; other vouchers were skipped for review."
                    : "Safe existing Payment voucher ledger remaps were applied; skipped rows failed one or more safety checks."
                : entryValue === "true"
                ? "Missing Payment vouchers were created as they were validated. Existing subgroup discrepancies are included in the report."
                : "Payment voucher reconciliation preview completed; no changes were applied.",
            summary,
            // Return one copy of the voucher list. Repeating thousands of full
            // voucher rows at both the top level and under `data` can exceed
            // response display limits for non-streaming clients.
            data: { ...result, summary, vouchers: returnedVouchers }
        });
    } catch (error) {
        if (streaming && res.headersSent) {
            const message = error instanceof Error ? error.message : "Payment voucher stream failed";
            res.write(`${JSON.stringify({ event: "error", data: { message } })}\n`);
            return res.end();
        }
        next(error);
    }
};

export const listPaymentVoucherSubgroupIssues = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: "Excel file is required." });
        }
        const mismatchStatuses = [
            "ledgerPathNotFound",
            "postingMissing",
            "ledgerPathAmbiguous",
            "postingAmbiguous",
            "amountMismatch",
            "wrongSubGroup"
        ] as const;
        const rawStatuses = req.body.status ?? req.query.status;
        const requestedStatuses = rawStatuses === undefined
            ? [...mismatchStatuses]
            : (Array.isArray(rawStatuses) ? rawStatuses : [rawStatuses])
                .flatMap(value => String(value).split(","))
                .map(value => value.trim())
                .filter(Boolean);
        const invalidStatuses = requestedStatuses.filter(status =>
            !mismatchStatuses.includes(status as typeof mismatchStatuses[number])
        );
        if (invalidStatuses.length) {
            return res.status(400).json({
                success: false,
                message: `Unsupported status filter: ${invalidStatuses.join(", ")}`,
                allowedStatuses: mismatchStatuses
            });
        }
        const selectedStatuses = new Set(requestedStatuses);
        const branchId = String(req.body.branchId || req.query.branchId || "").trim() || undefined;
        const result = await PaymentVoucherRepairService.reconcile(
            (req as any).user,
            req.file.buffer,
            false,
            branchId
        );
        const vouchers = result.vouchers
            .filter(voucher => ["existsWithSubGroupIssues", "existsWithAmountIssues"].includes(String(voucher.reconciliationStatus)))
            .map(voucher => ({
                ...voucher,
                rows: (voucher.rows as Array<Record<string, unknown>>).filter(row =>
                    selectedStatuses.has(String(row.status))
                )
            }))
            .filter(voucher => voucher.rows.length > 0);
        const statusCounts = Object.fromEntries(mismatchStatuses.map(status => [
            status,
            vouchers.reduce((count, voucher) => count + voucher.rows.filter(row => row.status === status).length, 0)
        ]));
        return res.status(200).json({
            success: true,
            message: "Payment voucher subgroup mismatch rows retrieved. Correct rows were excluded; no entries were changed.",
            branchId: result.branchId,
            voucherType: result.voucherType,
            workbookVouchers: result.workbookVouchers,
            filteredStatuses: [...selectedStatuses],
            issueVoucherCount: vouchers.length,
            mismatchRowCounts: statusCounts,
            vouchers
        });
    } catch (error) {
        next(error);
    }
};

export const importInwardDebitCreditNoteWorkbook = async (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        console.log("[inward-note-import] request received");
        if (!req.file) {
            return res.status(400).json({ success: false, message: "Excel file is required." });
        }
        console.log(`[inward-note-import] file received: ${req.file.originalname} (${req.file.size} bytes)`);
        const result = await InwardDebitCreditNoteImportService.importWorkbook(
            (req as any).user,
            req.file,
            summary => console.log(
                `[inward-note-import] progress ${summary.processed}/${summary.total}` +
                ` success=${summary.success} skipped=${summary.skipped} failed=${summary.failed}`
            )
        );
        console.log("[inward-note-import] completed");
        return res.status(200).json({
            success: true,
            message: "Inward and outward debit/credit notes imported successfully.",
            data: result
        });
    } catch (error) {
        next(error);
    }
};

export const downloadImportErrorReport = (
    req: Request,
    res: Response,
    next: NextFunction
) => {
    try {
        const report = getImportErrorReport(
            (req as any).params.reportId
        );

        if (!report) {
            return res.status(404).json({
                success: false,
                message: "Import error report not found or expired."
            });
        }

        res.setHeader(
            "Content-Type",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
            "Content-Disposition",
            `attachment; filename="${report.fileName}"`
        );

        return res.send(report.buffer);
    } catch (error) {
        next(error);
    }
};

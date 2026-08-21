import { AgencyType } from "@prisma/client";

export interface ExcelRowDTO {

    voucherDate?: Date;

    voucherType?: string;

    voucherNo?: string;

    invoiceNo?: string;

    otherReferenceNo?: string;

    invoiceDate?: Date;

    agencyName?: string;

    agencyAddress?: string;

    agencyGSTIN?: string;

    agencyPAN?: string;

    branchName?: string;

    branchAddress?: string;

    particulars?: string;

    disclaimer?: string;

    hsnNo?: string;

    quantity?: number;

    unit?: string;

    rate?: number;

    taxableAmount?: number;

    gstPercent?: number;

    cgst?: number;

    sgst?: number;

    igst?: number;

    roundOff?: number;

    grandTotal?: number;

    isCancelled?: boolean;

    isTotalRow?: boolean;

    narration?: string;

    transport?: {

        purchaseOrderNo?: string;

        purchaseOrderDate?: Date;

        receiptNoteNo?: string;

        receiptNoteDate?: Date;

        lrNo?: string;

        dispatchThrough?: string;

        destination?: string;

        vehicleOrFlightNo?: string;

        portOfLoading?: string;

        portOfDischarge?: string;

        countryTo?: string;

        billOfEntryNo?: string;

        billOfEntryDate?: Date;

        portCode?: string;

    };

    raw: Record<string, any>;
}

export interface ImportedTotalsDTO {

    subTotal: number;

    totalCGST: number;

    totalSGST: number;

    totalIGST: number;

    totalGST: number;

    roundOff: number;

    grandTotal: number;

}

export interface GroupedVoucherDTO {

    voucherType: string;

    voucherNo: string;

    voucherDate?: Date;

    invoiceNo?: string;

    invoiceDate?: Date;

    agencyName?: string;

    agencyAddress?: string;

    otherReferenceNo?: string;

    agencyGSTIN?: string;

    agencyPAN?: string;

    branchName?: string;

    branchAddress?: string;

    narration?: string;

    rows: ExcelRowDTO[];

    importedTotals?: ImportedTotalsDTO;

    isCancelled?: boolean;

}

export interface ParsedAddressDTO {

    addressLine1?: string;

    addressLine2?: string;

    city?: string;

    state?: string;

    stateCode?: string;

    pinCode?: string;

    email?: string;

}

export interface AgencyImportDTO {

    agencyName: string;

    agencyAddress?: string;

    agencyGSTIN?: string;

    agencyPAN?: string;

    openingBalance?: number;

    type?: AgencyType;

    city?: string;

    state?: string;

    pinCode?: string;

}

export interface ProductImportDTO {

    productName: string;

    openingStockKG?: number;

    density?: number;

    branchName?: string;

    date?: Date;

    batchNo?: string;

    sellPrice?: number;

    hsn?: string;

}

export interface JournalImportDTO {

    date?: Date;

    voucherNo: string;

    invoiceNo?: string;

    otherReferenceNo?: string;

    voucherType: string;

    particulars: string;

    debitAmount: number;

    creditAmount: number;

    raw?: any;

}

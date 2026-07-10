import { ProductUnit, VoucherType } from "@prisma/client";
import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { ExcelRowDTO, GroupedVoucherDTO, ParsedAddressDTO } from "../../core/dto/dto";
import { AgencyType } from "@prisma/client";
import { LocationService } from "../meta/meta.loc.service";
import { City, State } from "country-state-city";

export class ImportResolver {

    private static agencyCache =
        new Map<string, any>();

    private static branchCache =
        new Map<string, any>();

    private static productCache =
        new Map<string, any>();

    private static productLocks =
        new Map<string, Promise<any>>();

    static clearCache() {

        this.agencyCache.clear();

        this.branchCache.clear();

        this.productCache.clear();

    }

    private static normalizeProductName(name: string): string {

        const hsn =
            name.match(/\((\d{4,8})\)/)?.[1]
            ?? name.match(/\b(\d{4,8})\b/)?.[1];

        let normalized =
            String(name ?? "")

                .toUpperCase()

                .replace(/\(\d{4,8}\)/g, "")

                .replace(/\s*[-–]\s*(KG|KGS|LTR|LTRS|MT|MTS)\b/gi, "")

                .replace(/\b(KG|KGS|LTR|LTRS|MT|MTS)\b/gi, "")

                .replace(/\s+/g, " ")

                .trim();

        if (hsn && !normalized.endsWith(hsn)) {

            normalized += ` - ${hsn}`;

        }

        return normalized;

    }

    static async resolveOrCreateAgency(dto: GroupedVoucherDTO, type: AgencyType) {

        const cacheKey =
            dto.agencyGSTIN?.trim()
            || dto.agencyName?.trim().toLowerCase();

        if (
            cacheKey &&
            this.agencyCache.has(cacheKey)
        ) {

            return this.agencyCache.get(cacheKey);

        }

        if (dto.agencyGSTIN?.trim()) {

            const agency = await prisma.agency.findFirst({
                where: {
                    gstin: dto.agencyGSTIN.trim()
                }
            });

            if (agency) {

                const updateData: any = {};

                // Upgrade type if needed
                if (
                    agency.type !== AgencyType.BOTH &&
                    agency.type !== type
                ) {
                    updateData.type = AgencyType.BOTH;
                }

                // Fill missing GST/PAN
                if (!agency.gstin && dto.agencyGSTIN) {
                    updateData.gstin = dto.agencyGSTIN;
                }

                if (!agency.panNo && dto.agencyPAN) {
                    updateData.panNo = dto.agencyPAN;
                }

                if (Object.keys(updateData).length > 0) {

                    const updated = await prisma.agency.update({
                        where: {
                            id: agency.id
                        },
                        data: updateData
                    });

                    this.agencyCache.set(cacheKey!, updated);

                    return updated;
                }

                this.agencyCache.set(cacheKey!, agency);

                return agency;
            }
        }
        const address =
            await this.parseAddress(
                dto.agencyAddress
            );

        if (
            !address.stateCode &&
            dto.agencyGSTIN?.length >= 2
        ) {

            address.stateCode =
                dto.agencyGSTIN.substring(0,2);

        }

        if (
            !address.state &&
            address.stateCode
        ) {

            const states =
                await LocationService.getIndianStates();

            const state =
                states.find(
                    x =>
                        x.stateCode ===
                        address.stateCode
                );

            if(state){

                address.state =
                    state.name;

            }

        }

        if (dto.agencyName?.trim()) {

            const agency = await prisma.agency.findFirst({
                where: {
                    name: {
                        equals: dto.agencyName.trim(),
                        mode: "insensitive"
                    }
                }
            });

            if (agency) {

                const updateData: any = {};

                if (
                    agency.type !== AgencyType.BOTH &&
                    agency.type !== type
                ) {
                    updateData.type = AgencyType.BOTH;
                }

                if (!agency.gstin && dto.agencyGSTIN) {
                    updateData.gstin = dto.agencyGSTIN;
                }

                if (!agency.panNo && dto.agencyPAN) {
                    updateData.panNo = dto.agencyPAN;
                }

                if (
                    !agency.addressLine1 &&
                    dto.agencyAddress
                ) {
                    updateData.addressLine1 = address.addressLine1;
                    updateData.addressLine2 = address.addressLine2;
                    updateData.city = address.city;
                    updateData.state = address.state;
                    updateData.stateCode = address.stateCode;
                    updateData.pinCode = address.pinCode;
                    updateData.email = address.email;
                }


                if (Object.keys(updateData).length > 0) {

                    const updated = await prisma.agency.update({
                        where: {
                            id: agency.id
                        },
                        data: updateData
                    });

                    this.agencyCache.set(cacheKey!, updated);

                    return updated;
                }

                this.agencyCache.set(cacheKey!, agency);

                return agency;
            }
        }

        let created;

        try {

            created = await prisma.agency.create({

                data: {

                    name: dto.agencyName!,

                    gstin: dto.agencyGSTIN,

                    panNo: dto.agencyPAN,

                    addressLine1: address.addressLine1,
                    addressLine2: address.addressLine2,
                    city: address.city,
                    state: address.state,
                    stateCode: address.stateCode,
                    pinCode: address.pinCode,
                    email: address.email,

                    type

                }

            });

        }
        catch {

            created = await prisma.agency.findFirst({

                where: {

                    gstin: dto.agencyGSTIN

                }

            });

        }

        this.agencyCache.set(
            cacheKey!,
            created
        );

        return created;

    }


    static async resolveOrCreateBranch(dto: GroupedVoucherDTO) {

        const cacheKey =
            dto.branchName
                .trim()
                .toLowerCase();

        if (
            this.branchCache.has(cacheKey)
        ) {

            return this.branchCache.get(cacheKey);

        }

        if (!dto.branchName?.trim()) {
            throw new ApiError(
                "Branch missing in Excel.",
                400
            );
        }

        const address =
            await this.parseAddress(
                dto.branchAddress
            );

        const existing =
            await prisma.branch.findFirst({

                where: {

                    name: {

                        equals: dto.branchName.trim(),

                        mode: "insensitive"

                    }

                }

            });

        if (existing) {

            const updateData: any = {};

            if (
                !existing.addressLine1 &&
                dto.branchAddress
            ) {

                updateData.addressLine1 =
                    updateData.addressLine1 = address.addressLine1;
                    updateData.addressLine2 = address.addressLine2;
                    updateData.city = address.city;
                    updateData.state = address.state;
                    updateData.stateCode = address.stateCode;
                    updateData.pinCode = address.pinCode;

            }

            if (Object.keys(updateData).length > 0) {

                const updated = await prisma.branch.update({

                    where: {
                        id: existing.id
                    },

                    data: updateData

                });

                this.branchCache.set(cacheKey, updated);

                return updated;

            }
            this.branchCache.set(cacheKey, existing);

            return existing;

        }

        let created;

        try {

            created = await prisma.branch.create({

                data: {

                    name: dto.branchName,

                    code: dto.branchName
                        .replace(/\s+/g, "_")
                        .toUpperCase(),

                    addressLine1: address.addressLine1,
                    addressLine2: address.addressLine2,
                    city: address.city,
                    state: address.state,
                    stateCode: address.stateCode,
                    pinCode: address.pinCode

                }

            });

        }
        catch {

            created = await prisma.branch.findFirst({

                where: {

                    code: dto.branchName
                        .replace(/\s+/g, "_")
                        .toUpperCase()

                }

            });

        }

        this.branchCache.set(
            cacheKey,
            created
        );

        return created;


    }

    static async resolveProduct(
        dto: ExcelRowDTO
    ) {

        const normalizedName =
            this.normalizeProductName(dto.particulars!);

        const cacheKey =
            dto.hsnNo
                ? `${dto.hsnNo}_${normalizedName}`
                : normalizedName;

        if (this.productCache.has(cacheKey)) {

            return this.productCache.get(cacheKey);

        }

        let product = null;

        if (dto.hsnNo) {

            product =
                await prisma.product.findFirst({

                    where: {

                        hsnNo: dto.hsnNo,

                        name: {

                            contains: normalizedName,

                            mode: "insensitive"

                        }

                    }

                });

        }

        if (!product) {

            product =
                await prisma.product.findFirst({

                    where: {

                        OR: [

                            {

                                name: {

                                    equals: dto.particulars,

                                    mode: "insensitive"

                                }

                            },

                            {

                                name: {

                                    equals: normalizedName,

                                    mode: "insensitive"

                                }

                            }

                        ]

                    }

                });

        }

        if (!product) {

            throw new ApiError(

                `Product not found : ${dto.particulars}`,

                404

            );

        }

        this.productCache.set(
            cacheKey,
            product
        );

        return product;

    }

    static async resolveOrCreateProduct(
        dto: ExcelRowDTO
    ) {

        const normalizedName =
            this.normalizeProductName(dto.particulars!);

        const cacheKey =
            dto.hsnNo
                ? `${dto.hsnNo}_${normalizedName}`
                : normalizedName;

        if (this.productLocks.has(cacheKey)) {
           return await this.productLocks.get(cacheKey);
        }

        if (this.productCache.has(cacheKey)) {
            return this.productCache.get(cacheKey);
        }

        const lock = (async () => {

            if (dto.hsnNo) {

                const product =
                    await prisma.product.findFirst({

                        where: {

                            hsnNo: dto.hsnNo,

                            name: {

                                contains: normalizedName,

                                mode: "insensitive"

                            }

                        }

                    });

                if (product) {

                    this.productCache.set(
                        cacheKey,
                        product
                    );

                    return product;

                }

            }

            const product =
                await prisma.product.findFirst({

                    where: {

                        OR: [

                            {

                                name: {

                                    equals: dto.particulars,

                                    mode: "insensitive"

                                }

                            },

                            {

                                name: {

                                    equals: normalizedName,

                                    mode: "insensitive"

                                }

                            }

                        ]

                    }

                });

            if (product) {

                const updateData: any = {};

                if (
                    !product.hsnNo &&
                    dto.hsnNo
                ) {

                    updateData.hsnNo =
                        dto.hsnNo;

                }

                if (
                    !product.sellPricePerUnit &&
                    dto.rate
                ) {

                    updateData.sellPricePerUnit =
                        dto.rate;

                }

                if (
                    !product.applicableGST &&
                    dto.gstPercent
                ) {

                    updateData.applicableGST =
                        dto.gstPercent;

                }

                const finalProduct =
                    Object.keys(updateData).length > 0

                        ? await prisma.product.update({

                            where: {

                                id: product.id

                            },

                            data: updateData

                        })

                        : product;

                this.productCache.set(
                    cacheKey,
                    finalProduct
                );

                return finalProduct;

            }

            const created =
                await prisma.product.create({

                    data: {

                        sku: crypto.randomUUID(),

                        name: normalizedName,

                        hsnNo: dto.hsnNo,

                        applicableGST: dto.gstPercent,

                        baseUnit:
                            dto.unit as ProductUnit,

                        operationalUnit:
                            dto.unit as ProductUnit,

                        sellPricePerUnit:
                            dto.rate

                    }

                });

            this.productCache.set(
                cacheKey,
                created
            );

            return created;

        })();


        this.productLocks.set(
            cacheKey,
            lock
        );

        try {
            return await lock;
        }
        finally {
            this.productLocks.delete(
                cacheKey
            );

        }
    }

    private static async parseAddress(
        address?: string
    ): Promise<ParsedAddressDTO> {

        if (!address?.trim()) {
            return {};
        }

        const result: ParsedAddressDTO = {};

        let value = address
            .replace(/\r/g, "")
            .replace(/\n/g, ",")
            .replace(/,+/g, ",")
            .replace(/\s+/g, " ")
            .trim();

        /**
         * Email
         */
        const email =
            value.match(
                /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i
            )?.[0];

        if (email) {

            result.email = email;

            value = value.replace(email, "");

            value = value.replace(
                /E-?Mail\s*:?/ig,
                ""
            );
        }

        /**
         * Pincode
         */

        const pin =
            value.match(/\b\d{6}\b/)?.[0];

        if (pin) {

            result.pinCode = pin;

        }

        /**
         * State
         */

        const states =
            await LocationService.getIndianStates();

        for (const state of states) {

            const regex =
                new RegExp(
                    state.name,
                    "i"
                );

            if (regex.test(value)) {

                result.state =
                    state.name;

                result.stateCode =
                    state.stateCode;

                break;

            }

        }

        /**
         * Split
         */

        const parts =
            value
                .split(",")
                .map(v => v.trim())
                .filter(Boolean);

        result.addressLine1 =
            parts.slice(0, 2).join(", ");

        if (parts.length > 2) {

            result.addressLine2 =
                parts
                    .slice(2, parts.length - 1)
                    .join(", ");

        }

        /**
         * Guess city
         */

        if (result.state) {

            const state =
                states.find(
                    s =>
                        s.name ===
                        result.state
                );

            if (state) {

                const cities =
                    await LocationService.getCitiesByState(
                        state.isoCode
                    );

                for (const city of cities) {

                    if (
                        value
                            .toLowerCase()
                            .includes(
                                city.name.toLowerCase()
                            )
                    ) {

                        result.city =
                            city.name;

                        break;

                    }

                }

            }

        }

        if (!result.state && result.stateCode) {

            const states =
                await LocationService.getIndianStates();

            const state =
                states.find(
                    x => x.stateCode === result.stateCode
                );

            if (state) {

                result.state = state.name;

            }
        }

        if (!result.city && result.state) {

            const states =
                await State.getStatesOfCountry("IN");

            const state =
                states.find(
                    s =>
                        s.name.toUpperCase() ===
                        result.state!.toUpperCase()
                );

            if (state) {

                const cities =
                    City.getCitiesOfState(
                        "IN",
                        state.isoCode
                    );

                if (cities.length) {

                    result.city =
                        cities[0].name;

                }
            }
        }

        return result;

    }

    static async resolveBatchFIFO(
        branchId: string,
        productId: string,
        quantity: number,
        unit: ProductUnit
    ) {

        let remainingQty = quantity;

        const allocations: {

            batchId: string;

            quantity: number;

        }[] = [];

        const batches =
            await prisma.inventoryBatch.findMany({

                where: {

                    branchId,

                    productId,

                    isActive: true,

                    ...(unit === ProductUnit.KG
                        ? {
                            availableQtyKG: {
                                gt: 0
                            }
                        }
                        : {
                            availableQtyLTR: {
                                gt: 0
                            }
                        })

                },

                orderBy: {

                    createdAt: "asc"

                }

            });

        for (const batch of batches) {

            if (remainingQty <= 0)
                break;

            const available = Number(

                unit === ProductUnit.KG
                    ? batch.availableQtyKG
                    : batch.availableQtyLTR

            );

            if (available <= 0)
                continue;

            const allocateQty =
                Math.min(
                    remainingQty,
                    available
                );

            allocations.push({

                batchId: batch.id,

                quantity: allocateQty

            });

            remainingQty -= allocateQty;

        }

        if (remainingQty > 0) {

            throw new ApiError(

                `Insufficient stock for Product ${productId}. Remaining Qty ${remainingQty}`,

                400

            );

        }

        return allocations;

    }

    static async buildPurchasePayload(
        voucher: GroupedVoucherDTO
    ): Promise<any> {
        const agency = 
            await this.resolveOrCreateAgency(
                voucher,
                AgencyType.VENDOR
            );

        const branch = 
            await this.resolveOrCreateBranch(
                voucher
            );

            const productRows = voucher.rows.filter(row =>
                row.quantity > 0 &&
                row.taxableAmount > 0
            );

        const items = await Promise.all(
            productRows.map(async (row, index) => {
                const product = 
                    await this.resolveOrCreateProduct(
                        row
                    );

                return {

                    productId: product.id,

                    batchNo:
                        `${voucher.invoiceNo || voucher.voucherNo}-${index + 1}`,

                    quantity:
                        row.quantity!,

                    unit:
                        row.unit as ProductUnit,

                    purchasePrice:
                        row.rate!,

                    // ===== IMPORT ONLY =====

                    taxableAmount:
                        row.taxableAmount,

                    cgstAmount:
                        row.cgst,

                    sgstAmount:
                        row.sgst,

                    igstAmount:
                        row.igst,

                    gstAmount:
                        (row.cgst || 0) +
                        (row.sgst || 0) +
                        (row.igst || 0),

                    gstPercent:
                        row.gstPercent,

                    totalAmount:
                        row.grandTotal > 0
                            ? row.taxableAmount +
                            (row.cgst || 0) +
                            (row.sgst || 0) +
                            (row.igst || 0)
                            : row.taxableAmount

                }
            })
        );

        return {
            agencyId:
                agency.id,

            branchId:
                branch.id,

            invoiceNo:
                voucher.invoiceNo || voucher.voucherNo,

            invoiceDate:
                voucher.invoiceDate,

            supplierInvoiceDate:
                voucher.invoiceDate,

            voucherType:
                VoucherType.PURCHASE,

            otherReference:
                voucher.otherReferenceNo,

            remarks:
                voucher.narration,

            roundOffAmount:
                voucher.rows[0]?.roundOff,

            transport: {

                purchaseOrderNo:
                    voucher.rows[0].transport?.purchaseOrderNo,

                purchaseOrderDate:
                    voucher.rows[0].transport?.purchaseOrderDate,

                receiptNoteNo:
                    voucher.rows[0].transport?.receiptNoteNo,

                receiptNoteDate:
                    voucher.rows[0].transport?.receiptNoteDate,

                lrNo:
                    voucher.rows[0].transport?.lrNo,

                dispatchThrough:
                    voucher.rows[0].transport?.dispatchThrough,

                destination:
                    voucher.rows[0].transport?.destination,

                vehicleOrFlightNo:
                    voucher.rows[0].transport?.vehicleOrFlightNo,

                portOfLoading:
                    voucher.rows[0].transport?.portOfLoading,

                portOfDischarge:
                    voucher.rows[0].transport?.portOfDischarge,

                countryTo:
                    voucher.rows[0].transport?.countryTo,

                billOfEntryNo:
                    voucher.rows[0].transport?.billOfEntryNo,

                billOfEntryDate:
                    voucher.rows[0].transport?.billOfEntryDate,

                portCode:
                    voucher.rows[0].transport?.portCode

            },

            importedTotals:
                voucher.importedTotals,

            voucherDate: voucher.rows[0]?.voucherDate,
            approvedAt: voucher.rows[0]?.voucherDate,

            items
        }
    }

    static async buildSalePayload(
        voucher: GroupedVoucherDTO
    ): Promise<any> {

        const agency =
            await this.resolveOrCreateAgency(
                voucher,
                AgencyType.CLIENT
            );

        const branch = await prisma.branch.findFirst({
            where: {
                isActive: true
            }
        });

        if (!branch) {
            throw new ApiError("No branch found", 400);
        }

        const items: any[] = [];

        const productRows = voucher.rows.filter(row =>
            row.quantity > 0 &&
            row.taxableAmount > 0
        );

        for (const row of productRows) {

            const product =
                await this.resolveProduct(
                    row
                );

            /**
             * Resolve FIFO batches
             */
            const allocations =
                await this.resolveBatchFIFO(
                    branch.id,
                    product.id,
                    row.quantity!,
                    row.unit as ProductUnit
                );

            /**
             * Flatten allocations
             *
             * Example:
             *
             * Need 1200 KG
             *
             * Batch A = 700
             * Batch B = 500
             *
             * Creates two sale items.
             */
            for (const allocation of allocations) {

                items.push({

                    productId:
                        product.id,

                    batchId:
                        allocation.batchId,

                    quantity:
                        allocation.quantity,

                    unit:
                        row.unit as ProductUnit,

                    unitPrice:
                        row.rate,

                    // ===== IMPORT ONLY =====

                    taxableAmount:
                        row.taxableAmount,

                    cgstAmount:
                        row.cgst,

                    sgstAmount:
                        row.sgst,

                    igstAmount:
                        row.igst,

                    gstAmount:
                        (row.cgst || 0) +
                        (row.sgst || 0) +
                        (row.igst || 0),

                    gstPercent:
                        row.gstPercent,

                    totalAmount:
                        row.taxableAmount +
                        (row.cgst || 0) +
                        (row.sgst || 0) +
                        (row.igst || 0)

                });
            }

        }

        

        return {

            agencyId:
                agency.id,

            branchId:
                branch.id,

            invoiceNo:
                voucher.invoiceNo ||
                voucher.voucherNo,

            invoiceDate:
                voucher.invoiceDate ??
                voucher.voucherDate,

            voucherType:
                VoucherType.SALE,

            otherReference:
                voucher.otherReferenceNo,

            remarks:
                voucher.narration,

            roundOffAmount:
                voucher.rows[0]?.roundOff ?? 0,

            transport: {

                /**
                 * Mapping depends on the Sale Register.
                 * If your Excel has these columns,
                 * map them during parsing.
                 */

                buyerOrderNo:
                    voucher.rows[0].transport?.purchaseOrderNo,

                buyerOrderDate:
                    voucher.rows[0].transport?.purchaseOrderDate,

                deliveryNote:
                    voucher.rows[0].transport?.receiptNoteNo,

                despatchDocDate:
                    voucher.rows[0].transport?.receiptNoteDate,

                despatchThrough:
                    voucher.rows[0].transport?.dispatchThrough,

                destination:
                    voucher.rows[0].transport?.destination,

                vehicleOrFlightNo:
                    voucher.rows[0].transport?.vehicleOrFlightNo,

                portOfLoading:
                    voucher.rows[0].transport?.portOfLoading,

                portOfDischarge:
                    voucher.rows[0].transport?.portOfDischarge,

                countryTo:
                    voucher.rows[0].transport?.countryTo,

                shippingNo:
                    voucher.rows[0].transport?.billOfEntryNo,

                shippingDate:
                    voucher.rows[0].transport?.billOfEntryDate,

                portCode:
                    voucher.rows[0].transport?.portCode

            },

            voucherDate: voucher.rows[0]?.voucherDate,
            approvedAt: voucher.rows[0]?.voucherDate,

            importedTotals:
                voucher.importedTotals,

            items

        };

    }
}
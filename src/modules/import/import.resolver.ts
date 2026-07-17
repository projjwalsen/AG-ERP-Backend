import { PaymentMode, PaymentType, ProductUnit, VoucherType } from "@prisma/client";
import { prisma } from "../../config/db";
import { ApiError } from "../../core/middleware/errorHandler";
import { AgencyImportDTO, ExcelRowDTO, GroupedVoucherDTO, JournalImportDTO, ParsedAddressDTO, ProductImportDTO } from "../../core/dto/dto";
import { AgencyType } from "@prisma/client";
import { LocationService } from "../meta/meta.loc.service";
import { City, State } from "country-state-city";
import { ExcelImportService } from "./excelImport.service";
import { JournalService } from "../journal/journal.service";

export class ImportResolver {

    private static agencyCache =
        new Map<string, any>();

    private static branchCache =
        new Map<string, any>();

    private static productCache =
        new Map<string, any>();

    private static journalHeadCache =
        new Map<string, any>();

    private static productLocks =
        new Map<string, Promise<any>>();

    static clearCache() {

        this.agencyCache.clear();

        this.branchCache.clear();

        this.productCache.clear();

        this.journalHeadCache.clear();

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

    // for agency master import only 
    static async resolveOrCreateAgencyMaster(
        dto: AgencyImportDTO
    ) {

        const cacheKey =
            dto.agencyGSTIN?.trim() ||
            dto.agencyName.trim().toLowerCase();

        if (
            cacheKey &&
            this.agencyCache.has(cacheKey)
        ) {
            return this.agencyCache.get(cacheKey);
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
                dto.agencyGSTIN.substring(0, 2);

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

            if (state) {

                address.state =
                    state.name;

            }

        }

        address.city =
            dto.city?.trim() ||
            address.city;

        address.state =
            dto.state?.trim() ||
            address.state;

        address.pinCode =
            dto.pinCode?.trim() ||
            address.pinCode;

        let agency =
            null;

        if (dto.agencyGSTIN) {

            agency =
                await prisma.agency.findFirst({

                    where: {

                        gstin:
                            dto.agencyGSTIN

                    }

                });

        }

        if (
            !agency &&
            dto.agencyName
        ) {

            agency =
                await prisma.agency.findFirst({

                    where: {

                        name: {

                            equals:
                                dto.agencyName,

                            mode:
                                "insensitive"

                        }

                    }

                });

        }

        if (agency) {

            const updated =
                await prisma.agency.update({

                    where: {

                        id:
                            agency.id

                    },

                    data: {

                        name:
                            dto.agencyName,

                        gstin:
                            dto.agencyGSTIN,

                        panNo:
                            dto.agencyPAN,

                        type:
                            dto.type,

                        addressLine1:
                            address.addressLine1,

                        addressLine2:
                            address.addressLine2,

                        city:
                            address.city,

                        state:
                            address.state,

                        stateCode:
                            address.stateCode,

                        pinCode:
                            address.pinCode,

                        email:
                            address.email

                    }

                });

            const ledger =
                await prisma.ledger.findFirst({
                    where: {
                        agencyId: updated.id
                    }
                });

            if (
                ledger &&
                dto.openingBalance != null
            ) {
                await prisma.ledger.update({
                    where: {
                        id: ledger.id
                    },
                    data: {
                        openingBalance:
                            dto.openingBalance,
                    }
                });
            }

            this.agencyCache.set(
                cacheKey,
                updated
            );

            return updated;

        }

        const created =
            await prisma.agency.create({

                data: {

                    name:
                        dto.agencyName,

                    gstin:
                        dto.agencyGSTIN,

                    panNo:
                        dto.agencyPAN,

                    type:
                        dto.type,


                    addressLine1:
                        address.addressLine1,

                    addressLine2:
                        address.addressLine2,

                    city:
                        address.city,

                    state:
                        address.state,

                    stateCode:
                        address.stateCode,

                    pinCode:
                        address.pinCode,

                    email:
                        address.email

                }

            });

        const ledger =
            await prisma.ledger.findFirst({

                where: {

                    agencyId: created.id

                }

            });

        if (
            ledger &&
            dto.openingBalance != null
        ) {

            await prisma.ledger.update({

                where: {

                    id: ledger.id

                },

                data: {

                    openingBalance:
                        dto.openingBalance,

                    currentBalance:
                        dto.openingBalance

                }

            });

        }

        this.agencyCache.set(
            cacheKey,
            created
        );

        return created;

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

    // for product master import entry only
    static async resolveOrCreateProductMaster(
        branchId: string,
        dto: ProductImportDTO
    ) {

        const normalizedName =
            this.normalizeProductName(
                dto.productName
            );

        const cacheKey = normalizedName;

        if (this.productCache.has(cacheKey)) {
            return this.productCache.get(cacheKey);
        }

        const density = dto.density || 1;

        const openingKG = dto.openingStockKG || 0;

        const openingLTR = openingKG / density;

        return await prisma.$transaction(async tx => {

            /*
            ==========================================
            PRODUCT
            ==========================================
            */

            let product =
                await tx.product.findFirst({

                    where: {

                        OR: [

                            {
                                name: {
                                    equals: dto.productName,
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

            if (!product) {

                product =
                    await tx.product.create({

                        data: {

                            sku: crypto.randomUUID(),

                            name: normalizedName,

                            density,

                            openingStockKG: openingKG,

                            baseUnit: ProductUnit.KG,

                            operationalUnit: ProductUnit.KG,

                            sellPricePerUnit:
                                dto.sellPrice ?? 0,

                            sellPriceLTR:
                                dto.sellPrice && density
                                    ? Number(
                                        (
                                            dto.sellPrice *
                                            density
                                        ).toFixed(2)
                                    )
                                    : null,

                            minimumStockKG: openingKG,

                            hsnNo:
                                dto.hsn?.trim(),

                            applicableGST: 0

                        }

                    });

            }
            else {

                product =
                    await tx.product.update({
                        where: {
                            id: product.id
                        },

                        data: {
                            name: normalizedName,
                            density,
                            openingStockKG: openingKG,

                            sellPricePerUnit:
                                dto.sellPrice ??
                                product.sellPricePerUnit,

                            sellPriceLTR:
                                dto.sellPrice
                                    ? Number(
                                        (
                                            dto.sellPrice *
                                            density
                                        ).toFixed(2)
                                    )
                                    : product.sellPriceLTR,

                            hsnNo:
                                dto.hsn ??
                                product.hsnNo,

                            minimumStockKG: openingKG
                        }
                    });
            }

            /*
            ==========================================
            INVENTORY
            ==========================================
            */

            const inventory =
                await tx.inventory.findUnique({

                    where: {

                        branchId_productId: {

                            branchId,

                            productId: product.id

                        }

                    }

                });

            if (!inventory) {

                await tx.inventory.create({

                    data: {

                        branchId,

                        productId: product.id,

                        currentStockKG: openingKG,

                        currentStockLTR: openingLTR

                    }

                });

            }
            else {

                await tx.inventory.update({

                    where: {
                        id: inventory.id
                    },

                    data: {

                        currentStockKG: openingKG,

                        currentStockLTR: openingLTR

                    }

                });

            }

            /*
            ==========================================
            OPENING BATCH
            ==========================================
            */

            const batchNo =
                dto.batchNo?.trim()
                || `OPENING-${product.id}`;

            let batch =
                await tx.inventoryBatch.findFirst({

                    where: {

                        branchId,

                        productId: product.id,

                        batchNo

                    }

                });

            if (!batch) {

                batch =
                    await tx.inventoryBatch.create({

                        data: {

                            branchId,

                            productId: product.id,

                            batchNo,

                            purchasePrice: 0,

                            availableQtyKG: openingKG,

                            availableQtyLTR: openingLTR,

                            isActive: true

                        }

                    });

            }
            else {

                batch =
                    await tx.inventoryBatch.update({

                        where: {
                            id: batch.id
                        },

                        data: {

                            availableQtyKG: openingKG,

                            availableQtyLTR: openingLTR

                        }

                    });

            }

            /*
            ==========================================
            PRODUCT LEDGER
            ==========================================
            */

            let ledger =
                await tx.productLedger.findUnique({

                    where: {

                        productId: product.id

                    }

                });

            if (!ledger) {

                ledger =
                    await tx.productLedger.create({

                        data: {

                            code: `PROD-${product.sku.substring(0, 8)}`,

                            product: {

                                connect: {

                                    id: product.id

                                }

                            }

                        }

                    });

            }

            /*
            ==========================================
            OPENING ENTRY
            ==========================================
            */

            const openingEntry =
                await tx.productLedgerEntry.findFirst({

                    where: {

                        productLedgerId: ledger.id,

                        movementType: "OPENING_BALANCE",

                        batchId: batch.id

                    }

                });

            if (!openingEntry) {

               await tx.productLedgerEntry.create({
                    data: {
                        productLedger: {
                            connect: {
                                id: ledger.id
                            }
                        },

                        movementType: "OPENING_BALANCE",

                        direction: "CREDIT",

                        quantityKG: openingKG,

                        quantityLTR: openingLTR,

                        unit: ProductUnit.KG,

                        branch: {
                            connect: {
                                id: branchId
                            }
                        },

                        batch: {
                            connect: {
                                id: batch.id
                            }
                        },

                        batchNo: batch.batchNo,

                        invoiceNo: "OPENING STOCK",

                        unitCost: 0,

                        totalCost: 0,

                        entryDate:
                            typeof dto.date === "string"
                                ? ExcelImportService.toDate(dto.date) ?? new Date()
                                : dto.date ?? new Date(),

                        remarks:
                            `Opening Stock Import - ${batch.batchNo}`

                    }
                });

            }

            this.productCache.set(
                cacheKey,
                product
            );

            return product;

        });

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

    static async buildJournalPayload(
        actor: any,
        dto: JournalImportDTO
    ) {

        const branch =
            await prisma.branch.findFirst({
                where: {
                    isActive: true
                }
            });

        if (!branch) {
            throw new ApiError(
                "No active branch found.",
                400
            );
        }

        const journalHead =
            await this.resolveOrCreateJournalHead(
                actor,
                dto
            );

        let paymentMode: PaymentMode;
        let paymentThrough: PaymentType | undefined;

        switch (dto.voucherType.trim().toUpperCase()) {

            case "CASH PAYMENT":
            case "CASH RECEIPT":

                paymentMode = PaymentMode.OFFLINE;
                paymentThrough = PaymentType.CASH;
                break;

            default:

                paymentMode = PaymentMode.ONLINE;
                paymentThrough = PaymentType.BANK_DEPOSIT;
        }

        return {

            branchId: branch.id,

            journalHeadId: journalHead.id,

            amount:
                dto.debitAmount > 0
                    ? dto.debitAmount
                    : dto.creditAmount,

            paymentMode,

            paymentThrough,

            remarks: dto.particulars,

            journalDate: ExcelImportService.toDate(dto.date) || new Date(),

        };

    }

    public static async resolveOrCreateJournalHead(
        actor: any,
        dto: JournalImportDTO
    ) {

        const type =
            dto.debitAmount > 0
                ? "INWARD"
                : "OUTWARD";

        const voucherType = dto.voucherType.trim().toUpperCase();

        const cacheKey =
            `${voucherType}_${type}`;

        const cached =
            this.journalHeadCache.get(cacheKey);

        if (cached)
            return cached;

        let journalHead =
            await prisma.journalHead.findFirst({

                where: {

                    name: {

                        equals: voucherType,

                        mode: "insensitive"

                    },

                    type

                }

            });

        if (!journalHead) {

            journalHead =
                await JournalService.createJournalHead(
                    actor,
                    {

                        name: voucherType,

                        type

                    }
                );

        }

        this.journalHeadCache.set(
            cacheKey,
            journalHead
        );

        return journalHead;

    }
}
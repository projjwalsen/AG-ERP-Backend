import {
    DebitCreditNoteSourceType,
    DebitCreditNoteType
} from "@prisma/client";

export type DebitCreditNoteTemplateData = {

    title:
        "Debit Note" |
        "Credit Note";

    noteNo: string;

    noteDate: string;

    sourceType:
        "SALE" |
        "PURCHASE";

    status: string;

    narration: string | null;

    currencySymbol: string;

    totalAmount: string;

    subTotal: string;

    amountInWords?: string | null;

    placeOfSupply?: string | null;

    partyLabel: string;

    seller: {
        name: string;

        logo?: string | null;

        gstin?: string | null;

        pan?: string | null;

        phone?: string | null;

        email?: string | null;

        addressLine1?: string | null;

        addressLine2?: string | null;

        city?: string | null;

        state?: string | null;

        pinCode?: string | null;
    };

    party: {
        id: string;

        name: string;

        gstin?: string | null;

        pan?: string | null;

        phone?: string | null;

        email?: string | null;

        addressLine1?: string | null;

        addressLine2?: string | null;

        city?: string | null;

        state?: string | null;

        pinCode?: string | null;
    };

    invoice: {
        id: string;

        invoiceNo: string;

        invoiceDate: string;

        grandTotal: string;
    };

    particulars: {
        serialNo: number;

        description: string;

        amount: string;
    }[];

    signatureImage?: string | null;
};


export class DebitCreditNoteMapper {

    private static money(
        value: unknown
    ) {
        return Number(
            value ?? 0
        ).toFixed(2);
    }


    private static date(
        value: Date | string | null | undefined
    ) {

        if (!value) {
            return "-";
        }

        const date =
            new Date(value);

        if (
            Number.isNaN(
                date.getTime()
            )
        ) {
            return "-";
        }

        return new Intl.DateTimeFormat(
            "en-IN",
            {
                day: "2-digit",
                month: "short",
                year: "numeric"
            }
        ).format(date);
    }


    static map(
        note: any,
        setting?: any
    ): DebitCreditNoteTemplateData {

        /* ==========================================
         * SOURCE INVOICE
         * ========================================== */

        const invoice =
            note.sourceType ===
            DebitCreditNoteSourceType.SALE

                ? note.sale

                : note.purchase;


        if (!invoice) {
            throw new Error(
                `Source invoice missing for Debit/Credit Note ${note.id}`
            );
        }


        /* ==========================================
         * DOCUMENT TYPE
         * ========================================== */

        const title =
            note.type ===
            DebitCreditNoteType.DEBIT_NOTE

                ? "Debit Note"

                : "Credit Note";


        /* ==========================================
         * PARTICULARS
         * ========================================== */

        const particulars =
            (note.particulars ?? [])
                .map(
                    (
                        particular: any,
                        index: number
                    ) => ({

                        serialNo:
                            index + 1,

                        description:
                            particular.description,

                        amount:
                            this.money(
                                particular.amount
                            )

                    })
                );


        /* ==========================================
         * BRANCH = OUR COMPANY / SELLER
         * ========================================== */

        const seller = {

            name:
                note.branch.name,

            logo:
                setting?.sellerLogo ??
                null,

            gstin:
                note.branch.gstin ??
                null,

            pan:
                setting?.companyPAN ??
                null,

            phone:
                note.branch.phnNumber ??
                null,

            email:
                note.branch.email ??
                null,

            addressLine1:
                note.branch.addressLine1 ??
                null,

            addressLine2:
                note.branch.addressLine2 ??
                null,

            city:
                note.branch.city ??
                null,

            state:
                note.branch.state ??
                null,

            pinCode:
                note.branch.pinCode ??
                null
        };


        /* ==========================================
         * AGENCY
         * ========================================== */

        const party = {

            id:
                note.agency.id,

            name:
                note.agency.name,

            gstin:
                note.agency.gstin ??
                null,

            pan:
                note.agency.panNo ??
                null,

            phone:
                note.agency.mobileNumber ??
                null,

            email:
                note.agency.email ??
                null,

            addressLine1:
                note.agency.addressLine1 ??
                null,

            addressLine2:
                note.agency.addressLine2 ??
                null,

            city:
                note.agency.city ??
                null,

            state:
                note.agency.state ??
                null,

            pinCode:
                note.agency.pinCode ??
                null
        };


        /* ==========================================
         * TEMPLATE
         * ========================================== */

        return {

            title,

            noteNo:
                note.noteNo,

            noteDate:
                this.date(
                    note.noteDate
                ),

            sourceType:
                note.sourceType,

            status:
                note.status,

            narration:
                note.narration ??
                null,

            currencySymbol:
                "₹",

            totalAmount:
                this.money(
                    note.totalAmount
                ),

            subTotal:
                this.money(
                    note.totalAmount
                ),

            /*
             * You can plug your existing
             * number-to-words utility here.
             */
            amountInWords:
                null,

            /*
             * For now branch state.
             * Replace with your GST/place-of-supply
             * rule if already available.
             */
            placeOfSupply:
                note.branch.state
                    ? `${note.branch.state}${
                        note.branch.stateCode
                            ? ` (${note.branch.stateCode})`
                            : ""
                    }`
                    : null,

            partyLabel:
                note.sourceType ===
                DebitCreditNoteSourceType.SALE

                    ? "Bill To"

                    : "Vendor",

            seller,

            party,

            invoice: {

                id:
                    invoice.id,

                invoiceNo:
                    invoice.invoiceNo,

                invoiceDate:
                    this.date(
                        invoice.invoiceDate
                    ),

                /*
                 * ORIGINAL invoice amount.
                 *
                 * Debit/Credit Note does NOT
                 * mutate invoice grandTotal.
                 */
                grandTotal:
                    this.money(
                        invoice.grandTotal
                    )
            },

            particulars,

            signatureImage:
                setting?.signatureImage ??
                null
        };
    }
}
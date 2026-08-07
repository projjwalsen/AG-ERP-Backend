import { ExportColumn } from "../../core/utils/export.service";

export const agencyExportColumns:
ExportColumn<any>[] = [

    {
        header: "Agency Name",
        key: "agencyName",
        width: 35
    },

    {
        header: "Type",
        key: "type",
        width: 15
    },

    {
        header: "GSTIN",
        key: "gstin",
        width: 25
    },

    {
        header: "Contact Person",
        key: "contactPerson",
        width: 25
    },

    {
        header: "Mobile Number",
        key: "mobileNumber",
        width: 18
    },

    {
        header: "Email",
        key: "email",
        width: 30
    },

    {
        header: "City",
        key: "city"
    },

    {
        header: "State",
        key: "state"
    },

    {
        header: "Branch Name",
        key: "branchName",
        width: 25
    },

    {
        header: "Branch Code",
        key: "branchCode",
        width: 15
    },

    {
        header: "Opening Balance",
        key: "openingBalance",
        width: 20
    },

    {
        header: "Status",
        value: row =>
            row.isActive
                ? "Active"
                : "Inactive"
    }
];
import { ExportColumn } from "../../core/utils/export.service";


export const branchColumns: ExportColumn<any>[] = [
    {
        header: "Branch Code",
        key: "code",
        width: 20
    },
    {
        header: "Branch Name",
        key: "name",
        width: 30
    },
    {
        header: "GSTIN",
        key: "gstin",
        width: 25
    },
    {
        header: "State Code",
        key: "stateCode",
        width: 15
    },
    {
        header: "Phone Number",
        key: "phnNumber",
        width: 20
    },
    {
        header: "Email",
        key: "email",
        width: 30
    },
    {
        header: "City",
        key: "city",
        width: 20
    },
    {
        header: "State",
        key: "state",
        width: 20
    },
    {
        header: "Pincode",
        key: "pinCode",
        width: 15
    },
    {
        header: "Address",
        value: (row) =>
            [
                row.addressLine1,
                row.addressLine2
            ]
                .filter(Boolean)
                .join(", "),
        width: 50
    },
    {
        header: "Users",
        value: (row) =>
            row._count?.users || 0,
        width: 12
    },
    {
        header: "Status",
        value: (row) =>
            row.isActive
                ? "Active"
                : "Inactive",
        width: 15
    },
    {
        header: "Created Date",
        value: (row) =>
            row.createdAt
                ? new Date(row.createdAt)
                    .toLocaleDateString("en-IN")
                : "",
        width: 18
    }
];
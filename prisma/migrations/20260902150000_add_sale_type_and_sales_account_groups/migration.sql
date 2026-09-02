-- The transaction-type schema and Sales Accounts hierarchy are implemented
-- by the adjacent ordered migrations:
--   20260902120000_add_transaction_import_type_and_note_link
--   20260902150000_add_sales_account_group
--
-- Keep this historic migration directory valid so `prisma migrate deploy`
-- can record it and continue to the successor migration.
SELECT 1;

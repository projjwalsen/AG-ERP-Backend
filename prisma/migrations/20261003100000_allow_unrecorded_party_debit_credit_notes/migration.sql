-- Notes imported with "Party not recorded" are document-only pending notes.
ALTER TABLE "DebitCreditNote"
    ALTER COLUMN "agencyId" DROP NOT NULL;

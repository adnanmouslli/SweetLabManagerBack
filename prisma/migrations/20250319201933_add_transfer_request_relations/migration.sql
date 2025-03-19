/*
  Warnings:

  - Added the required column `unit` to the `invoice_items` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "invoice_items" ADD COLUMN     "unit" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "main_fund_transfer_requests" (
    "id" SERIAL NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "requestedById" INTEGER NOT NULL,
    "confirmedById" INTEGER,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),
    "notes" TEXT,
    "rejectionReason" TEXT,
    "expenseInvoiceId" INTEGER,
    "incomeInvoiceId" INTEGER,

    CONSTRAINT "main_fund_transfer_requests_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "main_fund_transfer_requests" ADD CONSTRAINT "main_fund_transfer_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "main_fund_transfer_requests" ADD CONSTRAINT "main_fund_transfer_requests_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

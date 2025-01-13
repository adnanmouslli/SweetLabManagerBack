/*
  Warnings:

  - You are about to drop the column `customerName` on the `debts` table. All the data in the column will be lost.
  - You are about to drop the column `customerPhone` on the `debts` table. All the data in the column will be lost.
  - You are about to drop the column `customerName` on the `invoices` table. All the data in the column will be lost.
  - You are about to drop the column `customerPhone` on the `invoices` table. All the data in the column will be lost.
  - You are about to drop the column `paymentType` on the `invoices` table. All the data in the column will be lost.
  - You are about to drop the `debt_payments` table. If the table is not empty, all the data it contains will be lost.
  - Added the required column `customerId` to the `debts` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TrayStatus" AS ENUM ('pending', 'returned');

-- DropForeignKey
ALTER TABLE "debt_payments" DROP CONSTRAINT "debt_payments_debtId_fkey";

-- DropForeignKey
ALTER TABLE "debt_payments" DROP CONSTRAINT "debt_payments_invoiceId_fkey";

-- AlterTable
ALTER TABLE "debts" DROP COLUMN "customerName",
DROP COLUMN "customerPhone",
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "customerId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "invoices" DROP COLUMN "customerName",
DROP COLUMN "customerPhone",
DROP COLUMN "paymentType",
ADD COLUMN     "customerId" INTEGER,
ADD COLUMN     "relatedDebtId" INTEGER,
ALTER COLUMN "paidStatus" DROP DEFAULT;

-- DropTable
DROP TABLE "debt_payments";

-- DropEnum
DROP TYPE "PaymentType";

-- CreateTable
CREATE TABLE "fund_transfer_logs" (
    "id" SERIAL NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "fromFundId" INTEGER NOT NULL,
    "toFundId" INTEGER NOT NULL,
    "transferredById" INTEGER NOT NULL,
    "transferredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fund_transfer_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tray_tracking" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "totalTrays" INTEGER NOT NULL,
    "status" "TrayStatus" NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "returnedAt" TIMESTAMP(3),
    "notes" TEXT,
    "invoiceId" INTEGER NOT NULL,

    CONSTRAINT "tray_tracking_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tray_tracking_invoiceId_key" ON "tray_tracking"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- AddForeignKey
ALTER TABLE "fund_transfer_logs" ADD CONSTRAINT "fund_transfer_logs_fromFundId_fkey" FOREIGN KEY ("fromFundId") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_transfer_logs" ADD CONSTRAINT "fund_transfer_logs_toFundId_fkey" FOREIGN KEY ("toFundId") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_transfer_logs" ADD CONSTRAINT "fund_transfer_logs_transferredById_fkey" FOREIGN KEY ("transferredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_relatedDebtId_fkey" FOREIGN KEY ("relatedDebtId") REFERENCES "debts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tray_tracking" ADD CONSTRAINT "tray_tracking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tray_tracking" ADD CONSTRAINT "tray_tracking_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debts" ADD CONSTRAINT "debts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

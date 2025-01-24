/*
  Warnings:

  - You are about to drop the column `trayCount` on the `invoice_items` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "invoice_items" DROP COLUMN "trayCount";

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "trayCount" INTEGER NOT NULL DEFAULT 0;

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('MANAGER', 'ADMIN', 'ShiftManager', 'TreasuryManager', 'TrayManager', 'EMPLOYEE');

-- CreateEnum
CREATE TYPE "DifferenceStatus" AS ENUM ('surplus', 'deficit');

-- CreateEnum
CREATE TYPE "ShiftType" AS ENUM ('morning', 'evening');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('open', 'closed');

-- CreateEnum
CREATE TYPE "FundType" AS ENUM ('main', 'general', 'booth', 'university');

-- CreateEnum
CREATE TYPE "ItemType" AS ENUM ('production', 'raw');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('income', 'expense');

-- CreateEnum
CREATE TYPE "InvoiceCategory" AS ENUM ('products', 'direct', 'debt', 'advance');

-- CreateEnum
CREATE TYPE "TrayStatus" AS ENUM ('pending', 'returned');

-- CreateEnum
CREATE TYPE "DebtStatus" AS ENUM ('active', 'paid');

-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('active', 'completed');

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "username" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "roles" "Role"[] DEFAULT ARRAY['EMPLOYEE']::"Role"[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" SERIAL NOT NULL,
    "shiftType" "ShiftType" NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'open',
    "openTime" TIMESTAMP(3) NOT NULL,
    "closeTime" TIMESTAMP(3),
    "differenceStatus" "DifferenceStatus",
    "differenceValue" DOUBLE PRECISION,
    "employeeId" INTEGER NOT NULL,

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "funds" (
    "id" SERIAL NOT NULL,
    "fundType" "FundType" NOT NULL,
    "currentBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastUpdate" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "funds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fund_transfer_logs" (
    "id" SERIAL NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "fromFundId" INTEGER NOT NULL,
    "toFundId" INTEGER NOT NULL,
    "transferredById" INTEGER NOT NULL,
    "transferredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,

    CONSTRAINT "fund_transfer_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "item_groups" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ItemType" NOT NULL,
    "description" TEXT,

    CONSTRAINT "item_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "items" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ItemType" NOT NULL,
    "units" JSONB,
    "defaultUnit" TEXT NOT NULL,
    "cost" DOUBLE PRECISION,
    "price" DOUBLE PRECISION NOT NULL,
    "description" TEXT,
    "groupId" INTEGER NOT NULL,

    CONSTRAINT "items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" SERIAL NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceType" "InvoiceType" NOT NULL,
    "invoiceCategory" "InvoiceCategory" NOT NULL,
    "customerId" INTEGER,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "discount" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "paidStatus" BOOLEAN NOT NULL,
    "paymentDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notes" TEXT,
    "isBreak" BOOLEAN NOT NULL DEFAULT false,
    "fundId" INTEGER NOT NULL,
    "shiftId" INTEGER NOT NULL,
    "employeeId" INTEGER NOT NULL,
    "relatedDebtId" INTEGER,
    "trayCount" INTEGER NOT NULL DEFAULT 0,
    "relatedAdvanceId" INTEGER,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" SERIAL NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "unitPrice" DOUBLE PRECISION NOT NULL,
    "subTotal" DOUBLE PRECISION NOT NULL,
    "unit" TEXT NOT NULL,
    "invoiceId" INTEGER NOT NULL,
    "itemId" INTEGER NOT NULL,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
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
CREATE TABLE "debts" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "remainingAmount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPaymentDate" TIMESTAMP(3),
    "status" "DebtStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,

    CONSTRAINT "debts_pkey" PRIMARY KEY ("id")
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

-- CreateTable
CREATE TABLE "pending_shift_transfers" (
    "id" SERIAL NOT NULL,
    "transferNumber" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "status" TEXT NOT NULL,
    "requestedById" INTEGER NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedById" INTEGER,
    "acceptedAt" TIMESTAMP(3),
    "notes" TEXT,
    "expenseInvoiceId" INTEGER,
    "incomeInvoiceId" INTEGER,

    CONSTRAINT "pending_shift_transfers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advances" (
    "id" SERIAL NOT NULL,
    "customerId" INTEGER NOT NULL,
    "totalAmount" DOUBLE PRECISION NOT NULL,
    "remainingAmount" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPaymentDate" TIMESTAMP(3),
    "status" "AdvanceStatus" NOT NULL DEFAULT 'active',
    "notes" TEXT,

    CONSTRAINT "advances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "invoices"("invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "tray_tracking_invoiceId_key" ON "tray_tracking"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_key" ON "customers"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "pending_shift_transfers_transferNumber_key" ON "pending_shift_transfers"("transferNumber");

-- CreateIndex
CREATE UNIQUE INDEX "pending_shift_transfers_expenseInvoiceId_key" ON "pending_shift_transfers"("expenseInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "pending_shift_transfers_incomeInvoiceId_key" ON "pending_shift_transfers"("incomeInvoiceId");

-- AddForeignKey
ALTER TABLE "shifts" ADD CONSTRAINT "shifts_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_transfer_logs" ADD CONSTRAINT "fund_transfer_logs_fromFundId_fkey" FOREIGN KEY ("fromFundId") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_transfer_logs" ADD CONSTRAINT "fund_transfer_logs_toFundId_fkey" FOREIGN KEY ("toFundId") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fund_transfer_logs" ADD CONSTRAINT "fund_transfer_logs_transferredById_fkey" FOREIGN KEY ("transferredById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "items" ADD CONSTRAINT "items_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "item_groups"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_fundId_fkey" FOREIGN KEY ("fundId") REFERENCES "funds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_relatedDebtId_fkey" FOREIGN KEY ("relatedDebtId") REFERENCES "debts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_relatedAdvanceId_fkey" FOREIGN KEY ("relatedAdvanceId") REFERENCES "advances"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tray_tracking" ADD CONSTRAINT "tray_tracking_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tray_tracking" ADD CONSTRAINT "tray_tracking_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debts" ADD CONSTRAINT "debts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "main_fund_transfer_requests" ADD CONSTRAINT "main_fund_transfer_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "main_fund_transfer_requests" ADD CONSTRAINT "main_fund_transfer_requests_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_shift_transfers" ADD CONSTRAINT "pending_shift_transfers_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_shift_transfers" ADD CONSTRAINT "pending_shift_transfers_acceptedById_fkey" FOREIGN KEY ("acceptedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_shift_transfers" ADD CONSTRAINT "pending_shift_transfers_expenseInvoiceId_fkey" FOREIGN KEY ("expenseInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_shift_transfers" ADD CONSTRAINT "pending_shift_transfers_incomeInvoiceId_fkey" FOREIGN KEY ("incomeInvoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advances" ADD CONSTRAINT "advances_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

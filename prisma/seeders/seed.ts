import { PrismaClient } from '@prisma/client';
import { seedUsers } from './users.seeder';
import { seedItemGroups } from './item-groups.seeder';
import { seedItems } from './items.seeder';
import { seedFunds } from './funds.seeder';
import { seedShifts } from './shifts.seeder';
import { seedInvoices } from './invoices.seeder';
import { seedDebts } from './debts.seeder';


const prisma = new PrismaClient();

async function cleanDatabase() {
  try {
    console.log('🧹 Cleaning database...');
    
    // حذف البيانات بالترتيب المناسب حسب العلاقات
    const deleteDebtPayments = prisma.debtPayment.deleteMany();
    const deleteDebts = prisma.debt.deleteMany();
    const deleteInvoiceItems = prisma.invoiceItem.deleteMany();
    const deleteInvoices = prisma.invoice.deleteMany();
    const deleteShifts = prisma.shift.deleteMany();
    const deleteItems = prisma.item.deleteMany();
    const deleteItemGroups = prisma.itemGroup.deleteMany();
    const deleteFunds = prisma.fund.deleteMany();
    const deleteUsers = prisma.user.deleteMany();

    await prisma.$transaction([
      deleteDebtPayments,
      deleteDebts,
      deleteInvoiceItems,
      deleteInvoices,
      deleteShifts,
      deleteItems,
      deleteItemGroups,
      deleteFunds,
      deleteUsers,
    ]);

    console.log('✅ Clean database success');
  } catch (error) {
    console.error('❌ Clean database error:', error);
    throw error;
  }
}

async function main() {
  await cleanDatabase();
  
  console.log('🌱 Starting seeding...');
  
  try {
    await seedUsers(prisma);
    await seedItemGroups(prisma);
    await seedItems(prisma);
    await seedFunds(prisma);
    await seedShifts(prisma);
    await seedInvoices(prisma);
    await seedDebts(prisma);
    
    console.log('✅ Seeding completed successfully');
  } catch (error) {
    console.error('❌ Seeding failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
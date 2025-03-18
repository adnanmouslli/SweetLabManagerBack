import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { seedUsers } from './users.seeder';
import { seedItemGroups } from './item-groups.seeder';
import { seedItems } from './items.seeder';
import { seedFunds } from './funds.seeder';
import { seedShifts } from './shifts.seeder';
import { seedInvoices } from './invoices.seeder';
import { seedDebts } from './debts.seeder';
import { seedCustomers } from './customers.seeder';

const prisma = new PrismaClient();

async function resetDatabase() {
  try {
    console.log('🔄 Resetting database...');
    
    // تنفيذ أمر prisma migrate reset
    execSync('npx prisma migrate reset --force', { stdio: 'inherit' });
    
    console.log('✅ Database reset completed');
  } catch (error) {
    console.error('❌ Database reset failed:', error);
    throw error;
  }
}

async function main() {
  try {
    // await resetDatabase();
    
    console.log('🌱 Starting seeding...');
    
    await seedUsers(prisma);
    await seedItemGroups(prisma);
    await seedItems(prisma);
    await seedFunds(prisma);
    await seedShifts(prisma);
    await seedCustomers(prisma); // إضافة
    // await seedInvoices(prisma);
    
    console.log('✅ Seeding completed successfully');
  } catch (error) {
    console.error('❌ Process failed:', error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main()
  .catch((error) => {
    console.error('❌ Main process error:', error);
    process.exit(1);
  });
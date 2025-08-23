import { PrismaClient } from '@prisma/client';
import { faker } from '@faker-js/faker/locale/ar';

export async function seedCustomers(prisma: PrismaClient) {
  console.log('Seeding customers...');

  const customers = [];
  for (let i = 0; i < 20; i++) {
    const customerType = faker.helpers.arrayElement(['CUSTOMER', 'SUPPLIER']);
    customers.push({
      name: faker.person.fullName(),
      phone: faker.phone.number(),
      notes: faker.helpers.arrayElement([null, faker.lorem.sentence()]),
      customerType: customerType,
      // إضافة رصيد عشوائي للموردين فقط
      supplierBalance: customerType === 'SUPPLIER' 
        ? faker.number.float({ min: 0, max: 5000, fractionDigits: 2 })
        : 0,
      createdAt: faker.date.recent({ days: 60 }),
      updatedAt: faker.date.recent({ days: 30 }),
    });
  }

  await prisma.customer.createMany({
    data: customers,
  });

  return await prisma.customer.findMany();
}
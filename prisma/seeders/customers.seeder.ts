import { PrismaClient } from '@prisma/client';
import { faker } from '@faker-js/faker/locale/ar';

export async function seedCustomers(prisma: PrismaClient) {
  console.log('Seeding customers...');

  const customers = [];
  for (let i = 0; i < 20; i++) {
    customers.push({
      name: faker.person.fullName(),
      phone: faker.phone.number(),
      notes: faker.helpers.arrayElement([null, faker.lorem.sentence()]),
      createdAt: faker.date.recent({ days: 60 }),
      updatedAt: faker.date.recent({ days: 30 }),
    });
  }

  await prisma.customer.createMany({
    data: customers,
  });

  return await prisma.customer.findMany();
}
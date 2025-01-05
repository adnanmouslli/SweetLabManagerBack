import { PrismaClient, DebtStatus } from '@prisma/client';
import { faker } from '@faker-js/faker/locale/ar';

export async function seedDebts(prisma: PrismaClient) {
  console.log('Seeding debts...');

  const invoices = await prisma.invoice.findMany({
    where: {
      paidStatus: true,
    },
  });

  for (const invoice of invoices) {
    const debt = await prisma.debt.create({
      data: {
        customerName: invoice.customerName,
        customerPhone: invoice.customerPhone,
        totalAmount: invoice.totalAmount,
        remainingAmount: faker.number.float({
          min: 0,
          max: invoice.totalAmount,
          fractionDigits: 2
        }),
        status: faker.helpers.arrayElement([DebtStatus.active, DebtStatus.paid]),
        notes: faker.lorem.sentence(),
      },
    });

    const paymentsCount = faker.number.int({ min: 1, max: 3 });
    for (let i = 0; i < paymentsCount; i++) {
      await prisma.debtPayment.create({
        data: {
          debtId: debt.id,
          invoiceId: invoice.id,
          amount: faker.number.float({
            min: 0,
            max: invoice.totalAmount / 2,
            fractionDigits: 2
          }),
          paymentDate: faker.date.recent({ days: 30 }),
        },
      });
    }
  }
}
// prisma/seeders/invoices.seeder.ts
import { PrismaClient, InvoiceType, InvoiceCategory, PaymentType } from '@prisma/client';
import { faker } from '@faker-js/faker/locale/ar';

export async function seedInvoices(prisma: PrismaClient) {
  console.log('Seeding invoices...');

  const users = await prisma.user.findMany();
  const shifts = await prisma.shift.findMany();
  const funds = await prisma.fund.findMany();
  const items = await prisma.item.findMany();

  // إنشاء 50 فاتورة متنوعة
  for (let i = 0; i < 50; i++) {
    const invoiceType = faker.helpers.arrayElement([InvoiceType.income, InvoiceType.expense]);
    const invoiceCategory = faker.helpers.arrayElement([
      InvoiceCategory.products,
      InvoiceCategory.direct,
      InvoiceCategory.debt,
    ]);

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-${faker.number.int({ min: 1000, max: 9999 })}`,
        invoiceType,
        invoiceCategory,
        customerName: faker.person.fullName(),
        customerPhone: faker.phone.number(),
        paymentType: faker.helpers.arrayElement([PaymentType.cash, PaymentType.credit]),
        totalAmount: faker.number.float({ min: 100, max: 5000, fractionDigits: 2 }),
        discount: faker.number.float({ min: 0, max: 100, fractionDigits: 2 }),
        paidStatus: faker.datatype.boolean(),
        createdAt: faker.date.recent({ days: 30 }),
        notes: faker.lorem.sentence(),
        fundId: faker.helpers.arrayElement(funds).id,
        shiftId: faker.helpers.arrayElement(shifts).id,
        employeeId: faker.helpers.arrayElement(users).id,
      },
    });

    // إضافة مواد للفاتورة
    const itemCount = faker.number.int({ min: 1, max: 5 });
    for (let j = 0; j < itemCount; j++) {
      const item = faker.helpers.arrayElement(items);
      await prisma.invoiceItem.create({
        data: {
          invoiceId: invoice.id,
          itemId: item.id,
          quantity: faker.number.float({ min: 1, max: 20, fractionDigits: 1 }),
          unitPrice: item.price,
          trayCount: faker.number.int({ min: 0, max: 5 }),
          subTotal: faker.number.float({ min: 50, max: 1000, fractionDigits: 2 }),
        },
      });
    }
  }
}
import { PrismaClient, DebtStatus, InvoiceType, InvoiceCategory } from '@prisma/client';
import { faker } from '@faker-js/faker/locale/ar';

export async function seedDebts(prisma: PrismaClient) {
  console.log('Seeding debts...');

  // الحصول على العملاء الموجودين
  const customers = await prisma.customer.findMany();
  const shifts = await prisma.shift.findMany();
  const funds = await prisma.fund.findMany();
  const users = await prisma.user.findMany();

  for (const customer of customers) {
    // إنشاء فاتورة صرف دين
    const expenseInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-${faker.number.int({ min: 1000, max: 9999 })}`,
        invoiceType: InvoiceType.expense,
        invoiceCategory: InvoiceCategory.debt,
        customerId: customer.id,
        totalAmount: faker.number.float({ min: 500, max: 5000, fractionDigits: 2 }),
        discount: 0,
        paidStatus: true,
        paymentDate: faker.date.recent({ days: 60 }),
        createdAt: faker.date.recent({ days: 60 }),
        notes: faker.lorem.sentence(),
        fundId: faker.helpers.arrayElement(funds).id,
        shiftId: faker.helpers.arrayElement(shifts).id,
        employeeId: faker.helpers.arrayElement(users).id,
      },
    });

    // إنشاء سجل الدين
    const debt = await prisma.debt.create({
      data: {
        customerId: customer.id,
        totalAmount: expenseInvoice.totalAmount,
        remainingAmount: faker.number.float({
          min: 0,
          max: expenseInvoice.totalAmount,
          fractionDigits: 2
        }),
        status: faker.helpers.arrayElement([DebtStatus.active, DebtStatus.paid]),
        notes: faker.lorem.sentence(),
        createdAt: expenseInvoice.createdAt,
        lastPaymentDate: faker.date.recent({ days: 30 }),
      },
    });

    // تحديث الفاتورة لربطها بالدين
    await prisma.invoice.update({
      where: { id: expenseInvoice.id },
      data: { relatedDebtId: debt.id },
    });

    // إنشاء فواتير دخل دين (دفعات)
    if (debt.status === DebtStatus.active) {
      const paymentsCount = faker.number.int({ min: 1, max: 3 });
      let remainingDebt = debt.remainingAmount;

      for (let i = 0; i < paymentsCount && remainingDebt > 0; i++) {
        const paymentAmount = faker.number.float({
          min: Math.min(100, remainingDebt),
          max: Math.min(remainingDebt, debt.totalAmount / 2),
          fractionDigits: 2
        });

        await prisma.invoice.create({
          data: {
            invoiceNumber: `INV-${faker.number.int({ min: 1000, max: 9999 })}`,
            invoiceType: InvoiceType.income,
            invoiceCategory: InvoiceCategory.debt,
            customerId: customer.id,
            totalAmount: paymentAmount,
            discount: 0,
            paidStatus: true,
            paymentDate: faker.date.recent({ days: 30 }),
            createdAt: faker.date.recent({ days: 30 }),
            notes: `دفعة دين ${debt.id}`,
            fundId: faker.helpers.arrayElement(funds).id,
            shiftId: faker.helpers.arrayElement(shifts).id,
            employeeId: faker.helpers.arrayElement(users).id,
            relatedDebtId: debt.id,
          },
        });

        remainingDebt -= paymentAmount;
      }

      // تحديث الدين بالمبلغ المتبقي النهائي
      await prisma.debt.update({
        where: { id: debt.id },
        data: {
          remainingAmount: remainingDebt,
          status: remainingDebt <= 0 ? DebtStatus.paid : DebtStatus.active,
        },
      });
    }
  }
}
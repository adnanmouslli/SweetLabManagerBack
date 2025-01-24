import { PrismaClient, InvoiceType, InvoiceCategory } from '@prisma/client';
import { faker } from '@faker-js/faker/locale/ar';

export async function seedInvoices(prisma: PrismaClient) {
  console.log('Seeding invoices...');

  const users = await prisma.user.findMany();
  const shifts = await prisma.shift.findMany();
  const funds = await prisma.fund.findMany();
  const items = await prisma.item.findMany();
  const customers = await prisma.customer.findMany();

  for (let i = 0; i < 50; i++) {
    const invoiceType = faker.helpers.arrayElement([InvoiceType.income, InvoiceType.expense]);
    const invoiceCategory = faker.helpers.arrayElement([
      InvoiceCategory.products,
      InvoiceCategory.direct,
      InvoiceCategory.debt,
    ]);

    // إذا كانت الفاتورة من نوع دين، نحتاج إلى عميل
    const customer = invoiceCategory === InvoiceCategory.debt ? 
      faker.helpers.arrayElement(customers) : 
      faker.helpers.arrayElement([null, ...customers]);

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-${faker.number.int({ min: 1000, max: 9999 })}`,
        invoiceType,
        invoiceCategory,
        customerId: customer?.id || null,
        totalAmount: faker.number.float({ min: 100, max: 5000, fractionDigits: 2 }),
        discount: faker.number.float({ min: 0, max: 100, fractionDigits: 2 }),
        paidStatus: faker.datatype.boolean(),
        createdAt: faker.date.recent({ days: 30 }),
        notes: faker.lorem.sentence(),
        fundId: faker.helpers.arrayElement(funds).id,
        shiftId: faker.helpers.arrayElement(shifts).id,
        employeeId: faker.helpers.arrayElement(users).id,
        trayCount: faker.number.int({ min: 0, max: 5 }),

      },
    });

    // إضافة أصناف للفواتير إذا كانت من نوع products
    if (invoiceCategory === InvoiceCategory.products) {
      const itemCount = faker.number.int({ min: 1, max: 5 });
      for (let j = 0; j < itemCount; j++) {
        const item = faker.helpers.arrayElement(items);
        const quantity = faker.number.float({ min: 1, max: 20, fractionDigits: 1 });
        const unitPrice = item.price;
        
        await prisma.invoiceItem.create({
          data: {
            invoiceId: invoice.id,
            itemId: item.id,
            quantity,
            unitPrice,
            subTotal: quantity * unitPrice,
          },
        });
      }
    }

    // إذا كانت فاتورة صرف دين، نقوم بإنشاء سجل دين
    if (invoiceType === InvoiceType.expense && invoiceCategory === InvoiceCategory.debt) {
      const debt = await prisma.debt.create({
        data: {
          customerId: customer!.id,
          totalAmount: invoice.totalAmount,
          remainingAmount: invoice.totalAmount,
          status: 'active',
          notes: `دين جديد من فاتورة ${invoice.invoiceNumber}`,
          lastPaymentDate: null,
        },
      });

      // تحديث الفاتورة لربطها بالدين
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { relatedDebtId: debt.id },
      });
    }
    
    // إذا كانت فاتورة دخل دين، نبحث عن دين نشط للعميل
    else if (invoiceType === InvoiceType.income && invoiceCategory === InvoiceCategory.debt) {
      const existingDebt = await prisma.debt.findFirst({
        where: {
          customerId: customer!.id,
          status: 'active',
        },
      });

      if (existingDebt) {
        const paymentAmount = Math.min(
          invoice.totalAmount,
          existingDebt.remainingAmount
        );

        await prisma.debt.update({
          where: { id: existingDebt.id },
          data: {
            remainingAmount: existingDebt.remainingAmount - paymentAmount,
            lastPaymentDate: invoice.createdAt,
            status: existingDebt.remainingAmount - paymentAmount <= 0 ? 'paid' : 'active',
          },
        });

        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { relatedDebtId: existingDebt.id },
        });
      }
    }
  }
}

import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto, CustomerType } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { SupplierPaymentDto } from './dto/supplier-payment.dto';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}



  async create(createCustomerDto: CreateCustomerDto) {
  // Create a base customer data object
  const customerData: any = {
    name: createCustomerDto.name,
    // استخدام null بدلاً من سلسلة فارغة
    phone: createCustomerDto.phone && createCustomerDto.phone.trim() !== '' 
           ? createCustomerDto.phone.trim() 
           : null,
    notes: createCustomerDto.notes || '',
    customerType: createCustomerDto.customerType || CustomerType.CUSTOMER,
    isUniversity: createCustomerDto.isUniversity || false, // إضافة الحقل الجديد
  };

  // إضافة categoryId فقط إذا تم تحديده
  if (createCustomerDto.categoryId) {
    customerData.categoryId = parseInt(createCustomerDto.categoryId);
  }

  // Validation for category if provided
  if (createCustomerDto.categoryId) {
    const category = await this.prisma.customerCategory.findUnique({
      where: { id: parseInt(createCustomerDto.categoryId) }
    });

    if (!category) {
      throw new NotFoundException('صنف العملاء المحدد غير موجود');
    }
  }

  // فحص رقم الهاتف فقط إذا كان موجوداً
  if (customerData.phone) {
    const existingCustomer = await this.prisma.customer.findUnique({
      where: { phone: customerData.phone }
    });

    if (existingCustomer) {
      throw new BadRequestException('رقم الهاتف مسجل مسبقاً');
    }
  }

  return this.prisma.customer.create({
    data: customerData
  });
}



  findAll() {
    return this.prisma.customer.findMany({
      include: {
        category: true,
        invoices: {
          include: {
            items: {
              include: {
                item: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        },
        trays: {
          where: {
            status: 'pending'
          }
        },
        debts: {
          where: {
            status: 'active'
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  async findOne(id: number) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        category: true,
        invoices: {
          include: {
            items: {
              include: {
                item: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        },
        trays: {
          where: {
            status: 'pending'
          }
        },
        debts: {
          where: {
            status: 'active'
          }
        }
      }
    });

    if (!customer) {
      throw new NotFoundException('العميل غير موجود');
    }

    return customer;
  }

  async update(id: number, updateCustomerDto: UpdateCustomerDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id }
    });

    const customerData = {
      ...updateCustomerDto,
      categoryId: updateCustomerDto.categoryId ? parseInt(updateCustomerDto.categoryId) : undefined
    };

    if (!customer) {
      throw new NotFoundException('العميل غير موجود');
    }

    // التحقق من رقم الهاتف إذا تم تحديثه
    if (updateCustomerDto.phone && updateCustomerDto.phone !== customer.phone) {
      const existingCustomer = await this.prisma.customer.findUnique({
        where: { phone: updateCustomerDto.phone }
      });

      if (existingCustomer) {
        throw new BadRequestException('رقم الهاتف مسجل مسبقاً');
      }
    }

    // التحقق من وجود الصنف في حالة تحديثه
    if (updateCustomerDto.categoryId) {
      const category = await this.prisma.customerCategory.findUnique({
        where: { id: parseInt(updateCustomerDto.categoryId) }
      });

      if (!category) {
        throw new NotFoundException('صنف العملاء المحدد غير موجود');
      }
    }

    return this.prisma.customer.update({
      where: { id },
      data: customerData
    });
  }

  async remove(id: number) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        invoices: true,
        trays: {
          where: {
            status: 'pending'
          }
        },
        debts: {
          where: {
            status: 'active'
          }
        }
      }
    });

    if (!customer) {
      throw new NotFoundException('العميل غير موجود');
    }

    // التحقق من عدم وجود صواني معلقة
    if (customer.trays.length > 0) {
      throw new BadRequestException('لا يمكن حذف العميل - لديه صواني معلقة');
    }

    // التحقق من عدم وجود ديون نشطة
    if (customer.debts.length > 0) {
      throw new BadRequestException('لا يمكن حذف العميل - لديه ديون نشطة');
    }

    return this.prisma.customer.delete({
      where: { id }
    });
  }

  async search(query: string) {
    return this.prisma.customer.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query } }
        ]
      },
      include: {
        category: true,
        debts: {
          where: {
            status: 'active'
          }
        },
        trays: {
          where: {
            status: 'pending'
          }
        }
      }
    });
  }

  async getCustomersList() {
    const customers = await this.prisma.customer.findMany({
      select: {
        id: true,
        name: true,
        phone: true,
        customerType: true,
        supplierBalance: true,
        category: {
          select: {
            id: true,
            name: true
          }
        },
        debts: {
          where: {
            status: 'active'
          },
          select: {
            remainingAmount: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });
  
    return customers.map(customer => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      customerType: customer.customerType,
      supplierBalance: customer.supplierBalance,
      category: customer.category,
      totalDebt: customer.debts.reduce((sum, debt) => sum + debt.remainingAmount, 0)
    }));
  }

  // تابع كشف حساب العميل
  async getCustomerAccountStatement(customerId: number) {
    // التحقق من وجود العميل
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: {
        id: true,
        name: true,
        phone: true,
        notes: true,
        categoryId: true,
        category: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    if (!customer) {
      throw new NotFoundException('العميل غير موجود');
    }

    // الحصول على معلومات الفواتير
    const invoices = await this.prisma.invoice.findMany({
      where: { 
        customerId 
      },
      include: {
        items: {
          include: {
            item: true
          }
        },
        trayTracking: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // الحصول على معلومات الديون
    const debts = await this.prisma.debt.findMany({
      where: { 
        customerId 
      },
      include: {
        relatedInvoices: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // الحصول على معلومات الصواني المعلقة
    const pendingTrays = await this.prisma.trayTracking.findMany({
      where: { 
        customerId,
        status: 'pending'
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // حساب إجمالي المبالغ المدفوعة
    const totalPaid = invoices
      .filter(invoice => invoice.paidStatus && invoice.invoiceType === 'income')
      .reduce((sum, invoice) => sum + (invoice.totalAmount - invoice.discount), 0);

    // حساب إجمالي المبيعات
    const totalSales = invoices
      .filter(invoice => invoice.invoiceType === 'income')
      .reduce((sum, invoice) => sum + (invoice.totalAmount - invoice.discount), 0);

    // حساب إجمالي الديون الحالية
    const currentDebts = debts
      .filter(debt => debt.status === 'active')
      .reduce((sum, debt) => sum + debt.remainingAmount, 0);

    // حساب إجمالي الديون المسددة
    const paidDebts = debts
      .filter(debt => debt.status === 'paid')
      .reduce((sum, debt) => sum + (debt.totalAmount - debt.remainingAmount), 0);

    // حساب عدد الصواني المعلقة
    const totalPendingTrays = pendingTrays.reduce((sum, tray) => sum + tray.totalTrays, 0);

    // معلومات المنتجات الأكثر شراءً
    const popularItems = this.calculatePopularItems(invoices);

    // حساب معدل الشراء الشهري
    const monthlyAverage = this.calculateMonthlyAverage(invoices);

    // حساب آخر معاملة وأول معاملة
    const sortedInvoices = [...invoices].sort((a, b) => 
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    
    const firstTransaction = sortedInvoices.length > 0 ? sortedInvoices[0] : null;
    const lastTransaction = sortedInvoices.length > 0 ? sortedInvoices[sortedInvoices.length - 1] : null;

    // إعداد كشف الحساب النهائي
    return {
      customerInfo: {
        ...customer,
        createdAt: customer.createdAt.toISOString(),
        updatedAt: customer.updatedAt.toISOString(),
        customerSince: this.formatDuration(customer.createdAt),
      },
      financialSummary: {
        totalSales,
        totalPaid,
        currentDebts,
        paidDebts,
        paymentRatio: totalSales > 0 ? (totalPaid / totalSales) * 100 : 0,
        pendingAmount: totalSales - totalPaid,
      },
      traysInfo: {
        totalPendingTrays,
        pendingTraysDetails: pendingTrays.map(tray => ({
          id: tray.id,
          invoiceId: tray.invoiceId,
          traysCount: tray.totalTrays,
          createdAt: tray.createdAt.toISOString(),
          pendingSince: this.formatDuration(tray.createdAt),
          notes: tray.notes,
        })),
      },
      debtsInfo: {
        activeDebts: debts
          .filter(debt => debt.status === 'active')
          .map(debt => ({
            id: debt.id,
            totalAmount: debt.totalAmount,
            remainingAmount: debt.remainingAmount,
            createdAt: debt.createdAt.toISOString(),
            lastPaymentDate: debt.lastPaymentDate ? debt.lastPaymentDate.toISOString() : null,
            pendingSince: this.formatDuration(debt.createdAt),
            notes: debt.notes,
            paymentProgress: ((debt.totalAmount - debt.remainingAmount) / debt.totalAmount) * 100,
          })),
        paidDebts: debts
          .filter(debt => debt.status === 'paid')
          .map(debt => ({
            id: debt.id,
            totalAmount: debt.totalAmount,
            paidAmount: debt.totalAmount - debt.remainingAmount,
            createdAt: debt.createdAt.toISOString(),
            lastPaymentDate: debt.lastPaymentDate ? debt.lastPaymentDate.toISOString() : null,
            paidAfter: debt.lastPaymentDate 
              ? this.calculateDaysBetween(debt.createdAt, debt.lastPaymentDate)
              : null,
            notes: debt.notes,
          })),
      },
      invoicesInfo: {
        totalCount: invoices.length,
        incomeInvoices: invoices
          .filter(invoice => invoice.invoiceType === 'income')
          .map(invoice => this.formatInvoice(invoice)),
        expenseInvoices: invoices
          .filter(invoice => invoice.invoiceType === 'expense')
          .map(invoice => this.formatInvoice(invoice)),
      },
      analysisInfo: {
        popularItems,
        monthlyAverage,
        firstTransaction: firstTransaction ? {
          date: firstTransaction.createdAt.toISOString(),
          amount: firstTransaction.totalAmount - firstTransaction.discount,
          invoiceNumber: firstTransaction.invoiceNumber,
        } : null,
        lastTransaction: lastTransaction ? {
          date: lastTransaction.createdAt.toISOString(),
          amount: lastTransaction.totalAmount - lastTransaction.discount,
          invoiceNumber: lastTransaction.invoiceNumber,
          daysSinceLastTransaction: lastTransaction ? this.calculateDaysBetween(lastTransaction.createdAt, new Date()) : null,
        } : null,
        transactionFrequency: this.calculateTransactionFrequency(invoices),
        paymentBehavior: {
          prefersPaying: totalPaid > currentDebts,
          prefersDebt: currentDebts > totalPaid,
          paymentReliabilityScore: this.calculateReliabilityScore(invoices, debts),
        }
      }
    };
  }

  private formatInvoice(invoice) {
    return {
      id: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      totalAmount: invoice.totalAmount,
      discount: invoice.discount,
      netAmount: invoice.totalAmount - invoice.discount,
      paidStatus: invoice.paidStatus,
      createdAt: invoice.createdAt.toISOString(),
      paymentDate: invoice.paymentDate ? invoice.paymentDate.toISOString() : null,
      notes: invoice.notes,
      isBreak: invoice.isBreak,
      items: invoice.items.map(item => ({
        itemName: item.item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        subTotal: item.subTotal,
      })),
      trayInfo: invoice.trayTracking ? {
        totalTrays: invoice.trayTracking.totalTrays,
        status: invoice.trayTracking.status,
        returnedAt: invoice.trayTracking.returnedAt ? invoice.trayTracking.returnedAt.toISOString() : null,
      } : null,
    };
  }

  private calculatePopularItems(invoices) {
    // تجميع المنتجات من جميع الفواتير
    const allItems = [];
    invoices.forEach(invoice => {
      if (invoice.invoiceType === 'income') {
        invoice.items.forEach(item => {
          allItems.push({
            itemId: item.item.id,
            itemName: item.item.name,
            quantity: item.quantity,
            revenue: item.subTotal,
          });
        });
      }
    });

    // تجميع المنتجات حسب الهوية
    const groupedItems = {};
    allItems.forEach(item => {
      if (!groupedItems[item.itemId]) {
        groupedItems[item.itemId] = {
          itemId: item.itemId,
          itemName: item.itemName,
          totalQuantity: 0,
          totalRevenue: 0,
          occurrences: 0,
        };
      }
      groupedItems[item.itemId].totalQuantity += item.quantity;
      groupedItems[item.itemId].totalRevenue += item.revenue;
      groupedItems[item.itemId].occurrences += 1;
    });

    // تحويل الكائن إلى مصفوفة وترتيبها حسب الكمية
    return Object.values(groupedItems)
      .sort((a: any, b: any) => b.totalQuantity - a.totalQuantity)
      .slice(0, 5);
  }

  private calculateMonthlyAverage(invoices) {
    if (invoices.length === 0) return 0;

    // الحصول على أول وآخر فاتورة
    const sortedInvoices = [...invoices].sort((a, b) => 
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );
    
    const firstDate = new Date(sortedInvoices[0].createdAt);
    const lastDate = new Date(sortedInvoices[sortedInvoices.length - 1].createdAt);
    
    // حساب عدد الأشهر بين أول وآخر فاتورة
    const months = (lastDate.getFullYear() - firstDate.getFullYear()) * 12 + 
                    (lastDate.getMonth() - firstDate.getMonth()) + 1;
    
    // إجمالي المبيعات
    const totalSales = invoices
      .filter(invoice => invoice.invoiceType === 'income')
      .reduce((sum, invoice) => sum + (invoice.totalAmount - invoice.discount), 0);
    
    return months > 0 ? totalSales / months : totalSales;
  }

  private calculateTransactionFrequency(invoices) {
    if (invoices.length <= 1) return "غير محدد";
  
    // ترتيب الفواتير حسب التاريخ
    const sortedInvoices = [...invoices]
      .filter(invoice => invoice.invoiceType === 'income')
      .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    
    if (sortedInvoices.length <= 1) return "غير محدد";
  
    // حساب المدة بين كل فاتورتين متتاليتين بالأيام
    const intervals = [];
    for (let i = 1; i < sortedInvoices.length; i++) {
      const prevDate = new Date(sortedInvoices[i-1].createdAt);
      const currentDate = new Date(sortedInvoices[i].createdAt);
      const daysDiff = this.calculateDaysBetween(prevDate, currentDate);
      intervals.push(daysDiff);
    }
  
    // حساب متوسط المدة بالأيام
    const averageInterval = intervals.reduce((sum, interval) => sum + interval, 0) / intervals.length;
  
    // تحديد تردد المعاملات
    if (averageInterval <= 7) {
      return "أسبوعي";
    } else if (averageInterval <= 15) {
      return "نصف شهري";
    } else if (averageInterval <= 35) {
      return "شهري";
    } else if (averageInterval <= 90) {
      return "فصلي";
    } else if (averageInterval <= 180) {
      return "نصف سنوي";
    } else {
      return "سنوي";
    }
  }
  
  private calculateReliabilityScore(invoices, debts) {
    // عوامل مختلفة لتحديد مستوى الموثوقية
    
    // 1. نسبة الفواتير المدفوعة
    const paidInvoicesRatio = invoices.length > 0 
      ? invoices.filter(inv => inv.paidStatus).length / invoices.length 
      : 0;
    
    // 2. نسبة الديون المسددة
    const paidDebtsRatio = debts.length > 0 
      ? debts.filter(debt => debt.status === 'paid').length / debts.length 
      : 1; // إذا لم يكن هناك ديون فهذا إيجابي
    
    // 3. سرعة سداد الديون (متوسط المدة بالأيام)
    let debtPaymentSpeed = 0;
    const paidDebts = debts.filter(debt => debt.status === 'paid' && debt.lastPaymentDate);
    
    if (paidDebts.length > 0) {
      const paymentDurations = paidDebts.map(debt => 
        this.calculateDaysBetween(debt.createdAt, debt.lastPaymentDate)
      );
      debtPaymentSpeed = paymentDurations.reduce((sum, days) => sum + days, 0) / paymentDurations.length;
    }
    
    // حساب نقاط الموثوقية (0-100)
    let reliabilityScore = 50; // نقطة البداية
    
    // إضافة نقاط بناءً على نسبة الفواتير المدفوعة (حتى 30 نقطة)
    reliabilityScore += paidInvoicesRatio * 30;
    
    // إضافة نقاط بناءً على نسبة الديون المسددة (حتى 30 نقطة)
    reliabilityScore += paidDebtsRatio * 30;
    
    // خصم نقاط بناءً على متوسط مدة سداد الديون
    if (debtPaymentSpeed > 0) {
      if (debtPaymentSpeed <= 7) { // سداد خلال أسبوع
        reliabilityScore += 10;
      } else if (debtPaymentSpeed <= 30) { // سداد خلال شهر
        reliabilityScore += 5;
      } else if (debtPaymentSpeed > 90) { // أكثر من 3 أشهر
        reliabilityScore -= 10;
      }
    }
    
    // التأكد من أن النتيجة بين 0 و 100
    return Math.max(0, Math.min(100, reliabilityScore));
  }
  
  private formatDuration(date) {
    const now = new Date();
    const pastDate = new Date(date);
    const diffInDays = this.calculateDaysBetween(pastDate, now);
  
    if (diffInDays < 1) {
      return "اليوم";
    } else if (diffInDays < 2) {
      return "منذ يوم واحد";
    } else if (diffInDays < 30) {
      return `منذ ${diffInDays} يوم`;
    } else if (diffInDays < 365) {
      const months = Math.floor(diffInDays / 30);
      return months === 1 ? "منذ شهر واحد" : `منذ ${months} أشهر`;
    } else {
      const years = Math.floor(diffInDays / 365);
      const remainingMonths = Math.floor((diffInDays % 365) / 30);
      
      let result = years === 1 ? "منذ سنة واحدة" : `منذ ${years} سنوات`;
      if (remainingMonths > 0) {
        result += remainingMonths === 1 ? " وشهر واحد" : ` و ${remainingMonths} أشهر`;
      }
      
      return result;
    }
  }
  
  private calculateDaysBetween(startDate, endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffInTime = end.getTime() - start.getTime();
    return Math.floor(diffInTime / (1000 * 60 * 60 * 24));
  }

  // دوال جديدة للبحث عن الزبائن والموردين بشكل منفصل
  async findCustomers() {
    return this.prisma.customer.findMany({
      where: {
        customerType: CustomerType.CUSTOMER
      },
      include: {
        category: true,
        invoices: {
          include: {
            items: {
              include: {
                item: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        },
        trays: {
          where: {
            status: 'pending'
          }
        },
        debts: {
          where: {
            status: 'active'
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  async findSuppliers() {
    return this.prisma.customer.findMany({
      where: {
        customerType: CustomerType.SUPPLIER
      },
      include: {
        category: true,
        invoices: {
          include: {
            items: {
              include: {
                item: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        },
        debts: {
          where: {
            status: 'active'
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  async getOnlyCustomersList() {
    const customers = await this.prisma.customer.findMany({
      where: {
        customerType: CustomerType.CUSTOMER
      },
      include: {
        category: true,
        debts: {
          where: {
            status: 'active'
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });

    return customers.map(customer => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      category: customer.category,
      customerType: customer.customerType,
      totalDebt: customer.debts.reduce((sum, debt) => sum + debt.remainingAmount, 0)
    }));
  }

  async getSuppliersList() {
    const suppliers = await this.prisma.customer.findMany({
      where: {
        customerType: CustomerType.SUPPLIER
      },
      include: {
        category: true,
        debts: {
          where: {
            status: 'active'
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });

    return suppliers.map(supplier => ({
      id: supplier.id,
      name: supplier.name,
      phone: supplier.phone,
      category: supplier.category,
      customerType: supplier.customerType,
      supplierBalance: supplier.supplierBalance,
      totalDebt: supplier.debts.reduce((sum, debt) => sum + debt.remainingAmount, 0)
    }));
  }

  // دوال جديدة لإدارة رصيد الموردين
  async updateSupplierBalance(supplierId: number, amount: number, operation: 'add' | 'subtract') {
    // التحقق من وجود المورد
    const supplier = await this.prisma.customer.findUnique({
      where: { id: supplierId }
    });

    if (!supplier) {
      throw new NotFoundException('المورد غير موجود');
    }

    if (supplier.customerType !== CustomerType.SUPPLIER) {
      throw new BadRequestException('العميل المحدد ليس مورداً');
    }

    // حساب الرصيد الجديد
    const newBalance = operation === 'add' 
      ? supplier.supplierBalance + amount
      : supplier.supplierBalance - amount;
    
    // التأكد من عدم وجود رصيد سالب غير منطقي
    if (operation === 'subtract' && newBalance < 0) {
      throw new BadRequestException('لا يمكن أن يكون الرصيد أقل من الصفر');
    }

    // تحديث رصيد المورد
    return await this.prisma.customer.update({
      where: { id: supplierId },
      data: { supplierBalance: newBalance }
    });
  }

  async paySupplierBalance(supplierId: number, paymentDto: SupplierPaymentDto, employeeId: number) {
    return this.prisma.$transaction(async (prisma) => {
      // التحقق من وجود المورد
      const supplier = await prisma.customer.findUnique({
        where: { id: supplierId }
      });

      if (!supplier) {
        throw new NotFoundException('المورد غير موجود');
      }

      if (supplier.customerType !== CustomerType.SUPPLIER) {
        throw new BadRequestException('العميل المحدد ليس مورداً');
      }

      // التحقق من الرصيد المتاح
      if (paymentDto.paymentAmount > supplier.supplierBalance) {
        throw new BadRequestException(`المبلغ المطلوب دفعه (${paymentDto.paymentAmount}) أكبر من الرصيد المتاح (${supplier.supplierBalance})`);
      }

      // التحقق من وجود الصندوق
      const fund = await prisma.fund.findUnique({
        where: { id: paymentDto.fundId }
      });

      if (!fund) {
        throw new BadRequestException('الصندوق غير موجود');
      }

      // البحث عن الوردية المفتوحة
      const activeShift = await prisma.shift.findFirst({
        where: {
          status: 'open'
        }
      });

      if (!activeShift) {
        throw new BadRequestException('لا توجد وردية مفتوحة للموظف الحالي');
      }

      // إنشاء فاتورة دفع رصيد المورد
      const invoiceNumber = `INV-${Date.now()}`;
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          invoiceType: 'expense',
          invoiceCategory: 'direct',
          customerId: supplierId,
          totalAmount: paymentDto.paymentAmount,
          paidStatus: true,
          paymentDate: new Date(),
          notes: `دفع رصيد مورد - ${paymentDto.notes || ''}`,
          fundId: paymentDto.fundId,
          shiftId: activeShift.id,
          employeeId: employeeId
        }
      });

      // تحديث رصيد المورد
      const newSupplierBalance = supplier.supplierBalance - paymentDto.paymentAmount;
      await prisma.customer.update({
        where: { id: supplierId },
        data: { supplierBalance: newSupplierBalance }
      });

      // تحديث رصيد الصندوق
      await prisma.fund.update({
        where: { id: paymentDto.fundId },
        data: {
          currentBalance: {
            decrement: paymentDto.paymentAmount
          }
        }
      });

      return {
        invoice,
        newSupplierBalance,
        message: 'تم دفع رصيد المورد بنجاح'
      };
    });
  }

  async getSupplierBalance(supplierId: number) {
    const supplier = await this.prisma.customer.findUnique({
      where: { id: supplierId },
      select: {
        id: true,
        name: true,
        customerType: true,
        supplierBalance: true,
        phone: true
      }
    });

    if (!supplier) {
      throw new NotFoundException('المورد غير موجود');
    }

    if (supplier.customerType !== CustomerType.SUPPLIER) {
      throw new BadRequestException('العميل المحدد ليس مورداً');
    }

    return supplier;
  }

  async getSuppliersBalanceReport() {
    const suppliers = await this.prisma.customer.findMany({
      where: {
        customerType: CustomerType.SUPPLIER
      },
      select: {
        id: true,
        name: true,
        phone: true,
        supplierBalance: true,
        category: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        supplierBalance: 'desc'
      }
    });

    const totalBalance = suppliers.reduce((sum, supplier) => sum + supplier.supplierBalance, 0);
    const suppliersWithBalance = suppliers.filter(supplier => supplier.supplierBalance > 0);

    return {
      suppliers,
      summary: {
        totalSuppliers: suppliers.length,
        suppliersWithBalance: suppliersWithBalance.length,
        totalBalance,
        averageBalance: suppliers.length > 0 ? totalBalance / suppliers.length : 0
      }
    };
  }
}
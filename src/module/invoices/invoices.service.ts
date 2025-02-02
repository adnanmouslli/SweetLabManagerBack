import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceCategory, InvoiceType } from '@prisma/client';
import { FilterInvoiceDto } from './dto/filter-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(private prisma: PrismaService) {}
  async create(createInvoiceDto: CreateInvoiceDto, employeeId: number) {
    const activeShift = await this.prisma.shift.findFirst({
      where: {
        status: 'open',
      },
    });
  
    if (!activeShift) {
      throw new BadRequestException('لا يوجد واردية مفتوحة');
    }
  
    const fund = await this.prisma.fund.findUnique({
      where: { id: createInvoiceDto.fundId },
    });
  
    if (!fund) {
      throw new BadRequestException('الصندوق غير موجود');
    }

    // التحقق من وجود العميل إذا تم تحديده
    if (createInvoiceDto.customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: createInvoiceDto.customerId },
      });

      if (!customer) {
        throw new BadRequestException('العميل غير موجود');
      }
    }
  
    // التحقق من وجود العميل عند وجود صاجات
    if (
      createInvoiceDto.invoiceType === 'income' &&
      createInvoiceDto.invoiceCategory === 'products' &&
      createInvoiceDto.items?.some(item => item.trayCount > 0) &&
      !createInvoiceDto.customerId
    ) {
      throw new BadRequestException('معلومات العميل مطلوبة عند وجود صاجات');
    }

    // التحقق من وجود العميل لفواتير الدين
    if (createInvoiceDto.invoiceCategory === 'debt' && !createInvoiceDto.customerId) {
      throw new BadRequestException('يجب تحديد العميل لفواتير الدين');
    }
  
    const invoiceNumber = `INV-${Date.now()}`;
  
    return this.prisma.$transaction(async (prisma) => {
      const calculatedTotal =
        createInvoiceDto.items?.reduce(
          (sum, item) => sum + item.quantity * item.unitPrice,
          0
        ) || 0;
  
      if (
        createInvoiceDto.items &&
        Math.abs(calculatedTotal - (createInvoiceDto.totalAmount || 0)) > 0.01
      ) {
        throw new BadRequestException('المجموع الكلي غير صحيح');
      }
  
      const totalTrays = createInvoiceDto.invoiceType === 'income' &&
        createInvoiceDto.invoiceCategory === 'products' ?
        createInvoiceDto.items?.reduce(
          (sum, item) => sum + (item.trayCount || 0),
          0
        ) || 0 : 0;
  
      // إنشاء الفاتورة
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          employeeId,
          invoiceType: createInvoiceDto.invoiceType,
          invoiceCategory: createInvoiceDto.invoiceCategory,
          customerId: createInvoiceDto.customerId,
          paidStatus: createInvoiceDto.paidStatus,
          totalAmount: createInvoiceDto.totalAmount || 0,
          discount: createInvoiceDto.discount || 0,
          notes: createInvoiceDto.notes || null,
          fundId: createInvoiceDto.fundId,
          shiftId: activeShift.id,
          paymentDate: createInvoiceDto.paidStatus ? new Date() : null,
          items: createInvoiceDto.items
            ? {
                create: createInvoiceDto.items.map((item) => ({
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  trayCount: item.trayCount || 0,
                  subTotal: item.quantity * item.unitPrice,
                  itemId: item.itemId,
                })),
              }
            : undefined,
        },
        include: {
          items: {
            include: {
              item: true,
            },
          },
          employee: {
            select: {
              username: true,
            },
          },
          customer: true,
        },
      });

      // معالجة الديون
      if (createInvoiceDto.invoiceCategory === 'debt') {
        if (createInvoiceDto.invoiceType === 'expense') {
          // البحث عن دين نشط للعميل
          const existingDebt = await prisma.debt.findFirst({
            where: {
              customerId: createInvoiceDto.customerId!,
              status: 'active',
            },
          });

          if (existingDebt) {
            // تحديث الدين الموجود
            const updatedDebt = await prisma.debt.update({
              where: { id: existingDebt.id },
              data: {
                totalAmount: existingDebt.totalAmount + createInvoiceDto.totalAmount,
                remainingAmount: existingDebt.remainingAmount + createInvoiceDto.totalAmount,
                notes: createInvoiceDto.notes || 'تم إضافة دين جديد',
              },
            });

            // ربط الفاتورة بالدين الموجود
            await prisma.invoice.update({
              where: { id: invoice.id },
              data: { relatedDebtId: existingDebt.id },
            });
          } else {
            // إنشاء سجل دين جديد
            const debt = await prisma.debt.create({
              data: {
                customerId: createInvoiceDto.customerId!,
                totalAmount: createInvoiceDto.totalAmount,
                remainingAmount: createInvoiceDto.totalAmount,
                status: 'active',
                notes: createInvoiceDto.notes || 'دين جديد',
              },
            });

            // ربط الفاتورة بالدين الجديد
            await prisma.invoice.update({
              where: { id: invoice.id },
              data: { relatedDebtId: debt.id },
            });
          }
        } else if (createInvoiceDto.invoiceType === 'income') {
          // البحث عن الديون النشطة للعميل
          const activeDebt = await prisma.debt.findFirst({
            where: {
              customerId: createInvoiceDto.customerId!,
              status: 'active',
            },
            orderBy: {
              createdAt: 'asc',
            },
          });

          if (!activeDebt) {
            throw new BadRequestException('لا يوجد ديون نشطة لهذا العميل');
          }

          // التحقق من أن مبلغ الدفعة لا يتجاوز المبلغ المتبقي
          if (createInvoiceDto.totalAmount > activeDebt.remainingAmount) {
            throw new BadRequestException('مبلغ الدفعة يتجاوز المبلغ المتبقي من الدين');
          }

          // تحديث الدين
          const newRemainingAmount = activeDebt.remainingAmount - createInvoiceDto.totalAmount;
          await prisma.debt.update({
            where: { id: activeDebt.id },
            data: {
              remainingAmount: newRemainingAmount,
              lastPaymentDate: new Date(),
              status: newRemainingAmount <= 0 ? 'paid' : 'active',
              notes: newRemainingAmount <= 0 
                ? `${activeDebt.notes || ''}\nتم سداد الدين بالكامل بتاريخ ${new Date().toLocaleDateString()}`
                : activeDebt.notes
            },
          });

          // ربط الفاتورة بالدين
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: { relatedDebtId: activeDebt.id },
          });
        }
      }

      // معالجة الصواني
      if (totalTrays > 0) {
        await prisma.trayTracking.create({
          data: {
            customerId: createInvoiceDto.customerId!,
            totalTrays,
            status: 'pending',
            notes: `تم تسليم ${totalTrays} صاج مع الفاتورة ${invoiceNumber}`,
            invoiceId: invoice.id
          }
        });
      }
      
      // تحديث رصيد الصندوق فقط إذا كانت الفاتورة مدفوعة
    if (createInvoiceDto.paidStatus && createInvoiceDto.totalAmount) {
      await prisma.fund.update({
        where: { id: createInvoiceDto.fundId },
        data: {
          currentBalance: {
            [createInvoiceDto.invoiceType === 'income'
              ? 'increment'
              : 'decrement']:
              createInvoiceDto.totalAmount - (createInvoiceDto.discount || 0),
          },
        },
      });
    }
      return {
        ...invoice,
        trayTracking: totalTrays > 0 ? {
          totalTrays,
          status: 'pending'
        } : null
      };
    });
  }
  

  async findByTypeAndCategory(type: InvoiceType, category: InvoiceCategory) {
    return this.prisma.invoice.findMany({
      where: {
        invoiceType: type,
        invoiceCategory: category
      },
      include: {
        items: {
          include: {
            item: true
          }
        },
        employee: {
          select: {
            username: true
          }
        }
      }
    });
  }

  async findAll(query: FilterInvoiceDto) {
    const where: any = {};
    

    if (query.type) {
      where.invoiceType = query.type;
    }
    
    if (query.category) {
      where.invoiceCategory = query.category;
    }
    
    if (query.paidStatus !== undefined) {
      where.paidStatus = query.paidStatus;
    }
    

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      
      if (query.endDate) {
        where.createdAt.lte = new Date(query.endDate);
      }
    }

    return this.prisma.invoice.findMany({
      where,
      include: {
        items: {
          include: {
            item: true
          }
        },
        employee: {
          select: {
            username: true
          }
        },
        fund: true,
        shift: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }
  

  async getSummary() {
    try {
      const summary = await this.prisma.invoice.groupBy({
        by: ['invoiceType', 'invoiceCategory'],
        _sum: {
          totalAmount: true,
        },
        _count: {
          _all: true,
        },
      });
  
      return summary;
    } catch (error) {
      throw new BadRequestException('حدث خطأ أثناء معالجة ملخص الفواتير');
    }
  }
  

  async findOne(id: number) {
    if (!id || isNaN(id)) {
      throw new BadRequestException('معرف الفاتورة غير صالح');
    }

    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            item: true,
          },
        },
        employee: {
          select: {
            username: true,
          },
        },
        fund: true,
        shift: true,
      },
    });
  
    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }
  
    return invoice;
  }
  
  findUnpaid() {
    return this.prisma.invoice.findMany({
      where: {
        paidStatus: false
      },
      include: {
        items: {
          include: {
            item: true
          }
        }
      }
    });
  }

  async markAsPaid(id: number) {
    const activeShift = await this.prisma.shift.findFirst({
      where: {
        status: 'open',
      },
    });
  
    if (!activeShift) {
      throw new BadRequestException('لا يمكن تحويل الفاتورة - لا يوجد واردية مفتوحة');
    }
  

    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        fund: true
      }
    });
  
    if (!invoice) {
      throw new NotFoundException('الفاتورة غير موجودة');
    }
  
    if (invoice.paidStatus) {
      throw new BadRequestException('الفاتورة مدفوعة بالفعل');
    }
  
    return this.prisma.$transaction(async (prisma) => {

      const updatedInvoice = await prisma.invoice.update({
        where: { id },
        data: {
          paidStatus: true,
          paymentDate: new Date(),
          shiftId: activeShift.id 
        },
        include: {
          fund: true,
          items: {
            include: {
              item: true
            }
          }
        }
      });
  
      await prisma.fund.update({
        where: { id: invoice.fundId },
        data: {
          currentBalance: {
            [invoice.invoiceType === 'income' ? 'increment' : 'decrement']:
              invoice.totalAmount - (invoice.discount || 0),
          },
        },
      });
  
      return updatedInvoice;
    });
  }

  async update(id: number, updateInvoiceDto: UpdateInvoiceDto) {
    const existingInvoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        items: true,
      },
    });
    
    if (!existingInvoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }
  
    return this.prisma.$transaction(async (prisma) => {
      const updateData: any = {};
  
      if (updateInvoiceDto.invoiceType !== undefined) {
        updateData.invoiceType = updateInvoiceDto.invoiceType;
      }
  
      if (updateInvoiceDto.invoiceCategory !== undefined) {
        updateData.invoiceCategory = updateInvoiceDto.invoiceCategory;
      }
  
      // if (updateInvoiceDto.customerId !== undefined) {
      //   updateData.customerId = updateInvoiceDto.customerId;
      // }
  
      if (updateInvoiceDto.paidStatus !== undefined) {
        updateData.paidStatus = updateInvoiceDto.paidStatus;
        updateData.paymentDate = updateInvoiceDto.paidStatus ? new Date() : null;
      }
  
      if (updateInvoiceDto.totalAmount !== undefined) {
        updateData.totalAmount = updateInvoiceDto.totalAmount;
      }
  
      if (updateInvoiceDto.discount !== undefined) {
        updateData.discount = updateInvoiceDto.discount;
      }
  
      if (updateInvoiceDto.notes !== undefined) {
        updateData.notes = updateInvoiceDto.notes;
      }
  
      if (updateInvoiceDto.fundId !== undefined) {
        updateData.fundId = updateInvoiceDto.fundId;
      }
  
      if (updateInvoiceDto.items !== undefined) {
        await prisma.invoiceItem.deleteMany({
          where: { invoiceId: id },
        });
  
        await prisma.invoiceItem.createMany({
          data: updateInvoiceDto.items.map((item) => ({
            invoiceId: id,
            itemId: item.itemId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            trayCount: item.trayCount || 0,
            subTotal: item.quantity * item.unitPrice,
          })),
        });
      }

      const updatedInvoice = await prisma.invoice.update({
        where: { id },
        data: updateData,
      });

      if (updateInvoiceDto.totalAmount !== undefined && updateInvoiceDto.fundId !== undefined) {
        const balanceAdjustment =
          updateInvoiceDto.invoiceType === 'income'
            ? updateInvoiceDto.totalAmount - (updateInvoiceDto.discount || 0)
            : -(updateInvoiceDto.totalAmount - (updateInvoiceDto.discount || 0));
  
        await prisma.fund.update({
          where: { id: updateInvoiceDto.fundId },
          data: {
            currentBalance: {
              increment: balanceAdjustment,
            },
          },
        });
      }
  
      return updatedInvoice;
    });
  }
  

  async getCurrentShiftInvoices() {
    try {

      const activeShift = await this.prisma.shift.findFirst({
        where: {
          status: 'open',
        },
      });
  
      if (!activeShift) {
        throw new BadRequestException('لا يوجد واردية مفتوحة');
      }
  

      const invoices = await this.prisma.invoice.findMany({
        where: {
          shiftId: activeShift.id,
          fund: {
            fundType: {
              not: 'main'
            }
          }
        },
        include: {
          items: {
            include: {
              item: true
            }
          },
          employee: {
            select: {
              username: true
            }
          },
          fund: true,
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
  
      const boothInvoices = invoices.filter(invoice => invoice.fund.fundType === 'booth');
      const universityInvoices = invoices.filter(invoice => invoice.fund.fundType === 'university');
      const generalInvoices = invoices.filter(invoice => invoice.fund.fundType === 'general');
  
      const calculateFundTotals = (fundInvoices) => {
        const income = fundInvoices
          .filter(inv => inv.invoiceType === 'income')
          .reduce((sum, inv) => sum + (inv.totalAmount - (inv.discount || 0)), 0);
        
        const expense = fundInvoices
          .filter(inv => inv.invoiceType === 'expense')
          .reduce((sum, inv) => sum + (inv.totalAmount - (inv.discount || 0)), 0);
  
        return {
          income,
          expense,
          net: income - expense
        };
      };
      return {
        shiftId: activeShift.id,
        openTime: activeShift.openTime,
        booth: {
          invoices: boothInvoices,
          count: boothInvoices.length,
          totals: calculateFundTotals(boothInvoices)
        },
        university: {
          invoices: universityInvoices,
          count: universityInvoices.length,
          totals: calculateFundTotals(universityInvoices)
        },
        general: {
          invoices: generalInvoices,
          count: generalInvoices.length,
          totals: calculateFundTotals(generalInvoices)
        }
      };
  
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException('حدث خطأ أثناء جلب فواتير الواردية الحالية');
    }
  }


}
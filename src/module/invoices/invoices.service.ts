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
      createInvoiceDto.trayCount > 0 &&
      !createInvoiceDto.customerId
    ) {
      throw new BadRequestException('معلومات العميل مطلوبة عند وجود صاجات');
    }
  
    // التحقق من وجود العميل لفواتير الدين
    if (createInvoiceDto.invoiceCategory === 'debt' && !createInvoiceDto.customerId) {
      throw new BadRequestException('يجب تحديد العميل لفواتير الدين');
    }
    
    // التحقق من وجود حقل initialPayment عندما يكون isBreak = true
    if (createInvoiceDto.isBreak && !createInvoiceDto.initialPayment) {
      throw new BadRequestException('يجب تحديد قيمة الدفعة الأولى عند إنشاء فاتورة كسر');
    }
  
    // التحقق من أن قيمة الدفعة الأولى أقل من إجمالي المبلغ
    if (createInvoiceDto.isBreak && createInvoiceDto.initialPayment >= createInvoiceDto.totalAmount) {
      throw new BadRequestException('قيمة الدفعة الأولى يجب أن تكون أقل من إجمالي المبلغ');
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
      
      // التعامل مع فاتورة الكسر (isBreak = true)
      if (createInvoiceDto.isBreak === true) {
        // (1) إنشاء الفاتورة الأولى (المدفوعة) بقيمة الدفعة الأولى
        const paidInvoice = await prisma.invoice.create({
          data: {
            invoiceNumber: `${invoiceNumber}-A`,
            employeeId,
            invoiceType: createInvoiceDto.invoiceType,
            invoiceCategory: createInvoiceDto.invoiceCategory,
            customerId: createInvoiceDto.customerId,
            paidStatus: true,  // فاتورة مدفوعة
            totalAmount: createInvoiceDto.initialPayment, // قيمة الدفعة الأولى
            discount: createInvoiceDto.discount || 0,
            notes: createInvoiceDto.notes ? `${createInvoiceDto.notes} - دفعة أولى` : 'دفعة أولى',
            fundId: createInvoiceDto.fundId,
            shiftId: activeShift.id,
            paymentDate: new Date(),
            trayCount: createInvoiceDto.trayCount,
            isBreak: false,
            items: createInvoiceDto.items
              ? {
                  create: createInvoiceDto.items.map((item) => ({
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    unit: item.unit,
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
  
        // تحديث رصيد الصندوق للفاتورة المدفوعة
        await prisma.fund.update({
          where: { id: createInvoiceDto.fundId },
          data: {
            currentBalance: {
              [createInvoiceDto.invoiceType === 'income' ? 'increment' : 'decrement']:
                createInvoiceDto.initialPayment - (createInvoiceDto.discount || 0),
            },
          },
        });
  
        // (2) إنشاء فاتورة الكسر (غير مدفوعة) بالمبلغ المتبقي
        const remainingAmount = createInvoiceDto.totalAmount - createInvoiceDto.initialPayment;
        
        // إنشاء فاتورة الكسر - مع الاحتفاظ بنوع الفاتورة الأصلي
        const breakInvoice = await prisma.invoice.create({
          data: {
            invoiceNumber: `${invoiceNumber}-B`,
            employeeId,
            invoiceType: createInvoiceDto.invoiceType, // نفس نوع الفاتورة الأساسية
            invoiceCategory: createInvoiceDto.invoiceCategory, // نفس فئة الفاتورة الأساسية
            customerId: createInvoiceDto.customerId,
            paidStatus: false, // غير مدفوعة
            totalAmount: remainingAmount,
            discount: 0, // لا خصم على فاتورة الكسر عادة
            notes: createInvoiceDto.notes ? `${createInvoiceDto.notes} - كسر` : 'كسر',
            fundId: createInvoiceDto.fundId,
            shiftId: activeShift.id,
            paymentDate: null,
            trayCount: 0, // لا صواني إضافية في فاتورة الكسر
            isBreak: true, // تعليم كفاتورة كسر
            items: createInvoiceDto.items
              ? {
                  create: createInvoiceDto.items.map((item) => ({
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    unit: item.unit,

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
  
        // معالجة الصواني - تسجيل الصواني فقط مع الفاتورة المدفوعة
        if (createInvoiceDto.trayCount > 0) {
          await prisma.trayTracking.create({
            data: {
              customerId: createInvoiceDto.customerId!,
              totalTrays: createInvoiceDto.trayCount,
              status: 'pending',
              notes: `تم تسليم ${createInvoiceDto.trayCount} صاج مع الفاتورة ${paidInvoice.invoiceNumber}`,
              invoiceId: paidInvoice.id
            }
          });
        }
  
        // إرجاع تفاصيل الفواتير المنشأة
        return {
          paidInvoice: {
            ...paidInvoice,
            trayTracking: createInvoiceDto.trayCount > 0 ? {
              totalTrays: createInvoiceDto.trayCount,
              status: 'pending'
            } : null
          },
          breakInvoice: breakInvoice,
          isBreakInvoice: true
        };
      } 
      
      // حالة الفاتورة العادية (عندما isBreak = false أو غير محدد)
      else {
        // إنشاء الفاتورة العادية
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
            trayCount: createInvoiceDto.trayCount,
            isBreak: false,
            items: createInvoiceDto.items
              ? {
                  create: createInvoiceDto.items.map((item) => ({
                    quantity: item.quantity,
                    unitPrice: item.unitPrice,
                    unit: item.unit,
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
        if (createInvoiceDto.trayCount > 0) {
          await prisma.trayTracking.create({
            data: {
              customerId: createInvoiceDto.customerId!,
              totalTrays: createInvoiceDto.trayCount,
              status: 'pending',
              notes: `تم تسليم ${createInvoiceDto.trayCount} صاج مع الفاتورة ${invoiceNumber}`,
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
        
        // إرجاع الفاتورة المنشأة
        return {
          ...invoice,
          trayTracking: createInvoiceDto.trayCount > 0 ? {
            totalTrays: createInvoiceDto.trayCount,
            status: 'pending'
          } : null,
          isBreakInvoice: false
        };
      }
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
    
    // إضافة البحث حسب معرف الصندوق
    if (query.fundId) {
      where.fundId = Number(query.fundId);
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
  
    // Handle new InvoiceStatus filter
    if (query.status) {
      switch (query.status) {
        case 'paid':
          where.paidStatus = true;
          where.isBreak = false;
          break;
        case 'unpaid':
          where.paidStatus = false;
          where.isBreak = false;
          where.invoiceCategory = { not: 'debt' };  // استخدام صياغة صحيحة لشرط NOT في Prisma
          break;
        case 'debt':
          where.invoiceCategory = 'debt';
          break;
        case 'breakage':
          where.paidStatus = false;
          where.isBreak = true;
          break;
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
        shift: true,
        customer: true
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
  
    // الحصول على بيانات الفاتورة الأصلية
    const originalInvoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: {
        items: {
          include: {
            item: true
          }
        },
        fund: true,
        customer: true,
        employee: true,
        trayTracking: true,
        relatedDebt: true
      }
    });
  
    if (!originalInvoice) {
      throw new NotFoundException('الفاتورة غير موجودة');
    }
  
    if (originalInvoice.paidStatus) {
      throw new BadRequestException('الفاتورة مدفوعة بالفعل');
    }
  
    return this.prisma.$transaction(async (prisma) => {
      // 1. حفظ بيانات الفاتورة الأصلية
      const originalInvoiceData = {
        invoiceType: originalInvoice.invoiceType,
        invoiceCategory: originalInvoice.invoiceCategory,
        customerId: originalInvoice.customerId,
        totalAmount: originalInvoice.totalAmount,
        discount: originalInvoice.discount || 0,
        trayCount: originalInvoice.trayCount || 0,
        fundId: originalInvoice.fundId,
        isBreak: originalInvoice.isBreak,
        createdAt: originalInvoice.createdAt,
        items: originalInvoice.items.map(item => ({
          itemId: item.itemId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          unit: item.unit,

          subTotal: item.subTotal
        }))
      };
  
      // 2. إنشاء فاتورة جديدة مدفوعة بنفس المعلومات
      const newInvoiceNumber = `INV-${Date.now()}`;
      const dateOptions: Intl.DateTimeFormatOptions = { 
        year: 'numeric', 
        month: 'numeric', 
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric'
      };
      const formattedDate = new Intl.DateTimeFormat('ar-EG', dateOptions).format(originalInvoice.createdAt);
      
      const newInvoice = await prisma.invoice.create({  
        data: {
          invoiceNumber: newInvoiceNumber,
          employeeId: originalInvoice.employeeId,
          invoiceType: originalInvoiceData.invoiceType,
          invoiceCategory: originalInvoiceData.invoiceCategory,
          customerId: originalInvoiceData.customerId,
          paidStatus: true, // تعيين الفاتورة كمدفوعة
          totalAmount: originalInvoiceData.totalAmount,
          discount: originalInvoiceData.discount,
          notes: originalInvoice.notes 
            ? `${originalInvoice.notes} - تم دفع الفاتورة المسجلة سابقاً بتاريخ ${formattedDate}` 
            : `تم دفع الفاتورة المسجلة سابقاً بتاريخ ${formattedDate}`,
          fundId: originalInvoiceData.fundId,
          shiftId: activeShift.id, // ربط الفاتورة بالواردية الحالية
          paymentDate: new Date(), // تاريخ الدفع الحالي
          trayCount: originalInvoiceData.trayCount,
          isBreak: false, // الفاتورة الجديدة ليست كسر
          relatedDebtId: originalInvoice.relatedDebtId, // نقل ارتباط الدين إن وجد
          
          // إنشاء نفس العناصر للفاتورة الجديدة
          items: {
            create: originalInvoiceData.items.map(item => ({
              itemId: item.itemId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              unit: item.unit,
              subTotal: item.subTotal
            }))
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
          customer: true,
          fund: true
        }
      });
  
      // 3. إذا كانت الفاتورة تحتوي على صواني، نقل بيانات الصواني إلى الفاتورة الجديدة
      if (originalInvoice.trayTracking) {
        await prisma.trayTracking.updateMany({
          where: { invoiceId: originalInvoice.id },
          data: { 
            invoiceId: newInvoice.id,
            notes: `${originalInvoice.trayTracking.notes} - تم تحديث الفاتورة المرتبطة`
          }
        });
      }
  
      // 4. تحديث رصيد الصندوق (لأن الفاتورة الآن مدفوعة)
      await prisma.fund.update({
        where: { id: originalInvoiceData.fundId },
        data: {
          currentBalance: {
            [originalInvoiceData.invoiceType === 'income' ? 'increment' : 'decrement']:
              originalInvoiceData.totalAmount - originalInvoiceData.discount,
          },
        },
      });
  
      // 6. حذف الفاتورة الأصلية (غير المدفوعة)
      // حذف العناصر المرتبطة بالفاتورة الأصلية أولاً
      await prisma.invoiceItem.deleteMany({
        where: { invoiceId: originalInvoice.id }
      });
      
      // حذف الفاتورة الأصلية
      await prisma.invoice.delete({
        where: { id: originalInvoice.id }
      });
  
      return {
        ...newInvoice,
        trayTracking: originalInvoice.trayTracking ? {
          totalTrays: originalInvoice.trayTracking.totalTrays,
          status: originalInvoice.trayTracking.status
        } : null,
        message: 'تم تحويل الفاتورة إلى مدفوعة بنجاح'
      };
    });
  }

  // async update(id: number, updateInvoiceDto: UpdateInvoiceDto) {
  //   const existingInvoice = await this.prisma.invoice.findUnique({
  //     where: { id },
  //     include: {
  //       items: true,
  //     },
  //   });
    
  //   if (!existingInvoice) {
  //     throw new NotFoundException(`Invoice with ID ${id} not found`);
  //   }
  
  //   return this.prisma.$transaction(async (prisma) => {
  //     const updateData: any = {};
  
  //     if (updateInvoiceDto.invoiceType !== undefined) {
  //       updateData.invoiceType = updateInvoiceDto.invoiceType;
  //     }
  
  //     if (updateInvoiceDto.invoiceCategory !== undefined) {
  //       updateData.invoiceCategory = updateInvoiceDto.invoiceCategory;
  //     }
  
  //     if (updateInvoiceDto.customerId !== undefined) {
  //       updateData.customerId = updateInvoiceDto.customerId;
  //     }
  
  //     if (updateInvoiceDto.paidStatus !== undefined) {
  //       updateData.paidStatus = updateInvoiceDto.paidStatus;
  //       updateData.paymentDate = updateInvoiceDto.paidStatus ? new Date() : null;
  //     }
  
  //     if (updateInvoiceDto.totalAmount !== undefined) {
  //       updateData.totalAmount = updateInvoiceDto.totalAmount;
  //     }
  
  //     if (updateInvoiceDto.discount !== undefined) {
  //       updateData.discount = updateInvoiceDto.discount;
  //     }
  
  //     if (updateInvoiceDto.notes !== undefined) {
  //       updateData.notes = updateInvoiceDto.notes;
  //     }
  
  //     if (updateInvoiceDto.fundId !== undefined) {
  //       updateData.fundId = updateInvoiceDto.fundId;
  //     }
  
  //     if (updateInvoiceDto.items !== undefined) {
  //       await prisma.invoiceItem.deleteMany({
  //         where: { invoiceId: id },
  //       });
  
  //       await prisma.invoiceItem.createMany({
  //         data: updateInvoiceDto.items.map((item) => ({
  //           invoiceId: id,
  //           itemId: item.itemId,
  //           quantity: item.quantity,
  //           unitPrice: item.unitPrice,
  //           subTotal: item.quantity * item.unitPrice,
  //         })),
  //       });
  //     }

  //     const updatedInvoice = await prisma.invoice.update({
  //       where: { id },
  //       data: updateData,
  //     });

  //     if (updateInvoiceDto.totalAmount !== undefined && updateInvoiceDto.fundId !== undefined) {
  //       const balanceAdjustment =
  //         updateInvoiceDto.invoiceType === 'income'
  //           ? updateInvoiceDto.totalAmount - (updateInvoiceDto.discount || 0)
  //           : -(updateInvoiceDto.totalAmount - (updateInvoiceDto.discount || 0));
  
  //       await prisma.fund.update({
  //         where: { id: updateInvoiceDto.fundId },
  //         data: {
  //           currentBalance: {
  //             increment: balanceAdjustment,
  //           },
  //         },
  //       });
  //     }
  
  //     return updatedInvoice;
  //   });
  // }

  async updateInvoice(invoiceId: number, updateInvoiceDto: UpdateInvoiceDto, employeeId: number) {
    const allowedFields = ['customerId', 'discount', 'items', 'trayCount'];
  
    // تحقق من الحقول المسموح بها فقط
    const updateKeys = Object.keys(updateInvoiceDto);
    for (const key of updateKeys) {
      if (!allowedFields.includes(key)) {
        throw new BadRequestException(`لا يمكن تعديل الحقل: ${key}`);
      }
    }
  
    const existingInvoice = await this.prisma.invoice.findUnique({
      where: { id: invoiceId },
      include: {
        items: true,
        trayTracking: true,
      },
    });
  
    if (!existingInvoice) {
      throw new BadRequestException('الفاتورة غير موجودة');
    }
  
    return this.prisma.$transaction(async (prisma) => {
      const trayDifference = 
        (updateInvoiceDto.trayCount || existingInvoice.trayCount || 0) - (existingInvoice.trayCount || 0);
      
      
      if('trayCount' in updateInvoiceDto && existingInvoice.trayCount == 0 && updateInvoiceDto.trayCount > 0){
        await prisma.trayTracking.create({
          data: {
            customerId: existingInvoice.customerId,
            totalTrays: updateInvoiceDto.trayCount,
            status: 'pending',
            notes: `تم إضافة ${trayDifference} صاج مع تعديل الفاتورة ${existingInvoice.invoiceNumber}`,
            invoiceId: invoiceId,
          },
        });
      } else if('trayCount' in updateInvoiceDto && existingInvoice.trayCount > 0 && updateInvoiceDto.trayCount > 0){
        await prisma.trayTracking.updateMany({
          where: { invoiceId: invoiceId },
          data: { totalTrays: updateInvoiceDto.trayCount },
        });
      } else if('trayCount' in updateInvoiceDto && existingInvoice.trayCount > 0 && updateInvoiceDto.trayCount == 0){
        await prisma.trayTracking.deleteMany({ where: { invoiceId: invoiceId } });
      } 
  
      // تحديث بيانات الفاتورة
      const updatedInvoice = await prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          // customerId: updateInvoiceDto.customerId || existingInvoice.customerId,
          discount: updateInvoiceDto.discount,
          trayCount: updateInvoiceDto.trayCount,
          items: updateInvoiceDto.items
            ? {
                deleteMany: { invoiceId: invoiceId }, // حذف العناصر القديمة
                create: updateInvoiceDto.items.map((item) => ({
                  quantity: item.quantity,
                  unitPrice: item.unitPrice,
                  unit: item.unit,

                  subTotal: item.quantity * item.unitPrice,
                  itemId: item.itemId,
                })),
              }
            : undefined,
        },
        include: {
          items: true,
          trayTracking: true,
        },
      });
  
      return updatedInvoice;
    });
  }
  

  async deleteInvoice(invoiceId: number): Promise<any> {
     this.prisma.$transaction(async (prisma) => {
      // التحقق من وجود الفاتورة
      const invoice = await prisma.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          items: true, // لجلب العناصر المرتبطة
          trayTracking: true, // لجلب الصواني المرتبطة
          fund: true, // لجلب الصندوق المرتبط
          relatedDebt: true, // لجلب الديون المرتبطة
        },
      });
  
      if (!invoice) {
        throw new NotFoundException(`الفاتورة رقم ${invoiceId} غير موجودة`);
      }
  
      // حذف العناصر المرتبطة بالفاتورة
      if (invoice.items.length > 0) {
        await prisma.invoiceItem.deleteMany({
          where: { invoiceId },
        });
      }
  
      // حذف الصواني المرتبطة بالفاتورة
      if (invoice.trayTracking) {
        await prisma.trayTracking.deleteMany({
          where: { invoiceId },
        });
      }
  
      // التعامل مع الديون المرتبطة
      if (invoice.relatedDebt) {
        const debt = await prisma.debt.findUnique({
          where: { id: invoice.relatedDebt.id },
        });
  
        if (debt) {
          // تقليل المبلغ المتبقي في الدين أو تغييره إلى "نشط"
          const newRemainingAmount = debt.remainingAmount - invoice.totalAmount;
          await prisma.debt.update({
            where: { id: debt.id },
            data: {
              remainingAmount: newRemainingAmount,
              status: newRemainingAmount > 0 ? 'active' : 'paid',
              notes: `تم تحديث الدين بعد حذف الفاتورة رقم ${invoice.invoiceNumber}`,
            },
          });
        }
      }
  
      // تحديث رصيد الصندوق
      if (invoice.paidStatus) {
        await prisma.fund.update({
          where: { id: invoice.fundId },
          data: {
            currentBalance: {
              [invoice.invoiceType === 'income' ? 'decrement' : 'increment']:
                invoice.totalAmount - (invoice.discount || 0),
            },
          },
        });
      }
  
      // حذف الفاتورة
       await prisma.invoice.delete({
        where: { id: invoiceId },
      });
  
       return {
        message: `تم حذف الفاتورة رقم ${invoice.invoiceNumber} بنجاح`
       };
    
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
          customer:true
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
          .filter(inv => inv.invoiceType === 'income' && 
            inv.paidStatus === true
          )
          .reduce((sum, inv) => sum + (inv.totalAmount - (inv.discount || 0)), 0);
        
        const expense = fundInvoices
          .filter(inv => inv.invoiceType === 'expense' && 
            inv.paidStatus === true
          )
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



async convertInvoiceToDebt(invoiceId: number) {
  // الحصول على بيانات الفاتورة الأصلية
  const invoice = await this.prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: true,
      items: true,
      trayTracking: true,
      relatedDebt: true
    }
  });

  if (!invoice) {
    throw new NotFoundException('الفاتورة غير موجودة');
  }

  // التحقق من أن الفاتورة غير مدفوعة
  if (invoice.paidStatus) {
    throw new BadRequestException('لا يمكن تحويل الفاتورة المدفوعة إلى دين');
  }

  // التحقق من وجود عميل مرتبط بالفاتورة
  if (!invoice.customerId) {
    throw new BadRequestException('لا يمكن تحويل الفاتورة إلى دين: العميل غير محدد');
  }

  return this.prisma.$transaction(async (prisma) => {
    let debtRecord;
    const debtDescription = `تم تحويل الفاتورة رقم ${invoice.invoiceNumber} إلى دين`;
    
    // البحث عن سجل دين نشط للعميل
    const existingDebt = await prisma.debt.findFirst({
      where: {
        customerId: invoice.customerId,
        status: 'active'
      }
    });

    if (existingDebt) {
      // تحديث سجل الدين الموجود
      debtRecord = await prisma.debt.update({
        where: { id: existingDebt.id },
        data: {
          totalAmount: existingDebt.totalAmount + invoice.totalAmount,
          remainingAmount: existingDebt.remainingAmount + invoice.totalAmount,
          notes: `${existingDebt.notes || ''}\n${debtDescription} بتاريخ ${new Date().toLocaleDateString('ar-EG')}`
        }
      });
    } else {
      // إنشاء سجل دين جديد
      debtRecord = await prisma.debt.create({
        data: {
          customerId: invoice.customerId,
          totalAmount: invoice.totalAmount,
          remainingAmount: invoice.totalAmount,
          status: 'active',
          notes: debtDescription
        }
      });
    }

    // حذف عناصر الفاتورة
    if (invoice.items.length > 0) {
      await prisma.invoiceItem.deleteMany({
        where: { invoiceId }
      });
    }

    // معالجة الصواني المرتبطة - تحديث ملاحظات الصواني وإبقاءها في النظام
    if (invoice.trayTracking) {
      await prisma.trayTracking.update({
        where: { id: invoice.trayTracking.id },
        data: { 
          notes: `${invoice.trayTracking.notes || ''}\n تم تحويل الفاتورة المرتبطة إلى دين`,
          invoiceId: null // فك الارتباط مع الفاتورة التي سيتم حذفها
        }
      });
    }

    // حذف الفاتورة
    await prisma.invoice.delete({
      where: { id: invoiceId }
    });

    // إرجاع معلومات عن الدين
    return {
      message: 'تم تحويل الفاتورة إلى دين بنجاح',
      debtRecord,
      customerName: invoice.customer?.name || 'غير معروف',
      invoiceAmount: invoice.totalAmount,
      originalInvoiceNumber: invoice.invoiceNumber
    };
  });
}


async getRawMaterialExpenseInvoices(query?: FilterInvoiceDto) {
  try {
    // التحقق من حالة المصفاة إذا تم تمريرها
    const where: any = {
      invoiceType: 'expense',
      invoiceCategory: 'products',
      items: {
        some: {
          item: {
            type: 'raw'
          }
        }
      }
    };

    // إضافة مصفاة إضافية من الاستعلام إذا وجدت
    if (query) {
      if (query.paidStatus !== undefined) {
        where.paidStatus = query.paidStatus;
      }
      
      if (query.fundId) {
        where.fundId = Number(query.fundId);
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
    }

    // جلب الفواتير مع تضمين البيانات المرتبطة
    const invoices = await this.prisma.invoice.findMany({
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
        customer: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    // حساب إحصاءات المواد الأولية
    const materialStats = this.calculateRawMaterialStats(invoices);

    return {
      invoices,
      totalCount: invoices.length,
      totalAmount: invoices.reduce((sum, invoice) => sum + invoice.totalAmount, 0),
      paidAmount: invoices
        .filter(invoice => invoice.paidStatus)
        .reduce((sum, invoice) => sum + invoice.totalAmount, 0),
      unpaidAmount: invoices
        .filter(invoice => !invoice.paidStatus)
        .reduce((sum, invoice) => sum + invoice.totalAmount, 0),
      rawMaterialStats: materialStats
    };
  } catch (error) {
    console.error('Error in getRawMaterialExpenseInvoices:', error);
    throw new BadRequestException('حدث خطأ أثناء جلب فواتير المواد الأولية');
  }
}

// تابع مساعد لحساب إحصاءات المواد الأولية
private calculateRawMaterialStats(invoices) {
  // تجميع كل المواد الأولية من جميع الفواتير
  const allItems = [];
  invoices.forEach(invoice => {
    invoice.items.forEach(item => {
      if (item.item.type === 'raw') {
        allItems.push({
          itemId: item.item.id,
          itemName: item.item.name,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subTotal: item.subTotal,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.createdAt,
          paidStatus: invoice.paidStatus
        });
      }
    });
  });

  // تجميع المواد حسب المعرف
  const groupedItems = {};
  allItems.forEach(item => {
    if (!groupedItems[item.itemId]) {
      groupedItems[item.itemId] = {
        itemId: item.itemId,
        itemName: item.itemName,
        totalQuantity: 0,
        totalCost: 0,
        averageUnitPrice: 0,
        invoiceCount: 0,
        transactions: []
      };
    }
    
    groupedItems[item.itemId].totalQuantity += item.quantity;
    groupedItems[item.itemId].totalCost += item.subTotal;
    groupedItems[item.itemId].invoiceCount += 1;
    
    // إضافة المعاملة إلى قائمة المعاملات للمادة
    groupedItems[item.itemId].transactions.push({
      invoiceId: item.invoiceId,
      invoiceNumber: item.invoiceNumber,
      date: item.invoiceDate,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      total: item.subTotal,
      paidStatus: item.paidStatus
    });
  });

  // حساب متوسط سعر الوحدة لكل مادة
  Object.values(groupedItems).forEach(item => {
    // @ts-ignore
    item.averageUnitPrice = item.totalQuantity > 0 ? item.totalCost / item.totalQuantity 
      : 0;
  });

  // إضافة إحصاءات إجمالية
  const totalStats = {
    totalUniqueItems: Object.keys(groupedItems).length,
    totalQuantity: Object.values(groupedItems).reduce((sum, item: any) => sum + item.totalQuantity, 0),
    totalCost: Object.values(groupedItems).reduce((sum, item: any) => sum + item.totalCost, 0),
    itemsByTotalCost: Object.values(groupedItems)
      .sort((a: any, b: any) => b.totalCost - a.totalCost)
      .slice(0, 5)
      .map((item: any) => ({
        itemName: item.itemName,
        totalCost: item.totalCost,
        percentage: 
        // @ts-ignore
        Object.values(groupedItems).reduce((sum, item: any) => sum + item.totalCost, 0) > 0
          ? 
          // @ts-ignore
          (item.totalCost / Object.values(groupedItems).reduce((sum, item: any) => sum + item.totalCost, 0)) * 100
          : 0
      })),
    itemsByQuantity: Object.values(groupedItems)
      .sort((a: any, b: any) => b.totalQuantity - a.totalQuantity)
      .slice(0, 5)
      .map((item: any) => ({
        itemName: item.itemName,
        totalQuantity: item.totalQuantity
      }))
  };

  // تحويل groupedItems من كائن إلى مصفوفة وترتيبها حسب التكلفة الإجمالية
  const itemsArray = Object.values(groupedItems).sort((a: any, b: any) => b.totalCost - a.totalCost);

  return {
    items: itemsArray,
    summary: totalStats
  };
}

}
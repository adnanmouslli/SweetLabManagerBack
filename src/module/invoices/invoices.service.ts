import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceCategory, InvoiceType } from '@prisma/client';
import { FilterInvoiceDto } from './dto/filter-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { TransferHistoryQueryDto } from './dto/transfer-request.dto';
import { ConvertToBreakDto } from './dto/convert-to-break.dto';


enum TransferToMainStatus {
  PENDING = 'pending',
  CONFIRMED = 'confirmed',
  REJECTED = 'rejected',
}

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
       // حساب المجموع من العناصر
       const calculatedItemsTotal =
       createInvoiceDto.items?.reduce(
         (sum, item) => sum + item.quantity * item.unitPrice,
         0
       ) || 0;
       
     // إضافة المبلغ الإضافي (إذا وجد) إلى المجموع المحسوب
     const additionalAmount = createInvoiceDto.additionalAmount || 0;
     const calculatedTotal = calculatedItemsTotal + additionalAmount;
     
     // التحقق من صحة المجموع الكلي
     if (
       createInvoiceDto.items &&
       Math.abs(calculatedTotal - (createInvoiceDto.totalAmount || 0)) > 0.01
     ) {
       throw new BadRequestException('المجموع الكلي غير صحيح');
     }
     
     // إضافة معلومات المبلغ الإضافي إلى الملاحظات إذا وجد
     let invoiceNotes = createInvoiceDto.notes || '';
     if (additionalAmount > 0) {
       const additionalNotes = createInvoiceDto.additionalAmountNotes 
         ? `مبلغ إضافي (${additionalAmount}): ${createInvoiceDto.additionalAmountNotes}` 
         : `مبلغ إضافي: ${additionalAmount}`;
       
       invoiceNotes = invoiceNotes 
         ? `${invoiceNotes}\n${additionalNotes}` 
         : additionalNotes;
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
            additionalAmount: additionalAmount, // تخزين المبلغ الإضافي
            notes: invoiceNotes ? `${invoiceNotes} - دفعة أولى` : 'دفعة أولى',
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
            additionalAmount: 0, // لا مبلغ إضافي على فاتورة الكسر
            notes: invoiceNotes ? `${invoiceNotes} - كسر` : 'كسر',
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
            additionalAmount: additionalAmount, // تخزين المبلغ الإضافي
            notes: invoiceNotes || null,
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

        if (createInvoiceDto.invoiceCategory === 'advance') {
          if (createInvoiceDto.invoiceType === 'income') {
            // البحث عن سلفة نشطة للعميل (الآن فاتورة دخل تعني استلام سلفة من العميل)
            const existingAdvance = await prisma.advance.findFirst({
              where: {
                customerId: createInvoiceDto.customerId!,
                status: 'active',
              },
            });
        
            if (existingAdvance) {
              // تحديث السلفة الموجودة
              const updatedAdvance = await prisma.advance.update({
                where: { id: existingAdvance.id },
                data: {
                  totalAmount: existingAdvance.totalAmount + createInvoiceDto.totalAmount,
                  remainingAmount: existingAdvance.remainingAmount + createInvoiceDto.totalAmount,
                  notes: createInvoiceDto.notes || 'تم إضافة سلفة جديدة',
                },
              });
        
              // ربط الفاتورة بالسلفة الموجودة
              await prisma.invoice.update({
                where: { id: invoice.id },
                data: { relatedAdvanceId: existingAdvance.id },
              });
            } else {
              // إنشاء سجل سلفة جديد
              const advance = await prisma.advance.create({
                data: {
                  customerId: createInvoiceDto.customerId!,
                  totalAmount: createInvoiceDto.totalAmount,
                  remainingAmount: createInvoiceDto.totalAmount,
                  status: 'active',
                  notes: createInvoiceDto.notes || 'سلفة جديدة',
                },
              });
        
              // ربط الفاتورة بالسلفة الجديدة
              await prisma.invoice.update({
                where: { id: invoice.id },
                data: { relatedAdvanceId: advance.id },
              });
            }
          } else if (createInvoiceDto.invoiceType === 'expense') {
            // البحث عن السلفات النشطة للعميل (الآن فاتورة صرف تعني إرجاع السلفة للعميل)
            const activeAdvance = await prisma.advance.findFirst({
              where: {
                customerId: createInvoiceDto.customerId!,
                status: 'active',
              },
              orderBy: {
                createdAt: 'asc',
              },
            });
        
            if (!activeAdvance) {
              throw new BadRequestException('لا يوجد سلفات نشطة لهذا العميل');
            }
        
            // التحقق من أن مبلغ الإرجاع لا يتجاوز المبلغ المتبقي
            if (createInvoiceDto.totalAmount > activeAdvance.remainingAmount) {
              throw new BadRequestException('مبلغ الإرجاع يتجاوز المبلغ المتبقي من السلفة');
            }
        
            // تحديث السلفة
            const newRemainingAmount = activeAdvance.remainingAmount - createInvoiceDto.totalAmount;
            await prisma.advance.update({
              where: { id: activeAdvance.id },
              data: {
                remainingAmount: newRemainingAmount,
                lastPaymentDate: new Date(),
                status: newRemainingAmount <= 0 ? 'completed' : 'active',
                notes: newRemainingAmount <= 0 
                  ? `${activeAdvance.notes || ''}\nتم إرجاع السلفة بالكامل بتاريخ ${new Date().toLocaleDateString()}`
                  : activeAdvance.notes
              },
            });
        
            // ربط الفاتورة بالسلفة
            await prisma.invoice.update({
              where: { id: invoice.id },
              data: { relatedAdvanceId: activeAdvance.id },
            });
          }
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


  async updateInvoice(invoiceId: number, updateInvoiceDto: UpdateInvoiceDto, employeeId: number) {
    const allowedFields = ['customerId', 'discount', 'items', 'trayCount', 'additionalAmount', 'additionalAmountNotes'];
  
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
      

      let notes = existingInvoice.notes || '';
    // في حالة تحديث المبلغ الإضافي
    if ('additionalAmount' in updateInvoiceDto) {
      const additionalAmount = updateInvoiceDto.additionalAmount || 0;
      const originalAdditionalAmount = existingInvoice.additionalAmount || 0;
      
      // إذا كان هناك نص سابق عن المبلغ الإضافي، قم بإزالته
      const additionalAmountRegex = /مبلغ إضافي(\s*\(\d+(\.\d+)?\))?(: .*)?\n?/g;
      notes = notes.replace(additionalAmountRegex, '');
      
      // إضافة نص جديد عن المبلغ الإضافي إذا كان أكبر من صفر
      if (additionalAmount > 0) {
        const additionalNotes = updateInvoiceDto.additionalAmountNotes 
          ? `مبلغ إضافي (${additionalAmount}): ${updateInvoiceDto.additionalAmountNotes}` 
          : `مبلغ إضافي: ${additionalAmount}`;
        
        notes = notes 
          ? `${notes}\n${additionalNotes}` 
          : additionalNotes;
      }
      
      // حساب المجموع الجديد بناءً على عناصر الفاتورة والمبلغ الإضافي
      let itemsTotal = 0;
      
      // استخدام العناصر المحدثة إذا تم توفيرها، وإلا استخدام العناصر الحالية
      if (updateInvoiceDto.items) {
        itemsTotal = updateInvoiceDto.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      } else {
        itemsTotal = existingInvoice.items.reduce((sum, item) => sum + item.quantity * item.unitPrice, 0);
      }
      
      // تحديث إجمالي الفاتورة
      const newTotalAmount = itemsTotal + additionalAmount;
      
      // تحديث بيانات الفاتورة
      const updatedInvoice = await prisma.invoice.update({
        where: { id: invoiceId },
        data: {
          // customerId: updateInvoiceDto.customerId || existingInvoice.customerId,
          discount: updateInvoiceDto.discount,
          additionalAmount: additionalAmount,
          notes: notes,
          trayCount: updateInvoiceDto.trayCount,
          totalAmount: newTotalAmount,
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
    }
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
          relatedAdvance: true, // لجلب السلف المرتبطة
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

      // التعامل مع السلفات المرتبطة
      if (invoice.relatedAdvance) {
        const advance = await prisma.advance.findUnique({
          where: { id: invoice.relatedAdvance.id },
        });

      if (advance) {
        if (invoice.invoiceType === 'income') {
          // في حالة حذف فاتورة استلام سلفة، نقلل من المبلغ الكلي والمتبقي
          const newTotalAmount = advance.totalAmount - invoice.totalAmount;
          const newRemainingAmount = advance.remainingAmount - invoice.totalAmount;
          
          if (newTotalAmount <= 0) {
            // إذا أصبح المبلغ الكلي صفر أو أقل، نحذف سجل السلفة
            await prisma.advance.delete({
              where: { id: advance.id },
            });
          } else {
            // وإلا نحدث السجل
            await prisma.advance.update({
              where: { id: advance.id },
              data: {
                totalAmount: newTotalAmount,
                remainingAmount: newRemainingAmount,
                status: newRemainingAmount <= 0 ? 'completed' : 'active',
                notes: `${advance.notes || ''}\nتم تعديل السلفة بعد حذف الفاتورة رقم ${invoice.invoiceNumber}`,
              },
            });
          }
        } else if (invoice.invoiceType === 'expense') {
          // في حالة حذف فاتورة إرجاع سلفة، نزيد المبلغ المتبقي
          await prisma.advance.update({
            where: { id: advance.id },
            data: {
              remainingAmount: advance.remainingAmount + invoice.totalAmount,
              status: 'active', // إعادة تنشيط السلفة إذا كانت مكتملة
              notes: `${advance.notes || ''}\nتم تعديل السلفة بعد حذف فاتورة الإرجاع رقم ${invoice.invoiceNumber}`,
            },
          });
        }
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
          unit: item.unit,
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





// عمليات التحويل بين الصناديق
async transferFromBoothOrUniversityToGeneral(sourceId: number, amount: number, employeeId: number, notes?: string) {
  // التحقق من وجود واردية مفتوحة
  const activeShift = await this.prisma.shift.findFirst({
    where: {
      status: 'open',
    },
  });

  if (!activeShift) {
    throw new BadRequestException('لا يوجد واردية مفتوحة');
  }

  // التحقق من الصندوق المصدر (يجب أن يكون بسطة أو جامعة)
  const sourceType = await this.prisma.fund.findUnique({
    where: { id: sourceId },
  });

  if (!sourceType) {
    throw new BadRequestException('الصندوق المصدر غير موجود');
  }

  if (sourceType.fundType !== 'booth' && sourceType.fundType !== 'university') {
    throw new BadRequestException('صندوق المصدر يجب أن يكون بسطة أو جامعة');
  }

  // التحقق من الرصيد المتاح في الصندوق المصدر
  if (sourceType.currentBalance < amount) {
    throw new BadRequestException(`رصيد الصندوق المصدر غير كافي (${sourceType.currentBalance})`);
  }

  // البحث عن الصندوق العام
  const generalFund = await this.prisma.fund.findFirst({
    where: { fundType: 'general' },
  });

  if (!generalFund) {
    throw new BadRequestException('الصندوق العام غير موجود');
  }

  // إنشاء المعاملة في قاعدة البيانات
  return this.prisma.$transaction(async (prisma) => {
    // إنشاء فاتورة صرف من الصندوق المصدر
    const expenseInvoiceNumber = `TRF-EXP-${Date.now()}`;
    const expenseInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: expenseInvoiceNumber,
        invoiceType: 'expense',
        invoiceCategory: 'direct',
        totalAmount: amount,
        discount: 0,
        paidStatus: true,
        paymentDate: new Date(),
        notes: notes || `تحويل من ${sourceType.fundType === 'booth' ? 'البسطة' : 'الجامعة'} إلى الصندوق العام`,
        fundId: sourceId,
        shiftId: activeShift.id,
        employeeId,
        isBreak: false,
      },
    });

    // إنشاء فاتورة دخل في الصندوق العام
    const incomeInvoiceNumber = `TRF-INC-${Date.now()}`;
    const incomeInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: incomeInvoiceNumber,
        invoiceType: 'income',
        invoiceCategory: 'direct',
        totalAmount: amount,
        discount: 0,
        paidStatus: true,
        paymentDate: new Date(),
        notes: notes || `تحويل من ${sourceType.fundType === 'booth' ? 'البسطة' : 'الجامعة'} إلى الصندوق العام`,
        fundId: generalFund.id,
        shiftId: activeShift.id,
        employeeId,
        isBreak: false,
      },
    });

    // تسجيل عملية التحويل في سجل تحويلات الصناديق
    const transferLog = await prisma.fundTransferLog.create({
      data: {
        amount,
        fromFundId: sourceId,
        toFundId: generalFund.id,
        transferredById: employeeId,
      },
    });

    // تحديث أرصدة الصناديق
    await prisma.fund.update({
      where: { id: sourceId },
      data: {
        currentBalance: {
          decrement: amount,
        },
      },
    });

    await prisma.fund.update({
      where: { id: generalFund.id },
      data: {
        currentBalance: {
          increment: amount,
        },
      },
    });

    return {
      success: true,
      message: 'تم تحويل المبلغ بنجاح',
      transferAmount: amount,
      sourceType: sourceType.fundType,
      expenseInvoice,
      incomeInvoice,
      transferLog,
    };
  });
}

async createTransferToMainRequest(sourceId: number, amount: number, employeeId: number, notes?: string) {
  // التحقق من وجود واردية مفتوحة
  const activeShift = await this.prisma.shift.findFirst({
    where: {
      status: 'open',
    },
  });

  if (!activeShift) {
    throw new BadRequestException('لا يوجد واردية مفتوحة');
  }

  // البحث عن الصندوق المصدر
  const sourceFund = await this.prisma.fund.findUnique({
    where: { id: sourceId },
  });

  if (!sourceFund) {
    throw new BadRequestException('الصندوق المصدر غير موجود');
  }

  // التحقق من الرصيد المتاح في الصندوق المصدر
  if (sourceFund.currentBalance < amount) {
    throw new BadRequestException(`رصيد الصندوق المصدر غير كافي (${sourceFund.currentBalance})`);
  }

  // البحث عن الخزينة الرئيسية
  const mainFund = await this.prisma.fund.findFirst({
    where: { fundType: 'main' },
  });

  if (!mainFund) {
    throw new BadRequestException('الخزينة الرئيسية غير موجودة');
  }

  // إنشاء المعاملة في قاعدة البيانات
  return this.prisma.$transaction(async (prisma) => {
    // إنشاء فاتورة صرف من الصندوق المصدر (مؤقتة - في حالة انتظار)
    const expenseInvoiceNumber = `TRF-MAIN-EXP-${Date.now()}`;
    const expenseInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: expenseInvoiceNumber,
        invoiceType: 'expense',
        invoiceCategory: 'direct',
        totalAmount: amount,
        discount: 0,
        paidStatus: false, // لن يتم تفعيل الفاتورة حتى التأكيد
        notes: (notes ? `${notes} - ` : '') + `طلب تحويل من ${sourceFund.fundType} إلى الخزينة الرئيسية - في انتظار التأكيد`,
        fundId: sourceId,
        shiftId: activeShift.id,
        employeeId,
        isBreak: false,
      },
    });

    // إنشاء فاتورة دخل في الخزينة الرئيسية (مؤقتة - في حالة انتظار)
    const incomeInvoiceNumber = `TRF-MAIN-INC-${Date.now()}`;
    const incomeInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: incomeInvoiceNumber,
        invoiceType: 'income',
        invoiceCategory: 'direct',
        totalAmount: amount,
        discount: 0,
        paidStatus: false, // لن يتم تفعيل الفاتورة حتى التأكيد
        notes: (notes ? `${notes} - ` : '') + `طلب تحويل من ${sourceFund.fundType} - في انتظار التأكيد`,
        fundId: mainFund.id,
        shiftId: activeShift.id,
        employeeId,
        isBreak: false,
      },
    });

    // تسجيل طلب التحويل في جدول طلبات التحويل
    const transferRequest = await prisma.mainFundTransferRequest.create({
      data: {
        amount,
        status: TransferToMainStatus.PENDING,
        requestedById: employeeId,
        notes: notes || `طلب تحويل من ${sourceFund.fundType} إلى الخزينة الرئيسية`,
        expenseInvoiceId: expenseInvoice.id,
        incomeInvoiceId: incomeInvoice.id,
      },
    });

    return {
      success: true,
      message: 'تم إنشاء طلب التحويل بنجاح، في انتظار التأكيد من أمين الخزينة',
      transferAmount: amount,
      status: TransferToMainStatus.PENDING,
      sourceFund: sourceFund.fundType,
      expenseInvoice,
      incomeInvoice,
      transferRequest,
    };
  });
}

async confirmTransferToMain(requestId: number, treasuryManagerId: number, confirm: boolean, rejectionReason?: string) {
  // البحث عن طلب التحويل
  const transferRequest = await this.prisma.mainFundTransferRequest.findUnique({
    where: { id: requestId },
    include: {
      requestedBy: true,
    },
  });

  if (!transferRequest) {
    throw new BadRequestException('طلب التحويل غير موجود');
  }

  if (transferRequest.status !== TransferToMainStatus.PENDING) {
    throw new BadRequestException('لا يمكن تعديل حالة طلب التحويل - الطلب ليس في حالة الانتظار');
  }

  // التحقق من صلاحيات المستخدم (يفترض أن هناك وظيفة للتحقق من الصلاحيات)
  // const hasPermission = await this.checkUserRole(treasuryManagerId, 'TreasuryManager');
  // if (!hasPermission) {
  //   throw new BadRequestException('ليس لديك الصلاحية للتأكيد على طلبات التحويل');
  // }

  return this.prisma.$transaction(async (prisma) => {
    if (confirm) {
      // تأكيد طلب التحويل
      // البحث عن الفواتير المرتبطة
      const expenseInvoice = await prisma.invoice.findUnique({
        where: { id: transferRequest.expenseInvoiceId },
      });

      const incomeInvoice = await prisma.invoice.findUnique({
        where: { id: transferRequest.incomeInvoiceId },
      });

      if (!expenseInvoice || !incomeInvoice) {
        throw new BadRequestException('الفواتير المرتبطة بطلب التحويل غير موجودة');
      }

      // تحديث حالة الفواتير إلى مدفوعة
      await prisma.invoice.update({
        where: { id: expenseInvoice.id },
        data: {
          paidStatus: true,
          paymentDate: new Date(),
          notes: `${expenseInvoice.notes?.replace('- في انتظار التأكيد', '') || ''} - تمت الموافقة`,
        },
      });

      await prisma.invoice.update({
        where: { id: incomeInvoice.id },
        data: {
          paidStatus: true,
          paymentDate: new Date(),
          notes: `${incomeInvoice.notes?.replace('- في انتظار التأكيد', '') || ''} - تمت الموافقة`,
        },
      });

      // تحديث أرصدة الصناديق
      await prisma.fund.update({
        where: { id: expenseInvoice.fundId },
        data: {
          currentBalance: {
            decrement: transferRequest.amount,
          },
        },
      });

      await prisma.fund.update({
        where: { id: incomeInvoice.fundId },
        data: {
          currentBalance: {
            increment: transferRequest.amount,
          },
        },
      });

      // تسجيل عملية التحويل في سجل تحويلات الصناديق
      await prisma.fundTransferLog.create({
        data: {
          amount: transferRequest.amount,
          fromFundId: expenseInvoice.fundId,
          toFundId: incomeInvoice.fundId,
          transferredById: treasuryManagerId,
        },
      });

      // تحديث حالة طلب التحويل
      await prisma.mainFundTransferRequest.update({
        where: { id: requestId },
        data: {
          status: TransferToMainStatus.CONFIRMED,
          confirmedById: treasuryManagerId,
          confirmedAt: new Date(),
        },
      });

      return {
        success: true,
        message: 'تم تأكيد طلب التحويل بنجاح وتحويل المبلغ إلى الخزينة الرئيسية',
        transferAmount: transferRequest.amount,
        status: TransferToMainStatus.CONFIRMED,
      };
    } else {
      // رفض طلب التحويل
      // حذف الفواتير المؤقتة
      if (transferRequest.expenseInvoiceId) {
        await prisma.invoice.delete({
          where: { id: transferRequest.expenseInvoiceId },
        });
      }

      if (transferRequest.incomeInvoiceId) {
        await prisma.invoice.delete({
          where: { id: transferRequest.incomeInvoiceId },
        });
      }

      // تحديث حالة طلب التحويل
      await prisma.mainFundTransferRequest.update({
        where: { id: requestId },
        data: {
          status: TransferToMainStatus.REJECTED,
          confirmedById: treasuryManagerId,
          confirmedAt: new Date(),
          rejectionReason: rejectionReason || 'تم رفض الطلب بدون سبب محدد',
        },
      });

      return {
        success: true,
        message: 'تم رفض طلب التحويل',
        transferAmount: transferRequest.amount,
        status: TransferToMainStatus.REJECTED,
        rejectionReason: rejectionReason || 'تم رفض الطلب بدون سبب محدد',
      };
    }
  });
}

async getPendingTransferRequests() {
  return this.prisma.mainFundTransferRequest.findMany({
    where: {
      status: TransferToMainStatus.PENDING,
    },
    include: {
      requestedBy: {
        select: {
          username: true,
        },
      },
    },
    orderBy: {
      requestedAt: 'desc',
    },
  });
}

async getTransferRequestHistory(options?: TransferHistoryQueryDto) {
  const where: any = {};
  
  if (options?.status) {
    where.status = options.status;
  }
  
  if (options?.startDate || options?.endDate) {
    where.requestedAt = {};
    
    if (options?.startDate) {
      where.requestedAt.gte = options.startDate;
    }
    
    if (options?.endDate) {
      where.requestedAt.lte = options.endDate;
    }
  }
  
  if (options?.requestedById) {
    where.requestedById = options.requestedById;
  }
  
  return this.prisma.mainFundTransferRequest.findMany({
    where,
    include: {
      requestedBy: {
        select: {
          username: true,
        },
      },
      confirmedBy: {
        select: {
          username: true,
        },
      },
    },
    orderBy: {
      requestedAt: 'desc',
    },
  });
}


async convertToBreak(invoiceId: number, convertToBreakDto: ConvertToBreakDto) {
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
    where: { id: invoiceId },
    include: {
      items: {
        include: {
          item: true
        }
      },
      fund: true,
      customer: true,
      employee: true,
      trayTracking: true
    }
  });

  if (!originalInvoice) {
    throw new NotFoundException('الفاتورة غير موجودة');
  }

  // التحقق من أن الفاتورة غير مدفوعة
  if (originalInvoice.paidStatus) {
    throw new BadRequestException('لا يمكن تحويل الفاتورة المدفوعة إلى فاتورة كسر');
  }
  
  // التحقق من أن الفاتورة ليست فاتورة كسر بالفعل
  if (originalInvoice.isBreak) {
    throw new BadRequestException('الفاتورة هي بالفعل فاتورة كسر');
  }

  // التحقق من أن قيمة الدفعة الأولى أقل من إجمالي المبلغ
  if (convertToBreakDto.initialPayment >= originalInvoice.totalAmount) {
    throw new BadRequestException('قيمة الدفعة الأولى يجب أن تكون أقل من إجمالي المبلغ');
  }

  // التحقق من أن قيمة الدفعة الأولى أكبر من صفر
  if (convertToBreakDto.initialPayment <= 0) {
    throw new BadRequestException('قيمة الدفعة الأولى يجب أن تكون أكبر من صفر');
  }

  return this.prisma.$transaction(async (prisma) => {
    const now = Date.now();
    const newInvoiceNumber = `INV-${now}`;
    
    // 1. إنشاء الفاتورة الأولى (المدفوعة) بقيمة الدفعة الأولى
    const paidInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `${newInvoiceNumber}-A`,
        employeeId: originalInvoice.employeeId,
        invoiceType: originalInvoice.invoiceType,
        invoiceCategory: originalInvoice.invoiceCategory,
        customerId: originalInvoice.customerId,
        paidStatus: true, // فاتورة مدفوعة
        totalAmount: convertToBreakDto.initialPayment,
        discount: 0, // لا خصم على الدفعة الأولى عادة
        additionalAmount: 0, // لا مبلغ إضافي على الدفعة الأولى
        notes: originalInvoice.notes 
          ? `${originalInvoice.notes} - تم تحويل الفاتورة ${originalInvoice.invoiceNumber} إلى كسر - دفعة أولى` 
          : `تم تحويل الفاتورة ${originalInvoice.invoiceNumber} إلى كسر - دفعة أولى`,
        fundId: originalInvoice.fundId,
        shiftId: activeShift.id,
        paymentDate: new Date(),
        trayCount: 0, // نقل الصواني إلى فاتورة الكسر
        isBreak: false,
        
        // نسخ نفس العناصر من الفاتورة الأصلية
        items: {
          create: originalInvoice.items.map(item => ({
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            unit: item.unit,
            subTotal: item.quantity * item.unitPrice,
            itemId: item.itemId,
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
        customer: true
      }
    });

    // 2. إنشاء فاتورة الكسر (غير مدفوعة) بالمبلغ المتبقي
    const remainingAmount = originalInvoice.totalAmount - convertToBreakDto.initialPayment;
    
    const breakInvoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `${newInvoiceNumber}-B`,
        employeeId: originalInvoice.employeeId,
        invoiceType: originalInvoice.invoiceType,
        invoiceCategory: originalInvoice.invoiceCategory,
        customerId: originalInvoice.customerId,
        paidStatus: false, // فاتورة غير مدفوعة
        totalAmount: remainingAmount,
        discount: originalInvoice.discount || 0, // نقل الخصم إلى فاتورة الكسر
        additionalAmount: originalInvoice.additionalAmount || 0, // نقل المبلغ الإضافي إلى فاتورة الكسر
        notes: originalInvoice.notes 
          ? `${originalInvoice.notes} - تم تحويل الفاتورة ${originalInvoice.invoiceNumber} إلى كسر - المبلغ المتبقي` 
          : `تم تحويل الفاتورة ${originalInvoice.invoiceNumber} إلى كسر - المبلغ المتبقي`,
        fundId: originalInvoice.fundId,
        shiftId: activeShift.id,
        paymentDate: null,
        trayCount: originalInvoice.trayCount || 0, // نقل الصواني إلى فاتورة الكسر
        isBreak: true, // تعليم كفاتورة كسر
        
        // نسخ نفس العناصر من الفاتورة الأصلية
        items: {
          create: originalInvoice.items.map(item => ({
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            unit: item.unit,
            subTotal: item.quantity * item.unitPrice,
            itemId: item.itemId,
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
        customer: true
      }
    });

    // 3. تحديث رصيد الصندوق للدفعة الأولية
    await prisma.fund.update({
      where: { id: originalInvoice.fundId },
      data: {
        currentBalance: {
          [originalInvoice.invoiceType === 'income' ? 'increment' : 'decrement']:
            convertToBreakDto.initialPayment,
        },
      },
    });

    // 4. نقل تتبع الصواني (إن وجد) إلى فاتورة الكسر
    if (originalInvoice.trayTracking) {
      await prisma.trayTracking.update({
        where: { invoiceId: originalInvoice.id },
        data: {
          invoiceId: breakInvoice.id,
          notes: `${originalInvoice.trayTracking.notes || ''} - تم تحويل الفاتورة إلى كسر`,
        },
      });
    }

    // 5. حذف العناصر المرتبطة بالفاتورة الأصلية أولاً
    await prisma.invoiceItem.deleteMany({
      where: { invoiceId: originalInvoice.id }
    });
    
    // 6. حذف الفاتورة الأصلية
    await prisma.invoice.delete({
      where: { id: originalInvoice.id }
    });

    // 7. إرجاع تفاصيل الفواتير المنشأة
    return {
      success: true,
      message: 'تم تحويل الفاتورة إلى فاتورة كسر بنجاح',
      paidInvoice: paidInvoice,
      breakInvoice: breakInvoice,
      initialPayment: convertToBreakDto.initialPayment,
      remainingAmount: remainingAmount,
      originalInvoiceNumber: originalInvoice.invoiceNumber
    };
  });
}

}
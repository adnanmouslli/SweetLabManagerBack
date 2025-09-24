import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { FundType, InvoiceCategory, InvoiceType } from '@prisma/client';
import { FilterInvoiceDto } from './dto/filter-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { TransferHistoryQueryDto } from './dto/transfer-request.dto';
import { ConvertToBreakDto } from './dto/convert-to-break.dto';
import { CustomerType } from '../customers/dto/create-customer.dto';
import { tr } from '@faker-js/faker/.';


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
    
    const totalAmountAfterChange = createInvoiceDto.totalAmount;

     const fund = await this.prisma.fund.findUnique({
      where: { id: createInvoiceDto.fundId },
    });

  
    if (!activeShift && fund.fundType != FundType.main) {
      throw new BadRequestException('لا يوجد واردية مفتوحة');
    }

    // 🔧 إضافة التحقق من وجود المنتجات
    if (createInvoiceDto.items && createInvoiceDto.items.length > 0) {
      for (const item of createInvoiceDto.items) {
        const existingItem = await this.prisma.item.findUnique({
          where: { id: item.itemId }
        });
        
        if (!existingItem) {
          throw new BadRequestException(`المنتج رقم ${item.itemId} غير موجود`);
        }
      }
    }

    
    if (createInvoiceDto.invoiceCategory === 'employee' && createInvoiceDto.relatedEmployeeId) {
      const relatedEmployee = await this.prisma.employee.findUnique({
        where: { id: createInvoiceDto.relatedEmployeeId }
      });
      
      if (!relatedEmployee) {
        throw new BadRequestException('الموظف المرتبط غير موجود');
      }
    }

    
   
  
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

      // التحقق من صحة بيانات المورد للفواتير المتعلقة بالموردين
      if (createInvoiceDto.customerId && 
        createInvoiceDto.invoiceType === 'expense' && 
        createInvoiceDto.invoiceCategory === 'products' &&
        createInvoiceDto.supplierPaymentAmount !== undefined) {
          
        // جلب بيانات العميل للتحقق من نوعه
        const customer = await this.prisma.customer.findUnique({
          where: { id: createInvoiceDto.customerId }
        });

        if (customer && customer.customerType === CustomerType.SUPPLIER) {
          createInvoiceDto.totalAmount = createInvoiceDto.supplierPaymentAmount;
        }
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
    

    if (createInvoiceDto.invoiceCategory === 'employee') {
      if (!createInvoiceDto.relatedEmployeeId) {
        throw new BadRequestException('يجب تحديد الموظف المرتبط للفواتير المتعلقة بالموظفين');
      }
      
      // Validate that the employee exists
      const relatedEmployee = await this.prisma.employee.findUnique({
        where: { id: createInvoiceDto.relatedEmployeeId }
      });
      
      if (!relatedEmployee) {
        throw new BadRequestException('الموظف المرتبط غير موجود');
      }
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
     const calculatedTotal = calculatedItemsTotal + additionalAmount - createInvoiceDto.discount;
     
     // التحقق من صحة المجموع الكلي
     if (
       createInvoiceDto.items &&
       Math.abs(calculatedTotal - (createInvoiceDto.totalAmount || 0)) > 0.01
     ) {
       throw new BadRequestException('المجموع الكلي غير صحيح');
     }
     
     // إضافة معلومات المبلغ الإضافي إلى الملاحظات إذا وجد
     let invoiceNotes = createInvoiceDto.notes || '';
   
      
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
            relatedEmployeeId: createInvoiceDto.relatedEmployeeId,
            customerId: createInvoiceDto.customerId,
            paidStatus: createInvoiceDto.paidStatus,
            totalAmount: createInvoiceDto.totalAmount || 0,
            discount: createInvoiceDto.discount || 0,
            additionalAmount: additionalAmount, // تخزين المبلغ الإضافي
            supplierPaymentAmount: createInvoiceDto.supplierPaymentAmount, // حفظ مبلغ الدفع للمورد
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
            relatedEmployee: true,
            customer: true,
          },
        });
        
        
         if (createInvoiceDto.invoiceType === 'expense' && 
            createInvoiceDto.invoiceCategory === 'products' && 
            createInvoiceDto.items) {
          await this.updateInventoryAndPrices(
            createInvoiceDto.items.map(item => ({
              itemId: item.itemId,
              quantity: item.quantity,
              unitPrice: item.unitPrice
            })),
            employeeId,
            invoice.id,
            invoice.invoiceNumber
          );
        }
        
        if (createInvoiceDto.invoiceCategory === 'employee' && createInvoiceDto.relatedEmployeeId) {
       
          // إضافة معالجة لفاتورة الأجر اليومي
            if (createInvoiceDto.invoiceType === 'expense' && 
              createInvoiceDto.employeeInvoiceType === 'salary') {
              
              console.log("test");
            // يمكننا إضافة سجل خاص بالأجر اليومي لتتبعه في المستقبل (اختياري)
            await prisma.employeeSalaryPayment.create({
              data: {
                employeeId: createInvoiceDto.relatedEmployeeId,
                amount: createInvoiceDto.totalAmount,
                paymentType: 'daily',
                notes: createInvoiceDto.notes || 'أجر يومي',
                invoiceId: invoice.id
              }
            });
          }
          // Handle employee withdrawals
          else if (createInvoiceDto.invoiceType === 'expense' && 
              createInvoiceDto.employeeInvoiceType === 'withdrawal') {
            await prisma.employeeWithdrawal.create({
              data: {
                employeeId: createInvoiceDto.relatedEmployeeId,
                amount: createInvoiceDto.totalAmount,
                withdrawalType: 'salary_advance',
                notes: createInvoiceDto.notes || 'سحب راتب',
                invoiceId: invoice.id
              }
            });
          } 
          // Handle employee debt
          else if (createInvoiceDto.invoiceType === 'expense' && 
                   createInvoiceDto.employeeInvoiceType === 'debtPayment') {
            // Check for existing active debt
            const existingDebt = await prisma.employeeDebt.findFirst({
              where: {
                employeeId: createInvoiceDto.relatedEmployeeId,
                status: 'active'
              }
            });
            
            if (existingDebt) {
              // Update existing debt
              const updatedDebt = await prisma.employeeDebt.update({
                where: { id: existingDebt.id },
                data: {
                  totalAmount: existingDebt.totalAmount + createInvoiceDto.totalAmount,
                  remainingAmount: existingDebt.remainingAmount + createInvoiceDto.totalAmount,
                  notes: createInvoiceDto.notes || 'تم إضافة دين جديد'
                }
              });
              
              // Link invoice to debt
              await prisma.invoice.update({
                where: { id: invoice.id },
                data: { relatedEmployeeDebtId: updatedDebt.id }
              });
            } else {
              // Create new debt
              const newDebt = await prisma.employeeDebt.create({
                data: {
                  employeeId: createInvoiceDto.relatedEmployeeId,
                  totalAmount: createInvoiceDto.totalAmount,
                  remainingAmount: createInvoiceDto.totalAmount,
                  status: 'active',
                  notes: createInvoiceDto.notes || 'دين جديد'
                }
              });
              
              // Link invoice to debt
              await prisma.invoice.update({
                where: { id: invoice.id },
                data: { relatedEmployeeDebtId: newDebt.id }
              });
            }
          }
          // Handle return of withdrawal
          else if (createInvoiceDto.invoiceType === 'income' && 
                   createInvoiceDto.employeeInvoiceType === 'return') {
            // Record negative withdrawal (return)
            await prisma.employeeWithdrawal.create({
              data: {
                employeeId: createInvoiceDto.relatedEmployeeId,
                amount: -createInvoiceDto.totalAmount, // Negative amount to indicate return
                withdrawalType: 'return',
                notes: createInvoiceDto.notes || 'إرجاع سحب',
                invoiceId: invoice.id
              }
            });
          }
          // Handle debt payment
          else if (createInvoiceDto.invoiceType === 'income' && 
                   createInvoiceDto.employeeInvoiceType === 'debtPayment') {
            // Find active debt
            const activeDebt = await prisma.employeeDebt.findFirst({
              where: {
                employeeId: createInvoiceDto.relatedEmployeeId,
                status: 'active'
              }
            });
            
            if (!activeDebt) {
              throw new BadRequestException('لا يوجد ديون نشطة لهذا الموظف');
            }
            
            // Verify payment amount
            if (createInvoiceDto.totalAmount > activeDebt.remainingAmount) {
              throw new BadRequestException('مبلغ الدفعة يتجاوز المبلغ المتبقي من الدين');
            }
            
            // Update debt
            const newRemainingAmount = activeDebt.remainingAmount - createInvoiceDto.totalAmount;
            await prisma.employeeDebt.update({
              where: { id: activeDebt.id },
              data: {
                remainingAmount: newRemainingAmount,
                lastPaymentDate: new Date(),
                status: newRemainingAmount <= 0 ? 'paid' : 'active',
                notes: newRemainingAmount <= 0 
                  ? `${activeDebt.notes || ''}\nتم سداد الدين بالكامل بتاريخ ${new Date().toLocaleDateString()}`
                  : activeDebt.notes
              }
            });
            
            // Link invoice to debt
            await prisma.invoice.update({
              where: { id: invoice.id },
              data: { relatedEmployeeDebtId: activeDebt.id }
            });
          }
        }
        
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

        
        // معالجة رصيد المورد للفواتير المتعلقة بالموردين
        if (createInvoiceDto.customerId && 
            createInvoiceDto.invoiceType === 'expense' && 
            createInvoiceDto.invoiceCategory === 'products' &&
            createInvoiceDto.supplierPaymentAmount !== undefined) {
          
          // جلب بيانات العميل للتحقق من نوعه
          const customer = await prisma.customer.findUnique({
            where: { id: createInvoiceDto.customerId }
          });

                       
          if (customer && customer.customerType === CustomerType.SUPPLIER) {

            // حساب المبلغ المتبقي الذي سيضاف لرصيد المورد
            const remainingAmount = totalAmountAfterChange - createInvoiceDto.supplierPaymentAmount;
            
            if (remainingAmount > 0) {
              // تحديث رصيد المورد
              await prisma.customer.update({
                where: { id: createInvoiceDto.customerId },
                data: {
                  supplierBalance: {
                    increment: remainingAmount
                  }
                }
              });
            }
            
            // تحديث رصيد الصندوق بالمبلغ المدفوع فقط (إذا كانت الفاتورة مدفوعة)
            if (createInvoiceDto.paidStatus && createInvoiceDto.supplierPaymentAmount > 0) {
              await prisma.fund.update({
                where: { id: createInvoiceDto.fundId },
                data: {
                  currentBalance: {
                    decrement: createInvoiceDto.supplierPaymentAmount,
                  },
                },
              });
            }

            
          }
        } 
        // المعالجة العادية لرصيد الصندوق للفواتير الأخرى
        else if (createInvoiceDto.paidStatus && createInvoiceDto.totalAmount) {
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


  private async updateInventoryAndPrices(invoiceItems: any[], employeeId: number, invoiceId: number, invoiceNumber: string) {
  for (const invoiceItem of invoiceItems) {
    // التحقق من أن المادة من النوع الخام
    const item = await this.prisma.item.findUnique({
      where: { id: invoiceItem.itemId }
    });
    
    if (item && item.type === 'raw') {
      // 1. تحديث سعر المنتج في جدول Items بآخر سعر من الفاتورة
      await this.prisma.item.update({
        where: { id: invoiceItem.itemId },
        data: {
          price: invoiceItem.unitPrice, // تحديث السعر بآخر سعر من الفاتورة
        }
      });

      // 2. تحديث أو إنشاء سجل المخزون
      await this.prisma.inventoryItem.upsert({
        where: { itemId: invoiceItem.itemId },
        update: {
          currentStock: {
            increment: invoiceItem.quantity
          },
          lastUpdated: new Date()
        },
        create: {
          itemId: invoiceItem.itemId,
          currentStock: invoiceItem.quantity,
          lastUpdated: new Date()
        }
      });

    
    }
  }
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
          notes: originalInvoice.notes ,
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

  // التحقق من صحة بيانات العناصر إذا تم إرسالها
  if (updateInvoiceDto.items && Array.isArray(updateInvoiceDto.items)) {
    for (let i = 0; i < updateInvoiceDto.items.length; i++) {
      const item = updateInvoiceDto.items[i];
      
      // التأكد من وجود الحقول المطلوبة
      if (!item.itemId || !item.quantity || !item.unitPrice) {
        throw new BadRequestException(`العنصر ${i + 1}: يجب توفير itemId و quantity و unitPrice`);
      }
      
      // التأكد من أن unit موجود وهو string
      if (!item.unit || typeof item.unit !== 'string' || item.unit.trim() === '') {
        updateInvoiceDto.items[i].unit = 'قطعة'; // قيمة افتراضية
      }
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
    // معالجة تحديث عدد الصواني
    if ('trayCount' in updateInvoiceDto) {
      const newTrayCount = updateInvoiceDto.trayCount || 0;
      const currentTrayCount = existingInvoice.trayCount || 0;

      if (currentTrayCount === 0 && newTrayCount > 0) {
        // إضافة تتبع صواني جديد
        await prisma.trayTracking.create({
          data: {
            customerId: existingInvoice.customerId,
            totalTrays: newTrayCount,
            status: 'pending',
            invoiceId: invoiceId,
          },
        });
      } else if (currentTrayCount > 0 && newTrayCount > 0) {
        // تحديث عدد الصواني الموجودة
        await prisma.trayTracking.updateMany({
          where: { invoiceId: invoiceId },
          data: { totalTrays: newTrayCount },
        });
      } else if (currentTrayCount > 0 && newTrayCount === 0) {
        // حذف تتبع الصواني
        await prisma.trayTracking.deleteMany({ 
          where: { invoiceId: invoiceId } 
        });
      }
    }

    // حساب المجموع الجديد
    let itemsTotal = 0;
    
    if (updateInvoiceDto.items && updateInvoiceDto.items.length > 0) {
      // استخدام العناصر المحدثة
      itemsTotal = updateInvoiceDto.items.reduce((sum, item) => {
        return sum + (item.quantity * item.unitPrice);
      }, 0);
    } else {
      // استخدام العناصر الحالية إذا لم يتم تحديثها
      itemsTotal = existingInvoice.items.reduce((sum, item) => {
        return sum + (item.quantity * item.unitPrice);
      }, 0);
    }
    
    // حساب المبلغ الإضافي
    const additionalAmount = updateInvoiceDto.additionalAmount !== undefined 
      ? updateInvoiceDto.additionalAmount 
      : existingInvoice.additionalAmount || 0;
    
    // حساب الخصم
    const discount = updateInvoiceDto.discount !== undefined 
      ? updateInvoiceDto.discount 
      : existingInvoice.discount || 0;
    
    // حساب المجموع النهائي
    const newTotalAmount = itemsTotal + additionalAmount - discount;
    
    // تحضير بيانات التحديث
    const updateData: any = {
      customerId: updateInvoiceDto.customerId !== undefined 
        ? updateInvoiceDto.customerId 
        : existingInvoice.customerId,
      discount: discount,
      additionalAmount: additionalAmount,
      trayCount: updateInvoiceDto.trayCount !== undefined 
        ? updateInvoiceDto.trayCount 
        : existingInvoice.trayCount,
      totalAmount: newTotalAmount,
    };

    // إضافة تحديث العناصر إذا تم إرسالها
    if (updateInvoiceDto.items && Array.isArray(updateInvoiceDto.items)) {
      updateData.items = {
        deleteMany: { invoiceId: invoiceId }, // حذف العناصر القديمة
        create: updateInvoiceDto.items.map((item) => ({
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          unit: item.unit || 'قطعة', // التأكد من وجود unit
          subTotal: item.quantity * item.unitPrice,
          itemId: item.itemId,
        })),
      };
    }
    
    // تحديث الفاتورة
    const updatedInvoice = await prisma.invoice.update({
      where: { id: invoiceId },
      data: updateData,
      include: {
        items: true,
        trayTracking: true,
      },
    });

    // تحديث رصيد الصندوق إذا كانت الفاتورة مدفوعة
    if (existingInvoice.paidStatus) {
      // حساب الفرق في المبلغ
      const oldAmount = existingInvoice.totalAmount - (existingInvoice.discount || 0);
      const newAmount = newTotalAmount - discount;
      const amountDifference = newAmount - oldAmount;
      
      if (amountDifference !== 0) {
        await prisma.fund.update({
          where: { id: existingInvoice.fundId },
          data: {
            currentBalance: {
              [existingInvoice.invoiceType === 'income' ? 'increment' : 'decrement']:
                amountDifference,
            },
          },
        });
      }
    }

    console.log('Updated invoice:', updatedInvoice);
    console.log('==============================');
    
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
          relatedAdvance: true, // لجلب السلف المرتبطة
          salaryPayments: true ,
          employeeWithdrawals: true,
          relatedEmployeeDebt: true ,
          expenseTransfer: true ,
          incomeTransfer: true ,
          relatedEmployee: true ,
          workshopSettlement: true
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
    
      if(invoice.salaryPayments) {
         await prisma.employeeSalaryPayment.deleteMany({
          where: { invoiceId },
        });
      }

      if(invoice.employeeWithdrawals) {
         await prisma.employeeWithdrawal.deleteMany({
          where: { invoiceId },
        });
      }

      if (invoice.relatedEmployeeDebt) {
        const debt = await prisma.employeeDebt.findUnique({
          where: { id: invoice.relatedEmployeeDebt.id },
        });
  
        if (debt) {
          // تقليل المبلغ المتبقي في الدين أو تغييره إلى "نشط"
          const newRemainingAmount = debt.remainingAmount - invoice.totalAmount;
          const totalAmount = debt.totalAmount - invoice.totalAmount;

          await prisma.employeeDebt.update({
            where: { id: debt.id },
            data: {
              remainingAmount: newRemainingAmount,
              totalAmount: totalAmount ,
              status: newRemainingAmount > 0 ? 'active' : 'paid',
              notes: `تم تحديث الدين بعد حذف الفاتورة رقم ${invoice.invoiceNumber}`,
            },
          });
        }
      }

      if(invoice.workshopSettlement) {
         await prisma.workshopSettlement.deleteMany({
          where: { invoiceId },
        });
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
        relatedEmployee: true,
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


async getInventoryItems() {
  const inventoryItems = await this.prisma.inventoryItem.findMany({
    where: {
      currentStock: {
        gt: 0
      }
    },
    include: {
      item: true
    },
    orderBy: {
      item: {
        name: 'asc'
      }
    }
  });

  // حساب متوسط سعر الشراء لكل مادة
  const itemsWithAveragePrice = await Promise.all(
    inventoryItems.map(async (inventoryItem) => {
      const movements = await this.prisma.inventoryStockMovement.findMany({
        where: {
          itemId: inventoryItem.itemId,
          movementType: 'purchase',
          unitPrice: { not: null }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });

      let averagePrice = 0;
      if (movements.length > 0) {
        const totalCost = movements.reduce((sum, movement) => sum + (movement.totalCost || 0), 0);
        const totalQuantity = movements.reduce((sum, movement) => sum + movement.quantity, 0);
        averagePrice = totalQuantity > 0 ? totalCost / totalQuantity : 0;
      }

      return {
        ...inventoryItem,
        averageUnitPrice: averagePrice,
        totalValue: inventoryItem.currentStock * averagePrice
      };
    })
  );

  return itemsWithAveragePrice;
}

// 2. تابع إجراء الجرد المبسط
async performInventoryAudit(auditData: { itemId: number; countedStock: number }[], employeeId: number) {
  return this.prisma.$transaction(async (prisma) => {
    let totalValueDifference = 0;
    let totalItemsProcessed = 0;
    const processedItems = [];

    // معالجة كل مادة في الجرد
    for (const auditItemData of auditData) {
      // جلب المادة من المخزون
      const inventoryItem = await prisma.inventoryItem.findUnique({
        where: { itemId: auditItemData.itemId },
        include: { item: true }
      });

      if (!inventoryItem) {
        throw new BadRequestException(`المادة رقم ${auditItemData.itemId} غير موجودة في المخزون`);
      }

      // حساب متوسط سعر الشراء
      const movements = await prisma.inventoryStockMovement.findMany({
        where: {
          itemId: auditItemData.itemId,
          movementType: 'purchase',
          unitPrice: { not: null }
        }
      });

      let averagePrice = 0;
      if (movements.length > 0) {
        const totalCost = movements.reduce((sum, movement) => sum + (movement.totalCost || 0), 0);
        const totalQuantity = movements.reduce((sum, movement) => sum + movement.quantity, 0);
        averagePrice = totalQuantity > 0 ? totalCost / totalQuantity : 0;
      }

      const previousStock = inventoryItem.currentStock;
      const difference = auditItemData.countedStock - previousStock;
      const totalValue = difference * averagePrice;

      // تجميع المعلومات للتقرير
      processedItems.push({
        itemName: inventoryItem.item.name,
        itemUnit: inventoryItem.item.units,
        previousStock,
        countedStock: auditItemData.countedStock,
        difference,
        unitPrice: averagePrice,
        totalValue
      });

      totalValueDifference += totalValue;
      totalItemsProcessed++;

      // تحديث المخزون
      await prisma.inventoryItem.update({
        where: { itemId: auditItemData.itemId },
        data: {
          currentStock: auditItemData.countedStock,
          lastUpdated: new Date()
        }
      });

      // تسجيل حركة المخزون للجرد (إذا كان هناك فرق)
      if (difference !== 0) {
        await prisma.inventoryStockMovement.create({
          data: {
            itemId: auditItemData.itemId,
            movementType: 'inventory',
            quantity: difference,
            unitPrice: averagePrice,
            totalCost: totalValue,
            notes: difference > 0 
              ? `زيادة في الجرد: ${Math.abs(difference)} ${inventoryItem.item.units}`
              : `نقص في الجرد: ${Math.abs(difference)} ${inventoryItem.item.units}`,
            employeeId
          }
        });
      }
    }

    // إنشاء سجل الجرد العام (بدون تفاصيل المنتجات)
    const audit = await prisma.inventoryAudit.create({
      data: {
        employeeId,
        totalItemsCount: totalItemsProcessed,
        totalValueDifference,
        notes: `جرد مخزون بتاريخ ${new Date().toLocaleDateString('ar-EG')} - تم جرد ${totalItemsProcessed} مادة`
      }
    });

    return {
      audit,
      processedItems, // تفاصيل المعالجة للعرض في الواجهة
      summary: {
        totalItems: totalItemsProcessed,
        totalValueDifference,
        itemsWithIncrease: processedItems.filter(item => item.difference > 0).length,
        itemsWithDecrease: processedItems.filter(item => item.difference < 0).length,
        itemsUnchanged: processedItems.filter(item => item.difference === 0).length
      }
    };
  });
}

// 3. تابع لجلب تاريخ الجرد (مبسط)
async getInventoryAuditHistory(limit = 10) {
  return this.prisma.inventoryAudit.findMany({
    include: {
      employee: {
        select: { name: true }
      }
    },
    orderBy: {
      auditDate: 'desc'
    },
    take: limit
  });
}

// 4. تابع لجلب تفاصيل جرد محدد (مبسط)
async getInventoryAuditDetails(auditId: number) {
  const audit = await this.prisma.inventoryAudit.findUnique({
    where: { id: auditId },
    include: {
      employee: {
        select: { name: true }
      }
    }
  });

  if (!audit) {
    throw new NotFoundException('سجل الجرد غير موجود');
  }

  // جلب حركات المخزون المرتبطة بتاريخ الجرد (تقريبياً)
  const auditMovements = await this.prisma.inventoryStockMovement.findMany({
    where: {
      movementType: 'inventory',
      employeeId: audit.employeeId,
      createdAt: {
        gte: new Date(audit.auditDate.getTime() - 5 * 60 * 1000), // قبل 5 دقائق
        lte: new Date(audit.auditDate.getTime() + 5 * 60 * 1000)  // بعد 5 دقائق
      }
    },
    include: {
      item: true
    },
    orderBy: {
      item: { name: 'asc' }
    }
  });

  return {
    ...audit,
    movements: auditMovements // حركات المخزون التي حدثت أثناء الجرد
  };
}

// 5. تابع لجلب حركات المخزون لمادة محددة (نفس الشيء)
async getItemStockMovements(itemId: number, limit = 50) {
  return this.prisma.inventoryStockMovement.findMany({
    where: { itemId },
    include: {
      employee: {
        select: { name: true }
      },
      item: true,
      invoice: {
        select: {
          invoiceNumber: true,
          invoiceType: true
        }
      }
    },
    orderBy: {
      createdAt: 'desc'
    },
    take: limit
  });
}

// 6. تابع لجلب تقرير المخزون الحالي (نفس الشيء)
async getInventoryReport() {
  const inventoryItems = await this.getInventoryItems();
  
  const totalValue = inventoryItems.reduce((sum, item) => sum + item.totalValue, 0);
  const totalItems = inventoryItems.length;
  
  // المواد التي تحتاج إعادة تموين (أقل من حد معين)
  const lowStockItems = inventoryItems.filter(item => item.currentStock < 10);
  
  return {
    items: inventoryItems,
    summary: {
      totalItems,
      totalValue,
      lowStockItemsCount: lowStockItems.length,
      lowStockItems: lowStockItems.map(item => ({
        name: item.item.name,
        currentStock: item.currentStock,
        unit: item.item.units
      }))
    }
  };
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
        notes: notes ,
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
        notes: notes,
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
        notes: notes,
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
        notes: notes,
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
        notes: notes || null,
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
        },
      });

      await prisma.invoice.update({
        where: { id: incomeInvoice.id },
        data: {
          paidStatus: true,
          paymentDate: new Date(),
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
        notes: originalInvoice.notes || null,
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
        notes: originalInvoice.notes || null,
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
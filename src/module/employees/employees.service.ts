import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateEmployeeHoursDto } from './dto/employee-hours.dto';
import { CreateEmployeeProductionDto } from './dto/employee-production.dto';
import { CreateEmployeeWithdrawalDto } from './dto/create-employee-withdrawal.dto';
import { CreateEmployeePaymentDto } from './dto/create-employee-payment.dto';



@Injectable()
export class EmployeesService {
  constructor(private prisma: PrismaService) {}
  
  // إضافة موظف جديد
  async create(createEmployeeDto: CreateEmployeeDto) {
    try {
      return await this.prisma.employee.create({
        data: {
          name: createEmployeeDto.name,
          phone: createEmployeeDto.phone,
          workType: createEmployeeDto.workType,
          workshopId: createEmployeeDto.workshopId
        }
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new BadRequestException('رقم الهاتف مستخدم بالفعل');
      }
      throw error;
    }
  }
  
  // جلب جميع الموظفين
  async findAll() {
    return this.prisma.employee.findMany({
      include: {
        workshop: true,
        withdrawals: {
          orderBy: {
            date: 'desc'
          }
        },
        debts: {
          where: {
            status: 'active'
          }
        }
      }
    });
  }
  
  // جلب موظف محدد
  async findOne(id: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        workshop: true, // الآن يتضمن lastSettlementDate
        withdrawals: {
          orderBy: {
            date: 'desc'
          }
        },
        debts: {
          include: {
            relatedInvoices: true
          }
        },
        productionRecords: {
          include: {
            item: true
          },
          orderBy: {
            date: 'desc'
          }
        },
        hourRecords: {
          orderBy: {
            date: 'desc'
          }
        },
        salaryPayments: {
          include: {
            invoice: true
          },
          orderBy: {
            date: 'desc'
          }
        }
      }
    });
    
    if (!employee) {
      throw new NotFoundException(`الموظف رقم ${id} غير موجود`);
    }
    
    const lastSettlementDate = employee.workshop?.lastSettlementDate || null;
    
    // حساب الإحصائيات المالية للموظف منذ آخر محاسبة
    const totalWithdrawals = employee.withdrawals
      .filter(w => !lastSettlementDate || w.date > lastSettlementDate)
      .reduce((sum, withdrawal) => sum + withdrawal.amount, 0);
    
    // حساب إجمالي الرواتب المدفوعة منذ آخر محاسبة
    const totalSalaries = employee.salaryPayments
      .filter(s => !lastSettlementDate || s.date > lastSettlementDate)
      .reduce((sum, payment) => sum + payment.amount, 0);
    
    let totalEarnings = 0;
    if (employee.workType === 'production') {
      totalEarnings = employee.productionRecords
        .filter(r => !lastSettlementDate || r.date > lastSettlementDate)
        .reduce((sum, record) => sum + record.totalAmount, 0);
    } else {
      totalEarnings = employee.hourRecords
        .filter(r => !lastSettlementDate || r.date > lastSettlementDate)
        .reduce((sum, record) => sum + record.totalAmount, 0);
    }
    
    const activeDebt = employee.debts.find(debt => debt.status === 'active');
    const debtAmount = activeDebt ? activeDebt.remainingAmount : 0;
    
    const netAmount = totalEarnings - totalWithdrawals ;
    
    // تجميع الرواتب حسب النوع منذ آخر محاسبة
    const salariesByType = {
      daily: employee.salaryPayments
        .filter(p => p.paymentType === 'daily' && (!lastSettlementDate || p.date > lastSettlementDate))
        .reduce((sum, p) => sum + p.amount, 0),
      weekly: employee.salaryPayments
        .filter(p => p.paymentType === 'weekly' && (!lastSettlementDate || p.date > lastSettlementDate))
        .reduce((sum, p) => sum + p.amount, 0),
      monthly: employee.salaryPayments
        .filter(p => p.paymentType === 'monthly' && (!lastSettlementDate || p.date > lastSettlementDate))
        .reduce((sum, p) => sum + p.amount, 0),
      workshop: employee.salaryPayments
        .filter(p => p.paymentType === 'workshop' && (!lastSettlementDate || p.date > lastSettlementDate))
        .reduce((sum, p) => sum + p.amount, 0),
    };
    
    return {
      ...employee,
      financialSummary: {
        totalWithdrawals,
        totalEarnings,
        totalSalaries,
        salariesByType,
        debtAmount,
        netAmount,
        lastWorkshopSettlement: lastSettlementDate,
        periodStart: lastSettlementDate || 'منذ البداية',
        lastPaymentDate: employee.salaryPayments.length > 0 
          ? employee.salaryPayments[0].date 
          : null,
        paymentsCount: employee.salaryPayments.length
      }
    };
  }
  
  // تحديث بيانات موظف
  async update(id: number, updateEmployeeDto: UpdateEmployeeDto) {
    const existingEmployee = await this.prisma.employee.findUnique({
      where: { id }
    });
    
    if (!existingEmployee) {
      throw new NotFoundException(`الموظف رقم ${id} غير موجود`);
    }
    
    try {
      return await this.prisma.employee.update({
        where: { id },
        data: updateEmployeeDto,
        include: {
          workshop: true
        }
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new BadRequestException('رقم الهاتف مستخدم بالفعل');
      }
      throw error;
    }
  }
  
  // حذف موظف
  async remove(id: number) {
    const existingEmployee = await this.prisma.employee.findUnique({
      where: { id },
      include: {
        withdrawals: true,
        productionRecords: true,
        hourRecords: true,
        debts: true
      }
    });
    
    if (!existingEmployee) {
      throw new NotFoundException(`الموظف رقم ${id} غير موجود`);
    }
    
    if (existingEmployee.withdrawals.length > 0 || 
        existingEmployee.productionRecords.length > 0 || 
        existingEmployee.hourRecords.length > 0 || 
        existingEmployee.debts.length > 0) {
      throw new BadRequestException('لا يمكن حذف موظف له سجلات مالية أو إنتاجية');
    }
    
    return this.prisma.employee.delete({
      where: { id }
    });
  }
  
  // إضافة سحب للموظف
  async addWithdrawal(employeeId: number, withdrawalDto: CreateEmployeeWithdrawalDto, currentUserId: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId }
    });
    
    if (!employee) {
      throw new NotFoundException(`الموظف رقم ${employeeId} غير موجود`);
    }
    
    const activeShift = await this.prisma.shift.findFirst({
      where: {
        status: 'open',
      },
    });
  
    if (!activeShift) {
      throw new BadRequestException('لا يوجد واردية مفتوحة');
    }
    
    const fund = await this.prisma.fund.findUnique({
      where: { id: withdrawalDto.fundId },
    });
  
    if (!fund) {
      throw new BadRequestException('الصندوق غير موجود');
    }
    
    return this.prisma.$transaction(async (prisma) => {
      // إنشاء فاتورة خروج للسحب
      const invoiceNumber = `EMP-WTH-${Date.now()}`;
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          invoiceType: 'expense',
          invoiceCategory: 'employee',
          employeeInvoiceType: withdrawalDto.withdrawalType,
          paidStatus: true,
          totalAmount: withdrawalDto.amount,
          notes: withdrawalDto.notes || `سحب للموظف ${employee.name}`,
          fundId: withdrawalDto.fundId,
          shiftId: activeShift.id,
          employeeId: currentUserId,
          paymentDate: new Date(),
          relatedEmployeeId: employeeId,
          isBreak: false,
        }
      });
      
      
      
      // تحديث رصيد الصندوق
      await prisma.fund.update({
        where: { id: withdrawalDto.fundId },
        data: {
          currentBalance: {
            decrement: withdrawalDto.amount
          }
        }
      });
      
      // إذا كان نوع السحب هو "دين"، نقوم بإنشاء سجل دين أو تحديثه
      if (withdrawalDto.withdrawalType === 'debt') {
        const existingDebt = await prisma.employeeDebt.findFirst({
          where: {
            employeeId,
            status: 'active'
          }
        });
        
        if (existingDebt) {
          const updatedDebt = await prisma.employeeDebt.update({
            where: { id: existingDebt.id },
            data: {
              totalAmount: existingDebt.totalAmount + withdrawalDto.amount,
              remainingAmount: existingDebt.remainingAmount + withdrawalDto.amount,
              notes: `${existingDebt.notes || ''} | تم إضافة دين جديد: ${withdrawalDto.amount}`
            }
          });
          
          // ربط الفاتورة بالدين
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              relatedEmployeeDebtId: updatedDebt.id
            }
          });
        } else {
          const newDebt = await prisma.employeeDebt.create({
            data: {
              employeeId,
              totalAmount: withdrawalDto.amount,
              remainingAmount: withdrawalDto.amount,
              status: 'active',
              notes: withdrawalDto.notes || 'دين جديد'
            }
          });
          
          // ربط الفاتورة بالدين
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              relatedEmployeeDebtId: newDebt.id
            }
          });
        }
        return {
        success: true,
        invoice
      };

      }
      else {
        // إنشاء سجل السحب
      const withdrawal = await prisma.employeeWithdrawal.create({
        data: {
          employeeId,
          amount: withdrawalDto.amount,
          withdrawalType: withdrawalDto.withdrawalType,
          invoiceId: invoice.id,
          notes: withdrawalDto.notes
        }
      });

      return {
        success: true,
        withdrawal,
        invoice
      };
      
    }
      
      
    });
  }

  // إضافة إرجاع سحب أو تسديد دين للموظف
  async addPayment(employeeId: number, paymentDto: CreateEmployeePaymentDto, currentUserId: number) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId }
    });
    
    if (!employee) {
      throw new NotFoundException(`الموظف رقم ${employeeId} غير موجود`);
    }
    
    const activeShift = await this.prisma.shift.findFirst({
      where: {
        status: 'open',
      },
    });
  
    if (!activeShift) {
      throw new BadRequestException('لا يوجد واردية مفتوحة');
    }
    
    const fund = await this.prisma.fund.findUnique({
      where: { id: paymentDto.fundId },
    });
  
    if (!fund) {
      throw new BadRequestException('الصندوق غير موجود');
    }
    
    return this.prisma.$transaction(async (prisma) => {
      // إنشاء فاتورة دخول للتسديد
      const invoiceNumber = `EMP-PMT-${Date.now()}`;
      let invoiceType = '';
      
      if (paymentDto.paymentType === 'returnWithdrawal') {
        invoiceType = 'returnWithdrawal';
      } else if (paymentDto.paymentType === 'debtPayment') {
        invoiceType = 'debtPayment';
        
        // التحقق من وجود دين نشط للموظف
        const activeDebt = await prisma.employeeDebt.findFirst({
          where: {
            employeeId,
            status: 'active'
          }
        });
        
        if (!activeDebt) {
          throw new BadRequestException('لا يوجد دين نشط لهذا الموظف');
        }
        
        // التحقق من المبلغ
        if (paymentDto.amount > activeDebt.remainingAmount) {
          throw new BadRequestException(`المبلغ المدخل (${paymentDto.amount}) أكبر من المبلغ المتبقي من الدين (${activeDebt.remainingAmount})`);
        }
      }
      
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          invoiceType: 'income',
          invoiceCategory: 'employee',
          employeeInvoiceType: invoiceType,
          paidStatus: true,
          totalAmount: paymentDto.amount,
          notes: paymentDto.notes || `تسديد من الموظف ${employee.name}`,
          fundId: paymentDto.fundId,
          shiftId: activeShift.id,
          employeeId: currentUserId,
          paymentDate: new Date(),
          relatedEmployeeId: employeeId,
          isBreak: false,
        }
      });
      
      // تحديث رصيد الصندوق
      await prisma.fund.update({
        where: { id: paymentDto.fundId },
        data: {
          currentBalance: {
            increment: paymentDto.amount
          }
        }
      });
      
      // إذا كان نوع التسديد هو "تسديد دين"، نقوم بتحديث سجل الدين
      if (paymentDto.paymentType === 'debtPayment') {
        const activeDebt = await prisma.employeeDebt.findFirst({
          where: {
            employeeId,
            status: 'active'
          }
        });
        
        if (activeDebt) {
          const newRemainingAmount = activeDebt.remainingAmount - paymentDto.amount;
          const newStatus = newRemainingAmount <= 0 ? 'paid' : 'active';
          
          const updatedDebt = await prisma.employeeDebt.update({
            where: { id: activeDebt.id },
            data: {
              remainingAmount: newRemainingAmount,
              status: newStatus,
              lastPaymentDate: new Date(),
              notes: newStatus === 'paid' 
                ? `${activeDebt.notes || ''} | تم تسديد الدين بالكامل في ${new Date().toLocaleDateString()}`
                : `${activeDebt.notes || ''} | تم تسديد ${paymentDto.amount} في ${new Date().toLocaleDateString()}`
            }
          });
          
          // ربط الفاتورة بالدين
          await prisma.invoice.update({
            where: { id: invoice.id },
            data: {
              relatedEmployeeDebtId: updatedDebt.id
            }
          });
        }
      }
      
      return {
        success: true,
        invoice,
        paymentType: paymentDto.paymentType
      };
    });
  }

  // إضافة سجل إنتاج للموظف
  async addProduction(employeeId: number, productionDto: CreateEmployeeProductionDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId }
    });
    
    if (!employee) {
      throw new NotFoundException(`الموظف رقم ${employeeId} غير موجود`);
    }
    
    if (employee.workType !== 'production') {
      throw new BadRequestException('لا يمكن إضافة سجل إنتاج لموظف غير مسجل بنظام الإنتاجية');
    }
    
    const item = await this.prisma.item.findUnique({
      where: { id: productionDto.itemId }
    });
    
    if (!item) {
      throw new BadRequestException('المنتج غير موجود');
    }
    
    if (!item.productionRate) {
      throw new BadRequestException('المنتج لا يحتوي على سعر إنتاج محدد');
    }
    
    const totalAmount = productionDto.quantity * item.productionRate;
    
    return this.prisma.employeeProduction.create({
      data: {
        employeeId,
        itemId: productionDto.itemId,
        quantity: productionDto.quantity,
        productionRate: item.productionRate,
        totalAmount,
        date: productionDto.date || new Date(),
        notes: productionDto.notes
      },
      include: {
        item: true
      }
    });
  }
  
  // إضافة سجل ساعات للموظف
  async addHours(employeeId: number, hoursDto: CreateEmployeeHoursDto) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId }
    });
    
    if (!employee) {
      throw new NotFoundException(`الموظف رقم ${employeeId} غير موجود`);
    }
    
    if (employee.workType !== 'hourly') {
      throw new BadRequestException('لا يمكن إضافة سجل ساعات لموظف غير مسجل بنظام الساعات');
    }
    
    const totalAmount = hoursDto.hours * hoursDto.hourlyRate;
    
    return this.prisma.employeeHours.create({
      data: {
        employeeId,
        hours: hoursDto.hours,
        hourlyRate: hoursDto.hourlyRate,
        totalAmount,
        date: hoursDto.date || new Date(),
        notes: hoursDto.notes
      }
    });
  }
  
  // الحصول على ملخص مالي للموظف
  async getFinancialSummary(employeeId: number, startDate?: Date, endDate?: Date) {

    const id = await this.prisma.employee.findFirst({
       where: { id: employeeId },
       include: {
        workshop: true
       }
    });

    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        workshop: true,
        withdrawals: {
          where: {
            date: {
              gte: startDate || id.workshop.lastSettlementDate || new Date(0),
              lte: endDate || new Date()
            }
          }
        },
        debts: {
          where: {
            status: 'active'
          }
        },
        productionRecords: {
          where: {
            date: {
              gte: startDate || id.workshop?.lastSettlementDate || new Date(0),
              lte: endDate || new Date()
            }
          },
          include: {
            item: true
          }
        },
        hourRecords: {
          where: {
            date: {
              gte: startDate || id.workshop?.lastSettlementDate || new Date(0),
              lte: endDate || new Date()
            }
          }
        }
      }
    });
    
    if (!employee) {
      throw new NotFoundException(`الموظف رقم ${employeeId} غير موجود`);
    }
    
    // حساب الإحصائيات المالية للموظف
    const totalWithdrawals = employee.withdrawals.reduce((sum, withdrawal) => sum + withdrawal.amount, 0);
    
    let totalEarnings = 0;
    if (employee.workType === 'production') {
      totalEarnings = employee.productionRecords.reduce((sum, record) => sum + record.totalAmount, 0);
    } else {
      totalEarnings = employee.hourRecords.reduce((sum, record) => sum + record.totalAmount, 0);
    }
    
    const activeDebt = employee.debts.find(debt => debt.status === 'active');
    const debtAmount = activeDebt ? activeDebt.remainingAmount : 0;
    
    const netAmount = totalEarnings - totalWithdrawals - debtAmount;
    
    const periodStart = startDate || employee.workshop?.lastSettlementDate || 'منذ البداية';
    
    return {
      employeeId,
      employeeName: employee.name,
      workType: employee.workType,
      workshopName: employee.workshop?.name,
      lastWorkshopSettlement: employee.workshop?.lastSettlementDate,
      totalWithdrawals,
      totalEarnings,
      debtAmount,
      netAmount,
      period: {
        startDate: periodStart,
        endDate: endDate || 'حتى اليوم'
      }
    };
  }
}
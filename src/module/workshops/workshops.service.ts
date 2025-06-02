import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateWorkshopDto } from './dto/create-workshop.dto';
import { UpdateWorkshopDto } from './dto/update-workshop.dto';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateWorkshopProductionDto } from './dto/create-workshop-production.dto';
import { CreateWorkshopSettlementDto } from './dto/create-workshop-settlement.dto';
import { CreateWorkshopHoursDto } from './dto/create-workshop-hours.dto';

@Injectable()
export class WorkshopsService {
  constructor(private prisma: PrismaService) {}
  
  // إنشاء ورشة جديدة
  async create(createWorkshopDto: CreateWorkshopDto) {
    try {
      return await this.prisma.workshop.create({
        data: {
          name: createWorkshopDto.name,
          workType: createWorkshopDto.workType,
          password: createWorkshopDto.password
        }
      });
    } catch (error) {
      throw new BadRequestException('حدث خطأ أثناء إنشاء الورشة');
    }
  }

async findAll() {
  const workshops = await this.prisma.workshop.findMany({
    include: {
      employees: {
        include: {
          withdrawals: {
            where: {
              withdrawalType: "salary_advance"
            }, 
            orderBy: {
              date: 'desc'
            }
          },
          debts: {
            where: {
              status: 'active'
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
      },
      productionRecords: {
        orderBy: {
          date: 'desc'
        },
        take: 5
      },
      settlements: {
        orderBy: {
          date: 'desc'
        },
        take: 5
      }
    }
  });
  
  const workshopsWithSummary = await Promise.all(
    workshops.map(async (workshop) => {
      const summary = await this.getWorkshopSummary(workshop.id);
      
      // حساب التفاصيل المالية لكل موظف
      const employeesWithFinancials = workshop.employees.map(employee => {
        const lastSettlementDate = workshop.lastSettlementDate || null;
        
        // حساب إجمالي السحوبات منذ آخر محاسبة
        const totalWithdrawals = employee.withdrawals
          .filter(w => !lastSettlementDate || w.date > lastSettlementDate)
          .reduce((sum, withdrawal) => sum + withdrawal.amount, 0);
        
        // حساب إجمالي الرواتب المدفوعة منذ آخر محاسبة
        const totalSalaries = employee.salaryPayments
          .filter(s => !lastSettlementDate || s.date > lastSettlementDate)
          .reduce((sum, payment) => sum + payment.amount, 0);
        
        
        // حساب الديون النشطة
        const activeDebt = employee.debts.find(debt => debt.status === 'active');
        const debtAmount = activeDebt ? activeDebt.remainingAmount : 0;
        
      
        
        return {
          ...employee,
          financialSummary: {
            totalWithdrawals,
            totalSalaries,
            debtAmount,
            lastWorkshopSettlement: lastSettlementDate,
            periodStart: lastSettlementDate || 'منذ البداية',
            lastPaymentDate: employee.salaryPayments.length > 0 
              ? employee.salaryPayments[0].date 
              : null,
            paymentsCount: employee.salaryPayments.length,
            // إضافة تفاصيل إضافية
            withdrawalsCount: employee.withdrawals.length,
            hasActiveDebt: debtAmount > 0
          }
        };
      });
      
      return {
        ...workshop,
        employees: employeesWithFinancials,
        financialSummary: summary
      };
    })
  );
  
  return workshopsWithSummary;
}
  
  // جلب ورشة محددة
  async findOne(id: number) {
    const workshop = await this.prisma.workshop.findUnique({
      where: { id },
      include: {
        employees: {
          include: {
            withdrawals: {
              where: {
                withdrawalType: "salary_advance"
              }, 
              orderBy: {
                date: 'desc'
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
            debts: {
              where: {
                status: 'active'
              }
            }
          }
        },
        productionRecords: {
          orderBy: {
            date: 'desc'
          }
        },
        settlements: {
          include: {
            fund: true,
            invoice: true
          },
          orderBy: {
            date: 'desc'
          }
        }
      }
    });
    
    if (!workshop) {
      throw new NotFoundException(`الورشة رقم ${id} غير موجودة`);
    }
    
    const summary = await this.getWorkshopSummary(id);
    

    return {
      ...workshop,
      financialSummary: summary
    };
  }
  
  // تحديث بيانات ورشة
  async update(id: number, updateWorkshopDto: UpdateWorkshopDto) {
    const existingWorkshop = await this.prisma.workshop.findUnique({
      where: { id }
    });
    
    if (!existingWorkshop) {
      throw new NotFoundException(`الورشة رقم ${id} غير موجودة`);
    }
    
    return this.prisma.workshop.update({
      where: { id },
      data: updateWorkshopDto
    });
  }
  
  // حذف ورشة
  async remove(id: number) {
    const existingWorkshop = await this.prisma.workshop.findUnique({
      where: { id },
      include: {
        employees: true,
        productionRecords: true,
        settlements: true
      }
    });
    
    if (!existingWorkshop) {
      throw new NotFoundException(`الورشة رقم ${id} غير موجودة`);
    }
    
    if (existingWorkshop.employees.length > 0) {
      throw new BadRequestException('لا يمكن حذف ورشة تحتوي على موظفين');
    }
    
    if (existingWorkshop.productionRecords.length > 0 || existingWorkshop.settlements.length > 0) {
      throw new BadRequestException('لا يمكن حذف ورشة لها سجلات إنتاج أو محاسبة');
    }
    
    return this.prisma.workshop.delete({
      where: { id }
    });
  }
  
  // التحقق من كلمة مرور الورشة
  async verifyWorkshopPassword(id: number, password: string) {
    const workshop = await this.prisma.workshop.findUnique({
      where: { id }
    });
    
    if (!workshop) {
      throw new NotFoundException(`الورشة رقم ${id} غير موجودة`);
    }
    
    const isPasswordValid = workshop.password === password;
    
    if (!isPasswordValid) {
      throw new BadRequestException('كلمة المرور غير صحيحة');
    }
    
    return { success: true, workshopId: id };
  }
  
  // إضافة سجل إنتاج للورشة
  async addProductionRecord(id: number, productionDto: CreateWorkshopProductionDto) {
    const workshop = await this.prisma.workshop.findUnique({
      where: { id }
    });
    
    if (!workshop) {
      throw new NotFoundException(`الورشة رقم ${id} غير موجودة`);
    }
    
    if (workshop.workType !== 'production') {
      throw new BadRequestException('لا يمكن إضافة سجل إنتاج لورشة غير مسجلة بنظام الإنتاجية');
    }
    
    let totalProduction = 0;
    const productionItems = [];
    
    for (const item of productionDto.items) {
      const productItem = await this.prisma.item.findUnique({
        where: { id: item.itemId }
      });
      
      if (!productItem) {
        throw new BadRequestException(`المنتج رقم ${item.itemId} غير موجود`);
      }
      
      if (!productItem.productionRate) {
        throw new BadRequestException(`المنتج ${productItem.name} لا يحتوي على سعر إنتاج محدد`);
      }
      
      const itemTotal = item.quantity * productItem.productionRate;
      totalProduction += itemTotal;
      
      productionItems.push({
        itemId: item.itemId,
        itemName: productItem.name,
        quantity: item.quantity,
        rate: productItem.productionRate,
        total: itemTotal
      });
    }
    
    return this.prisma.workshopProduction.create({
      data: {
        workshopId: id,
        date: productionDto.date || new Date(),
        totalProduction,
        items: productionItems,
        notes: productionDto.notes
      }
    });
  }
  
  // إضافة سجل ساعات لورشة ساعات
  async addHoursRecord(id: number, hoursDto: CreateWorkshopHoursDto) {
    const workshop = await this.prisma.workshop.findUnique({
      where: { id },
      include: {
        employees: true
      }
    });
    
    if (!workshop) {
      throw new NotFoundException(`الورشة رقم ${id} غير موجودة`);
    }
    
    if (workshop.workType !== 'hourly') {
      throw new BadRequestException('لا يمكن إضافة سجل ساعات لورشة غير مسجلة بنظام الساعات');
    }
    
    const employee = workshop.employees.find(emp => emp.id === hoursDto.employeeId);
    
    if (!employee) {
      throw new BadRequestException('الموظف غير منضم لهذه الورشة');
    }
    
    const totalAmount = hoursDto.hours * hoursDto.hourlyRate;
    
    return this.prisma.employeeHours.create({
      data: {
        employeeId: hoursDto.employeeId,
        hours: hoursDto.hours,
        hourlyRate: hoursDto.hourlyRate,
        totalAmount,
        date: hoursDto.date || new Date(),
        notes: hoursDto.notes
      },
      include: {
        employee: true
      }
    });
  }

  // محاسبة الورشة مع تصفير السجلات
  async settleWorkshop(
    id: number, 
    settlementDto: CreateWorkshopSettlementDto, 
    currentUserId: number
  ) {
    const workshop = await this.prisma.workshop.findUnique({
      where: { id },
      include: {
        employees: true
      }
    });
    
    if (!workshop) {
      throw new NotFoundException(`الورشة رقم ${id} غير موجودة`);
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
      where: { id: settlementDto.fundId },
    });

    if (!fund) {
      throw new BadRequestException('الصندوق غير موجود');
    }
    
    // حساب الملخص المالي الحالي للورشة (بدون فلترة تاريخ)
    const summary = await this.getWorkshopSummary(id);
    
    const amountToPay = settlementDto.amount;
    
    if (amountToPay <= 0) {
      throw new BadRequestException('المبلغ المدفوع يجب أن يكون أكبر من صفر');
    }
    
    // التحقق من التوزيع اليدوي إذا كان مطلوباً
    if (settlementDto.distributionType === 'manual') {
      if (!settlementDto.manualDistributions || settlementDto.manualDistributions.length === 0) {
        throw new BadRequestException('يجب تحديد توزيع المبالغ على الموظفين');
      }
      
      const workshopEmployeeIds = workshop.employees.map(emp => emp.id);
      const distributionEmployeeIds = settlementDto.manualDistributions.map(dist => dist.employeeId);
      
      for (const employeeId of distributionEmployeeIds) {
        if (!workshopEmployeeIds.includes(employeeId)) {
          throw new BadRequestException(`الموظف رقم ${employeeId} لا ينتمي لهذه الورشة`);
        }
      }
      
      const totalDistributed = settlementDto.manualDistributions.reduce((sum, dist) => sum + dist.amount, 0);
      
      if (Math.abs(totalDistributed - amountToPay) > 0.01) {
        throw new BadRequestException(
          `مجموع المبالغ الموزعة (${totalDistributed}) لا يساوي المبلغ المدفوع (${amountToPay})`
        );
      }
    }
    
    return this.prisma.$transaction(async (prisma) => {
      try {
        // إنشاء فاتورة صرف للمحاسبة
        const invoiceNumber = `WSP-STL-${Date.now()}`;
        const mainInvoice = await prisma.invoice.create({
          data: {
            invoiceNumber,
            invoiceType: 'expense',
            invoiceCategory: 'direct',
            paidStatus: true,
            totalAmount: amountToPay,
            notes: settlementDto.notes || `محاسبة ورشة ${workshop.name}`,
            fundId: settlementDto.fundId,
            shiftId: activeShift.id,
            employeeId: currentUserId,
            paymentDate: new Date(),
            isBreak: false,
          }
        });
        
        // إنشاء سجل المحاسبة
        const settlement = await prisma.workshopSettlement.create({
          data: {
            workshopId: id,
            amount: summary.netAmount,
            paidAmount: amountToPay,
            date: new Date(),
            fundId: settlementDto.fundId,
            invoiceId: mainInvoice.id,
            notes: settlementDto.notes,
          },
          include: {
            fund: true,
            invoice: true
          }
        });
        
        // حذف جميع السحوبات الخاصة بموظفي الورشة (نوع salary_advance فقط)
        await prisma.employeeWithdrawal.deleteMany({
          where: {
            employee: {
              workshopId: id
            },
            withdrawalType: 'salary_advance'
          }
        });
        
        // حذف سجلات الإنتاج أو الساعات حسب نوع الورشة
        if (workshop.workType === 'production') {
          // حذف سجلات إنتاج الورشة
          await prisma.workshopProduction.deleteMany({
            where: {
              workshopId: id
            }
          });
        } else if (workshop.workType === 'hourly') {
          // حذف سجلات ساعات موظفي الورشة
          await prisma.employeeHours.deleteMany({
            where: {
              employee: {
                workshopId: id
              }
            }
          });
        }
        
        // تحديث رصيد الصندوق
        await prisma.fund.update({
          where: { id: settlementDto.fundId },
          data: {
            currentBalance: {
              decrement: amountToPay
            }
          }
        });
        
        let salaryPayments = [];
        
        // التوزيع المباشر إذا كان مطلوباً
        if (settlementDto.distributeImmediately) {

          if (settlementDto.distributionType === 'manual' && settlementDto.manualDistributions) {
            // التوزيع اليدوي
           for (const dist of settlementDto.manualDistributions) {
              const employee = workshop.employees.find(emp => emp.id === dist.employeeId);
              
              const salaryPayment = await prisma.employeeSalaryPayment.create({
                data: {
                  amount: dist.amount,
                  date: new Date(),
                  paymentType: settlementDto.salaryPaymentType || 'workshop',
                  invoiceId: mainInvoice.id,
                  notes: dist.notes || `توزيع من محاسبة ورشة ${workshop.name}`,
                  employeeId: employee.id,
                }
              });
              
              salaryPayments.push({
                ...salaryPayment,
                employeeName: employee.name
              });
            }
          } else {
            // التوزيع التلقائي بالتساوي
            const employeeCount = workshop.employees.length;
            
            if (employeeCount === 0) {
              throw new BadRequestException('لا يوجد موظفين في الورشة للتوزيع عليهم');
            }
            
            const sharePerEmployee = amountToPay / employeeCount;
            
            for (const employee of workshop.employees) {
              const salaryPayment = await prisma.employeeSalaryPayment.create({
                data: {
                  employeeId: employee.id,
                  amount: sharePerEmployee,
                  date: new Date(),
                  paymentType: settlementDto.salaryPaymentType || 'workshop',
                  invoiceId: mainInvoice.id,
                  notes: `توزيع بالتساوي من محاسبة ورشة ${workshop.name}`
                }
              });
              
              salaryPayments.push({
                ...salaryPayment,
                employeeName: employee.name
              });
            }
          }
        }
        
        return {
          success: true,
          settlement,
          invoice: mainInvoice,
          summary,
          salaryPayments,
          resetMessage: 'تم تصفير جميع السحوبات وسجلات الإنتاج/الساعات للورشة'
        };
      } catch (error) {
        console.error('Error in workshop settlement:', error);
        throw new BadRequestException(
          error.message || 'حدث خطأ أثناء محاسبة الورشة'
        );
      }
    });
  }
    
  // الحصول على ملخص مالي للورشة (بدون فلترة تاريخ)
  async getWorkshopSummary(workshopId: number) {
    const workshop = await this.prisma.workshop.findUnique({
      where: { id: workshopId },
      include: {
        employees: {
          include: {
            withdrawals: {
              where: {
                withdrawalType: 'salary_advance'
              }
            },
            productionRecords: true,
            hourRecords: true,
            debts: {
              where: {
                status: 'active'
              }
            }
          }
        },
        productionRecords: true
      }
    });
    
    if (!workshop) {
      throw new NotFoundException(`الورشة رقم ${workshopId} غير موجودة`);
    }
    
    // حساب إجمالي السحوبات لجميع الموظفين في الورشة
    const totalWithdrawals = workshop.employees.reduce(
      (sum, employee) => 
        sum + employee.withdrawals.reduce(
          (empSum, withdrawal) => empSum + withdrawal.amount, 0
        ), 
      0
    );
    
    // حساب إجمالي المبالغ المستحقة حسب نوع الورشة
    let totalEarnings = 0;
    
    if (workshop.workType === 'production') {
      totalEarnings = workshop.productionRecords.reduce(
        (sum, record) => sum + record.totalProduction, 0
      );
    } else {
      totalEarnings = workshop.employees.reduce(
        (sum, employee) => 
          sum + employee.hourRecords.reduce(
            (empSum, record) => empSum + record.totalAmount, 0
          ), 
        0
      );
    }
    
    // حساب إجمالي الديون النشطة للموظفين
    const totalDebt = workshop.employees.reduce(
      (sum, employee) => {
        const activeDebt = employee.debts.find(debt => debt.status === 'active');
        return sum + (activeDebt ? activeDebt.remainingAmount : 0);
      }, 
      0
    );
    
    // حساب الصافي
    const netAmount = totalEarnings - totalWithdrawals;
    
    // تجميع إنتاج الورشة حسب الأيام
    const dailySummary = this.getDailyProductionSummary(workshop);
    
    return {
      workshopId,
      workshopName: workshop.name,
      workType: workshop.workType,
      totalWithdrawals,
      totalEarnings,
      totalDebt,
      netAmount,
      dailySummary
    };
  }
  
  // تجميع الإنتاج اليومي للورشة
  private getDailyProductionSummary(workshop) {
    const dailyProduction = {};
    
    if (workshop.workType === 'production') {
      for (const record of workshop.productionRecords) {
        const dateStr = new Date(record.date).toISOString().split('T')[0];
        
        if (!dailyProduction[dateStr]) {
          dailyProduction[dateStr] = {
            date: dateStr,
            totalProduction: 0,
            items: []
          };
        }
        
        dailyProduction[dateStr].totalProduction += record.totalProduction;
        
        const recordItems = Array.isArray(record.items) ? record.items : JSON.parse(record.items || '[]');
        for (const item of recordItems) {
          dailyProduction[dateStr].items.push(item);
        }
      }
    } else {
      for (const employee of workshop.employees) {
        for (const record of employee.hourRecords) {
          const dateStr = new Date(record.date).toISOString().split('T')[0];
          
          if (!dailyProduction[dateStr]) {
            dailyProduction[dateStr] = {
              date: dateStr,
              totalHours: 0,
              totalAmount: 0,
              employees: []
            };
          }
          
          dailyProduction[dateStr].totalHours += record.hours;
          dailyProduction[dateStr].totalAmount += record.totalAmount;
          
          dailyProduction[dateStr].employees.push({
            employeeId: employee.id,
            employeeName: employee.name,
            hours: record.hours,
            hourlyRate: record.hourlyRate,
            amount: record.totalAmount
          });
        }
      }
    }
    
    return Object.values(dailyProduction).sort((a, b) =>
      // @ts-ignore 
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }
  
  // إضافة موظف للورشة
  async addEmployeeToWorkshop(workshopId: number, employeeId: number) {
    const workshop = await this.prisma.workshop.findUnique({
      where: { id: workshopId }
    });
    
    if (!workshop) {
      throw new NotFoundException(`الورشة رقم ${workshopId} غير موجودة`);
    }
    
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      include: {
        workshop: true
      }
    });
    
    if (!employee) {
      throw new NotFoundException(`الموظف رقم ${employeeId} غير موجود`);
    }
    
    if (employee.workshop) {
      throw new BadRequestException(`الموظف منضم بالفعل إلى ورشة ${employee.workshop.name}`);
    }
    
    if (employee.workType !== workshop.workType) {
      throw new BadRequestException(`نوع عمل الموظف (${employee.workType}) لا يتوافق مع نوع عمل الورشة (${workshop.workType})`);
    }
    
    return this.prisma.employee.update({
      where: { id: employeeId },
      data: {
        workshopId
      },
      include: {
        workshop: true
      }
    });
  }
  
  // إزالة موظف من الورشة
  async removeEmployeeFromWorkshop(workshopId: number, employeeId: number) {
    const workshop = await this.prisma.workshop.findUnique({
      where: { id: workshopId },
      include: {
        employees: {
          where: { id: employeeId }
        }
      }
    });
    
    if (!workshop) {
      throw new NotFoundException(`الورشة رقم ${workshopId} غير موجودة`);
    }
    
    if (workshop.employees.length === 0) {
      throw new BadRequestException(`الموظف رقم ${employeeId} غير منضم إلى هذه الورشة`);
    }
    
    return this.prisma.employee.update({
      where: { id: employeeId },
      data: {
        workshopId: null
      }
    });
  }
}
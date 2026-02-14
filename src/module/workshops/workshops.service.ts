import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateWorkshopDto } from './dto/create-workshop.dto';
import { UpdateWorkshopDto } from './dto/update-workshop.dto';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateWorkshopProductionDto } from './dto/create-workshop-production.dto';
import { UpdateWorkshopProductionDto } from './dto/update-workshop-production.dto';
import { CreateWorkshopSettlementDto } from './dto/create-workshop-settlement.dto';
import { CreateWorkshopHoursDto } from './dto/create-workshop-hours.dto';
import { UpdateWorkshopHoursDto } from './dto/update-workshop-hours.dto';

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

  // جلب جميع الورش مع فلترة البيانات حسب lastSettlementDate
  async findAll() {
    const workshops = await this.prisma.workshop.findMany({
      include: {
        employees: {
          include: {
            withdrawals: {
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
        const lastSettlementDate = workshop.lastSettlementDate || null;
        
        // فلترة سجلات الإنتاج حسب lastSettlementDate
        const filteredProductionRecords = workshop.productionRecords.filter(
          record => !lastSettlementDate || record.date > lastSettlementDate
        );
        
        // حساب التفاصيل المالية لكل موظف مع فلترة البيانات
        const employeesWithFinancials = workshop.employees.map(employee => {
          // فلترة السحوبات بعد آخر محاسبة
          const filteredWithdrawals = employee.withdrawals.filter(
            w => !lastSettlementDate || w.date > lastSettlementDate
          );
          
          // فلترة الرواتب بعد آخر محاسبة
          const filteredSalaryPayments = employee.salaryPayments.filter(
            s => !lastSettlementDate || s.date > lastSettlementDate
          );
          
          // حساب إجمالي السحوبات منذ آخر محاسبة
          const totalWithdrawals = filteredWithdrawals.reduce(
            (sum, withdrawal) => sum + withdrawal.amount, 
            0
          );
          
          // حساب إجمالي الرواتب المدفوعة منذ آخر محاسبة
          const totalSalaries = filteredSalaryPayments.reduce(
            (sum, payment) => sum + payment.amount, 
            0
          );
          
          // حساب الديون النشطة
          const activeDebt = employee.debts.find(debt => debt.status === 'active');
          const debtAmount = activeDebt ? activeDebt.remainingAmount : 0;
          
          return {
            ...employee,
            // إرجاع السحوبات المفلترة فقط
            withdrawals: filteredWithdrawals,
            // إرجاع الرواتب المفلترة فقط
            salaryPayments: filteredSalaryPayments,
            financialSummary: {
              totalWithdrawals,
              totalSalaries,
              debtAmount,
              lastWorkshopSettlement: lastSettlementDate,
              periodStart: lastSettlementDate || 'منذ البداية',
              lastPaymentDate: filteredSalaryPayments.length > 0 
                ? filteredSalaryPayments[0].date 
                : null,
              paymentsCount: filteredSalaryPayments.length,
              withdrawalsCount: filteredWithdrawals.length,
              hasActiveDebt: debtAmount > 0
            }
          };
        });
        
        return {
          ...workshop,
          // إرجاع سجلات الإنتاج المفلترة فقط
          productionRecords: filteredProductionRecords.slice(0, 5), // أول 5 سجلات
          employees: employeesWithFinancials,
          financialSummary: summary
        };
      })
    );
    
    return workshopsWithSummary;
  }
  
  // جلب ورشة محددة مع فلترة البيانات حسب lastSettlementDate
  async findOne(id: number) {
    const workshop = await this.prisma.workshop.findUnique({
      where: { id },
      include: {
        employees: {
          include: {
            withdrawals: {
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
            invoice: {
              include: {
                employee: true
              }
            }
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
    const lastSettlementDate = workshop.lastSettlementDate || null;

    // فلترة سجلات الإنتاج على مستوى الورشة
    const filteredProductionRecords = workshop.productionRecords.filter(
      record => !lastSettlementDate || record.date > lastSettlementDate
    );

    // تعديل employees لإضافة financialSummary وفلترة البيانات
    const employeesWithFilteredData = workshop.employees.map(employee => {
      // فلترة السحوبات بعد آخر محاسبة
      const filteredWithdrawals = employee.withdrawals.filter(
        w => !lastSettlementDate || w.date > lastSettlementDate
      );
      
      // فلترة الرواتب بعد آخر محاسبة
      const filteredSalaryPayments = employee.salaryPayments.filter(
        s => !lastSettlementDate || s.date > lastSettlementDate
      );
      
      // فلترة سجلات الإنتاج للموظف بعد آخر محاسبة
      const filteredProductionRecords = employee.productionRecords.filter(
        p => !lastSettlementDate || p.date > lastSettlementDate
      );
      
      // فلترة سجلات الساعات بعد آخر محاسبة
      const filteredHourRecords = employee.hourRecords.filter(
        h => !lastSettlementDate || h.date > lastSettlementDate
      );

      // حساب المجاميع
      const totalWithdrawals = filteredWithdrawals.reduce(
        (sum, withdrawal) => sum + withdrawal.amount, 
        0
      );

      const totalSalaries = filteredSalaryPayments.reduce(
        (sum, payment) => sum + payment.amount, 
        0
      );

      const activeDebt = employee.debts.find(debt => debt.status === 'active');
      const debtAmount = activeDebt ? activeDebt.remainingAmount : 0;

      return {
        ...employee,
        // إرجاع البيانات المفلترة فقط
        withdrawals: filteredWithdrawals,
        salaryPayments: filteredSalaryPayments,
        productionRecords: filteredProductionRecords,
        hourRecords: filteredHourRecords,
        financialSummary: {
          totalWithdrawals,
          totalSalaries,
          debtAmount,
          lastWorkshopSettlement: lastSettlementDate,
          periodStart: lastSettlementDate || 'منذ البداية',
          lastPaymentDate: filteredSalaryPayments.length > 0 
            ? filteredSalaryPayments[0].date 
            : null,
          paymentsCount: filteredSalaryPayments.length,
          withdrawalsCount: filteredWithdrawals.length,
          hasActiveDebt: debtAmount > 0,
          productionRecordsCount: filteredProductionRecords.length,
          hourRecordsCount: filteredHourRecords.length
        }
      };
    });

    return {
      ...workshop,
      productionRecords: filteredProductionRecords,
      employees: employeesWithFilteredData,
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

  // محاسبة الورشة مع تحديث lastSettlementDate
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
      where: { status: 'open' },
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
    
    const summary = await this.getWorkshopSummary(id);
    const amountToPay = settlementDto.amount;
    
    if (amountToPay <= 0) {
      throw new BadRequestException('المبلغ المدفوع يجب أن يكون أكبر من صفر');
    }
    
    // التحقق من التوزيع اليدوي
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
        const settlementDate = new Date();
        
        // إنشاء فاتورة صرف للمحاسبة
        const invoiceNumber = `WSP-STL-${Date.now()}`;
        const mainInvoice = await prisma.invoice.create({
          data: {
            invoiceNumber,
            invoiceType: 'expense',
            invoiceCategory: 'direct',
            paidStatus: true,
            totalAmount: amountToPay,
            notes: `w-${workshop.name}`,
            fundId: settlementDto.fundId,
            shiftId: activeShift.id,
            employeeId: currentUserId,
            paymentDate: settlementDate,
            isBreak: false,
          }
        });
        
        // إنشاء سجل المحاسبة
        const settlement = await prisma.workshopSettlement.create({
          data: {
            workshopId: id,
            amount: summary.netAmount,
            paidAmount: amountToPay,
            date: settlementDate,
            fundId: settlementDto.fundId,
            invoiceId: mainInvoice.id,
            notes: settlementDto.notes,
            totalEarnings: summary.totalEarnings,
            totalWithdrawals: summary.totalWithdrawals,
          },
          include: {
            fund: true,
            invoice: true
          }
        });
        
        // تحديث تاريخ آخر محاسبة
        await prisma.workshop.update({
          where: { id },
          data: {
            lastSettlementDate: settlementDate
          }
        });
        
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
                  date: settlementDate,
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
                  date: settlementDate,
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
          message: 'تمت المحاسبة بنجاح. السجلات السابقة محفوظة ولن تظهر في الحسابات الجديدة'
        };
      } catch (error) {
        console.error('Error in workshop settlement:', error);
        throw new BadRequestException(
          error.message || 'حدث خطأ أثناء محاسبة الورشة'
        );
      }
    });
  }

  // الحصول على ملخص مالي للورشة مع فلترة حسب lastSettlementDate
  async getWorkshopSummary(workshopId: number) {
    const workshop = await this.prisma.workshop.findUnique({
      where: { id: workshopId },
      include: {
        employees: {
          include: {
            withdrawals: true,
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
    
    // تحديد تاريخ الفلترة
    const lastSettlement = workshop.lastSettlementDate;
    
    // حساب إجمالي السحوبات (منذ آخر محاسبة فقط)
    const totalWithdrawals = workshop.employees.reduce(
      (sum, employee) => 
        sum + employee.withdrawals
          .filter(w => !lastSettlement || w.date > lastSettlement)
          .reduce((empSum, withdrawal) => empSum + withdrawal.amount, 0), 
      0
    );
    
    // حساب إجمالي المبالغ المستحقة (منذ آخر محاسبة فقط)
    let totalEarnings = 0;
    
    if (workshop.workType === 'production') {
      totalEarnings = workshop.productionRecords
        .filter(record => !lastSettlement || record.date > lastSettlement)
        .reduce((sum, record) => sum + record.totalProduction, 0);
    } else {
      totalEarnings = workshop.employees.reduce(
        (sum, employee) => 
          sum + employee.hourRecords
            .filter(record => !lastSettlement || record.date > lastSettlement)
            .reduce((empSum, record) => empSum + record.totalAmount, 0), 
        0
      );
    }
    
    // حساب إجمالي الديون النشطة
    const totalDebt = workshop.employees.reduce(
      (sum, employee) => {
        const activeDebt = employee.debts.find(debt => debt.status === 'active');
        return sum + (activeDebt ? activeDebt.remainingAmount : 0);
      }, 
      0
    );
    
    const netAmount = totalEarnings - totalWithdrawals;
    
    // تجميع الإنتاج اليومي (منذ آخر محاسبة فقط)
    const dailySummary = this.getDailyProductionSummary(workshop, lastSettlement);
    
    return {
      workshopId,
      workshopName: workshop.name,
      workType: workshop.workType,
      totalWithdrawals,
      totalEarnings,
      totalDebt,
      netAmount,
      dailySummary,
      lastSettlementDate: lastSettlement
    };
  }

  // تجميع الإنتاج اليومي للورشة مع فلترة حسب lastSettlementDate
  private getDailyProductionSummary(workshop: any, lastSettlement?: Date) {
    const dailyProduction = {};
    
    if (workshop.workType === 'production') {
      // فلترة السجلات بعد آخر محاسبة
      const filteredRecords = workshop.productionRecords.filter(
        record => !lastSettlement || record.date > lastSettlement
      );
      
      for (const record of filteredRecords) {
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
        // فلترة السجلات بعد آخر محاسبة
        const filteredHours = employee.hourRecords.filter(
          record => !lastSettlement || record.date > lastSettlement
        );
        
        for (const record of filteredHours) {
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
  
  // تعديل سجل إنتاج
  async updateProductionRecord(workshopId: number, recordId: number, updateDto: UpdateWorkshopProductionDto) {
    const record = await this.prisma.workshopProduction.findFirst({
      where: { id: recordId, workshopId }
    });

    if (!record) {
      throw new NotFoundException(`سجل الإنتاج رقم ${recordId} غير موجود في هذه الورشة`);
    }

    const workshop = await this.prisma.workshop.findUnique({ where: { id: workshopId } });

    // منع التعديل على سجلات قبل آخر محاسبة
    if (workshop.lastSettlementDate && record.date <= workshop.lastSettlementDate) {
      throw new BadRequestException('لا يمكن تعديل سجل إنتاج تم محاسبته مسبقاً');
    }

    const data: any = {};

    if (updateDto.notes !== undefined) {
      data.notes = updateDto.notes;
    }

    if (updateDto.date) {
      data.date = updateDto.date;
    }

    // إعادة حساب الإنتاج إذا تم تغيير العناصر
    if (updateDto.items) {
      let totalProduction = 0;
      const productionItems = [];

      for (const item of updateDto.items) {
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

      data.totalProduction = totalProduction;
      data.items = productionItems;
    }

    return this.prisma.workshopProduction.update({
      where: { id: recordId },
      data
    });
  }

  // حذف سجل إنتاج
  async deleteProductionRecord(workshopId: number, recordId: number) {
    const record = await this.prisma.workshopProduction.findFirst({
      where: { id: recordId, workshopId }
    });

    if (!record) {
      throw new NotFoundException(`سجل الإنتاج رقم ${recordId} غير موجود في هذه الورشة`);
    }

    const workshop = await this.prisma.workshop.findUnique({ where: { id: workshopId } });

    if (workshop.lastSettlementDate && record.date <= workshop.lastSettlementDate) {
      throw new BadRequestException('لا يمكن حذف سجل إنتاج تم محاسبته مسبقاً');
    }

    return this.prisma.workshopProduction.delete({
      where: { id: recordId }
    });
  }

  // تعديل سجل ساعات
  async updateHoursRecord(workshopId: number, recordId: number, updateDto: UpdateWorkshopHoursDto) {
    const record = await this.prisma.employeeHours.findUnique({
      where: { id: recordId },
      include: { employee: true }
    });

    if (!record) {
      throw new NotFoundException(`سجل الساعات رقم ${recordId} غير موجود`);
    }

    if (record.employee.workshopId !== workshopId) {
      throw new BadRequestException('هذا السجل لا ينتمي لهذه الورشة');
    }

    const workshop = await this.prisma.workshop.findUnique({ where: { id: workshopId } });

    if (workshop.lastSettlementDate && record.date <= workshop.lastSettlementDate) {
      throw new BadRequestException('لا يمكن تعديل سجل ساعات تم محاسبته مسبقاً');
    }

    const data: any = {};

    if (updateDto.hours !== undefined) {
      data.hours = updateDto.hours;
    }

    if (updateDto.hourlyRate !== undefined) {
      data.hourlyRate = updateDto.hourlyRate;
    }

    if (updateDto.date) {
      data.date = updateDto.date;
    }

    if (updateDto.notes !== undefined) {
      data.notes = updateDto.notes;
    }

    // إعادة حساب المبلغ الإجمالي
    const finalHours = data.hours ?? record.hours;
    const finalRate = data.hourlyRate ?? record.hourlyRate;
    data.totalAmount = finalHours * finalRate;

    return this.prisma.employeeHours.update({
      where: { id: recordId },
      data,
      include: { employee: true }
    });
  }

  // حذف سجل ساعات
  async deleteHoursRecord(workshopId: number, recordId: number) {
    const record = await this.prisma.employeeHours.findUnique({
      where: { id: recordId },
      include: { employee: true }
    });

    if (!record) {
      throw new NotFoundException(`سجل الساعات رقم ${recordId} غير موجود`);
    }

    if (record.employee.workshopId !== workshopId) {
      throw new BadRequestException('هذا السجل لا ينتمي لهذه الورشة');
    }

    const workshop = await this.prisma.workshop.findUnique({ where: { id: workshopId } });

    if (workshop.lastSettlementDate && record.date <= workshop.lastSettlementDate) {
      throw new BadRequestException('لا يمكن حذف سجل ساعات تم محاسبته مسبقاً');
    }

    return this.prisma.employeeHours.delete({
      where: { id: recordId }
    });
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
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
      // لا داعي لتشفير كلمة المرور
      return await this.prisma.workshop.create({
        data: {
          name: createWorkshopDto.name,
          workType: createWorkshopDto.workType,
          password: createWorkshopDto.password // حفظ كلمة المرور كما هي
        }
      });
    } catch (error) {
      throw new BadRequestException('حدث خطأ أثناء إنشاء الورشة');
    }
  }
  
  // جلب جميع الورش
  async findAll() {
    const workshops = await this.prisma.workshop.findMany({
      include: {
        employees: true,
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
    
    // إضافة ملخص مالي لكل ورشة
    const workshopsWithSummary = await Promise.all(
      workshops.map(async (workshop) => {
        const summary = await this.getWorkshopSummary(workshop.id);
        return {
          ...workshop,
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
    
    // حساب الملخص المالي للورشة
    const summary = await this.getWorkshopSummary(id);
    
    // تحويل بيانات الإنتاج اليومي إلى تنسيق أفضل للعرض
    const dailyProduction = this.formatDailyProduction(workshop.productionRecords);
    
    return {
      ...workshop,
      financialSummary: summary,
      dailyProduction
    };
  }
  
  // تحويل سجلات الإنتاج إلى تنسيق يومي للعرض
  private formatDailyProduction(productionRecords) {
    // تجميع السجلات حسب التاريخ
    const groupedByDate = {};
    
    for (const record of productionRecords) {
      const dateStr = new Date(record.date).toISOString().split('T')[0];
      
      if (!groupedByDate[dateStr]) {
        groupedByDate[dateStr] = {
          date: dateStr,
          totalProduction: 0,
          items: []
        };
      }
      
      groupedByDate[dateStr].totalProduction += record.totalProduction;
      
      // إضافة عناصر الإنتاج
      const recordItems = Array.isArray(record.items) ? record.items : JSON.parse(record.items || '[]');
      for (const item of recordItems) {
        groupedByDate[dateStr].items.push(item);
      }
    }
    
    // تحويل إلى مصفوفة وترتيبها حسب التاريخ (الأحدث أولاً)
    return Object.values(groupedByDate).sort((a, b) => 
      // @ts-ignore
      new Date(b.date).getTime() - new Date(a.date).getTime()
    );
  }
  
  // تحديث بيانات ورشة
  async update(id: number, updateWorkshopDto: UpdateWorkshopDto) {
    const existingWorkshop = await this.prisma.workshop.findUnique({
      where: { id }
    });
    
    if (!existingWorkshop) {
      throw new NotFoundException(`الورشة رقم ${id} غير موجودة`);
    }
    
    // تحديث البيانات بدون تشفير كلمة المرور
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
    
    // مقارنة كلمة المرور مباشرة بدون فك تشفير
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
    
    // التحقق من صحة عناصر الإنتاج وحساب الإجمالي
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
    
    // إنشاء سجل الإنتاج
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
    
    // التحقق من وجود الموظف في الورشة
    const employee = workshop.employees.find(emp => emp.id === hoursDto.employeeId);
    
    if (!employee) {
      throw new BadRequestException('الموظف غير منضم لهذه الورشة');
    }
    
    // حساب المبلغ الإجمالي
    const totalAmount = hoursDto.hours * hoursDto.hourlyRate;
    
    // إنشاء سجل ساعات للموظف
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
  
  // محاسبة الورشة
  async settleWorkshop(id: number, settlementDto: CreateWorkshopSettlementDto, currentUserId: number) {
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
    
    // حساب الملخص المالي للورشة
    const summary = await this.getWorkshopSummary(id);
    
    // هنا نستخدم المبلغ المحدد من قبل المستخدم مباشرة
    const amountToPay = settlementDto.amount;
    
    if (amountToPay <= 0) {
      throw new BadRequestException('المبلغ المدفوع يجب أن يكون أكبر من صفر');
    }
    
    return this.prisma.$transaction(async (prisma) => {
      // إنشاء فاتورة صرف للمحاسبة
      const invoiceNumber = `WSP-STL-${Date.now()}`;
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          invoiceType: 'expense',
          invoiceCategory: 'direct', // يمكن إضافة فئة خاصة بالورش لاحقاً
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
          amount: summary.netAmount, // المبلغ المستحق
          paidAmount: amountToPay, // المبلغ المدفوع
          date: new Date(),
          fundId: settlementDto.fundId,
          invoiceId: invoice.id,
          notes: settlementDto.notes
        },
        include: {
          fund: true,
          invoice: true
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
      
      return {
        success: true,
        settlement,
        invoice,
        summary
      };
    });
  }
  
  // الحصول على ملخص مالي للورشة
  async getWorkshopSummary(workshopId: number, startDate?: Date, endDate?: Date) {
    const workshop = await this.prisma.workshop.findUnique({
      where: { id: workshopId },
      include: {
        employees: {
          include: {
            withdrawals: {
              where: {
                date: {
                  gte: startDate,
                  lte: endDate || new Date()
                }
              }
            },
            productionRecords: {
              where: {
                date: {
                  gte: startDate,
                  lte: endDate || new Date()
                }
              }
            },
            hourRecords: {
              where: {
                date: {
                  gte: startDate,
                  lte: endDate || new Date()
                }
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
          where: {
            date: {
              gte: startDate,
              lte: endDate || new Date()
            }
          }
        }
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
      // في حالة ورشة الإنتاج، نستخدم سجلات الإنتاج للورشة
      totalEarnings = workshop.productionRecords.reduce(
        (sum, record) => sum + record.totalProduction, 0
      );
    } else {
      // في حالة ورشة الساعات، نجمع ساعات جميع الموظفين
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
    const netAmount = totalEarnings - totalWithdrawals - totalDebt;
    
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
      period: {
        startDate: startDate || 'all',
        endDate: endDate || 'current'
      },
      dailySummary
    };
  }
  
  // تجميع الإنتاج اليومي للورشة
  private getDailyProductionSummary(workshop) {
    const dailyProduction = {};
    
    if (workshop.workType === 'production') {
      // تجميع سجلات الإنتاج حسب التاريخ
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
        
        // إضافة عناصر الإنتاج
        const recordItems = Array.isArray(record.items) ? record.items : JSON.parse(record.items || '[]');
        for (const item of recordItems) {
          dailyProduction[dateStr].items.push(item);
        }
      }
    } else {
      // تجميع سجلات الساعات حسب التاريخ
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
          
          // إضافة بيانات الموظف
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
    
    // تحويل إلى مصفوفة وترتيبها حسب التاريخ (الأحدث أولاً)
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
    
    // التحقق من توافق نوع عمل الموظف مع نوع عمل الورشة
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
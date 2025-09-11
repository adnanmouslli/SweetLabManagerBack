import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import {  FundType, InvoiceType, ShiftStatus, ShiftType, User } from '@prisma/client';
import { UpdateShiftDto } from './dto/update-shift.dto';
import { FundSummary, ShiftSummary } from '@/common/types/shift-summary.types';



@Injectable()
export class ShiftsService {
 constructor(private prisma: PrismaService) {}

 async create(createShiftDto: CreateShiftDto , user: User){
  
   try {
     const openShift = await this.prisma.shift.findFirst({
       where: { status: ShiftStatus.open }
     });

     if (openShift) {
       throw new BadRequestException('Cannot create new shift while another is open');
     }

     const employee = await this.prisma.user.findUnique({
       where: { id: user.id }
     });

     if (!employee) {
       throw new NotFoundException(`Employee with ID ${user.id} not found`);
     }

     return await this.prisma.shift.create({
       data: {
        employeeId: user.id,
        shiftType: createShiftDto.shiftType,
        openTime: new Date(),
         status: ShiftStatus.open
       },
       include: {
         employee: {
           select: {
             id: true,
             username: true
           }
         }
       }
     });

   } catch (error) {
     if (error instanceof BadRequestException || error instanceof NotFoundException) {
       throw error;
     }
     throw new InternalServerErrorException('Failed to create shift');
   }
 }

 async findAll() {
   try {
     return await this.prisma.shift.findMany({
       include: {
         employee: {
           select: {
             id: true,
             username: true
           }
         }
       },
       orderBy: {
         openTime: 'desc'
       }
     });
   } catch (error) {
     throw new InternalServerErrorException('Failed to fetch shifts');
   }
 }

 async update(id: number, updateShiftDto: UpdateShiftDto) {
  try {
    const shift = await this.prisma.shift.findUnique({
      where: { id },
      include: {
        invoices: true
      }
    });

    if (!shift) {
      throw new NotFoundException(`Shift #${id} not found`);
    }

    if (shift.status === ShiftStatus.closed) {
      throw new BadRequestException('Cannot update a closed shift');
    }


    return await this.prisma.shift.update({
      where: { id },
      data: {
        shiftType: updateShiftDto.shiftType,
        // Don't allow updating status through this endpoint
      },
      include: {
        employee: {
          select: {
            id: true,
            username: true
          }
        }
      }
    });

  } catch (error) {
    if (error instanceof BadRequestException || error instanceof NotFoundException) {
      throw error;
    }
    throw new InternalServerErrorException('Failed to update shift');
  }
}

async remove(id: number) {
  try {
    const shift = await this.prisma.shift.findUnique({
      where: { id },
      include: {
        invoices: true
      }
    });

    if (!shift) {
      throw new NotFoundException(`Shift #${id} not found`);
    }

    // Check if shift has associated invoices
    if (shift.invoices.length > 0) {
      throw new BadRequestException('Cannot delete shift with associated invoices');
    }

    // Only allow deleting open shifts
    if (shift.status === ShiftStatus.closed) {
      throw new BadRequestException('Cannot delete a closed shift');
    }

    await this.prisma.shift.delete({
      where: { id }
    });
    
    return {
       message: `Shift #${id} has been successfully deleted`
     };

  } catch (error) {
    if (error instanceof BadRequestException || error instanceof NotFoundException) {
      throw error;
    }
    throw new InternalServerErrorException('Failed to delete shift');
  }
}

async partialCloseShift() {
    try {
      const openShift = await this.prisma.shift.findFirst({
        where: { status: ShiftStatus.open },
        include: { employee: true }
      });

      if (!openShift) {
        throw new NotFoundException('لا توجد واردية مفتوحة');
      }

      // التحقق من وجود طلبات تحويل معلقة
      const pendingTransfers = await this.prisma.pendingShiftTransfer.findMany({
        where: { status: 'pending' }
      });

      if (pendingTransfers.length > 0) {
        throw new BadRequestException('لا يمكن إغلاق الواردية بينما توجد طلبات تحويل معلقة. يرجى معالجة هذه الطلبات أولاً.');
      }

      // إغلاق الواردية جزئياً
      const partiallyClosedShift = await this.prisma.shift.update({
        where: { id: openShift.id },
        data: {
          status: ShiftStatus.partially_closed,
          closeTime: new Date()
        },
        include: {
          employee: {
            select: {
              id: true,
              username: true
            }
          }
        }
      });

      // // الحصول على ملخص الواردية للمراجعة
      // const shiftSummary = await this.getCurrentShiftSummary();

      return {
        message: 'تم إغلاق الواردية جزئياً بنجاح. يمكن الآن فتح واردية جديدة.',
        shift: partiallyClosedShift,
        // summary: shiftSummary,
        note: 'يجب إكمال عملية الإغلاق لاحقاً بإدخال المبلغ الفعلي المستلم'
      };

    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      console.error('خطأ في الإغلاق الجزئي:', error);
      throw new InternalServerErrorException('حدث خطأ أثناء الإغلاق الجزئي للواردية');
    }
  }

  // دالة جديدة لإكمال إغلاق الواردية
  async completeShiftClosure(shiftId: number, actualAmount: number) {
    try {
      const shift = await this.prisma.shift.findUnique({
        where: { id: shiftId },
        include: { employee: true }
      });

      if (!shift) {
        throw new NotFoundException('الواردية غير موجودة');
      }

      if (shift.status !== ShiftStatus.partially_closed) {
        throw new BadRequestException('يمكن إكمال الإغلاق فقط للوارديات المغلقة جزئياً');
      }

      // الحصول على ملخص الواردية للمقارنة
      const shiftSummary = await this.getShiftSummary(shiftId);
      const expectedAmount = shiftSummary.totalNet;

      // تحديد إذا كان هناك زيادة أو نقصان
      let differenceStatus: 'surplus' | 'deficit' | null = null;
      let differenceValue = 0;

      if (actualAmount > expectedAmount) {
        differenceStatus = 'surplus';
        differenceValue = actualAmount - expectedAmount;
      } else if (actualAmount < expectedAmount) {
        differenceStatus = 'deficit';
        differenceValue = expectedAmount - actualAmount;
      }

      const [generalFund, boothFund, universityFund] = await Promise.all([
        this.prisma.fund.findFirst({ where: { fundType: 'general' } }),
        this.prisma.fund.findFirst({ where: { fundType: 'booth' } }),
        this.prisma.fund.findFirst({ where: { fundType: 'university' } })
      ]);

      if (!generalFund) {
        throw new BadRequestException('الصندوق العام غير موجود');
      }

      return await this.prisma.$transaction(async (prisma) => {
        const boothBalance = boothFund?.currentBalance || 0;
        const universityBalance = universityFund?.currentBalance || 0;

        // تصفير أرصدة الصناديق الفرعية
        if (boothFund) {
          await prisma.fund.update({
            where: { id: boothFund.id },
            data: { currentBalance: 0 }
          });
        }

        if (universityFund) {
          await prisma.fund.update({
            where: { id: universityFund.id },
            data: { currentBalance: 0 }
          });
        }

        // تحويل المبلغ الفعلي للصندوق العام
        await prisma.fund.update({
          where: { id: generalFund.id },
          data: {
            currentBalance: {
              increment: actualAmount
            }
          }
        });

        // إكمال إغلاق الواردية
        const completedShift = await prisma.shift.update({
          where: { id: shiftId },
          data: {
            status: ShiftStatus.closed,
            differenceStatus,
            differenceValue
          },
          include: {
            employee: {
              select: {
                id: true,
                username: true
              }
            }
          }
        });

        return {
          message: 'تم إكمال إغلاق الواردية وتحويل الأرصدة بنجاح',
          shift: completedShift,
          expectedAmount,
          actualAmount,
          differenceStatus,
          differenceValue,
          transfers: {
            boothTransfer: boothBalance,
            universityTransfer: universityBalance,
            totalTransferred: actualAmount
          }
        };
      });

    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      console.error('خطأ في إكمال الإغلاق:', error);
      throw new InternalServerErrorException('حدث خطأ أثناء إكمال إغلاق الواردية');
    }
  }



async closeShift(actualAmount: number) {
  try {
    const openShift = await this.prisma.shift.findFirst({
      where: { status: ShiftStatus.open },
      include: { employee: true },
    });

    if (!openShift) {
      throw new NotFoundException('لا توجد واردية مفتوحة');
    }

    if (openShift.status === ShiftStatus.closed) {
      throw new BadRequestException('الواردية مغلقة بالفعل');
    }

    // التحقق من وجود طلبات تحويل معلقة من الصندوق العام
    const pendingTransfers = await this.prisma.pendingShiftTransfer.findMany({
      where: {
        status: 'pending'
      }
    });

    if (pendingTransfers.length > 0) {
      throw new BadRequestException('لا يمكن إغلاق الواردية بينما توجد طلبات تحويل معلقة من الصندوق العام. يرجى معالجة هذه الطلبات أولاً.');
    }

    // الحصول على ملخص الواردية الحالية للمقارنة
    const shiftSummary = await this.getCurrentShiftSummary();
    const expectedAmount = shiftSummary.totalNet;

    // تحديد إذا كان هناك زيادة أو نقصان بناءً على المبلغ الفعلي المستلم
    let differenceStatus: 'surplus' | 'deficit' | null = null;
    let differenceValue = 0;

    if (actualAmount > expectedAmount) {
      differenceStatus = 'surplus'; // زيادة
      differenceValue = actualAmount - expectedAmount;
    } else if (actualAmount < expectedAmount) {
      differenceStatus = 'deficit'; // نقصان
      differenceValue = expectedAmount - actualAmount;
    }

    const [generalFund, boothFund, universityFund] = await Promise.all([
      this.prisma.fund.findFirst({ where: { fundType: 'general' } }),
      this.prisma.fund.findFirst({ where: { fundType: 'booth' } }),
      this.prisma.fund.findFirst({ where: { fundType: 'university' } }),
    ]);

    if (!generalFund) {
      throw new BadRequestException('الصندوق العام غير موجود');
    }

    return await this.prisma.$transaction(async (prisma) => {
      const boothBalance = boothFund?.currentBalance || 0;
      const universityBalance = universityFund?.currentBalance || 0;
      
      // نستخدم المبلغ الفعلي المستلم بدلاً من مجموع الأرصدة
      const totalTransfer = actualAmount;

      if (boothFund) {
        await prisma.fund.update({
          where: { id: boothFund.id },
          data: { currentBalance: 0 },
        });
      }

      if (universityFund) {
        await prisma.fund.update({
          where: { id: universityFund.id },
          data: { currentBalance: 0 },
        });
      }

      await prisma.fund.update({
        where: { id: generalFund.id },
        data: {
          currentBalance: {
            increment: totalTransfer,
          },
        },
      });

      const closedShift = await prisma.shift.update({
        where: { id: openShift.id },
        data: {
          status: ShiftStatus.closed,
          closeTime: new Date(),
          differenceStatus,
          differenceValue,
        },
        include: {
          employee: {
            select: {
              id: true,
              username: true,
            },
          },
        },
      });

      return {
        message: 'تم إغلاق الواردية وتحويل الأرصدة بنجاح',
        shift: closedShift,
        expectedAmount,
        actualAmount,
        differenceStatus,
        differenceValue,
        transfers: {
          boothTransfer: boothBalance,
          universityTransfer: universityBalance,
          totalTransferred: actualAmount,
        },
      };
    });
  } catch (error) {
    console.log(error)
    if (error instanceof BadRequestException || error instanceof NotFoundException) {
      throw error;
    }
    throw new InternalServerErrorException('حدث خطأ أثناء إغلاق الواردية');
  }
}

 // دالة للحصول على الوارديات المغلقة جزئياً
  async getPartiallyClosedShifts() {
    try {
      return await this.prisma.shift.findMany({
        where: { status: ShiftStatus.partially_closed },
        include: {
          employee: {
            select: {
              id: true,
              username: true
            }
          }
        },
        orderBy: {
          closeTime: 'desc'
        }
      });
    } catch (error) {
      throw new InternalServerErrorException('فشل في جلب الوارديات المغلقة جزئياً');
    }
  }

  // دالة للحصول على الواردية النشطة (مفتوحة أو مغلقة جزئياً)
  async getActiveShift() {
    try {
      return await this.prisma.shift.findFirst({
        where: { 
          status: { 
            in: [ShiftStatus.open, ShiftStatus.partially_closed] 
          } 
        },
        include: {
          employee: {
            select: {
              id: true,
              username: true
            }
          }
        }
      });
    } catch (error) {
      throw new InternalServerErrorException('فشل في جلب الواردية النشطة');
    }
  }


 async findShiftsByStatusOrType(status?: ShiftStatus, shiftType?: ShiftType) {
  try {
    const where: any = {};
    if (status) {
      where.status = status;
    }
    if (shiftType) {
      where.shiftType = shiftType;
    }
    
    return await this.prisma.shift.findMany({
      where,
      include: {
        employee: {
          select: {
            id: true,
            username: true
          }
        }
      },
      orderBy: {
        openTime: 'desc'
      }
    });
  } catch (error) {
    throw new InternalServerErrorException('Failed to fetch shifts');
  }
}

async getShiftSummary(shiftId: number): Promise<ShiftSummary> {
  try {
    // Get shift details with employee and invoices
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: {
        employee: true,
        invoices: {
          include: {
            fund: true
          }
        }
      }
    });

    if (!shift) {
      throw new NotFoundException(`Shift #${shiftId} not found`);
    }

    // Get relevant fund types (excluding main)
    const relevantFundTypes = Object.values(FundType).filter(
      fundType => fundType !== 'main'
    );

    // Group invoices by fund type
    const fundSummaries: FundSummary[] = await Promise.all(
      relevantFundTypes.map(async (fundType) => {
        // Get all invoices for this fund type in the shift
        const fundInvoices = shift.invoices.filter(
          invoice => invoice.fund.fundType === fundType
        );

        // Calculate totals
        const incomeTotal = fundInvoices
          .filter(invoice => invoice.invoiceType === 'income')
          .reduce((sum, invoice) => sum + invoice.totalAmount, 0);

        const expenseTotal = fundInvoices
          .filter(invoice => invoice.invoiceType === 'expense')
          .reduce((sum, invoice) => sum + invoice.totalAmount, 0);

        return {
          fundType,
          invoiceCount: fundInvoices.length,
          incomeTotal,
          expenseTotal,
          netTotal: incomeTotal - expenseTotal,

        };
      })
    );

    // Calculate total net across all non-main funds
    const totalNet = fundSummaries.reduce(
      (sum, fund) => sum + fund.netTotal, 
      0
    );

    return {
      shiftId: shift.id,
      employeeName: shift.employee.username,
      openTime: shift.openTime,
      closedTime: shift.closeTime,
      fundSummaries,
      totalNet,
      differenceStatus: shift.differenceStatus || null,
      differenceValue: shift.differenceValue || null,  
    };
  } catch (error) {
    if (error instanceof NotFoundException) {
      throw error;
    }
    throw new InternalServerErrorException('Failed to generate shift summary');
  }
}

async getCurrentShiftSummary(): Promise<ShiftSummary> {
  try {
    const openShift = await this.prisma.shift.findFirst({
      where: { 
        status: ShiftStatus.open 
      },
      include: {
        employee: true,
        invoices: {
          include: {
            fund: true
          }
        }
      },
      orderBy: {
        openTime: 'desc'
      }
    });

    if (!openShift) {
      throw new NotFoundException('No open shift found');
    }

    const relevantFundTypes = Object.values(FundType).filter(
      fundType => fundType !== 'main'
    );

    const fundSummaries: FundSummary[] = await Promise.all(
      relevantFundTypes.map(async (fundType) => {
        const fundInvoices = openShift.invoices.filter(
          invoice => invoice.fund.fundType === fundType
        );


        // Calculate totals only for paid invoices and subtract discounts
        const incomeTotal = fundInvoices
        .filter(invoice => 
          invoice.invoiceType === InvoiceType.income && 
          invoice.paidStatus === true
        ) 
        .reduce((sum, invoice) => {
          // استخدام supplierPaymentAmount إذا وجد، وإلا استخدام totalAmount
          let actualAmount;
          if (invoice.supplierPaymentAmount > 0) {
            actualAmount = invoice.supplierPaymentAmount - (invoice.discount || 0);
          } else {
            actualAmount = invoice.totalAmount - (invoice.discount || 0);
          }
          return sum + actualAmount;
        }, 0);

          // console.log("incomeTotal" , incomeTotal);

        const expenseTotal = fundInvoices
          .filter(invoice => 
            invoice.invoiceType === 'expense' && 
            invoice.paidStatus === true 
          )
          .reduce((sum, invoice) => {
            // Subtract discount from total amount
            let actualAmount;
            if (invoice.supplierPaymentAmount > 0) {
              actualAmount = invoice.supplierPaymentAmount - (invoice.discount || 0);
            } else {
              actualAmount = invoice.totalAmount - (invoice.discount || 0);
            }
            return sum + actualAmount;
          }, 0);

        const paidInvoicesCount = fundInvoices.filter(
          invoice => invoice.paidStatus === true
        ).length;

        return {
          fundType,
          invoiceCount: paidInvoicesCount, // Only count paid invoices
          incomeTotal,
          expenseTotal,
          netTotal: incomeTotal - expenseTotal
        };
      })
    );

    const totalNet = fundSummaries.reduce(
      (sum, fund) => sum + fund.netTotal, 
      0
    );

    return {
      shiftId: openShift.id,
      employeeName: openShift.employee.username,
      openTime: openShift.openTime,
      fundSummaries,
      totalNet,
    };

  } catch (error) {
    if (error instanceof NotFoundException) {
      throw error;
    }
    console.log(error);
    throw new InternalServerErrorException('Failed to generate current shift summary');
  }
}

async getShiftInvoicesByFund(shiftId: number) {
  try {
    // التحقق من وجود الوردية
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: {
        invoices: {
          include: {
            fund: true,
            customer: true,
            employee: true,
            items: {
              include: {
                item: true, // جلب تفاصيل المنتج
              },
            },
          },
        },
      },
    });

    if (!shift) {
      throw new NotFoundException(`Shift #${shiftId} not found`);
    }

    // تجهيز الفواتير مع تعديل items لإضافة title
    const invoicesWithTitles = shift.invoices.map((invoice) => ({
      ...invoice,
      items: invoice.items.map((i) => ({
        ...i,
        title: i.item.name, // إضافة اسم المنتج تحت key "title"
      })),
    }));

    // تصنيف الفواتير حسب نوع الصندوق
    const boothInvoices = invoicesWithTitles.filter(
      (invoice) => invoice.fund.fundType === 'booth'
    );
    const generalInvoices = invoicesWithTitles.filter(
      (invoice) => invoice.fund.fundType === 'general'
    );
    const universityInvoices = invoicesWithTitles.filter(
      (invoice) => invoice.fund.fundType === 'university'
    );

    return {
      boothInvoices,
      generalInvoices,
      universityInvoices,
    };
  } catch (error) {
    if (error instanceof NotFoundException) {
      throw error;
    }
    throw new InternalServerErrorException(
      'Failed to fetch invoices for the specified shift'
    );
  }
}



  /**
 * التحقق من وجود طلبات تحويل معلقة من الصندوق العام
 * تستخدم هذه الدالة قبل إغلاق الواردية للتأكد من إمكانية الإغلاق
 */
  async checkForPendingTransfers(): Promise<{ hasPendingTransfers: boolean, pendingTransfers?: any[] }> {
    try {
      const pendingTransfers = await this.prisma.pendingShiftTransfer.findMany({
        where: {
          status: 'pending'
        },
        include: {
          requestedBy: {
            select: {
              username: true
            }
          }
        },
        orderBy: {
          requestedAt: 'desc'
        }
      });
  
      return { 
        hasPendingTransfers: pendingTransfers.length > 0,
        pendingTransfers: pendingTransfers.length > 0 ? pendingTransfers : undefined
      };
    } catch (error) {
      console.error('Error checking for pending transfers:', error);
      throw new InternalServerErrorException('حدث خطأ أثناء التحقق من طلبات التحويل المعلقة');
    }
  }
  
}
import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import {  FundType, ShiftStatus, ShiftType, User } from '@prisma/client';
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

async closeShift() {
  try {

    const openShift = await this.prisma.shift.findFirst({
      where: { 
        status: ShiftStatus.open 
      },
      include: {
        employee: true
      }
    });

    if (!openShift) {
      throw new NotFoundException('لا توجد واردية مفتوحة');
    }

    if (openShift.status === ShiftStatus.closed) {
      throw new BadRequestException('الواردية مغلقة بالفعل');
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
      const totalTransfer = boothBalance + universityBalance;


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

      await prisma.fund.update({
        where: { id: generalFund.id },
        data: {
          currentBalance: {
            increment: totalTransfer
          }
        }
      });

      const closedShift = await prisma.shift.update({
        where: { id: openShift.id },
        data: {
          status: ShiftStatus.closed,
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

      return {
        message: 'تم إغلاق الواردية وتحويل الأرصدة بنجاح',
        shift: closedShift,
        transfers: {
          boothTransfer: boothBalance,
          universityTransfer: universityBalance,
          totalTransferred: totalTransfer
        }
      };
    });

  } catch (error) {
    if (error instanceof BadRequestException || error instanceof NotFoundException) {
      throw error;
    }
    throw new InternalServerErrorException('حدث خطأ أثناء إغلاق الواردية');
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
          netTotal: incomeTotal - expenseTotal
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
      fundSummaries,
      totalNet
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
      totalNet
    };
  } catch (error) {
    if (error instanceof NotFoundException) {
      throw error;
    }
    console.log(error);
    throw new InternalServerErrorException('Failed to generate current shift summary');
  }
}

}
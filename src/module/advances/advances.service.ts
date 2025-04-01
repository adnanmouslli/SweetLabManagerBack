import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAdvanceDto } from './dto/create-advance.dto';

@Injectable()
export class AdvancesService {
  constructor(private prisma: PrismaService) {}

  // Get all advances
  async findAll() {
    return this.prisma.advance.findMany({
      include: {
        customer: true,
        relatedInvoices: {
          include: {
            items: true,
            employee: {
              select: {
                username: true
              }
            },
            fund: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  // Get active advances only
  async getActiveAdvances() {
    return this.prisma.advance.findMany({
      where: {
        status: 'active'
      },
      include: {
        customer: true,
        relatedInvoices: {
          include: {
            items: true,
            employee: {
              select: {
                username: true
              }
            },
            fund: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  // Get advances for a specific customer
  async getCustomerAdvances(customerId: number) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      throw new NotFoundException(`العميل غير موجود`);
    }

    return this.prisma.advance.findMany({
      where: {
        customerId,
      },
      include: {
        relatedInvoices: {
          include: {
            items: true,
            employee: {
              select: {
                username: true
              }
            },
            fund: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  // Get a specific advance by ID
  async findOne(id: number) {
    const advance = await this.prisma.advance.findUnique({
      where: { id },
      include: {
        customer: true,
        relatedInvoices: {
          include: {
            items: true,
            employee: {
              select: {
                username: true
              }
            },
            fund: true
          }
        }
      }
    });

    if (!advance) {
      throw new NotFoundException(`السلفة غير موجودة`);
    }

    return advance;
  }

  // Create a new advance (this will create an income invoice - receiving advance from customer)
  async createAdvance(createAdvanceDto: CreateAdvanceDto, employeeId: number) {
    // Check for active shift
    const activeShift = await this.prisma.shift.findFirst({
      where: {
        status: 'open',
      },
    });

    if (!activeShift) {
      throw new BadRequestException('لا يوجد واردية مفتوحة');
    }

    // Verify fund exists
    const fund = await this.prisma.fund.findUnique({
      where: { id: createAdvanceDto.fundId },
    });

    if (!fund) {
      throw new BadRequestException('الصندوق غير موجود');
    }

    // Verify customer exists
    const customer = await this.prisma.customer.findUnique({
      where: { id: createAdvanceDto.customerId },
    });

    if (!customer) {
      throw new BadRequestException('العميل غير موجود');
    }

    return this.prisma.$transaction(async (prisma) => {
      // Check if customer already has an active advance
      const existingAdvance = await prisma.advance.findFirst({
        where: {
          customerId: createAdvanceDto.customerId,
          status: 'active',
        },
      });

      // Create invoice for the advance - now income type since we're receiving money from customer
      const invoiceNumber = `ADV-INC-${Date.now()}`;
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          employeeId,
          invoiceType: 'income', // Changed from 'expense' to 'income'
          invoiceCategory: 'advance',
          customerId: createAdvanceDto.customerId,
          paidStatus: true,
          totalAmount: createAdvanceDto.amount,
          discount: 0,
          notes: createAdvanceDto.notes || 'استلام سلفة من العميل',
          fundId: createAdvanceDto.fundId,
          shiftId: activeShift.id,
          paymentDate: new Date(),
          isBreak: false,
        },
        include: {
          employee: {
            select: {
              username: true
            }
          },
          customer: true,
        },
      });

      let advanceRecord;

      if (existingAdvance) {
        // Update existing advance record
        advanceRecord = await prisma.advance.update({
          where: { id: existingAdvance.id },
          data: {
            totalAmount: existingAdvance.totalAmount + createAdvanceDto.amount,
            remainingAmount: existingAdvance.remainingAmount + createAdvanceDto.amount,
            notes: createAdvanceDto.notes 
              ? `${existingAdvance.notes || ''}\n${createAdvanceDto.notes}`
              : existingAdvance.notes,
            relatedInvoices: {
              connect: { id: invoice.id }
            }
          },
          include: {
            customer: true
          }
        });

        // Link invoice to advance
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { relatedAdvanceId: existingAdvance.id },
        });

      } else {
        // Create new advance record
        advanceRecord = await prisma.advance.create({
          data: {
            customerId: createAdvanceDto.customerId,
            totalAmount: createAdvanceDto.amount,
            remainingAmount: createAdvanceDto.amount,
            status: 'active',
            notes: createAdvanceDto.notes || 'سلفة جديدة',
            relatedInvoices: {
              connect: { id: invoice.id }
            }
          },
          include: {
            customer: true
          }
        });

        // Link invoice to advance
        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { relatedAdvanceId: advanceRecord.id },
        });
      }

      // Update fund balance - increment instead of decrement
      await prisma.fund.update({
        where: { id: createAdvanceDto.fundId },
        data: {
          currentBalance: {
            increment: createAdvanceDto.amount, // Changed from decrement to increment
          },
        },
      });

      return {
        success: true,
        message: existingAdvance 
          ? 'تم تحديث سلفة العميل بنجاح' 
          : 'تم إنشاء سلفة جديدة بنجاح',
        advanceRecord,
        invoice
      };
    });
  }

  // Process an advance repayment (this will create an expense invoice - returning money to customer)
  async processRepayment(advanceId: number, amount: number, fundId: number, employeeId: number, notes?: string) {
    // Check for active shift
    const activeShift = await this.prisma.shift.findFirst({
      where: {
        status: 'open',
      },
    });

    if (!activeShift) {
      throw new BadRequestException('لا يوجد واردية مفتوحة');
    }

    // Verify fund exists
    const fund = await this.prisma.fund.findUnique({
      where: { id: fundId },
    });

    if (!fund) {
      throw new BadRequestException('الصندوق غير موجود');
    }

    // Get advance record
    const advance = await this.prisma.advance.findUnique({
      where: { id: advanceId },
      include: { customer: true }
    });

    if (!advance) {
      throw new BadRequestException('السلفة غير موجودة');
    }

    if (advance.status !== 'active') {
      throw new BadRequestException('السلفة مكتملة بالفعل');
    }

    if (amount > advance.remainingAmount) {
      throw new BadRequestException(`مبلغ الإرجاع أكبر من المبلغ المتبقي (${advance.remainingAmount})`);
    }

    return this.prisma.$transaction(async (prisma) => {
      // Create repayment invoice - now expense type since we're returning money to customer
      const invoiceNumber = `ADV-EXP-${Date.now()}`;
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          employeeId,
          invoiceType: 'expense', // Changed from 'income' to 'expense'
          invoiceCategory: 'advance',
          customerId: advance.customerId,
          paidStatus: true,
          totalAmount: amount,
          discount: 0,
          notes: notes || 'إرجاع سلفة للعميل',
          fundId: fundId,
          shiftId: activeShift.id,
          paymentDate: new Date(),
          isBreak: false,
          relatedAdvanceId: advanceId
        },
        include: {
          employee: {
            select: {
              username: true
            }
          },
          customer: true,
        },
      });

      // Update advance record
      const newRemainingAmount = advance.remainingAmount - amount;
      const updatedAdvance = await prisma.advance.update({
        where: { id: advanceId },
        data: {
          remainingAmount: newRemainingAmount,
          lastPaymentDate: new Date(),
          status: newRemainingAmount <= 0 ? 'completed' : 'active',
          notes: newRemainingAmount <= 0
            ? `${advance.notes || ''}\nتم إرجاع السلفة بالكامل بتاريخ ${new Date().toLocaleDateString('ar-EG')}`
            : advance.notes
        },
        include: {
          customer: true
        }
      });

      // Update fund balance - decrement instead of increment
      await prisma.fund.update({
        where: { id: fundId },
        data: {
          currentBalance: {
            decrement: amount, // Changed from increment to decrement
          },
        },
      });

      return {
        success: true,
        message: newRemainingAmount <= 0
          ? 'تم إرجاع السلفة بالكامل'
          : 'تم إرجاع جزء من السلفة',
        advanceRecord: updatedAdvance,
        invoice,
        remainingAmount: newRemainingAmount
      };
    });
  }
}
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { ApplyDiscountDto } from './dto/apply-discount.dto';

@Injectable()
export class DebtsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.debt.findMany({
      include: {
        customer: true,
        relatedInvoices: {
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
            fund: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  async getActiveDebts() {
    return this.prisma.debt.findMany({
      where: {
        status: 'active'
      },
      include: {
        customer: true,
        relatedInvoices: {
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
            fund: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  async getCustomerDebts(customerId: number) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId }
    });

    if (!customer) {
      throw new NotFoundException(`العميل غير موجود`);
    }

    return this.prisma.debt.findMany({
      where: {
        customerId,
      },
      include: {
        relatedInvoices: {
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
            fund: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  async findOne(id: number) {
    const debt = await this.prisma.debt.findUnique({
      where: { id },
      include: {
        customer: true,
        relatedInvoices: {
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
            fund: true
          }
        }
      }
    });

    if (!debt) {
      throw new NotFoundException(`الدين غير موجود`);
    }

    return debt;
  }
  
  // Add a new method to apply discount to debt
  async applyDiscount(id: number, discountDto: ApplyDiscountDto) {
    // Find the debt first
    const debt = await this.prisma.debt.findUnique({
      where: { id }
    });

    if (!debt) {
      throw new NotFoundException(`الدين غير موجود`);
    }

    // Validate discount amount - can't exceed remaining amount
    if (discountDto.discountAmount > debt.remainingAmount) {
      throw new BadRequestException(`قيمة الخصم تتجاوز المبلغ المتبقي للدين`);
    }

    // Apply the discount
    const updatedDebt = await this.prisma.debt.update({
      where: { id },
      data: {
        discount: debt.discount + discountDto.discountAmount,
        remainingAmount: debt.remainingAmount - discountDto.discountAmount,
        notes: discountDto.notes 
          ? `${debt.notes ? debt.notes + ' | ' : ''}تم تطبيق خصم بقيمة ${discountDto.discountAmount}: ${discountDto.notes}`
          : `${debt.notes ? debt.notes + ' | ' : ''}تم تطبيق خصم بقيمة ${discountDto.discountAmount}`,
      }
    });

    // Check if the debt is fully paid after discount
    if (updatedDebt.remainingAmount <= 0) {
      await this.prisma.debt.update({
        where: { id },
        data: {
          status: 'paid',
          lastPaymentDate: new Date()
        }
      });
    }

    return this.findOne(id);
  }
}
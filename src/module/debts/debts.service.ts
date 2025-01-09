import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

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
  
}
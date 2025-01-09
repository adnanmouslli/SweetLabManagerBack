import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async create(createCustomerDto: CreateCustomerDto) {
    // التحقق من عدم وجود رقم الهاتف مسبقاً
    const existingCustomer = await this.prisma.customer.findUnique({
      where: { phone: createCustomerDto.phone }
    });

    if (existingCustomer) {
      throw new BadRequestException('رقم الهاتف مسجل مسبقاً');
    }

    return this.prisma.customer.create({
      data: createCustomerDto
    });
  }

  findAll() {
    return this.prisma.customer.findMany({
      include: {
        invoices: {
          include: {
            items: {
              include: {
                item: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        },
        trays: {
          where: {
            status: 'pending'
          }
        },
        debts: {
          where: {
            status: 'active'
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }

  async findOne(id: number) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        invoices: {
          include: {
            items: {
              include: {
                item: true
              }
            }
          },
          orderBy: {
            createdAt: 'desc'
          }
        },
        trays: {
          where: {
            status: 'pending'
          }
        },
        debts: {
          where: {
            status: 'active'
          }
        }
      }
    });

    if (!customer) {
      throw new NotFoundException('العميل غير موجود');
    }

    return customer;
  }

  async update(id: number, updateCustomerDto: UpdateCustomerDto) {
    const customer = await this.prisma.customer.findUnique({
      where: { id }
    });

    if (!customer) {
      throw new NotFoundException('العميل غير موجود');
    }

    // التحقق من رقم الهاتف إذا تم تحديثه
    if (updateCustomerDto.phone && updateCustomerDto.phone !== customer.phone) {
      const existingCustomer = await this.prisma.customer.findUnique({
        where: { phone: updateCustomerDto.phone }
      });

      if (existingCustomer) {
        throw new BadRequestException('رقم الهاتف مسجل مسبقاً');
      }
    }

    return this.prisma.customer.update({
      where: { id },
      data: updateCustomerDto
    });
  }

  async remove(id: number) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        invoices: true,
        trays: {
          where: {
            status: 'pending'
          }
        },
        debts: {
          where: {
            status: 'active'
          }
        }
      }
    });

    if (!customer) {
      throw new NotFoundException('العميل غير موجود');
    }

    // التحقق من عدم وجود صواني معلقة
    if (customer.trays.length > 0) {
      throw new BadRequestException('لا يمكن حذف العميل - لديه صواني معلقة');
    }

    // التحقق من عدم وجود ديون نشطة
    if (customer.debts.length > 0) {
      throw new BadRequestException('لا يمكن حذف العميل - لديه ديون نشطة');
    }

    return this.prisma.customer.delete({
      where: { id }
    });
  }

  async search(query: string) {
    return this.prisma.customer.findMany({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { phone: { contains: query } }
        ]
      },
      include: {
        debts: {
          where: {
            status: 'active'
          }
        },
        trays: {
          where: {
            status: 'pending'
          }
        }
      }
    });
  }

  async getCustomersList() {
    const customers = await this.prisma.customer.findMany({
      select: {
        id: true,
        name: true,
        phone: true,
        debts: {
          where: {
            status: 'active'
          },
          select: {
            remainingAmount: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });
  
    return customers.map(customer => ({
      id: customer.id,
      name: customer.name,
      phone: customer.phone,
      totalDebt: customer.debts.reduce((sum, debt) => sum + debt.remainingAmount, 0)
    }));
  }
}
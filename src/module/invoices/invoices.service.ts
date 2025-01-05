import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceCategory, InvoiceType } from '@prisma/client';
import { FilterInvoiceDto } from './dto/filter-invoice.dto';

@Injectable()
export class InvoicesService {
  constructor(private prisma: PrismaService) {}

  async create(createInvoiceDto: CreateInvoiceDto, employeeId: number) {
    const activeShift = await this.prisma.shift.findFirst({
      where: { 
        id: createInvoiceDto.shiftId,
        status: 'open'
      }
    });

    if (!activeShift) {
      throw new BadRequestException('هذه الوردية مغلقة');
    }


     const fund = await this.prisma.fund.findUnique({
      where: { id: createInvoiceDto.fundId }
    });

    if (!fund) {
      throw new BadRequestException('الصندوق غير موجود');
    }

    const invoiceNumber = `INV-${Date.now()}`;

    return this.prisma.$transaction(async (prisma) => {

      const calculatedTotal = createInvoiceDto.items.reduce(
        (sum, item) => sum + (item.quantity * item.unitPrice),
        0
      );


      if (Math.abs(calculatedTotal - createInvoiceDto.totalAmount) > 0.01) {
        throw new BadRequestException('المجموع الكلي غير صحيح');
      }

      const invoice = await prisma.invoice.create({
        data: {
          ...createInvoiceDto,
          invoiceNumber,
          employeeId,
          paymentDate: createInvoiceDto.paidStatus ? new Date() : null,
          items: {
            create: createInvoiceDto.items.map(item => ({
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              trayCount: item.trayCount || 0,
              subTotal: item.quantity * item.unitPrice,
              itemId: item.itemId
            }))
          }
        },
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
          }
        }
      }
    );


    await prisma.fund.update({
        where: { id: createInvoiceDto.fundId },
        data: {
          currentBalance: {
            [createInvoiceDto.invoiceType === 'income' ? 'increment' : 'decrement']: 
              createInvoiceDto.totalAmount - (createInvoiceDto.discount || 0)
          }
        }
      });

      return invoice;
    });
  }

  async findByTypeAndCategory(type: InvoiceType, category: InvoiceCategory) {
    return this.prisma.invoice.findMany({
      where: {
        invoiceType: type,
        invoiceCategory: category
      },
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
        }
      }
    });
  }

  async findAll(query: FilterInvoiceDto) {
    const where: any = {};
    

    if (query.type) {
      where.invoiceType = query.type;
    }
    
    if (query.category) {
      where.invoiceCategory = query.category;
    }
    
    if (query.paidStatus !== undefined) {
      where.paidStatus = query.paidStatus;
    }
    

    if (query.startDate || query.endDate) {
      where.createdAt = {};
      
      if (query.startDate) {
        where.createdAt.gte = new Date(query.startDate);
      }
      
      if (query.endDate) {
        where.createdAt.lte = new Date(query.endDate);
      }
    }

    return this.prisma.invoice.findMany({
      where,
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
        fund: true,
        shift: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });
  }
  

  async getSummary() {
    const summary = await this.prisma.invoice.groupBy({
      by: ['invoiceType', 'invoiceCategory'],
      _sum: {
        totalAmount: true, 
      },
      _count: {
        _all: true, 
      },
    });
  
    return summary;
  }
  



  async findOne(id: number) {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
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
        fund: true,
        shift: true
      }
    });

    if (!invoice) {
      throw new NotFoundException(`Invoice with ID ${id} not found`);
    }

    return invoice;
  }



  findUnpaid() {
    return this.prisma.invoice.findMany({
      where: {
        paidStatus: false
      },
      include: {
        items: {
          include: {
            item: true
          }
        }
      }
    });
  }

  async markAsPaid(id: number) {
    return this.prisma.invoice.update({
      where: { id },
      data: {
        paidStatus: true,
        paymentDate: new Date()
      }
    });
  }



}
import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { PaymentType, InvoiceCategory } from '@prisma/client';

@Injectable()
export class InvoicesService {
  constructor(private prisma: PrismaService) {}

  async create(createInvoiceDto: CreateInvoiceDto, employeeId: number) {
    // التحقق من وجود وردية مفتوحة
    const activeShift = await this.prisma.shift.findFirst({
      where: { 
        id: createInvoiceDto.shiftId,
        status: 'open'
      }
    });

    if (!activeShift) {
      throw new BadRequestException('No active shift found');
    }

    // إنشاء رقم فاتورة فريد
    const invoiceNumber = `INV-${Date.now()}`;

    return this.prisma.$transaction(async (prisma) => {
      // إنشاء الفاتورة
      const invoice = await prisma.invoice.create({
        data: {
          ...createInvoiceDto,
          invoiceNumber,
          employeeId,
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
      });

      // إذا كانت فاتورة دين، قم بإنشاء سجل دين
      if (createInvoiceDto.paymentType === PaymentType.credit && 
          createInvoiceDto.invoiceCategory === InvoiceCategory.debt) {
        await prisma.debt.create({
          data: {
            customerName: createInvoiceDto.customerName,
            customerPhone: createInvoiceDto.customerPhone,
            totalAmount: createInvoiceDto.totalAmount,
            remainingAmount: createInvoiceDto.totalAmount,
            status: 'active'
          }
        });
      }

      return invoice;
    });
  }

  findAll() {
    return this.prisma.invoice.findMany({
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
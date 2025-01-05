import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreatePaymentDto } from './dto/create-payment.dto';

@Injectable()
export class DebtsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.debt.findMany({
      include: {
        payments: {
          include: {
            invoice: true
          }
        }
      }
    });
  }

  async addPayment(debtId: number, createPaymentDto: CreatePaymentDto) {
    const debt = await this.prisma.debt.findUnique({
      where: { id: debtId }
    });

    if (!debt) {
      throw new NotFoundException(`Debt #${debtId} not found`);
    }

    return this.prisma.$transaction(async (prisma) => {

      const payment = await prisma.debtPayment.create({
        data: {
          ...createPaymentDto,
          debtId
        }
      });


      const newRemainingAmount = debt.remainingAmount - createPaymentDto.amount;
      
      await prisma.debt.update({
        where: { id: debtId },
        data: {
          remainingAmount: newRemainingAmount,
          status: newRemainingAmount <= 0 ? 'paid' : 'active',
          lastPaymentDate: new Date()
        }
      });

      return payment;
    });
  }

  async getCustomerDebts(customerPhone: string) {
    return this.prisma.debt.findMany({
      where: {
        customerPhone,
        status: 'active'
      },
      include: {
        payments: true
      }
    });
  }
}
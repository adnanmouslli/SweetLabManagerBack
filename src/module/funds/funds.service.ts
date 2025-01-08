import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFundDto } from './dto/create-fund.dto';
import { TransferResult } from '@/common/types/funds.types';

@Injectable()
export class FundsService {
  constructor(private prisma: PrismaService) {}

  create(createFundDto: CreateFundDto) {
    return this.prisma.fund.create({
      data: createFundDto
    });
  }

  findAll() {
    return this.prisma.fund.findMany();
  }

  async updateBalance(id: number, amount: number) {
    const fund = await this.prisma.fund.findUnique({ where: { id } });
    
    return this.prisma.fund.update({
      where: { id },
      data: {
        currentBalance: fund.currentBalance + amount
      }
    });
  }


  async transferToMain(amount: number, userId: number): Promise<TransferResult> {
    try {
      if (amount <= 0) {
        throw new BadRequestException('مبلغ التحويل يجب أن يكون أكبر من صفر');
      }


      const [generalFund, mainFund] = await Promise.all([
        this.prisma.fund.findFirst({ where: { fundType: 'general' } }),
        this.prisma.fund.findFirst({ where: { fundType: 'main' } })
      ]);

      if (!generalFund || !mainFund) {
        throw new BadRequestException('الصناديق غير موجودة');
      }

      if (generalFund.currentBalance < amount) {
        throw new BadRequestException('الرصيد غير كافي في الصندوق العام');
      }


      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { username: true }
      });

      if (!user) {
        throw new BadRequestException('المستخدم غير موجود');
      }


      const result = await this.prisma.$transaction(async (prisma) => {

        const updatedGeneralFund = await prisma.fund.update({
          where: { id: generalFund.id },
          data: {
            currentBalance: {
              decrement: amount
            }
          }
        });

        // Add to main fund
        const updatedMainFund = await prisma.fund.update({
          where: { id: mainFund.id },
          data: {
            currentBalance: {
              increment: amount
            }
          }
        });


        await prisma.fundTransferLog.create({
          data: {
            amount: amount,
            fromFundId: generalFund.id,
            toFundId: mainFund.id,
            transferredById: userId,
            transferredAt: new Date()
          }
        });

        return {
          fromBalance: updatedGeneralFund.currentBalance,
          toBalance: updatedMainFund.currentBalance
        };
      });

      return {
        success: true,
        message: 'تم التحويل بنجاح',
        transfer: {
          amount,
          fromBalance: result.fromBalance,
          toBalance: result.toBalance,
          transferredBy: user.username,
          transferredAt: new Date()
        }
      };

    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('حدث خطأ أثناء عملية التحويل');
    }
  }



  
}
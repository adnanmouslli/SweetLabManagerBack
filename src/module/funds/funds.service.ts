import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFundDto } from './dto/create-fund.dto';
import { TransferResult } from '@/common/types/funds.types';
import { FundType } from '@prisma/client';

// Enum to track the status of pending transfers
enum PendingTransferStatus {
  PENDING = 'pending',
  ACCEPTED = 'accepted',
  REJECTED = 'rejected'
}

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

    // التحقق من وجود واردية مفتوحة
    const activeShift = await this.prisma.shift.findFirst({
      where: {
        status: 'open',
      },
    });

    const result = await this.prisma.$transaction(async (prisma) => {
      // تحديث رصيد الصندوق العام (تقليل المبلغ)
      const updatedGeneralFund = await prisma.fund.update({
        where: { id: generalFund.id },
        data: {
          currentBalance: {
            decrement: amount
          }
        }
      });

      // تحديث رصيد الخزينة الرئيسية (زيادة المبلغ)
      const updatedMainFund = await prisma.fund.update({
        where: { id: mainFund.id },
        data: {
          currentBalance: {
            increment: amount
          }
        }
      });

      const transferNumber = `MAIN-TREASURY-${Date.now()}`;
      let expenseInvoice = null;
      let incomeInvoice = null;

      // إنشاء فاتورة صرف من الصندوق العام فقط في حال وجود واردية مفتوحة
      if (activeShift) {
        expenseInvoice = await prisma.invoice.create({
          data: {
            invoiceNumber: `${transferNumber}-EXP`,
            employeeId: userId,
            invoiceType: 'expense',
            invoiceCategory: 'direct',
            paidStatus: true,
            totalAmount: amount,
            discount: 0,
            notes: `تحويل مباشر من الصندوق العام إلى الخزينة الرئيسية - ${transferNumber}`,
            fundId: generalFund.id,
            shiftId: activeShift.id,
            paymentDate: new Date(),
            isBreak: false,
          }
        });
      }

      // إنشاء فاتورة دخل للخزينة الرئيسية (دون ربطها بواردية)
      incomeInvoice = await prisma.invoice.create({
        data: {
          invoiceNumber: `${transferNumber}-INC`,
          employeeId: userId,
          invoiceType: 'income',
          invoiceCategory: 'direct',
          paidStatus: true,
          totalAmount: amount,
          discount: 0,
          notes: `تحويل مباشر من الصندوق العام إلى الخزينة الرئيسية - ${transferNumber}`,
          fundId: mainFund.id,
          shiftId: activeShift?.id || null, // ربط بالواردية إذا كانت موجودة، وإلا null
          paymentDate: new Date(),
          isBreak: false,
        }
      });

      // تسجيل عملية التحويل في سجل تحويلات الصناديق
      const transferLog = await prisma.fundTransferLog.create({
        data: {
          amount,
          fromFundId: generalFund.id,
          toFundId: mainFund.id,
          transferredById: userId,
          transferredAt: new Date(),
          metadata: JSON.stringify({
            type: 'direct_to_main_treasury',
            transferNumber,
            notes: 'تحويل مباشر من الصندوق العام إلى الخزينة الرئيسية',
            hasActiveShift: !!activeShift,
            expenseInvoiceId: expenseInvoice?.id || null,
            incomeInvoiceId: incomeInvoice?.id || null
          })
        }
      });

      return {
        fromBalance: updatedGeneralFund.currentBalance,
        toBalance: updatedMainFund.currentBalance,
        expenseInvoice,
        incomeInvoice,
        transferLog,
        hasActiveShift: !!activeShift
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
        transferredAt: new Date(),
      }
    };

  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }
    throw new InternalServerErrorException('حدث خطأ أثناء عملية التحويل');
  }
}


  /**
   * تحويل مبلغ من الصندوق العام إلى الواردية القادمة
   * عملية تحويل مباشرة بدون فواتير (بعد إغلاق الواردية)
   */
  async createPendingTransferForNextShift(amount: number, userId: number, notes?: string): Promise<any> {
    try {
      if (amount <= 0) {
        throw new BadRequestException('مبلغ التحويل يجب أن يكون أكبر من صفر');
      }

      // التحقق من وجود صندوق عام
      const generalFund = await this.prisma.fund.findFirst({ 
        where: { fundType: FundType.general } 
      });

      if (!generalFund) {
        throw new BadRequestException('الصندوق العام غير موجود');
      }

      // التحقق من وجود رصيد كافي
      if (generalFund.currentBalance < amount) {
        throw new BadRequestException(`الرصيد غير كافي في الصندوق العام (${generalFund.currentBalance})`);
      }

      // التحقق من المستخدم
      const user = await this.prisma.user.findUnique({
        where: { id: userId }
      });

      if (!user) {
        throw new BadRequestException('المستخدم غير موجود');
      }

      // إنشاء طلب التحويل في قاعدة البيانات
      return await this.prisma.$transaction(async (prisma) => {
        // تخفيض رصيد الصندوق العام
        const updatedFund = await prisma.fund.update({
          where: { id: generalFund.id },
          data: {
            currentBalance: {
              decrement: amount
            }
          }
        });

        // إنشاء رقم تحويل فريد
        const transferNumber = `NEXT-SHIFT-${Date.now()}`;

        // إنشاء سجل في جدول للتحويلات المعلقة للواردية القادمة
        const pendingTransfer = await prisma.pendingShiftTransfer.create({
          data: {
            transferNumber,
            amount,
            status: PendingTransferStatus.PENDING,
            requestedById: userId,
            requestedAt: new Date(),
            notes: notes || 'تحويل مبلغ للواردية القادمة',
          }
        });

        // تسجيل عملية التحويل في سجل تحويلات الصناديق
        await prisma.fundTransferLog.create({
          data: {
            amount,
            fromFund: {
              connect: { id: generalFund.id }
            },
            toFund: {
              connect: { id: generalFund.id }
            },
            transferredBy: {
              connect: { id: userId }
            },
            transferredAt: new Date(),
            metadata: JSON.stringify({
              type: 'pending_next_shift',
              pendingTransferId: pendingTransfer.id,
              transferNumber
            })
          }
        });

        return {
          success: true,
          message: 'تم تحويل المبلغ بنجاح للواردية القادمة',
          transferNumber,
          amount,
          status: PendingTransferStatus.PENDING,
          generalFundBalance: updatedFund.currentBalance
        };
      });
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      console.error('Error in createPendingTransferForNextShift:', error);
      throw new InternalServerErrorException('حدث خطأ أثناء إنشاء التحويل للواردية القادمة');
    }
  }

  /**
   * التحقق من وجود تحويلات معلقة للواردية القادمة
   */
  async checkPendingTransfersForNextShift() {
    try {
      // البحث عن جميع التحويلات بحالة "معلق"
      const pendingTransfers = await this.prisma.pendingShiftTransfer.findMany({
        where: {
          status: PendingTransferStatus.PENDING
        },
        include: {
          requestedBy: {
            select: {
              id: true,
              username: true
            }
          }
        },
        orderBy: {
          requestedAt: 'desc'
        }
      });

      const totalPendingAmount = pendingTransfers.reduce((sum, transfer) => sum + transfer.amount, 0);

      return {
        pendingTransfers,
        count: pendingTransfers.length,
        totalPendingAmount
      };
    } catch (error) {
      console.error('Error in checkPendingTransfersForNextShift:', error);
      throw new InternalServerErrorException('حدث خطأ أثناء التحقق من التحويلات المعلقة');
    }
  }

  /**
   * قبول أو رفض التحويل المعلق عند بدء الواردية الجديدة
   */
  async handlePendingTransfer(transferId: number, accept: boolean, employeeId: number, shiftId: number, notes?: string) {
    try {
      // البحث عن التحويل المعلق
      const pendingTransfer = await this.prisma.pendingShiftTransfer.findUnique({
        where: { id: transferId }
      });

      if (!pendingTransfer) {
        throw new NotFoundException('التحويل المعلق غير موجود');
      }

      if (pendingTransfer.status !== PendingTransferStatus.PENDING) {
        throw new BadRequestException('تم معالجة هذا التحويل مسبقاً');
      }

      // التحقق من الواردية الحالية
      const currentShift = await this.prisma.shift.findUnique({
        where: { id: shiftId }
      });

      if (!currentShift) {
        throw new BadRequestException('الواردية غير موجودة');
      }

      if (currentShift.status !== 'open') {
        throw new BadRequestException('يجب أن تكون الواردية مفتوحة لقبول التحويل');
      }

      // البحث عن الصندوق العام
      const generalFund = await this.prisma.fund.findFirst({
        where: { fundType: FundType.general }
      });

      if (!generalFund) {
        throw new BadRequestException('الصندوق العام غير موجود');
      }

      // تنفيذ العملية باستخدام ترانزاكشن
      return this.prisma.$transaction(async (prisma) => {
        if (accept) {
          // قبول التحويل - إنشاء فاتورة دخل في الواردية الجديدة
          const incomeInvoiceNumber = `${pendingTransfer.transferNumber}-INC`;
          const incomeInvoice = await prisma.invoice.create({
            data: {
              invoiceNumber: incomeInvoiceNumber,
              invoiceType: 'income',
              invoiceCategory: 'direct',
              totalAmount: pendingTransfer.amount,
              discount: 0,
              paidStatus: true,
              paymentDate: new Date(),
              notes: notes || `استلام مبلغ محول للواردية الحالية - ${pendingTransfer.transferNumber}`,
              fundId: generalFund.id,
              shiftId: currentShift.id,
              employeeId: employeeId,
              isBreak: false,
            }
          });

          // تحديث حالة التحويل المعلق
          await prisma.pendingShiftTransfer.update({
            where: { id: transferId },
            data: {
              status: PendingTransferStatus.ACCEPTED,
              acceptedById: employeeId,
              acceptedAt: new Date(),
              incomeInvoiceId: incomeInvoice.id,
              notes: pendingTransfer.notes + (notes ? ` | ملاحظات الاستلام: ${notes}` : '')
            }
          });

          // تحديث سجل التحويل
          await prisma.fundTransferLog.updateMany({
            where: {
              metadata: {
                contains: `"pendingTransferId":${pendingTransfer.id}`
              }
            },
            data: {
              toFundId: generalFund.id,
              metadata: JSON.stringify({
                type: 'completed_next_shift',
                pendingTransferId: pendingTransfer.id,
                transferNumber: pendingTransfer.transferNumber,
                accepted: true,
                acceptedById: employeeId,
                acceptedAt: new Date()
              })
            }
          });

          return {
            success: true,
            message: 'تم قبول التحويل بنجاح وإضافة المبلغ للصندوق العام في الواردية الحالية',
            amount: pendingTransfer.amount,
            transferNumber: pendingTransfer.transferNumber,
            status: PendingTransferStatus.ACCEPTED
          };
        } else {
          // رفض التحويل - إعادة المبلغ للصندوق العام
          
          // تحديث رصيد الصندوق العام (إعادة المبلغ)
          await prisma.fund.update({
            where: { id: generalFund.id },
            data: {
              currentBalance: {
                increment: pendingTransfer.amount
              }
            }
          });

          // تحديث حالة التحويل المعلق
          await prisma.pendingShiftTransfer.update({
            where: { id: transferId },
            data: {
              status: PendingTransferStatus.REJECTED,
              acceptedById: employeeId,
              acceptedAt: new Date(),
              notes: pendingTransfer.notes + (notes ? ` | سبب الرفض: ${notes}` : ' | تم الرفض')
            }
          });

          // تحديث سجل التحويل
          await prisma.fundTransferLog.updateMany({
            where: {
              metadata: {
                contains: `"pendingTransferId":${pendingTransfer.id}`
              }
            },
            data: {
              toFundId: generalFund.id, // المبلغ عاد للصندوق العام
              metadata: JSON.stringify({
                type: 'rejected_next_shift',
                pendingTransferId: pendingTransfer.id,
                transferNumber: pendingTransfer.transferNumber,
                accepted: false,
                rejectedById: employeeId,
                rejectedAt: new Date(),
                reason: notes || 'تم رفض التحويل'
              })
            }
          });

          return {
            success: true,
            message: 'تم رفض التحويل وإعادة المبلغ للصندوق العام',
            amount: pendingTransfer.amount,
            transferNumber: pendingTransfer.transferNumber,
            status: PendingTransferStatus.REJECTED
          };
        }
      });
    } catch (error) {
      if (error instanceof BadRequestException || error instanceof NotFoundException) {
        throw error;
      }
      console.error('Error in handlePendingTransfer:', error);
      throw new InternalServerErrorException('حدث خطأ أثناء معالجة التحويل المعلق');
    }
  }

  /**
   * الحصول على تاريخ تحويلات الوارديات
   */
  async getPendingTransferHistory(status?: string) {
    try {
      const where: any = {};
      
      if (status) {
        where.status = status;
      }

      const transfers = await this.prisma.pendingShiftTransfer.findMany({
        where,
        include: {
          requestedBy: {
            select: {
              username: true
            }
          },
          acceptedBy: {
            select: {
              username: true
            }
          },
          expenseInvoice: {
            select: {
              invoiceNumber: true,
              shift: true
            }
          },
          incomeInvoice: {
            select: {
              invoiceNumber: true,
              shift: true
            }
          }
        },
        orderBy: {
          requestedAt: 'desc'
        }
      });

      return {
        transfers,
        count: transfers.length,
        totalAmount: transfers.reduce((sum, transfer) => sum + transfer.amount, 0)
      };
    } catch (error) {
      console.error('Error in getPendingTransferHistory:', error);
      throw new InternalServerErrorException('حدث خطأ أثناء جلب تاريخ التحويلات');
    }
  }



}
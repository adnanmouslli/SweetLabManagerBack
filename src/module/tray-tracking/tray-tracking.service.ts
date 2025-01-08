import { PrismaService } from '@/prisma/prisma.service';
import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';

@Injectable()
export class TrayTrackingService {
 constructor(private prisma: PrismaService) {}


 async markTraysAsReturned(invoiceId: number) {
    try {
      const trayTracking = await this.prisma.trayTracking.findUnique({
        where: { invoiceId }
      });
  
      if (!trayTracking) {
        throw new NotFoundException('لم يتم العثور على سجل الصاجات');
      }
  
      if (trayTracking.status === 'returned') {
        throw new BadRequestException('تم إرجاع الصاجات مسبقاً');
      }
  
      return await this.prisma.trayTracking.update({
        where: { invoiceId },
        data: {
          status: 'returned',
          returnedAt: new Date(),
          notes: `${trayTracking.notes}\nتم إرجاع الصاجات بتاريخ ${new Date().toISOString()}`
        }
      });
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) {
        throw error;
      }
      throw new InternalServerErrorException('حدث خطأ أثناء تحديث حالة الصاجات');
    }
  }
  
  async getPendingTrays() {
    return this.prisma.trayTracking.findMany({
      where: {
        status: 'pending'
      },
     
      orderBy: {
        createdAt: 'desc'
      }
    });
  }
  
}

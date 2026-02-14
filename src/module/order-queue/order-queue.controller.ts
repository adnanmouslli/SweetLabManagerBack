import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Res,
  UseGuards,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { OrderQueueService } from './order-queue.service';
import { JwtAuthGuard, RolesGuard } from '@/common';

@Controller('order-queue')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrderQueueController {
  constructor(private readonly orderQueueService: OrderQueueService) {}

  /**
   * حالة الدور الحالي لليوم
   */
  @Get('status')
  getQueueStatus() {
    return this.orderQueueService.getQueueStatus();
  }

  /**
   * طباعة تذكرة الدور لطلبية معينة
   */
  @Get('ticket/:orderId')
  async getQueueTicket(
    @Param('orderId', ParseIntPipe) orderId: number,
    @Res() res: Response,
  ) {
    try {
      const htmlContent =
        await this.orderQueueService.generateQueueTicketHTML(orderId);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(htmlContent);
    } catch (error) {
      throw new HttpException(
        `خطأ في توليد تذكرة الدور: ${error.message}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}

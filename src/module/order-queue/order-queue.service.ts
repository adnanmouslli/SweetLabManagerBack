import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Cron } from '@nestjs/schedule';

@Injectable()
export class OrderQueueService {
  constructor(private prisma: PrismaService) {}

  /**
   * الحصول على تاريخ اليوم بتوقيت سوريا (بدون وقت)
   */
  private getTodayDateSyria(): Date {
    const now = new Date();
    const localOffset = now.getTimezoneOffset();
    const syriaOffset = -180; // UTC+3
    const diff = syriaOffset - (-localOffset);
    now.setMinutes(now.getMinutes() + diff);
    // إرجاع التاريخ فقط بدون وقت
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }

  /**
   * الحصول على رقم الدور التالي لليوم
   */
  async getNextQueueNumber(): Promise<number> {
    const todayDate = this.getTodayDateSyria();

    const queue = await this.prisma.orderQueue.upsert({
      where: { date: todayDate },
      update: { lastNumber: { increment: 1 } },
      create: { date: todayDate, lastNumber: 1 },
    });

    return queue.lastNumber;
  }

  /**
   * الحصول على حالة الدور الحالي لليوم
   */
  async getQueueStatus(): Promise<{ date: string; currentNumber: number }> {
    const todayDate = this.getTodayDateSyria();

    const queue = await this.prisma.orderQueue.findUnique({
      where: { date: todayDate },
    });

    return {
      date: todayDate.toISOString().split('T')[0],
      currentNumber: queue?.lastNumber || 0,
    };
  }

  /**
   * تصفير العداد كل يوم الساعة 12 بليل بتوقيت سوريا (UTC+3 → 21:00 UTC)
   */
  @Cron('0 21 * * *')
  async resetDailyQueue(): Promise<void> {
    console.log('تصفير عداد الدور اليومي...');
    // لا حاجة لحذف أي شيء - سجل اليوم الجديد سيُنشأ تلقائياً عند أول طلبية
    // الأرقام القديمة تبقى للأرشفة
  }

  private formatCurrency(amount: number | null | undefined): string {
    const numericAmount = Number(amount) || 0;
    return numericAmount.toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });
  }

  /**
   * توليد تذكرة الدور بصيغة HTML للطباعة على طابعة حرارية
   */
  async generateQueueTicketHTML(orderId: number): Promise<string> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        customer: true,
        category: true,
        items: {
          include: {
            item: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException('الطلبية غير موجودة');
    }

    if (!order.queueNumber) {
      throw new NotFoundException('لا يوجد رقم دور لهذه الطلبية');
    }

    const createdAt = new Date(order.createdAt);
    const dateStr = createdAt.toLocaleDateString('en-GB', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      timeZone: 'Asia/Damascus',
    });
    const timeStr = createdAt.toLocaleTimeString('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      timeZone: 'Asia/Damascus',
    });

    return `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=80mm, initial-scale=1.0">
  <title>تذكرة دور #${order.queueNumber}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Segoe UI', Tahoma, Arial, 'Noto Kufi Arabic', sans-serif;
      padding: 8px;
      background: #fff;
      color: #000;
      font-size: 13px;
      line-height: 1.4;
      font-weight: 600;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }

    .header {
      text-align: center;
      margin-bottom: 6px;
      padding-bottom: 6px;
      border-bottom: 1px solid #000;
    }

    .header .bakery-name {
      font-size: 18px;
      font-weight: bold;
      color: #000;
      margin-bottom: 2px;
    }

    .header .sub-title {
      font-size: 12px;
      color: #000;
      font-weight: 700;
    }

    .queue-section {
      text-align: center;
      padding: 8px 0;
      border-bottom: 1px dashed #000;
    }

    .queue-label {
      font-size: 14px;
      font-weight: 700;
      color: #000;
      margin-bottom: 2px;
    }

    .queue-number {
      font-size: 72px;
      font-weight: 900;
      line-height: 1;
      color: #000;
      letter-spacing: 2px;
    }

    .details {
      padding: 8px 0;
      border-bottom: 1px dashed #000;
    }

    .detail-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4px 0;
      font-size: 13px;
      font-weight: 700;
    }

    .detail-row .label {
      color: #000;
      font-weight: bold;
    }

    .detail-row .value {
      color: #000;
      font-weight: 700;
      font-size: 14px;
    }

    .category-badge {
      text-align: center;
      padding: 6px 0;
      border-bottom: 1px dashed #000;
    }

    .category-badge span {
      display: inline-block;
      font-size: 14px;
      font-weight: 700;
      color: #000;
      padding: 4px 16px;
      border: 2px solid #000;
      border-radius: 2px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
    }

    th {
      background: #fff;
      color: #000;
      padding: 10px 6px;
      text-align: center;
      font-size: 13px;
      font-weight: 700;
      border: 1px solid #000;
    }

    td {
      padding: 8px;
      border: 1px solid #000;
      font-size: 12px;
      background: #fff;
      color: #000;
      font-weight: 600;
    }

    .total-row {
      font-weight: 700;
      border-top: 2px solid #000 !important;
    }

    .total-row td {
      padding: 10px 6px;
      font-size: 13px;
      background: #fff;
      font-weight: 700;
    }

    .text-center {
      text-align: center;
    }

    .text-bold {
      font-weight: bold;
    }

    .text-primary {
      color: #000;
      font-weight: bold;
    }

    .footer {
      text-align: center;
      padding-top: 6px;
      font-size: 11px;
      color: #000;
      font-weight: 700;
    }

    @media print {
      @page {
        size: 80mm auto;
        margin: 2mm;
      }

      body {
        padding: 2mm;
        font-weight: 700;
        color: #000 !important;
      }

      .header .bakery-name {
        font-size: 17px;
      }

      .queue-number {
        font-size: 72px;
      }

      .detail-row {
        font-size: 12px;
      }

      .detail-row .value {
        font-size: 13px;
      }

      th {
        font-size: 12px;
        padding: 8px 5px;
        font-weight: 700;
        color: #000 !important;
      }

      td {
        font-size: 11px;
        padding: 7px 5px;
        font-weight: 700;
        color: #000 !important;
      }

      .total-row td {
        font-size: 12px;
        font-weight: 700;
      }

      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }
  </style>
</head>
<body>

  <div class="header">
    <div class="bakery-name">مخبز الإحسان الدمشقي</div>
    <div class="sub-title">تذكرة دور</div>
  </div>

  <div class="queue-section">
    <div class="queue-label">رقم الدور</div>
    <div class="queue-number">${order.queueNumber}</div>
  </div>

  <div class="details">
    <div class="detail-row">
      <span class="label">الزبون:</span>
      <span class="value">${order.customer.name}</span>
    </div>
  </div>

  <div class="category-badge">
    <span>${order.category.name}</span>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width: 30%">اسم الصنف</th>
        <th style="width: 18%">الوحدة</th>
        <th style="width: 17%">الكمية</th>
        <th style="width: 17%">سعر الوحدة</th>
        <th style="width: 18%">الإجمالي</th>
      </tr>
    </thead>
    <tbody>
      ${order.items.map(oi => `
      <tr>
        <td class="text-center text-bold">${oi.item.name}</td>
        <td class="text-center">${oi.unit}</td>
        <td class="text-center text-bold">${oi.quantity}</td>
        <td class="text-center text-primary">${this.formatCurrency(oi.unitPrice)} ل.س</td>
        <td class="text-center text-primary">${this.formatCurrency(oi.subTotal)} ل.س</td>
      </tr>`).join('')}
      <tr class="total-row">
        <td colspan="2" class="text-center">المجموع</td>
        <td class="text-center">${order.items.reduce((s, i) => s + i.quantity, 0)}</td>
        <td colspan="2" class="text-center">${this.formatCurrency(order.items.reduce((s, i) => s + i.subTotal, 0))} ل.س</td>
      </tr>
    </tbody>
  </table>

  <div class="footer">
    <div>${dateStr} | ${timeStr}</div>
  </div>

  <script>
    window.onload = function() {
      setTimeout(() => {
        window.print();
      }, 500);
    };

    window.printReceipt = function() {
      window.print();
    };
  </script>
</body>
</html>`;
  }
}

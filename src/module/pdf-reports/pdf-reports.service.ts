import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as path from 'path';
import * as fs from 'fs';
import { OrderStatus } from '@prisma/client';

interface ReportData {
  customer: any;
  totals: {
    totalUnpaidAmount: number;
    totalBreakAmount: number;
    totalDebtsAmount: number;
    grandTotal: number;
  };
  unpaidInvoices: any[];
  breakInvoices?: any[];
  activeDebts?: any[];
  notes?: string;
}


interface OrdersInventoryFilters {
  customerName?: string;
  categoryId?: number;
  status?: OrderStatus[];
  paidStatus?: boolean; // true = مدفوع، false = غير مدفوع، undefined = الكل
  itemIds?: number[];
  startDate?: Date;
  endDate?: Date;
}

interface OrderInventoryItem {
  itemName: string;
  unit: string;
  totalQuantity: number;
  totalPieces?: number; // للقطع
  totalTrays?: number; // للصاجات
  orders: {
    orderNumber: string;
    customerName: string;
    status: string;
    paidStatus: boolean;
    quantity: number;
    scheduledFor: Date;
  }[];
}


interface WarehouseInventoryFilters {
  year: number;
  month: number; // 1-12
  itemGroupId?: number; // تصنيف المواد
  itemIds?: number[]; // مواد محددة
}

interface WarehouseInventoryItem {
  itemId: number;
  itemName: string;
  itemGroup: string;
  unit: string;
  openingStock: number; // الرصيد الافتتاحي
  purchases: number; // المشتريات خلال الشهر
  currentStock: number; // الرصيد الحالي (من آخر جرد)
  consumedQuantity: number; // الكمية المستهلكة
  averageUnitPrice: number; // متوسط سعر الوحدة
  totalValue: number; // القيمة الإجمالية للمستهلك
}

interface WarehouseInventorySummary {
  totalItems: number;
  totalConsumedValue: number;
  totalPurchaseValue: number;
  consumptionRate: number; // نسبة الاستهلاك
  byGroup: {
    groupName: string;
    itemsCount: number;
    totalValue: number;
    percentage: number;
  }[];
}

@Injectable()
export class PDFReportsService {
  constructor(private prisma: PrismaService) {}

  // قالب HTML الأساسي
  private getHTMLTemplate(): string {
    return `
<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>{{REPORT_TITLE}} - معمل الحلويات</title>
  <style>
    :root {
      --ink: #1b1b1b;
      --muted: #5b5b5b;
      --border: #d9d9d9;
      --bg: #ffffff;
      --accent: #444;
    }

    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      margin: 0; background: var(--bg); color: var(--ink);
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, Arial, "Noto Kufi Arabic", "Noto Naskh Arabic", "Amiri", Tahoma, sans-serif;
      line-height: 1.6;
    }

    .toolbar {
      position: sticky; top: 0; z-index: 1000; background: #fff; border-bottom: 1px solid var(--border);
      padding: 12px 16px; display: flex; gap: 8px; align-items: center; justify-content: space-between;
    }
    .toolbar .left, .toolbar .right { display: flex; gap: 8px; align-items: center; }
    .btn {
      border: 1px solid var(--border); background: #fff; color: var(--ink);
      padding: 8px 14px; cursor: pointer; border-radius: 8px; font-weight: 600; transition: .2s ease;
    }
    .btn:hover { border-color: var(--accent); }
    .btn:active { transform: translateY(1px); }
    .sep { width: 1px; height: 28px; background: var(--border); margin: 0 8px; }

    .sheet {
      width: 210mm; min-height: 297mm; margin: 16px auto; background: #fff;
      border: 1px solid var(--border); border-radius: 12px; box-shadow: 0 4px 14px rgba(0,0,0,.04);
      padding: 18mm 16mm 24mm; position: relative; overflow: hidden;
    }

    header.report-header { text-align: center; margin-bottom: 10mm; }
    .brand { font-size: 20px; font-weight: 700; letter-spacing: .3px; }
    .meta-row { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 8px; color: var(--muted); font-size: 12px; margin-top: 6px; }
    .title { font-size: 18px; font-weight: 700; margin-top: 8px; }
    .subtitle { font-size: 13px; color: var(--muted); margin-top: 2px; }

    footer.report-footer {
      position: fixed; bottom: 10mm; left: 0; right: 0; margin: 0 auto;
      width: 180mm; text-align: center; font-size: 11px; color: var(--muted);
    }
    footer .pageno::after { content: counter(page) " / " counter(pages); }

    .section { margin: 8mm 0; }
    .section h3 { font-size: 15px; margin: 0 0 6px; border-right: 3px solid var(--accent); padding-right: 8px; }
    .muted { color: var(--muted); }

    .cards { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
    .card { border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
    .card .label { font-size: 12px; color: var(--muted); }
    .card .value { font-size: 16px; font-weight: 700; margin-top: 4px; }

    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead th {
      text-align: center; font-weight: 700; font-size: 12px;
      border: 1px solid var(--border); padding: 8px; background: #fafafa;
    }
    tbody td { border: 1px solid var(--border); padding: 8px; font-size: 12px; word-wrap: break-word; }
    tbody tr:nth-child(even) td { background: #fcfcfc; }

    .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; }
    .note { font-size: 11px; color: var(--muted); }
    .page-break { page-break-before: always; break-before: page; }

    @page { size: A4; margin: 15mm 12mm 18mm; }
    @media print {
      .toolbar, .print-hint { display: none !important; }
      .sheet { border: none; margin: 0; box-shadow: none; width: auto; min-height: auto; padding: 0; }
      header.report-header { margin-top: 0; }
      footer.report-footer { position: fixed; }
      body.landscape { -webkit-print-color-adjust: exact; }
      body.landscape @page { size: A4 landscape; }
    }
  </style>
</head>
<body>
  <div class="toolbar" role="region" aria-label="شريط الأدوات">
    <div class="left">
      <button class="btn" onclick="window.print()">طباعة / حفظ PDF</button>
      <div class="sep" aria-hidden="true"></div>
      <button class="btn" onclick="toggleOrientation()">تبديل الاتجاه (طولي/عرضي)</button>
    </div>
  </div>

  <main class="sheet" id="sheet">
    <header class="report-header">
      <div class="brand">معمل الحلويات</div>
      <div class="title">{{REPORT_TITLE}}</div>
      <div class="subtitle">{{REPORT_SUBTITLE}}</div>
      <div class="meta-row">
        <div>العميل: <strong>{{CUSTOMER_NAME}}</strong></div>
        <div>الهاتف: <span>{{CUSTOMER_PHONE}}</span></div>
        <div>الفئة: <span>{{CUSTOMER_CATEGORY}}</span></div>
      </div>
    </header>

    <section class="section" id="account-summary">
      <h3>ملخص الحساب</h3>
      <div class="cards">
        <div class="card"><div class="label">الفواتير غير المدفوعة</div><div class="value">{{TOTAL_UNPAID}}</div></div>
        <div class="card"><div class="label">فواتير الكسر</div><div class="value">{{TOTAL_BREAK}}</div></div>
        <div class="card"><div class="label">الديون النشطة</div><div class="value">{{TOTAL_DEBTS}}</div></div>
      </div>
      <p class="note" style="margin-top:6px">المجموع الكلي: <strong>{{GRAND_TOTAL}}</strong></p>
    </section>

    <section class="section" id="unpaid-section">
      <h3>الفواتير غير المدفوعة</h3>
      <table>
        <thead>
          <tr>
            <th style="width: 20%">رقم الفاتورة</th>
            <th style="width: 20%">التاريخ</th>
            <th style="width: 20%">المبلغ الكلي</th>
            <th style="width: 20%">الخصم</th>
            <th style="width: 20%">الصافي</th>
          </tr>
        </thead>
        <tbody>
          {{UNPAID_INVOICES_ROWS}}
        </tbody>
      </table>
    </section>

    {{ADDITIONAL_SECTIONS}}

    <section class="section">
      <div class="grid-2">
        <div>
          <h3>ملاحظات</h3>
          <p class="muted">{{NOTES}}</p>
        </div>
        <div>
          <h3>توقيع</h3>
          <p class="muted">.......................................................</p>
        </div>
      </div>
    </section>

    <footer class="report-footer">
      <div>معمل الحلويات — هاتف: 123-456-789</div>
      <div>الصفحة <span class="pageno"></span></div>
    </footer>
  </main>

  <script>
    function toggleOrientation(){
      document.body.classList.toggle('landscape');
    }
  </script>
</body>
</html>`;
  }

  // توليد كشف حساب العميل بصيغة HTML
  async generateCustomerStatementHTML(customerId: number): Promise<string> {
    const reportData = await this.getCustomerStatementData(customerId);
    return this.buildCustomerStatementHTML(reportData);
  }

  // بناء HTML كشف الحساب
  private buildCustomerStatementHTML(data: ReportData): string {
    let template = this.getHTMLTemplate();
    
    // استبدال المتغيرات الأساسية
    const replacements = {
      '{{REPORT_TITLE}}': `كشف حساب العميل: ${data.customer.name}`,
      '{{REPORT_SUBTITLE}}': `كما في تاريخ ${this.formatDate(new Date())}`,
      '{{CUSTOMER_NAME}}': data.customer.name || '—',
      '{{CUSTOMER_PHONE}}': data.customer.phone || '—',
      '{{CUSTOMER_CATEGORY}}': data.customer.category?.name || '—',
      '{{TOTAL_UNPAID}}': this.formatCurrency(data.totals.totalUnpaidAmount),
      '{{TOTAL_BREAK}}': this.formatCurrency(data.totals.totalBreakAmount),
      '{{TOTAL_DEBTS}}': this.formatCurrency(data.totals.totalDebtsAmount),
      '{{GRAND_TOTAL}}': this.formatCurrency(data.totals.grandTotal),
      '{{NOTES}}': data.notes || '—'
    };

    // تطبيق الاستبدالات
    Object.entries(replacements).forEach(([key, value]) => {
      template = template.replace(new RegExp(key, 'g'), value);
    });

    // بناء صفوف الفواتير غير المدفوعة
    const unpaidRows = this.buildInvoiceRows(data.unpaidInvoices);
    template = template.replace('{{UNPAID_INVOICES_ROWS}}', unpaidRows);

    // إضافة أقسام إضافية إذا لزم الأمر
    let additionalSections = '';
    
    if (data.breakInvoices && data.breakInvoices.length > 0) {
      additionalSections += this.buildBreakInvoicesSection(data.breakInvoices);
    }

    if (data.activeDebts && data.activeDebts.length > 0) {
      additionalSections += this.buildActiveDebtsSection(data.activeDebts);
    }

    template = template.replace('{{ADDITIONAL_SECTIONS}}', additionalSections);

    return template;
  }

  // بناء صفوف جدول الفواتير
  private buildInvoiceRows(invoices: any[]): string {
    if (!invoices || invoices.length === 0) {
      return '<tr><td colspan="5" style="text-align:center" class="muted">لا توجد فواتير غير مدفوعة</td></tr>';
    }

    return invoices.map(invoice => {
      const netAmount = (invoice.totalAmount || 0) - (invoice.discount || 0);
      return `
        <tr>
          <td style="text-align:center">${invoice.invoiceNumber || ''}</td>
          <td style="text-align:center">${this.formatDate(invoice.createdAt)}</td>
          <td style="text-align:center">${this.formatCurrency(invoice.totalAmount)}</td>
          <td style="text-align:center">${this.formatCurrency(invoice.discount || 0)}</td>
          <td style="text-align:center">${this.formatCurrency(netAmount)}</td>
        </tr>
      `;
    }).join('');
  }

  // بناء قسم فواتير الكسر
  private buildBreakInvoicesSection(breakInvoices: any[]): string {
    const rows = breakInvoices.map(invoice => {
      const netAmount = (invoice.totalAmount || 0) - (invoice.discount || 0);
      return `
        <tr>
          <td style="text-align:center">${invoice.invoiceNumber || ''}</td>
          <td style="text-align:center">${this.formatDate(invoice.createdAt)}</td>
          <td style="text-align:center">${this.formatCurrency(invoice.totalAmount)}</td>
          <td style="text-align:center">${this.formatCurrency(invoice.discount || 0)}</td>
          <td style="text-align:center">${this.formatCurrency(netAmount)}</td>
        </tr>
      `;
    }).join('');

    return `
      <div class="page-break"></div>
      <section class="section">
        <h3>فواتير الكسر</h3>
        <table>
          <thead>
            <tr>
              <th style="width: 20%">رقم الفاتورة</th>
              <th style="width: 20%">التاريخ</th>
              <th style="width: 20%">المبلغ الكلي</th>
              <th style="width: 20%">الخصم</th>
              <th style="width: 20%">الصافي</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </section>
    `;
  }

  // بناء قسم الديون النشطة
  private buildActiveDebtsSection(activeDebts: any[]): string {
    const rows = activeDebts.map(debt => `
      <tr>
        <td style="text-align:center">${debt.id}</td>
        <td style="text-align:center">${this.formatDate(debt.createdAt)}</td>
        <td style="text-align:center">${this.formatCurrency(debt.originalAmount)}</td>
        <td style="text-align:center">${this.formatCurrency(debt.paidAmount || 0)}</td>
        <td style="text-align:center">${this.formatCurrency(debt.remainingAmount)}</td>
        <td style="text-align:center">${debt.description || '—'}</td>
      </tr>
    `).join('');

    return `
      <section class="section">
        <h3>الديون النشطة</h3>
        <table>
          <thead>
            <tr>
              <th style="width: 15%">رقم الدين</th>
              <th style="width: 20%">التاريخ</th>
              <th style="width: 20%">المبلغ الأصلي</th>
              <th style="width: 15%">المدفوع</th>
              <th style="width: 15%">المتبقي</th>
              <th style="width: 15%">الوصف</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </section>
    `;
  }

  // جلب بيانات كشف الحساب من قاعدة البيانات
  private async getCustomerStatementData(customerId: number): Promise<ReportData> {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      include: { category: true }
    });

    if (!customer) {
      throw new Error('العميل غير موجود');
    }

    const [unpaidInvoices, breakInvoices, activeDebts] = await Promise.all([
      this.prisma.invoice.findMany({
        where: { customerId, paidStatus: false, isBreak: false },
        orderBy: { createdAt: 'desc' }
      }),
      this.prisma.invoice.findMany({
        where: { customerId, isBreak: true, paidStatus: false },
        orderBy: { createdAt: 'desc' }
      }),
      this.prisma.debt.findMany({
        where: { customerId, status: 'active' },
        orderBy: { createdAt: 'desc' }
      })
    ]);

    const totals = {
      totalUnpaidAmount: unpaidInvoices.reduce((sum, inv) => sum + (inv.totalAmount - (inv.discount || 0)), 0),
      totalBreakAmount: breakInvoices.reduce((sum, inv) => sum + (inv.totalAmount - (inv.discount || 0)), 0),
      totalDebtsAmount: activeDebts.reduce((sum, debt) => sum + debt.remainingAmount, 0),
      get grandTotal() { return this.totalUnpaidAmount + this.totalBreakAmount + this.totalDebtsAmount; }
    };

    // إضافة ملاحظات حسب حالة العميل
    let notes = '';
    if (totals.grandTotal > 100000) {
      notes = 'ملاحظة: يرجى التسديد خلال أسبوع من تاريخ هذا الكشف';
    } else if (totals.totalDebtsAmount > 0) {
      notes = 'يوجد ديون نشطة تتطلب المتابعة';
    } else {
      notes = 'حساب منتظم';
    }

    return {
      customer,
      totals,
      unpaidInvoices,
      breakInvoices,
      activeDebts,
      notes
    };
  }

  // توليد تقرير مبيعات بصيغة HTML
  async generateSalesReportHTML(startDate: Date, endDate: Date): Promise<string> {
    const salesData = await this.getSalesReportData(startDate, endDate);
    return this.buildSalesReportHTML(salesData, startDate, endDate);
  }

  // بناء تقرير المبيعات
  private buildSalesReportHTML(salesData: any[], startDate: Date, endDate: Date): string {
    let template = this.getHTMLTemplate();
    
    const replacements = {
      '{{REPORT_TITLE}}': 'تقرير المبيعات',
      '{{REPORT_SUBTITLE}}': `من ${this.formatDate(startDate)} إلى ${this.formatDate(endDate)}`,
      '{{CUSTOMER_NAME}}': '—',
      '{{CUSTOMER_PHONE}}': '—',
      '{{CUSTOMER_CATEGORY}}': '—',
      '{{TOTAL_UNPAID}}': '—',
      '{{TOTAL_BREAK}}': '—',
      '{{TOTAL_DEBTS}}': '—',
      '{{GRAND_TOTAL}}': '—',
      '{{NOTES}}': '—'
    };

    Object.entries(replacements).forEach(([key, value]) => {
      template = template.replace(new RegExp(key, 'g'), value);
    });

    // استبدال جدول الفواتير بجدول المبيعات
    const salesTableHTML = this.buildSalesTable(salesData);
    template = template.replace(/(<section class="section" id="unpaid-section">[\s\S]*?<\/section>)/g, salesTableHTML);
    
    // إخفاء قسم ملخص الحساب
    template = template.replace(/(<section class="section" id="account-summary">[\s\S]*?<\/section>)/g, '');
    
    template = template.replace('{{ADDITIONAL_SECTIONS}}', '');

    return template;
  }

  // بناء جدول المبيعات
  private buildSalesTable(salesData: any[]): string {
    const rows = salesData.map(sale => `
      <tr>
        <td style="text-align:center">${sale.period}</td>
        <td style="text-align:center">${sale.invoiceCount}</td>
        <td style="text-align:center">${this.formatCurrency(sale.totalSales)}</td>
        <td style="text-align:center">${this.formatCurrency(sale.totalProfit || 0)}</td>
      </tr>
    `).join('');

    const totalSales = salesData.reduce((sum, sale) => sum + sale.totalSales, 0);
    const totalInvoices = salesData.reduce((sum, sale) => sum + sale.invoiceCount, 0);

    return `
      <section class="section">
        <h3>تقرير المبيعات</h3>
        <table>
          <thead>
            <tr>
              <th style="width: 25%">الفترة</th>
              <th style="width: 25%">عدد الفواتير</th>
              <th style="width: 25%">إجمالي المبيعات</th>
              <th style="width: 25%">إجمالي الربح</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
            <tr style="background-color: #f0f8ff; font-weight: bold;">
              <td style="text-align:center">المجموع</td>
              <td style="text-align:center">${totalInvoices}</td>
              <td style="text-align:center">${this.formatCurrency(totalSales)}</td>
              <td style="text-align:center">—</td>
            </tr>
          </tbody>
        </table>
      </section>
    `;
  }

  // جلب بيانات تقرير المبيعات
  private async getSalesReportData(startDate: Date, endDate: Date) {
    const invoices = await this.prisma.invoice.findMany({
      where: {
        createdAt: {
          gte: startDate,
          lte: endDate
        },
        paidStatus: true
      },
      select: {
        totalAmount: true,
        discount: true,
        createdAt: true,
      }
    });

    // تجميع البيانات حسب الشهر
    const salesByMonth = new Map();
    
    invoices.forEach(invoice => {
      const month = new Date(invoice.createdAt).toLocaleDateString('ar-SA', { 
        year: 'numeric', 
        month: 'long' 
      });
      
      if (!salesByMonth.has(month)) {
        salesByMonth.set(month, {
          period: month,
          invoiceCount: 0,
          totalSales: 0
        });
      }
      
      const monthData = salesByMonth.get(month);
      monthData.invoiceCount++;
      monthData.totalSales += (invoice.totalAmount - (invoice.discount || 0));
    });

    return Array.from(salesByMonth.values()).sort((a, b) => 
      new Date(a.period).getTime() - new Date(b.period).getTime()
    );
  }

  // حفظ HTML كملف
  async saveHTMLReport(htmlContent: string, filename: string): Promise<string> {
    const reportsDir = path.join(process.cwd(), 'temp', 'reports');
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const filePath = path.join(reportsDir, `${filename}.html`);
    fs.writeFileSync(filePath, htmlContent, 'utf8');
    
    return filePath;
  }

  // دوال مساعدة
  private formatDate(date: Date | string): string {
    return new Date(date).toLocaleDateString('ar-SA', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
  }


  private formatCurrency(amount: number | null | undefined): string {
    const numericAmount = Number(amount) || 0;
    return `${numericAmount.toFixed(2)} ل.س`;
    }


  // طريقة سريعة لمعاينة التقرير
  async previewCustomerStatement(customerId: number): Promise<string> {
    return this.generateCustomerStatementHTML(customerId);
  }



  // order  


  // توليد تقرير جرد الطلبيات بصيغة HTML
async generateOrdersInventoryReportHTML(filters: OrdersInventoryFilters): Promise<string> {
  const inventoryData = await this.getOrdersInventoryData(filters);
  return this.buildOrdersInventoryHTML(inventoryData, filters);
}

// جلب بيانات جرد الطلبيات من قاعدة البيانات
private async getOrdersInventoryData(filters: OrdersInventoryFilters) {
  // بناء شروط البحث
  const where: any = {};
  
  // فلتر العميل بالاسم
  if (filters.customerName) {
    where.customer = {
      name: {
        contains: filters.customerName,
        mode: 'insensitive'
      }
    };
  }
  
  // فلتر التصنيف
  if (filters.categoryId) {
    where.categoryId = filters.categoryId;
  }
  
  // فلتر حالة الطلبية
  if (filters.status && filters.status.length > 0) {
    where.status = {
      in: filters.status
    };
  }
  
  // فلتر حالة الدفع
  if (filters.paidStatus !== undefined) {
    where.paidStatus = filters.paidStatus;
  }
  
  // فلتر التاريخ
  if (filters.startDate || filters.endDate) {
    where.scheduledFor = {};
    if (filters.startDate) {
      where.scheduledFor.gte = filters.startDate;
    }
    if (filters.endDate) {
      where.scheduledFor.lte = filters.endDate;
    }
  }
  
  // جلب الطلبيات مع العناصر
  const orders = await this.prisma.order.findMany({
    where,
    include: {
      customer: true,
      category: true,
      items: {
        include: {
          item: true
        },
        where: filters.itemIds && filters.itemIds.length > 0 ? {
          itemId: { in: filters.itemIds }
        } : undefined
      }
    },
    orderBy: {
      scheduledFor: 'desc'
    }
  });
  
  // تجميع البيانات حسب المادة
  const itemsMap = new Map<number, OrderInventoryItem>();
  
  orders.forEach(order => {
    order.items.forEach(orderItem => {
      const itemId = orderItem.itemId;
      
      if (!itemsMap.has(itemId)) {
        itemsMap.set(itemId, {
          itemName: orderItem.item.name,
          unit: orderItem.unit,
          totalQuantity: 0,
          totalPieces: 0,
          totalTrays: 0,
          orders: []
        });
      }
      
      const inventoryItem = itemsMap.get(itemId)!;
      inventoryItem.totalQuantity += orderItem.quantity;
      
      // تحديد نوع الوحدة للتجميع
      if (orderItem.unit.includes('قطعة') || orderItem.unit.includes('حبة')) {
        inventoryItem.totalPieces! += orderItem.quantity;
      } else if (orderItem.unit.includes('صاج') || orderItem.unit.includes('طبق')) {
        inventoryItem.totalTrays! += orderItem.quantity;
      }
      
      // إضافة تفاصيل الطلبية
      inventoryItem.orders.push({
        orderNumber: order.orderNumber,
        customerName: order.customer.name,
        status: this.getStatusArabicName(order.status),
        paidStatus: order.paidStatus,
        quantity: orderItem.quantity,
        scheduledFor: order.scheduledFor
      });
    });
  });
  
  // تحويل إلى مصفوفة وترتيب حسب الكمية
  const inventoryItems = Array.from(itemsMap.values()).sort((a, b) => b.totalQuantity - a.totalQuantity);
  
  // حساب الإجماليات
  const summary = {
    totalOrders: orders.length,
    totalItems: inventoryItems.length,
    totalQuantity: inventoryItems.reduce((sum, item) => sum + item.totalQuantity, 0),
    totalPieces: inventoryItems.reduce((sum, item) => sum + (item.totalPieces || 0), 0),
    totalTrays: inventoryItems.reduce((sum, item) => sum + (item.totalTrays || 0), 0),
    paidOrdersCount: orders.filter(o => o.paidStatus).length,
    unpaidOrdersCount: orders.filter(o => !o.paidStatus).length
  };
  
  return {
    items: inventoryItems,
    summary,
    filters
  };
}

// بناء HTML تقرير جرد الطلبيات
private buildOrdersInventoryHTML(data: any, filters: OrdersInventoryFilters): string {
  let template = this.getHTMLTemplate();
  
  // تحديد عنوان التقرير حسب الفلاتر
  let reportTitle = 'تقرير جرد الطلبيات';
  let reportSubtitle = `إجمالي ${data.summary.totalOrders} طلبية`;
  
  if (filters.customerName) {
    reportSubtitle += ` - العميل: ${filters.customerName}`;
  }
  if (filters.status && filters.status.length > 0) {
    reportSubtitle += ` - الحالة: ${filters.status.map(s => this.getStatusArabicName(s)).join(', ')}`;
  }
  
  const replacements = {
    '{{REPORT_TITLE}}': reportTitle,
    '{{REPORT_SUBTITLE}}': reportSubtitle,
    '{{CUSTOMER_NAME}}': filters.customerName || 'جميع العملاء',
    '{{CUSTOMER_PHONE}}': '—',
    '{{CUSTOMER_CATEGORY}}': '—',
    '{{TOTAL_UNPAID}}': `${data.summary.totalItems} مادة`,
    '{{TOTAL_BREAK}}': `${data.summary.totalPieces} قطعة`,
    '{{TOTAL_DEBTS}}': `${data.summary.totalTrays} صاج`,
    '{{GRAND_TOTAL}}': `${data.summary.totalQuantity} إجمالي الكمية`,
    '{{NOTES}}': this.buildFiltersNotes(filters)
  };
  
  // تطبيق الاستبدالات
  Object.entries(replacements).forEach(([key, value]) => {
    template = template.replace(new RegExp(key, 'g'), value);
  });
  
  // بناء جدول المواد
  const inventoryTableHTML = this.buildInventoryTable(data.items);
  template = template.replace(/(<section class="section" id="unpaid-section">[\s\S]*?<\/section>)/g, inventoryTableHTML);
  
  // تحديث قسم ملخص الحساب ليعكس ملخص الجرد
  const summaryHTML = this.buildInventorySummary(data.summary);
  template = template.replace(/(<section class="section" id="account-summary">[\s\S]*?<\/section>)/g, summaryHTML);
  
  template = template.replace('{{ADDITIONAL_SECTIONS}}', '');
  
  return template;
}

// بناء جدول المواد
private buildInventoryTable(items: OrderInventoryItem[]): string {
  if (!items || items.length === 0) {
    return `
      <section class="section">
        <h3>جرد المواد المطلوبة</h3>
        <p class="muted" style="text-align:center; padding: 20px;">لا توجد مواد مطابقة للفلاتر المحددة</p>
      </section>
    `;
  }
  
  const rows = items.map(item => {
    const piecesDisplay = item.totalPieces && item.totalPieces > 0 ? item.totalPieces : '—';
    const traysDisplay = item.totalTrays && item.totalTrays > 0 ? item.totalTrays : '—';
    
    return `
      <tr>
        <td style="text-align:right; font-weight: bold;">${item.itemName}</td>
        <td style="text-align:center">${item.unit}</td>
        <td style="text-align:center; font-weight: bold; color: #2563eb;">${item.totalQuantity}</td>
        <td style="text-align:center">${piecesDisplay}</td>
        <td style="text-align:center">${traysDisplay}</td>
        <td style="text-align:center">${item.orders.length}</td>
      </tr>
    `;
  }).join('');
  
  // حساب الإجماليات
  const totalQuantity = items.reduce((sum, item) => sum + item.totalQuantity, 0);
  const totalPieces = items.reduce((sum, item) => sum + (item.totalPieces || 0), 0);
  const totalTrays = items.reduce((sum, item) => sum + (item.totalTrays || 0), 0);
  const totalOrders = items.reduce((sum, item) => sum + item.orders.length, 0);
  
  return `
    <section class="section">
      <h3>جرد المواد المطلوبة</h3>
      <table>
        <thead>
          <tr>
            <th style="width: 25%">اسم المادة</th>
            <th style="width: 15%">الوحدة</th>
            <th style="width: 15%">إجمالي الكمية</th>
            <th style="width: 15%">القطع</th>
            <th style="width: 15%">الصاجات</th>
            <th style="width: 15%">عدد الطلبيات</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
          <tr style="background-color: #f0f8ff; font-weight: bold; border-top: 2px solid #2563eb;">
            <td style="text-align:right">المجموع الكلي</td>
            <td style="text-align:center">—</td>
            <td style="text-align:center; color: #2563eb;">${totalQuantity}</td>
            <td style="text-align:center">${totalPieces > 0 ? totalPieces : '—'}</td>
            <td style="text-align:center">${totalTrays > 0 ? totalTrays : '—'}</td>
            <td style="text-align:center">${totalOrders}</td>
          </tr>
        </tbody>
      </table>
    </section>
  `;
}

// بناء ملخص الجرد
private buildInventorySummary(summary: any): string {
  return `
    <section class="section" id="inventory-summary">
      <h3>ملخص جرد الطلبيات</h3>
      <div class="cards">
        <div class="card">
          <div class="label">إجمالي الطلبيات</div>
          <div class="value">${summary.totalOrders}</div>
        </div>
        <div class="card">
          <div class="label">عدد المواد المختلفة</div>
          <div class="value">${summary.totalItems}</div>
        </div>
        <div class="card">
          <div class="label">إجمالي الكمية</div>
          <div class="value">${summary.totalQuantity}</div>
        </div>
      </div>
      <div class="cards" style="margin-top: 8px;">
        <div class="card">
          <div class="label">القطع</div>
          <div class="value">${summary.totalPieces}</div>
        </div>
        <div class="card">
          <div class="label">الصاجات</div>
          <div class="value">${summary.totalTrays}</div>
        </div>
        <div class="card">
          <div class="label">الطلبيات المدفوعة</div>
          <div class="value">${summary.paidOrdersCount}/${summary.totalOrders}</div>
        </div>
      </div>
    </section>
  `;
}

// بناء ملاحظات الفلاتر
private buildFiltersNotes(filters: OrdersInventoryFilters): string {
  const notes = [];
  
  if (filters.customerName) {
    notes.push(`العميل: ${filters.customerName}`);
  }
  
  if (filters.status && filters.status.length > 0) {
    notes.push(`الحالة: ${filters.status.map(s => this.getStatusArabicName(s)).join(', ')}`);
  }
  
  if (filters.paidStatus === true) {
    notes.push('الطلبيات المدفوعة فقط');
  } else if (filters.paidStatus === false) {
    notes.push('الطلبيات غير المدفوعة فقط');
  }
  
  if (filters.startDate || filters.endDate) {
    let dateRange = 'الفترة: ';
    if (filters.startDate) {
      dateRange += `من ${this.formatDate(filters.startDate)}`;
    }
    if (filters.endDate) {
      dateRange += ` إلى ${this.formatDate(filters.endDate)}`;
    }
    notes.push(dateRange);
  }
  
  return notes.length > 0 ? notes.join(' • ') : 'جميع الطلبيات';
}

// تابع مساعد للحصول على اسم الحالة بالعربية
private getStatusArabicName(status: OrderStatus): string {
  const statusNames = {
    [OrderStatus.pending]: 'قيد الانتظار',
    [OrderStatus.processing]: 'قيد المعالجة',
    [OrderStatus.ready]: 'جاهزة للتسليم',
    [OrderStatus.delivered]: 'تم التسليم',
    [OrderStatus.cancelled]: 'ملغية'
  };
  
  return statusNames[status] || status;
}


// warehous


// توليد تقرير جرد المستودع الشهري
async generateWarehouseInventoryReportHTML(filters: WarehouseInventoryFilters): Promise<string> {
  const inventoryData = await this.getWarehouseInventoryData(filters);
  return this.buildWarehouseInventoryHTML(inventoryData, filters);
}


// بناء HTML تقرير جرد المستودع
private buildWarehouseInventoryHTML(data: any, filters: WarehouseInventoryFilters): string {
  let template = this.getHTMLTemplate();
  
  const reportTitle = `تقرير جرد المستودع الشهري`;
  const reportSubtitle = `${data.period.monthName} ${data.period.year}`;
  
  const replacements = {
    '{{REPORT_TITLE}}': reportTitle,
    '{{REPORT_SUBTITLE}}': reportSubtitle,
    '{{CUSTOMER_NAME}}': '—',
    '{{CUSTOMER_PHONE}}': '—',
    '{{CUSTOMER_CATEGORY}}': '—',
    '{{TOTAL_UNPAID}}': `${data.summary.totalItems} مادة`,
    '{{TOTAL_BREAK}}': `${data.summary.totalConsumedValue.toFixed(2)} ل.س`,
    '{{TOTAL_DEBTS}}': `${data.summary.consumptionRate.toFixed(1)}%`,
    '{{GRAND_TOTAL}}': `${data.summary.totalPurchaseValue.toFixed(2)} ل.س`,
    '{{NOTES}}': this.buildWarehouseInventoryNotes(data)
  };
  
  // تطبيق الاستبدالات
  Object.entries(replacements).forEach(([key, value]) => {
    template = template.replace(new RegExp(key, 'g'), value);
  });
  
  // بناء جدول المخزون
  const inventoryTableHTML = this.buildWarehouseInventoryTable(data.items);
  template = template.replace(/(<section class="section" id="unpaid-section">[\s\S]*?<\/section>)/g, inventoryTableHTML);
  
  // تحديث قسم الملخص
  const summaryHTML = this.buildWarehouseInventorySummary(data.summary);
  template = template.replace(/(<section class="section" id="account-summary">[\s\S]*?<\/section>)/g, summaryHTML);
  
  // إضافة قسم التحليل حسب التصنيف
  const groupAnalysisHTML = this.buildWarehouseGroupAnalysis(data.summary.byGroup);
  template = template.replace('{{ADDITIONAL_SECTIONS}}', groupAnalysisHTML);
  
  return template;
}

// بناء جدول جرد المستودع
private buildWarehouseInventoryTable(items: WarehouseInventoryItem[]): string {
  if (!items || items.length === 0) {
    return `
      <section class="section">
        <h3>جرد المستودع الشهري</h3>
        <p class="muted" style="text-align:center; padding: 20px;">لا توجد مواد مستهلكة خلال الفترة المحددة</p>
      </section>
    `;
  }
  
  // تجميع المواد حسب المجموعة
  const groupedItems = new Map<string, WarehouseInventoryItem[]>();
  items.forEach(item => {
    if (!groupedItems.has(item.itemGroup)) {
      groupedItems.set(item.itemGroup, []);
    }
    groupedItems.get(item.itemGroup)!.push(item);
  });
  
  let tableRows = '';
  let totalConsumedValue = 0;
  
  // بناء الصفوف مجمعة حسب التصنيف
  groupedItems.forEach((groupItems, groupName) => {
    // صف عنوان المجموعة
    tableRows += `
      <tr style="background-color: #f8f9fa; font-weight: bold;">
        <td colspan="7" style="text-align:center; padding: 12px; border: 2px solid #dee2e6;">
          ${groupName}
        </td>
      </tr>
    `;
    
    // صفوف المواد في المجموعة
    groupItems.forEach(item => {
      totalConsumedValue += item.totalValue;
      
      tableRows += `
        <tr>
          <td style="text-align:right">${item.itemName}</td>
          <td style="text-align:center">${item.unit}</td>
          <td style="text-align:center">${item.openingStock.toFixed(2)}</td>
          <td style="text-align:center">${item.purchases.toFixed(2)}</td>
          <td style="text-align:center">${item.currentStock.toFixed(2)}</td>
          <td style="text-align:center; font-weight: bold; color: #dc3545;">${item.consumedQuantity.toFixed(2)}</td>
          <td style="text-align:center">${this.formatCurrency(item.averageUnitPrice)}</td>
          <td style="text-align:center; font-weight: bold; color: #2563eb;">${this.formatCurrency(item.totalValue)}</td>
        </tr>
      `;
    });
  });
  
  // صف المجموع الكلي
  tableRows += `
    <tr style="background-color: #e3f2fd; font-weight: bold; border-top: 3px solid #2563eb;">
      <td colspan="7" style="text-align:center; font-size: 14px;">إجمالي قيمة الاستهلاك الشهري</td>
      <td style="text-align:center; color: #2563eb; font-size: 16px;">${this.formatCurrency(totalConsumedValue)}</td>
    </tr>
  `;
  
  return `
    <section class="section">
      <h3>جرد المستودع الشهري - تفاصيل الاستهلاك</h3>
      <table>
        <thead>
          <tr>
            <th style="width: 20%">اسم المادة</th>
            <th style="width: 10%">الوحدة</th>
            <th style="width: 12%">رصيد افتتاحي</th>
            <th style="width: 10%">المشتريات</th>
            <th style="width: 12%">الرصيد الحالي</th>
            <th style="width: 12%">المستهلك</th>
            <th style="width: 12%">سعر الوحدة</th>
            <th style="width: 12%">القيمة الإجمالية</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </section>
  `;
}

// بناء ملخص جرد المستودع
private buildWarehouseInventorySummary(summary: WarehouseInventorySummary): string {
  return `
    <section class="section" id="warehouse-summary">
      <h3>ملخص جرد المستودع</h3>
      <div class="cards">
        <div class="card">
          <div class="label">عدد المواد المستهلكة</div>
          <div class="value">${summary.totalItems}</div>
        </div>
        <div class="card">
          <div class="label">إجمالي قيمة الاستهلاك</div>
          <div class="value">${this.formatCurrency(summary.totalConsumedValue)}</div>
        </div>
        <div class="card">
          <div class="label">إجمالي قيمة المشتريات</div>
          <div class="value">${this.formatCurrency(summary.totalPurchaseValue)}</div>
        </div>
      </div>
      <div class="cards" style="margin-top: 8px;">
        <div class="card">
          <div class="label">نسبة الاستهلاك</div>
          <div class="value">${summary.consumptionRate.toFixed(1)}%</div>
        </div>
        <div class="card">
          <div class="label">أكبر تصنيف استهلاكاً</div>
          <div class="value">${summary.byGroup.length > 0 ? summary.byGroup[0].groupName : '—'}</div>
        </div>
        <div class="card">
          <div class="label">قيمة أكبر تصنيف</div>
          <div class="value">${summary.byGroup.length > 0 ? this.formatCurrency(summary.byGroup[0].totalValue) : '—'}</div>
        </div>
      </div>
    </section>
  `;
}

// بناء تحليل حسب التصنيف
private buildWarehouseGroupAnalysis(byGroup: any[]): string {
  if (!byGroup || byGroup.length === 0) {
    return '';
  }
  
  const rows = byGroup.map(group => `
    <tr>
      <td style="text-align:right; font-weight: bold;">${group.groupName}</td>
      <td style="text-align:center">${group.itemsCount}</td>
      <td style="text-align:center; color: #2563eb; font-weight: bold;">${this.formatCurrency(group.totalValue)}</td>
      <td style="text-align:center; font-weight: bold;">${group.percentage.toFixed(1)}%</td>
    </tr>
  `).join('');
  
  return `
    <section class="section">
      <h3>تحليل الاستهلاك حسب التصنيف</h3>
      <table>
        <thead>
          <tr>
            <th style="width: 40%">التصنيف</th>
            <th style="width: 20%">عدد المواد</th>
            <th style="width: 20%">القيمة الإجمالية</th>
            <th style="width: 20%">النسبة المئوية</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    </section>
  `;
}

// حساب ملخص جرد المستودع
private calculateWarehouseInventorySummary(items: WarehouseInventoryItem[]): WarehouseInventorySummary {
  const totalConsumedValue = items.reduce((sum, item) => sum + item.totalValue, 0);
  const totalPurchaseValue = items.reduce((sum, item) => sum + (item.purchases * item.averageUnitPrice), 0);
  
  // تجميع حسب المجموعة
  const groupMap = new Map<string, { itemsCount: number; totalValue: number }>();
  
  items.forEach(item => {
    if (!groupMap.has(item.itemGroup)) {
      groupMap.set(item.itemGroup, { itemsCount: 0, totalValue: 0 });
    }
    
    const group = groupMap.get(item.itemGroup)!;
    group.itemsCount++;
    group.totalValue += item.totalValue;
  });
  
  // تحويل إلى مصفوفة وحساب النسب المئوية
  const byGroup = Array.from(groupMap.entries())
    .map(([groupName, data]) => ({
      groupName,
      itemsCount: data.itemsCount,
      totalValue: data.totalValue,
      percentage: totalConsumedValue > 0 ? (data.totalValue / totalConsumedValue) * 100 : 0
    }))
    .sort((a, b) => b.totalValue - a.totalValue);
  
  return {
    totalItems: items.length,
    totalConsumedValue,
    totalPurchaseValue,
    consumptionRate: totalPurchaseValue > 0 ? (totalConsumedValue / totalPurchaseValue) * 100 : 0,
    byGroup
  };
}

// بناء ملاحظات التقرير
private buildWarehouseInventoryNotes(data: any): string {
  const notes = [];
  
  notes.push(`تقرير جرد شهر ${data.period.monthName} ${data.period.year}`);
  
  if (data.summary.totalItems > 0) {
    notes.push(`تم استهلاك ${data.summary.totalItems} مادة مختلفة`);
  }
  
  if (data.summary.consumptionRate > 90) {
    notes.push('نسبة استهلاك عالية - يُنصح بمراجعة المخزون');
  } else if (data.summary.consumptionRate < 50) {
    notes.push('نسبة استهلاك منخفضة - قد يدل على تراكم المخزون');
  }
  
  return notes.length > 0 ? notes.join(' • ') : 'تقرير جرد عادي';
}

// تابع مساعد للحصول على اسم الشهر بالعربية
private getArabicMonthName(month: number): string {
  const months = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  
  return months[month - 1] || 'غير محدد';
}

// جعل تابع getWarehouseInventoryData عام للاستخدام في المقارنة
async getWarehouseInventoryData(filters: WarehouseInventoryFilters) {
  // إنشاء تواريخ بداية ونهاية الشهر
  const startOfMonth = new Date(filters.year, filters.month - 1, 1);
  const endOfMonth = new Date(filters.year, filters.month, 0, 23, 59, 59);
  const startOfPreviousMonth = new Date(filters.year, filters.month - 2, 1);
  const endOfPreviousMonth = new Date(filters.year, filters.month - 1, 0, 23, 59, 59);

  // بناء شروط البحث للمواد
  const itemsWhere: any = {
    type: 'raw' // المواد الخام فقط
  };
  
  if (filters.itemGroupId) {
    itemsWhere.groupId = filters.itemGroupId;
  }
  
  if (filters.itemIds && filters.itemIds.length > 0) {
    itemsWhere.id = {
      in: filters.itemIds
    };
  }

  // جلب جميع المواد الخام مع مجموعاتها
  const items = await this.prisma.item.findMany({
    where: itemsWhere,
    include: {
      group: true,
      inventoryItem: true
    },
    orderBy: [
      { group: { name: 'asc' } },
      { name: 'asc' }
    ]
  });

  const inventoryItems: WarehouseInventoryItem[] = [];

  for (const item of items) {
    // 1. حساب الرصيد الافتتاحي (آخر رصيد قبل بداية الشهر)
    const openingStockMovements = await this.prisma.inventoryStockMovement.findMany({
      where: {
        itemId: item.id,
        createdAt: {
          lte: endOfPreviousMonth
        }
      },
      orderBy: {
        createdAt: 'desc'
      },
      take: 1
    });

    let openingStock = 0;
    if (openingStockMovements.length > 0) {
      // حساب الرصيد الافتتاحي من خلال جمع جميع الحركات حتى نهاية الشهر السابق
      const allMovements = await this.prisma.inventoryStockMovement.findMany({
        where: {
          itemId: item.id,
          createdAt: {
            lte: endOfPreviousMonth
          }
        }
      });
      
      openingStock = allMovements.reduce((sum, movement) => {
        if (movement.movementType === 'purchase' || movement.movementType === 'inventory') {
          return sum + movement.quantity;
        }
        return sum;
      }, 0);
    }

    // 2. حساب المشتريات خلال الشهر
    const purchaseMovements = await this.prisma.inventoryStockMovement.findMany({
      where: {
        itemId: item.id,
        movementType: 'purchase',
        createdAt: {
          gte: startOfMonth,
          lte: endOfMonth
        }
      }
    });

    const purchases = purchaseMovements.reduce((sum, movement) => sum + movement.quantity, 0);
    const totalPurchaseValue = purchaseMovements.reduce((sum, movement) => sum + (movement.totalCost || 0), 0);

    // 3. الرصيد الحالي (من آخر جرد أو من InventoryItem)
    let currentStock = 0;
    if (item.inventoryItem) {
      currentStock = item.inventoryItem.currentStock;
    } else {
      // إذا لم يكن هناك سجل في InventoryItem، احسب من الحركات
      const allMovementsToDate = await this.prisma.inventoryStockMovement.findMany({
        where: {
          itemId: item.id,
          createdAt: {
            lte: endOfMonth
          }
        }
      });
      
      currentStock = allMovementsToDate.reduce((sum, movement) => {
        if (movement.movementType === 'purchase' || movement.movementType === 'inventory') {
          return sum + movement.quantity;
        }
        return sum;
      }, 0);
    }

    // 4. حساب الكمية المستهلكة
    const consumedQuantity = Math.max(0, (openingStock + purchases) - currentStock);

    // 5. حساب متوسط سعر الوحدة
    let averageUnitPrice = 0;
    if (purchases > 0 && totalPurchaseValue > 0) {
      averageUnitPrice = totalPurchaseValue / purchases;
    } else {
      // استخدام آخر سعر شراء من الحركات
      const lastPurchase = await this.prisma.inventoryStockMovement.findFirst({
        where: {
          itemId: item.id,
          movementType: 'purchase',
          unitPrice: { not: null }
        },
        orderBy: {
          createdAt: 'desc'
        }
      });
      
      if (lastPurchase && lastPurchase.unitPrice) {
        averageUnitPrice = lastPurchase.unitPrice;
      } else {
        // استخدام السعر المحفوظ في جدول المواد
        averageUnitPrice = item.price || 0;
      }
    }

    // 6. حساب القيمة الإجمالية للمستهلك
    const totalValue = consumedQuantity * averageUnitPrice;

    // إضافة المادة إذا كانت لديها كمية مستهلكة أو مخزون
    if (consumedQuantity > 0 || openingStock > 0 || purchases > 0) {
      inventoryItems.push({
        itemId: item.id,
        itemName: item.name,
        itemGroup: item.group.name,
        unit: item.defaultUnit,
        openingStock,
        purchases,
        currentStock,
        consumedQuantity,
        averageUnitPrice,
        totalValue
      });
    }
  }

  // حساب الملخص
  const summary = this.calculateWarehouseInventorySummary(inventoryItems);

  return {
    items: inventoryItems,
    summary,
    period: {
      year: filters.year,
      month: filters.month,
      monthName: this.getArabicMonthName(filters.month),
      startDate: startOfMonth,
      endDate: endOfMonth
    },
    filters
  };
}

// بناء HTML تقرير المقارنة بين شهرين
async buildWarehouseComparisonHTML(period1Data: any, period2Data: any, periods: any): Promise<string> {
  let template = this.getHTMLTemplate();
  
  const reportTitle = `تقرير مقارنة استهلاك المستودع`;
  const reportSubtitle = `${period1Data.period.monthName} ${period1Data.period.year} مقابل ${period2Data.period.monthName} ${period2Data.period.year}`;
  
  const replacements = {
    '{{REPORT_TITLE}}': reportTitle,
    '{{REPORT_SUBTITLE}}': reportSubtitle,
    '{{CUSTOMER_NAME}}': '—',
    '{{CUSTOMER_PHONE}}': '—',
    '{{CUSTOMER_CATEGORY}}': '—',
    '{{TOTAL_UNPAID}}': `${period1Data.summary.totalItems} vs ${period2Data.summary.totalItems}`,
    '{{TOTAL_BREAK}}': `${this.formatCurrency(period1Data.summary.totalConsumedValue)} vs ${this.formatCurrency(period2Data.summary.totalConsumedValue)}`,
    '{{TOTAL_DEBTS}}': `${period1Data.summary.consumptionRate.toFixed(1)}% vs ${period2Data.summary.consumptionRate.toFixed(1)}%`,
    '{{GRAND_TOTAL}}': this.formatCurrency(period1Data.summary.totalConsumedValue - period2Data.summary.totalConsumedValue),
    '{{NOTES}}': this.buildComparisonNotes(period1Data, period2Data)
  };
  
  // تطبيق الاستبدالات
  Object.entries(replacements).forEach(([key, value]) => {
    template = template.replace(new RegExp(key, 'g'), value);
  });
  
  // بناء جدول المقارنة
  const comparisonTableHTML = this.buildWarehouseComparisonTable(period1Data.items, period2Data.items, periods);
  template = template.replace(/(<section class="section" id="unpaid-section">[\s\S]*?<\/section>)/g, comparisonTableHTML);
  
  // تحديث قسم الملخص للمقارنة
  const comparisonSummaryHTML = this.buildWarehouseComparisonSummary(period1Data.summary, period2Data.summary, periods);
  template = template.replace(/(<section class="section" id="account-summary">[\s\S]*?<\/section>)/g, comparisonSummaryHTML);
  
  template = template.replace('{{ADDITIONAL_SECTIONS}}', '');
  
  return template;
}

// بناء جدول مقارنة الاستهلاك
private buildWarehouseComparisonTable(period1Items: WarehouseInventoryItem[], period2Items: WarehouseInventoryItem[], periods: any): string {
  // دمج المواد من الفترتين
  const itemsMap = new Map<number, {
    itemName: string;
    itemGroup: string;
    unit: string;
    period1: WarehouseInventoryItem | null;
    period2: WarehouseInventoryItem | null;
  }>();
  
  // إضافة مواد الفترة الأولى
  period1Items.forEach(item => {
    itemsMap.set(item.itemId, {
      itemName: item.itemName,
      itemGroup: item.itemGroup,
      unit: item.unit,
      period1: item,
      period2: null
    });
  });
  
  // إضافة مواد الفترة الثانية
  period2Items.forEach(item => {
    if (itemsMap.has(item.itemId)) {
      itemsMap.get(item.itemId)!.period2 = item;
    } else {
      itemsMap.set(item.itemId, {
        itemName: item.itemName,
        itemGroup: item.itemGroup,
        unit: item.unit,
        period1: null,
        period2: item
      });
    }
  });
  
  // تحويل إلى مصفوفة وترتيب حسب المجموعة ثم الاسم
  const comparisonItems = Array.from(itemsMap.values()).sort((a, b) => {
    if (a.itemGroup !== b.itemGroup) {
      return a.itemGroup.localeCompare(b.itemGroup, 'ar');
    }
    return a.itemName.localeCompare(b.itemName, 'ar');
  });
  
  if (comparisonItems.length === 0) {
    return `
      <section class="section">
        <h3>مقارنة الاستهلاك الشهري</h3>
        <p class="muted" style="text-align:center; padding: 20px;">لا توجد مواد للمقارنة في الفترتين المحددتين</p>
      </section>
    `;
  }
  
  let tableRows = '';
  let currentGroup = '';
  
  comparisonItems.forEach(item => {
    // إضافة صف عنوان المجموعة
    if (item.itemGroup !== currentGroup) {
      currentGroup = item.itemGroup;
      tableRows += `
        <tr style="background-color: #f8f9fa; font-weight: bold;">
          <td colspan="8" style="text-align:center; padding: 12px; border: 2px solid #dee2e6;">
            ${currentGroup}
          </td>
        </tr>
      `;
    }
    
    const period1Consumed = item.period1?.consumedQuantity || 0;
    const period2Consumed = item.period2?.consumedQuantity || 0;
    const period1Value = item.period1?.totalValue || 0;
    const period2Value = item.period2?.totalValue || 0;
    
    const quantityChange = period1Consumed - period2Consumed;
    const valueChange = period1Value - period2Value;
    const percentageChange = period2Consumed > 0 ? ((period1Consumed - period2Consumed) / period2Consumed) * 100 : 0;
    
    // تحديد لون الصف حسب التغيير
    let rowStyle = '';
    if (quantityChange > 0) {
      rowStyle = 'background-color: #ffebee;'; // أحمر فاتح للزيادة في الاستهلاك
    } else if (quantityChange < 0) {
      rowStyle = 'background-color: #e8f5e8;'; // أخضر فاتح للنقص في الاستهلاك
    }
    
    tableRows += `
      <tr style="${rowStyle}">
        <td style="text-align:right">${item.itemName}</td>
        <td style="text-align:center">${item.unit}</td>
        <td style="text-align:center">${period1Consumed.toFixed(2)}</td>
        <td style="text-align:center">${period2Consumed.toFixed(2)}</td>
        <td style="text-align:center; font-weight: bold; color: ${quantityChange >= 0 ? '#d32f2f' : '#388e3c'};">
          ${quantityChange > 0 ? '+' : ''}${quantityChange.toFixed(2)}
        </td>
        <td style="text-align:center">${this.formatCurrency(period1Value)}</td>
        <td style="text-align:center">${this.formatCurrency(period2Value)}</td>
        <td style="text-align:center; font-weight: bold; color: ${valueChange >= 0 ? '#d32f2f' : '#388e3c'};">
          ${valueChange > 0 ? '+' : ''}${this.formatCurrency(valueChange)}
        </td>
      </tr>
    `;
  });
  
  return `
    <section class="section">
      <h3>مقارنة الاستهلاك الشهري</h3>
      <div style="margin-bottom: 10px; font-size: 12px; color: #666;">
        <span style="background-color: #ffebee; padding: 2px 6px; border-radius: 3px; margin-left: 10px;">زيادة في الاستهلاك</span>
        <span style="background-color: #e8f5e8; padding: 2px 6px; border-radius: 3px;">نقص في الاستهلاك</span>
      </div>
      <table>
        <thead>
          <tr>
            <th rowspan="2" style="width: 20%; vertical-align: middle;">اسم المادة</th>
            <th rowspan="2" style="width: 8%; vertical-align: middle;">الوحدة</th>
            <th colspan="3" style="width: 36%; text-align: center; background-color: #f0f4f8;">الكمية المستهلكة</th>
            <th colspan="3" style="width: 36%; text-align: center; background-color: #f8f0f0;">القيمة الإجمالية</th>
          </tr>
          <tr>
            <th style="width: 12%; background-color: #f0f4f8;">${this.getArabicMonthName(periods.period1.month)} ${periods.period1.year}</th>
            <th style="width: 12%; background-color: #f0f4f8;">${this.getArabicMonthName(periods.period2.month)} ${periods.period2.year}</th>
            <th style="width: 12%; background-color: #f0f4f8;">التغيير</th>
            <th style="width: 12%; background-color: #f8f0f0;">${this.getArabicMonthName(periods.period1.month)} ${periods.period1.year}</th>
            <th style="width: 12%; background-color: #f8f0f0;">${this.getArabicMonthName(periods.period2.month)} ${periods.period2.year}</th>
            <th style="width: 12%; background-color: #f8f0f0;">التغيير</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
        </tbody>
      </table>
    </section>
  `;
}

// بناء ملخص المقارنة
private buildWarehouseComparisonSummary(period1Summary: WarehouseInventorySummary, period2Summary: WarehouseInventorySummary, periods: any): string {
  const itemsChange = period1Summary.totalItems - period2Summary.totalItems;
  const valueChange = period1Summary.totalConsumedValue - period2Summary.totalConsumedValue;
  const rateChange = period1Summary.consumptionRate - period2Summary.consumptionRate;
  
  return `
    <section class="section" id="comparison-summary">
      <h3>ملخص مقارنة الاستهلاك</h3>
      <div class="cards">
        <div class="card">
          <div class="label">عدد المواد المستهلكة</div>
          <div class="value">${period1Summary.totalItems} vs ${period2Summary.totalItems}</div>
          <div style="font-size: 11px; color: ${itemsChange >= 0 ? '#d32f2f' : '#388e3c'};">
            ${itemsChange > 0 ? '+' : ''}${itemsChange} مادة
          </div>
        </div>
        <div class="card">
          <div class="label">قيمة الاستهلاك</div>
          <div class="value">${this.formatCurrency(period1Summary.totalConsumedValue)}</div>
          <div style="font-size: 11px; color: ${valueChange >= 0 ? '#d32f2f' : '#388e3c'};">
            ${valueChange > 0 ? '+' : ''}${this.formatCurrency(valueChange)}
          </div>
        </div>
        <div class="card">
          <div class="label">نسبة الاستهلاك</div>
          <div class="value">${period1Summary.consumptionRate.toFixed(1)}%</div>
          <div style="font-size: 11px; color: ${rateChange >= 0 ? '#d32f2f' : '#388e3c'};">
            ${rateChange > 0 ? '+' : ''}${rateChange.toFixed(1)}%
          </div>
        </div>
      </div>
      <div class="cards" style="margin-top: 8px;">
        <div class="card">
          <div class="label">الفترة الأولى</div>
          <div class="value">${this.getArabicMonthName(periods.period1.month)} ${periods.period1.year}</div>
        </div>
        <div class="card">
          <div class="label">الفترة الثانية</div>
          <div class="value">${this.getArabicMonthName(periods.period2.month)} ${periods.period2.year}</div>
        </div>
        <div class="card">
          <div class="label">اتجاه التغيير</div>
          <div class="value" style="color: ${valueChange >= 0 ? '#d32f2f' : '#388e3c'};">
            ${valueChange > 0 ? 'زيادة' : valueChange < 0 ? 'نقص' : 'ثابت'}
          </div>
        </div>
      </div>
    </section>
  `;
}

// بناء ملاحظات المقارنة
private buildComparisonNotes(period1Data: any, period2Data: any): string {
  const notes = [];
  
  const valueChange = period1Data.summary.totalConsumedValue - period2Data.summary.totalConsumedValue;
  const valueChangePercentage = period2Data.summary.totalConsumedValue > 0 
    ? (valueChange / period2Data.summary.totalConsumedValue) * 100 
    : 0;
  
  if (Math.abs(valueChangePercentage) > 20) {
    if (valueChange > 0) {
      notes.push(`زيادة كبيرة في الاستهلاك بنسبة ${valueChangePercentage.toFixed(1)}%`);
    } else {
      notes.push(`انخفاض كبير في الاستهلاك بنسبة ${Math.abs(valueChangePercentage).toFixed(1)}%`);
    }
  } else if (Math.abs(valueChangePercentage) < 5) {
    notes.push('استهلاك مستقر نسبياً');
  }
  
  return notes.length > 0 ? notes.join(' • ') : 'مقارنة استهلاك عادية';
}

  

// إضافة هذه التوابع الثلاثة إلى PDFReportsService

// 1. تقرير جرد البسطة
async generateBoothInventoryReport(startDate: Date, endDate: Date): Promise<string> {
  // جلب فواتير البسطة في الفترة المحددة
  const boothInvoices = await this.prisma.invoice.findMany({
    where: {
      fund: {
        fundType: 'booth'
      },
      paidStatus: true,
      createdAt: {
        gte: startDate,
        lte: endDate
      }
    },
    include: {
      customer: true
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  // حساب الإجماليات
  const totalIncome = boothInvoices
    .filter(invoice => invoice.invoiceType === 'income')
    .reduce((sum, invoice) => sum + (invoice.totalAmount - (invoice.discount || 0)), 0);

  const totalExpense = boothInvoices
    .filter(invoice => invoice.invoiceType === 'expense')
    .reduce((sum, invoice) => sum + (invoice.totalAmount - (invoice.discount || 0)), 0);

  const netIncome = totalIncome - totalExpense;

  // بناء HTML التقرير
  let template = this.getHTMLTemplate();
  
  const replacements = {
    '{{REPORT_TITLE}}': 'تقرير جرد البسطة',
    '{{REPORT_SUBTITLE}}': `من ${this.formatDate(startDate)} إلى ${this.formatDate(endDate)}`,
    '{{CUSTOMER_NAME}}': '—',
    '{{CUSTOMER_PHONE}}': '—',
    '{{CUSTOMER_CATEGORY}}': '—',
    '{{TOTAL_UNPAID}}': `${boothInvoices.length} فاتورة`,
    '{{TOTAL_BREAK}}': this.formatCurrency(totalIncome),
    '{{TOTAL_DEBTS}}': this.formatCurrency(totalExpense),
    '{{GRAND_TOTAL}}': this.formatCurrency(netIncome),
    '{{NOTES}}': `صافي دخل البسطة: ${this.formatCurrency(netIncome)}`
  };

  // استبدال عناوين قسم الملخص بعناوين مناسبة للبسطة
  const boothSummaryHTML = `
    <section class="section" id="account-summary">
      <h3>ملخص جرد البسطة</h3>
      <div class="cards">
        <div class="card"><div class="label">عدد الفواتير</div><div class="value">${boothInvoices.length}</div></div>
        <div class="card"><div class="label">إجمالي الدخل</div><div class="value">${this.formatCurrency(totalIncome)}</div></div>
        <div class="card"><div class="label">إجمالي الصرف</div><div class="value">${this.formatCurrency(totalExpense)}</div></div>
      </div>
      <p class="note" style="margin-top:6px">صافي الدخل: <strong>${this.formatCurrency(netIncome)}</strong></p>
    </section>
  `;

  Object.entries(replacements).forEach(([key, value]) => {
    template = template.replace(new RegExp(key, 'g'), value);
  });

 
  // استبدال قسم الملخص بملخص البسطة
  template = template.replace(/(<section class="section" id="account-summary">[\s\S]*?<\/section>)/g, boothSummaryHTML);

  // بناء جدول الفواتير
  const invoicesRows = boothInvoices.map(invoice => `
    <tr>
      <td style="text-align:center">${invoice.invoiceNumber}</td>
      <td style="text-align:center">${this.formatDate(invoice.createdAt)}</td>
      <td style="text-align:center">${invoice.invoiceType === 'income' ? 'دخل' : 'صرف'}</td>
      <td style="text-align:center">${invoice.customer?.name || '—'}</td>
      <td style="text-align:center">${this.formatCurrency(invoice.totalAmount - (invoice.discount || 0))}</td>
    </tr>
  `).join('');

  const tableHTML = `
    <section class="section">
      <h3>تفاصيل فواتير البسطة</h3>
      <table>
        <thead>
          <tr>
            <th>رقم الفاتورة</th>
            <th>التاريخ</th>
            <th>النوع</th>
            <th>العميل</th>
            <th>المبلغ</th>
          </tr>
        </thead>
        <tbody>
          ${invoicesRows}
        </tbody>
      </table>
    </section>
  `;

  template = template.replace(/(<section class="section" id="unpaid-section">[\s\S]*?<\/section>)/g, tableHTML);
  template = template.replace('{{ADDITIONAL_SECTIONS}}', '');

  return template;
}

// 2. تقرير جرد استهلاك مادة معينة
async generateItemConsumptionReport(itemId: number, startDate: Date, endDate: Date): Promise<string> {
  // جلب بيانات المادة
  const item = await this.prisma.item.findUnique({
    where: { id: itemId },
    include: {
      group: true,
      inventoryItem: true
    }
  });

  if (!item) {
    throw new BadRequestException('المادة غير موجودة');
  }

  // حساب الاستهلاك خلال الفترة
  const startStock = await this.getItemStockAtDate(itemId, startDate);
  const endStock = await this.getItemStockAtDate(itemId, endDate);
  const purchases = await this.getItemPurchasesInPeriod(itemId, startDate, endDate);

  const consumedQuantity = (startStock + purchases.totalQuantity) - endStock;
  const consumedValue = consumedQuantity * (purchases.averagePrice || item.price || 0);

  // بناء HTML التقرير
  let template = this.getHTMLTemplate();
  
  const replacements = {
    '{{REPORT_TITLE}}': 'تقرير جرد استهلاك المادة',
    '{{REPORT_SUBTITLE}}': `${item.name} - من ${this.formatDate(startDate)} إلى ${this.formatDate(endDate)}`,
    '{{CUSTOMER_NAME}}': item.name,
    '{{CUSTOMER_PHONE}}': item.defaultUnit,
    '{{CUSTOMER_CATEGORY}}': item.group.name,
    '{{TOTAL_UNPAID}}': `${startStock} ${item.defaultUnit}`,
    '{{TOTAL_BREAK}}': `${purchases.totalQuantity} ${item.defaultUnit}`,
    '{{TOTAL_DEBTS}}': `${endStock} ${item.defaultUnit}`,
    '{{GRAND_TOTAL}}': `${consumedQuantity} ${item.defaultUnit}`,
    '{{NOTES}}': `قيمة الاستهلاك: ${this.formatCurrency(consumedValue)}`
  };

  // ملخص خاص باستهلاك المادة
  const consumptionSummaryHTML = `
    <section class="section" id="account-summary">
      <h3>ملخص استهلاك المادة</h3>
      <div class="cards">
        <div class="card"><div class="label">الرصيد الافتتاحي</div><div class="value">${startStock} ${item.defaultUnit}</div></div>
        <div class="card"><div class="label">المشتريات</div><div class="value">${purchases.totalQuantity} ${item.defaultUnit}</div></div>
        <div class="card"><div class="label">الرصيد الختامي</div><div class="value">${endStock} ${item.defaultUnit}</div></div>
      </div>
      <p class="note" style="margin-top:6px">إجمالي الاستهلاك: <strong>${consumedQuantity} ${item.defaultUnit}</strong> - القيمة: <strong>${this.formatCurrency(consumedValue)}</strong></p>
    </section>
  `;

  Object.entries(replacements).forEach(([key, value]) => {
    template = template.replace(new RegExp(key, 'g'), value);
  });


   
  // استبدال قسم الملخص بملخص الاستهلاك
  template = template.replace(/(<section class="section" id="account-summary">[\s\S]*?<\/section>)/g, consumptionSummaryHTML);


  const detailsHTML = `
    <section class="section">
      <h3>تفاصيل استهلاك المادة</h3>
      <table>
        <thead>
          <tr>
            <th>البيان</th>
            <th>الكمية</th>
            <th>القيمة</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>الرصيد في بداية الفترة</td>
            <td>${startStock} ${item.defaultUnit}</td>
            <td>—</td>
          </tr>
          <tr>
            <td>المشتريات خلال الفترة</td>
            <td>${purchases.totalQuantity} ${item.defaultUnit}</td>
            <td>${this.formatCurrency(purchases.totalValue)}</td>
          </tr>
          <tr>
            <td>الرصيد في نهاية الفترة</td>
            <td>${endStock} ${item.defaultUnit}</td>
            <td>—</td>
          </tr>
          <tr style="background-color: #f0f8ff; font-weight: bold;">
            <td>إجمالي الاستهلاك</td>
            <td>${consumedQuantity} ${item.defaultUnit}</td>
            <td>${this.formatCurrency(consumedValue)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  `;

  template = template.replace(/(<section class="section" id="unpaid-section">[\s\S]*?<\/section>)/g, detailsHTML);
  template = template.replace('{{ADDITIONAL_SECTIONS}}', '');

  return template;
}

// 3. تقرير جرد شراء مادة معينة
async generateItemPurchaseReport(itemId: number, startDate: Date, endDate: Date): Promise<string> {
  // جلب بيانات المادة
  const item = await this.prisma.item.findUnique({
    where: { id: itemId },
    include: {
      group: true
    }
  });

  if (!item) {
    throw new BadRequestException('المادة غير موجودة');
  }

  // جلب فواتير الشراء للمادة
  const purchaseInvoices = await this.prisma.invoiceItem.findMany({
    where: {
      itemId: itemId,
      invoice: {
        invoiceType: 'expense',
        invoiceCategory: 'products',
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      }
    },
    include: {
      invoice: {
        include: {
          customer: true
        }
      }
    },
    orderBy: {
      invoice: {
        createdAt: 'desc'
      }
    }
  });

  // حساب الإجماليات
  const totalQuantity = purchaseInvoices.reduce((sum, item) => sum + item.quantity, 0);
  const totalValue = purchaseInvoices.reduce((sum, item) => sum + item.subTotal, 0);
  const averagePrice = totalQuantity > 0 ? totalValue / totalQuantity : 0;

  // بناء HTML التقرير
  let template = this.getHTMLTemplate();
  
  const replacements = {
    '{{REPORT_TITLE}}': 'تقرير جرد شراء المادة',
    '{{REPORT_SUBTITLE}}': `${item.name} - من ${this.formatDate(startDate)} إلى ${this.formatDate(endDate)}`,
    '{{CUSTOMER_NAME}}': item.name,
    '{{CUSTOMER_PHONE}}': item.defaultUnit,
    '{{CUSTOMER_CATEGORY}}': item.group.name,
    '{{TOTAL_UNPAID}}': `${purchaseInvoices.length} فاتورة`,
    '{{TOTAL_BREAK}}': `${totalQuantity} ${item.defaultUnit}`,
    '{{TOTAL_DEBTS}}': this.formatCurrency(totalValue),
    '{{GRAND_TOTAL}}': this.formatCurrency(averagePrice),
    '{{NOTES}}': `متوسط سعر الوحدة: ${this.formatCurrency(averagePrice)}`
  };

  // ملخص خاص بشراء المادة
  const purchaseSummaryHTML = `
    <section class="section" id="account-summary">
      <h3>ملخص مشتريات المادة</h3>
      <div class="cards">
        <div class="card"><div class="label">عدد الفواتير</div><div class="value">${purchaseInvoices.length}</div></div>
        <div class="card"><div class="label">إجمالي الكمية</div><div class="value">${totalQuantity} ${item.defaultUnit}</div></div>
        <div class="card"><div class="label">إجمالي القيمة</div><div class="value">${this.formatCurrency(totalValue)}</div></div>
      </div>
      <p class="note" style="margin-top:6px">متوسط سعر الوحدة: <strong>${this.formatCurrency(averagePrice)}</strong></p>
    </section>
  `;

  Object.entries(replacements).forEach(([key, value]) => {
    template = template.replace(new RegExp(key, 'g'), value);
  });


  // استبدال قسم الملخص بملخص المشتريات
  template = template.replace(/(<section class="section" id="account-summary">[\s\S]*?<\/section>)/g, purchaseSummaryHTML);


  // بناء جدول المشتريات
  const purchaseRows = purchaseInvoices.map(purchaseItem => `
    <tr>
      <td style="text-align:center">${purchaseItem.invoice.invoiceNumber}</td>
      <td style="text-align:center">${this.formatDate(purchaseItem.invoice.createdAt)}</td>
      <td style="text-align:center">${purchaseItem.invoice.customer?.name || '—'}</td>
      <td style="text-align:center">${purchaseItem.quantity} ${purchaseItem.unit}</td>
      <td style="text-align:center">${this.formatCurrency(purchaseItem.unitPrice)}</td>
      <td style="text-align:center">${this.formatCurrency(purchaseItem.subTotal)}</td>
    </tr>
  `).join('');

  const tableHTML = `
    <section class="section">
      <h3>تفاصيل مشتريات المادة</h3>
      <table>
        <thead>
          <tr>
            <th>رقم الفاتورة</th>
            <th>التاريخ</th>
            <th>المورد</th>
            <th>الكمية</th>
            <th>سعر الوحدة</th>
            <th>الإجمالي</th>
          </tr>
        </thead>
        <tbody>
          ${purchaseRows}
          <tr style="background-color: #f0f8ff; font-weight: bold;">
            <td colspan="3" style="text-align:center">المجموع الكلي</td>
            <td style="text-align:center">${totalQuantity} ${item.defaultUnit}</td>
            <td style="text-align:center">${this.formatCurrency(averagePrice)}</td>
            <td style="text-align:center">${this.formatCurrency(totalValue)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  `;

  template = template.replace(/(<section class="section" id="unpaid-section">[\s\S]*?<\/section>)/g, tableHTML);
  template = template.replace('{{ADDITIONAL_SECTIONS}}', '');

  return template;
}

// توابع مساعدة
private async getItemStockAtDate(itemId: number, date: Date): Promise<number> {
  const movements = await this.prisma.inventoryStockMovement.findMany({
    where: {
      itemId,
      createdAt: {
        lte: date
      }
    }
  });

  return movements.reduce((sum, movement) => {
    if (movement.movementType === 'purchase' || movement.movementType === 'inventory') {
      return sum + movement.quantity;
    }
    return sum;
  }, 0);
}

private async getItemPurchasesInPeriod(itemId: number, startDate: Date, endDate: Date): Promise<{totalQuantity: number, totalValue: number, averagePrice: number}> {
  const movements = await this.prisma.inventoryStockMovement.findMany({
    where: {
      itemId,
      movementType: 'purchase',
      createdAt: {
        gte: startDate,
        lte: endDate
      }
    }
  });

  const totalQuantity = movements.reduce((sum, movement) => sum + movement.quantity, 0);
  const totalValue = movements.reduce((sum, movement) => sum + (movement.totalCost || 0), 0);
  const averagePrice = totalQuantity > 0 ? totalValue / totalQuantity : 0;

  return { totalQuantity, totalValue, averagePrice };
}


// 1. تقرير جرد الديون
async generateDebtsInventoryReport(categoryId?: number, customerIds?: number[]): Promise<string> {
  // بناء شروط البحث
  const where: any = {
    status: 'active'
  };
  
  if (customerIds && customerIds.length > 0) {
    where.customerId = { in: customerIds };
  } else if (categoryId) {
    where.customer = { categoryId: categoryId };
  }

  // جلب الديون النشطة
  const debts = await this.prisma.debt.findMany({
    where,
    include: {
      customer: {
        include: {
          category: true
        }
      }
    },
    orderBy: [
      { customer: { category: { name: 'asc' } } },
      { customer: { name: 'asc' } }
    ]
  });

  // حساب الإجماليات
  const totalDebts = debts.reduce((sum, debt) => sum + debt.remainingAmount, 0);
  const debtsByCategory = new Map();
  
  debts.forEach(debt => {
    const categoryName = debt.customer.category?.name || 'بدون تصنيف';
    if (!debtsByCategory.has(categoryName)) {
      debtsByCategory.set(categoryName, { count: 0, total: 0 });
    }
    const category = debtsByCategory.get(categoryName);
    category.count++;
    category.total += debt.remainingAmount;
  });

  // بناء HTML التقرير
  let template = this.getHTMLTemplate();
  
  const replacements = {
    '{{REPORT_TITLE}}': 'تقرير جرد الديون',
    '{{REPORT_SUBTITLE}}': `الديون النشطة للعملاء`,
    '{{CUSTOMER_NAME}}': '—',
    '{{CUSTOMER_PHONE}}': '—',
    '{{CUSTOMER_CATEGORY}}': '—',
    '{{TOTAL_UNPAID}}': `${debts.length} عميل`,
    '{{TOTAL_BREAK}}': this.formatCurrency(totalDebts),
    '{{TOTAL_DEBTS}}': `${debtsByCategory.size} تصنيف`,
    '{{GRAND_TOTAL}}': this.formatCurrency(totalDebts),
    '{{NOTES}}': `متوسط الدين لكل عميل: ${debts.length > 0 ? this.formatCurrency(totalDebts / debts.length) : '0'}`
  };

  Object.entries(replacements).forEach(([key, value]) => {
    template = template.replace(new RegExp(key, 'g'), value);
  });

  // ملخص خاص بالديون
  const debtsSummaryHTML = `
    <section class="section" id="account-summary">
      <h3>ملخص الديون</h3>
      <div class="cards">
        <div class="card"><div class="label">عدد العملاء المدينين</div><div class="value">${debts.length}</div></div>
        <div class="card"><div class="label">إجمالي الديون</div><div class="value">${this.formatCurrency(totalDebts)}</div></div>
        <div class="card"><div class="label">عدد التصنيفات</div><div class="value">${debtsByCategory.size}</div></div>
      </div>
    </section>
  `;

  // بناء جدول الديون
  let currentCategory = '';
  const debtsRows = debts.map(debt => {
    let categoryHeader = '';
    const categoryName = debt.customer.category?.name || 'بدون تصنيف';
    
    if (categoryName !== currentCategory) {
      currentCategory = categoryName;
      categoryHeader = `
        <tr style="background-color: #f8f9fa; font-weight: bold;">
          <td colspan="4" style="text-align:center; padding: 12px;">
            ${categoryName}
          </td>
        </tr>
      `;
    }
    
    return `
      ${categoryHeader}
      <tr>
        <td style="text-align:right">${debt.customer.name}</td>
        <td style="text-align:center">${this.formatDate(debt.createdAt)}</td>
        <td style="text-align:center">${this.formatCurrency(debt.totalAmount)}</td>
        <td style="text-align:center; font-weight: bold; color: #d32f2f;">${this.formatCurrency(debt.remainingAmount)}</td>
      </tr>
    `;
  }).join('');

  const tableHTML = `
    <section class="section">
      <h3>تفاصيل الديون حسب التصنيف</h3>
      <table>
        <thead>
          <tr>
            <th>اسم العميل</th>
            <th>تاريخ الدين</th>
            <th>المبلغ الأصلي</th>
            <th>المبلغ المتبقي</th>
          </tr>
        </thead>
        <tbody>
          ${debtsRows}
        </tbody>
      </table>
    </section>
  `;

  template = template.replace(/(<section class="section" id="account-summary">[\s\S]*?<\/section>)/g, debtsSummaryHTML);
  template = template.replace(/(<section class="section" id="unpaid-section">[\s\S]*?<\/section>)/g, tableHTML);
  template = template.replace('{{ADDITIONAL_SECTIONS}}', '');

  return template;
}

// 2. تقرير تفاصيل دين معين
async generateDebtDetailsReport(debtId: number, startDate: Date, endDate: Date): Promise<string> {
  // جلب بيانات الدين
  const debt = await this.prisma.debt.findUnique({
    where: { id: debtId },
    include: {
      customer: {
        include: {
          category: true
        }
      },
      relatedInvoices: {
        where: {
          createdAt: {
            gte: startDate,
            lte: endDate
          }
        },
        orderBy: {
          createdAt: 'desc'
        }
      }
    }
  });

  if (!debt) {
    throw new BadRequestException('الدين غير موجود');
  }

  // حساب الدفعات
  const payments = debt.relatedInvoices.filter(invoice => 
    invoice.invoiceType === 'income' && invoice.paidStatus
  );
  const totalPaid = payments.reduce((sum, payment) => sum + payment.totalAmount, 0);

  // بناء HTML التقرير
  let template = this.getHTMLTemplate();
  
  const replacements = {
    '{{REPORT_TITLE}}': 'تقرير تفاصيل الدين',
    '{{REPORT_SUBTITLE}}': `${debt.customer.name} - من ${this.formatDate(startDate)} إلى ${this.formatDate(endDate)}`,
    '{{CUSTOMER_NAME}}': debt.customer.name,
    '{{CUSTOMER_PHONE}}': debt.customer.phone || '—',
    '{{CUSTOMER_CATEGORY}}': debt.customer.category?.name || '—',
    '{{TOTAL_UNPAID}}': this.formatCurrency(debt.totalAmount),
    '{{TOTAL_BREAK}}': this.formatCurrency(totalPaid),
    '{{TOTAL_DEBTS}}': this.formatCurrency(debt.remainingAmount),
    '{{GRAND_TOTAL}}': `${payments.length} دفعة`,
    '{{NOTES}}': `حالة الدين: ${debt.status === 'active' ? 'نشط' : 'مسدد'}`
  };

  Object.entries(replacements).forEach(([key, value]) => {
    template = template.replace(new RegExp(key, 'g'), value);
  });

  // ملخص خاص بتفاصيل الدين
  const debtDetailsSummaryHTML = `
    <section class="section" id="account-summary">
      <h3>ملخص الدين</h3>
      <div class="cards">
        <div class="card"><div class="label">المبلغ الأصلي</div><div class="value">${this.formatCurrency(debt.totalAmount)}</div></div>
        <div class="card"><div class="label">المبلغ المسدد</div><div class="value">${this.formatCurrency(totalPaid)}</div></div>
        <div class="card"><div class="label">المبلغ المتبقي</div><div class="value">${this.formatCurrency(debt.remainingAmount)}</div></div>
      </div>
    </section>
  `;

  // بناء جدول الدفعات
  const paymentsRows = payments.map(payment => `
    <tr>
      <td style="text-align:center">${payment.invoiceNumber}</td>
      <td style="text-align:center">${this.formatDate(payment.paymentDate || payment.createdAt)}</td>
      <td style="text-align:center">${this.formatCurrency(payment.totalAmount)}</td>
      <td style="text-align:center">${payment.notes || '—'}</td>
    </tr>
  `).join('');

  const tableHTML = `
    <section class="section">
      <h3>تفاصيل الدفعات</h3>
      <table>
        <thead>
          <tr>
            <th>رقم الفاتورة</th>
            <th>تاريخ الدفع</th>
            <th>المبلغ</th>
            <th>ملاحظات</th>
          </tr>
        </thead>
        <tbody>
          ${paymentsRows}
          <tr style="background-color: #f0f8ff; font-weight: bold;">
            <td colspan="2" style="text-align:center">المجموع</td>
            <td style="text-align:center">${this.formatCurrency(totalPaid)}</td>
            <td>—</td>
          </tr>
        </tbody>
      </table>
    </section>
  `;

  template = template.replace(/(<section class="section" id="account-summary">[\s\S]*?<\/section>)/g, debtDetailsSummaryHTML);
  template = template.replace(/(<section class="section" id="unpaid-section">[\s\S]*?<\/section>)/g, tableHTML);
  template = template.replace('{{ADDITIONAL_SECTIONS}}', '');

  return template;
}

// 3. تقرير جرد مبيعات منتج معين
async generateProductSalesReport(itemIds: number[], startDate: Date, endDate: Date): Promise<string> {
  // جلب مبيعات المنتجات
  const salesItems = await this.prisma.invoiceItem.findMany({
    where: {
      itemId: { in: itemIds },
      invoice: {
        invoiceType: 'income',
        invoiceCategory: 'products',
        paidStatus: true,
        createdAt: {
          gte: startDate,
          lte: endDate
        }
      }
    },
    include: {
      item: true,
      invoice: {
        include: {
          customer: true
        }
      }
    },
    orderBy: {
      invoice: {
        createdAt: 'desc'
      }
    }
  });

  // تجميع البيانات حسب المنتج
  const productSales = new Map();
  salesItems.forEach(saleItem => {
    if (!productSales.has(saleItem.itemId)) {
      productSales.set(saleItem.itemId, {
        itemName: saleItem.item.name,
        unit: saleItem.unit,
        totalQuantity: 0,
        totalValue: 0,
        salesCount: 0
      });
    }
    const product = productSales.get(saleItem.itemId);
    product.totalQuantity += saleItem.quantity;
    product.totalValue += saleItem.subTotal;
    product.salesCount++;
  });

  const totalSalesValue = Array.from(productSales.values()).reduce((sum, product) => sum + product.totalValue, 0);
  const totalQuantity = Array.from(productSales.values()).reduce((sum, product) => sum + product.totalQuantity, 0);

  // بناء HTML التقرير
  let template = this.getHTMLTemplate();
  
  const replacements = {
    '{{REPORT_TITLE}}': 'تقرير جرد مبيعات المنتجات',
    '{{REPORT_SUBTITLE}}': `من ${this.formatDate(startDate)} إلى ${this.formatDate(endDate)}`,
    '{{CUSTOMER_NAME}}': '—',
    '{{CUSTOMER_PHONE}}': '—',
    '{{CUSTOMER_CATEGORY}}': '—',
    '{{TOTAL_UNPAID}}': `${productSales.size} منتج`,
    '{{TOTAL_BREAK}}': `${totalQuantity} وحدة`,
    '{{TOTAL_DEBTS}}': this.formatCurrency(totalSalesValue),
    '{{GRAND_TOTAL}}': `${salesItems.length} عملية بيع`,
    '{{NOTES}}': `متوسط قيمة البيع: ${salesItems.length > 0 ? this.formatCurrency(totalSalesValue / salesItems.length) : '0'}`
  };

  Object.entries(replacements).forEach(([key, value]) => {
    template = template.replace(new RegExp(key, 'g'), value);
  });

  // ملخص خاص بمبيعات المنتجات
  const salesSummaryHTML = `
    <section class="section" id="account-summary">
      <h3>ملخص المبيعات</h3>
      <div class="cards">
        <div class="card"><div class="label">عدد المنتجات</div><div class="value">${productSales.size}</div></div>
        <div class="card"><div class="label">إجمالي الكمية</div><div class="value">${totalQuantity}</div></div>
        <div class="card"><div class="label">إجمالي القيمة</div><div class="value">${this.formatCurrency(totalSalesValue)}</div></div>
      </div>
    </section>
  `;

  // بناء جدول المبيعات
  const salesRows = Array.from(productSales.values()).map(product => `
    <tr>
      <td style="text-align:right">${product.itemName}</td>
      <td style="text-align:center">${product.unit}</td>
      <td style="text-align:center; font-weight: bold; color: #2563eb;">${product.totalQuantity}</td>
      <td style="text-align:center">${product.salesCount}</td>
      <td style="text-align:center; font-weight: bold; color: #059669;">${this.formatCurrency(product.totalValue)}</td>
    </tr>
  `).join('');

  const tableHTML = `
    <section class="section">
      <h3>تفاصيل مبيعات المنتجات</h3>
      <table>
        <thead>
          <tr>
            <th>اسم المنتج</th>
            <th>الوحدة</th>
            <th>الكمية المباعة</th>
            <th>عدد العمليات</th>
            <th>إجمالي القيمة</th>
          </tr>
        </thead>
        <tbody>
          ${salesRows}
        </tbody>
      </table>
    </section>
  `;

  template = template.replace(/(<section class="section" id="account-summary">[\s\S]*?<\/section>)/g, salesSummaryHTML);
  template = template.replace(/(<section class="section" id="unpaid-section">[\s\S]*?<\/section>)/g, tableHTML);
  template = template.replace('{{ADDITIONAL_SECTIONS}}', '');

  return template;
}

// 4. تقرير حركة الصناديق
async generateFundsMovementReport(startDate: Date, endDate: Date): Promise<string> {
  // جلب حركات الصناديق
  const fundsMovements = await this.prisma.invoice.findMany({
    where: {
      paidStatus: true,
      createdAt: {
        gte: startDate,
        lte: endDate
      }
    },
    include: {
      fund: true,
      shift: true
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  // تجميع البيانات حسب نوع الصندوق
  const fundsSummary = new Map();
  
  fundsMovements.forEach(movement => {
    const fundType = movement.fund.fundType;
    if (!fundsSummary.has(fundType)) {
      fundsSummary.set(fundType, {
        income: 0,
        expense: 0,
        count: 0
      });
    }
    const fund = fundsSummary.get(fundType);
    fund.count++;
    
    const amount = movement.totalAmount - (movement.discount || 0);
    if (movement.invoiceType === 'income') {
      fund.income += amount;
    } else {
      fund.expense += amount;
    }
  });

  const totalIncome = Array.from(fundsSummary.values()).reduce((sum, fund) => sum + fund.income, 0);
  const totalExpense = Array.from(fundsSummary.values()).reduce((sum, fund) => sum + fund.expense, 0);

  // بناء HTML التقرير
  let template = this.getHTMLTemplate();
  
  const replacements = {
    '{{REPORT_TITLE}}': 'تقرير حركة الصناديق',
    '{{REPORT_SUBTITLE}}': `من ${this.formatDate(startDate)} إلى ${this.formatDate(endDate)}`,
    '{{CUSTOMER_NAME}}': '—',
    '{{CUSTOMER_PHONE}}': '—',
    '{{CUSTOMER_CATEGORY}}': '—',
    '{{TOTAL_UNPAID}}': `${fundsMovements.length} حركة`,
    '{{TOTAL_BREAK}}': this.formatCurrency(totalIncome),
    '{{TOTAL_DEBTS}}': this.formatCurrency(totalExpense),
    '{{GRAND_TOTAL}}': this.formatCurrency(totalIncome - totalExpense),
    '{{NOTES}}': `صافي الحركة: ${this.formatCurrency(totalIncome - totalExpense)}`
  };

  Object.entries(replacements).forEach(([key, value]) => {
    template = template.replace(new RegExp(key, 'g'), value);
  });

  // ملخص خاص بحركة الصناديق
  const movementsSummaryHTML = `
    <section class="section" id="account-summary">
      <h3>ملخص حركة الصناديق</h3>
      <div class="cards">
        <div class="card"><div class="label">إجمالي المدخولات</div><div class="value">${this.formatCurrency(totalIncome)}</div></div>
        <div class="card"><div class="label">إجمالي المصروفات</div><div class="value">${this.formatCurrency(totalExpense)}</div></div>
        <div class="card"><div class="label">صافي الحركة</div><div class="value">${this.formatCurrency(totalIncome - totalExpense)}</div></div>
      </div>
    </section>
  `;

  // بناء جدول حركة الصناديق
  const movementsRows = Array.from(fundsSummary.entries()).map(([fundType, data]) => {
    const fundName = {
      'main': 'الخزينة الرئيسية',
      'general': 'الصندوق العام',
      'booth': 'البسطة',
      'university': 'الجامعة'
    }[fundType] || fundType;
    
    return `
      <tr>
        <td style="text-align:right">${fundName}</td>
        <td style="text-align:center; color: #059669;">${this.formatCurrency(data.income)}</td>
        <td style="text-align:center; color: #dc2626;">${this.formatCurrency(data.expense)}</td>
        <td style="text-align:center; font-weight: bold;">${this.formatCurrency(data.income - data.expense)}</td>
        <td style="text-align:center">${data.count}</td>
      </tr>
    `;
  }).join('');

  const tableHTML = `
    <section class="section">
      <h3>تفاصيل حركة الصناديق</h3>
      <table>
        <thead>
          <tr>
            <th>نوع الصندوق</th>
            <th>المدخولات</th>
            <th>المصروفات</th>
            <th>الصافي</th>
            <th>عدد الحركات</th>
          </tr>
        </thead>
        <tbody>
          ${movementsRows}
        </tbody>
      </table>
    </section>
  `;

  template = template.replace(/(<section class="section" id="account-summary">[\s\S]*?<\/section>)/g, movementsSummaryHTML);
  template = template.replace(/(<section class="section" id="unpaid-section">[\s\S]*?<\/section>)/g, tableHTML);
  template = template.replace('{{ADDITIONAL_SECTIONS}}', '');

  return template;
}

// 5. تقرير ملخص الواردية
async generateShiftSummaryReport(shiftId?: number): Promise<string> {
  // تحديد الواردية (الحالية إذا لم يتم تحديد معرف)
  let shift;
  if (shiftId) {
    shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: {
        employee: true
      }
    });
  } else {
    shift = await this.prisma.shift.findFirst({
      where: { status: 'open' },
      include: {
        employee: true
      }
    });
  }

  if (!shift) {
    throw new BadRequestException('لا توجد واردية مفتوحة أو الواردية المحددة غير موجودة');
  }

  // جلب فواتير الواردية
  const shiftInvoices = await this.prisma.invoice.findMany({
    where: {
      shiftId: shift.id,
      paidStatus: true
    },
    include: {
      fund: true,
      customer: true
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  // حساب الإجماليات
  const totalIncome = shiftInvoices
    .filter(inv => inv.invoiceType === 'income')
    .reduce((sum, inv) => sum + (inv.totalAmount - (inv.discount || 0)), 0);
    
  const totalExpense = shiftInvoices
    .filter(inv => inv.invoiceType === 'expense')
    .reduce((sum, inv) => sum + (inv.totalAmount - (inv.discount || 0)), 0);

  const netAmount = totalIncome - totalExpense;

  // تجميع حسب نوع الصندوق
  const fundTypes = ['general', 'booth', 'university'];
  const fundsSummary = {};
  
  fundTypes.forEach(type => {
    const fundInvoices = shiftInvoices.filter(inv => inv.fund.fundType === type);
    const income = fundInvoices
      .filter(inv => inv.invoiceType === 'income')
      .reduce((sum, inv) => sum + (inv.totalAmount - (inv.discount || 0)), 0);
    const expense = fundInvoices
      .filter(inv => inv.invoiceType === 'expense')
      .reduce((sum, inv) => sum + (inv.totalAmount - (inv.discount || 0)), 0);
    
    fundsSummary[type] = { income, expense, net: income - expense };
  });

  // بناء HTML التقرير
  let template = this.getHTMLTemplate();
  
  const shiftTypeAr = shift.shiftType === 'morning' ? 'صباحية' : 'مسائية';
  const shiftStatusAr = shift.status === 'open' ? 'مفتوحة' : 'مغلقة';
  
  const replacements = {
    '{{REPORT_TITLE}}': 'تقرير ملخص الواردية',
    '{{REPORT_SUBTITLE}}': `واردية ${shiftTypeAr} - ${shiftStatusAr}`,
    '{{CUSTOMER_NAME}}': shift.employee?.username || '—',
    '{{CUSTOMER_PHONE}}': this.formatDate(shift.openTime),
    '{{CUSTOMER_CATEGORY}}': shift.closeTime ? this.formatDate(shift.closeTime) : 'مفتوحة',
    '{{TOTAL_UNPAID}}': `${shiftInvoices.length} فاتورة`,
    '{{TOTAL_BREAK}}': this.formatCurrency(totalIncome),
    '{{TOTAL_DEBTS}}': this.formatCurrency(totalExpense),
    '{{GRAND_TOTAL}}': this.formatCurrency(netAmount),
    '{{NOTES}}': `صافي الواردية: ${this.formatCurrency(netAmount)}`
  };

  Object.entries(replacements).forEach(([key, value]) => {
    template = template.replace(new RegExp(key, 'g'), value);
  });

  // ملخص خاص بالواردية
  const shiftSummaryHTML = `
    <section class="section" id="account-summary">
      <h3>ملخص الواردية</h3>
      <div class="cards">
        <div class="card"><div class="label">إجمالي المدخولات</div><div class="value">${this.formatCurrency(totalIncome)}</div></div>
        <div class="card"><div class="label">إجمالي المصروفات</div><div class="value">${this.formatCurrency(totalExpense)}</div></div>
        <div class="card"><div class="label">صافي الواردية</div><div class="value">${this.formatCurrency(netAmount)}</div></div>
      </div>
    </section>
  `;

  // بناء جدول الصناديق
  const fundsRows = Object.entries(fundsSummary).map(([type, data]: [string, any]) => {
    const fundName = {
      'general': 'الصندوق العام',
      'booth': 'البسطة',
      'university': 'الجامعة'
    }[type] || type;
    
    return `
      <tr>
        <td style="text-align:right">${fundName}</td>
        <td style="text-align:center; color: #059669;">${this.formatCurrency(data.income)}</td>
        <td style="text-align:center; color: #dc2626;">${this.formatCurrency(data.expense)}</td>
        <td style="text-align:center; font-weight: bold;">${this.formatCurrency(data.net)}</td>
      </tr>
    `;
  }).join('');

  const tableHTML = `
    <section class="section">
      <h3>ملخص الصناديق في الواردية</h3>
      <table>
        <thead>
          <tr>
            <th>الصندوق</th>
            <th>المدخولات</th>
            <th>المصروفات</th>
            <th>الصافي</th>
          </tr>
        </thead>
        <tbody>
          ${fundsRows}
          <tr style="background-color: #f0f8ff; font-weight: bold;">
            <td style="text-align:center">المجموع الكلي</td>
            <td style="text-align:center; color: #059669;">${this.formatCurrency(totalIncome)}</td>
            <td style="text-align:center; color: #dc2626;">${this.formatCurrency(totalExpense)}</td>
            <td style="text-align:center">${this.formatCurrency(netAmount)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  `;

  template = template.replace(/(<section class="section" id="account-summary">[\s\S]*?<\/section>)/g, shiftSummaryHTML);
  template = template.replace(/(<section class="section" id="unpaid-section">[\s\S]*?<\/section>)/g, tableHTML);
  template = template.replace('{{ADDITIONAL_SECTIONS}}', '');

  return template;
}

}
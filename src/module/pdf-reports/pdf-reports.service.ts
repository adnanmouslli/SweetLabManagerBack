import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as path from 'path';
import * as fs from 'fs';
import { FundType, OrderStatus } from '@prisma/client';
import { FundSummary, ShiftSummary } from '@/common/types/shift-summary.types';

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
  customerIds?: number[]; 
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
  <title>{{REPORT_TITLE}} - مخبز الإحسان الدمشقي</title>
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
      <div class="brand">مخبز الإحسان الدمشقي</div>
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
      <div>مخبز الإحسان الدمشقي — هاتف: 123-456-789</div>
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


  private formatCurrency(amount: number | null | undefined): string {
    const numericAmount = Number(amount) || 0;
    return `${numericAmount.toFixed(2)} ل.س`;
    }


  // طريقة سريعة لمعاينة التقرير
  async previewCustomerStatement(customerId: number): Promise<string> {
    return this.generateCustomerStatementHTML(customerId);
  }



  // order  
// 1. توليد تقرير جرد الطلبيات بصيغة HTML
async generateOrdersInventoryReportHTML(filters: OrdersInventoryFilters): Promise<string> {
  const inventoryData = await this.getOrdersInventoryData(filters);
  return this.buildOrdersInventoryHTML(inventoryData, filters);
}

// 2. جلب بيانات جرد الطلبيات من قاعدة البيانات
private async getOrdersInventoryData(filters: OrdersInventoryFilters) {
  const where: any = {};
  
  if (filters.customerIds && filters.customerIds.length > 0) {
    where.customerId = { in: filters.customerIds };
  }
  
  if (filters.categoryId) {
    where.categoryId = filters.categoryId;
  }
  
  if (filters.status && filters.status.length > 0) {
    where.status = { in: filters.status };
  }
  
  if (filters.paidStatus !== undefined) {
    where.paidStatus = filters.paidStatus;
  }
  
  if (filters.startDate || filters.endDate) {
    where.scheduledFor = {};
    if (filters.startDate) {
      where.scheduledFor.gte = filters.startDate;
    }
    if (filters.endDate) {
      where.scheduledFor.lte = filters.endDate;
    }
  }
  
  const orders = await this.prisma.order.findMany({
    where,
    include: {
      customer: true,
      category: true,
      items: {
        include: { item: true },
        where: filters.itemIds && filters.itemIds.length > 0 ? {
          itemId: { in: filters.itemIds }
        } : undefined
      }
    },
    orderBy: { scheduledFor: 'desc' }
  });
  
  const itemsMap = new Map<number, OrderInventoryItem>();
  
  orders.forEach(order => {
    order.items.forEach(orderItem => {
      const itemId = orderItem.itemId;
      
      if (!itemsMap.has(itemId)) {
        itemsMap.set(itemId, {
          itemName: orderItem.item.name,
          unit: orderItem.unit,
          totalQuantity: 0,
          totalTrays: 0,
          totalPieces: 0, // إضافة عمود القطع
          orders: []
        });
      }
      
      const inventoryItem = itemsMap.get(itemId)!;
      inventoryItem.totalQuantity += orderItem.quantity;
      
      // حساب عدد الصاجات باستخدام معامل التحويل
      const traysQuantity = this.calculateTraysFromUnits(
        orderItem.quantity,
        orderItem.unit,
        orderItem.item.units as any[]
      );
      
      // حساب عدد القطع باستخدام معامل التحويل
      const piecesQuantity = this.calculatePiecesFromUnits(
        orderItem.quantity,
        orderItem.unit,
        orderItem.item.units as any[]
      );
      
      inventoryItem.totalTrays! += traysQuantity;
      inventoryItem.totalPieces! += piecesQuantity;
      
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
  
  const inventoryItems = Array.from(itemsMap.values()).sort((a, b) => b.totalQuantity - a.totalQuantity);
  
  const summary = {
    totalOrders: orders.length,
    totalItems: inventoryItems.length,
    totalQuantity: inventoryItems.reduce((sum, item) => sum + item.totalQuantity, 0),
    totalTrays: inventoryItems.reduce((sum, item) => sum + (item.totalTrays || 0), 0),
    totalPieces: inventoryItems.reduce((sum, item) => sum + (item.totalPieces || 0), 0), // إضافة إجمالي القطع
  };
  
  return {
    items: inventoryItems,
    summary,
    filters
  };
}

// 3. دالة حساب عدد الصاجات من معامل التحويل
private calculateTraysFromUnits(
  quantity: number,
  currentUnit: string,
  units: any[]
): number {
  
  // إذا كانت الوحدة الأساسية هي صاج، قم بإرجاع الكمية نفسها
  if (currentUnit.includes('صاج') || currentUnit.includes('صينية')) {
    return quantity;
  }
  
  // البحث عن وحدة الصاج في قائمة الوحدات
  const trayUnit = units.find(u => 
    u.unit.includes('صاج') || u.unit.includes('صينية')
  );
  
  if (!trayUnit) {
    return 0;
  }
  
  // البحث عن الوحدة الحالية
  const currentUnitObj = units.find(u => u.unit === currentUnit);
  
  if (!currentUnitObj) {
    return 0;
  }
  
  // حساب عدد الصاجات = (الكمية × معامل الوحدة الحالية) ÷ معامل وحدة الصاج
  const traysQuantity = (quantity * currentUnitObj.factor) / trayUnit.factor;
  
  return parseFloat(traysQuantity.toFixed(2)); // تقريب لرقمين عشريين
}

// 4. دالة حساب عدد القطع من معامل التحويل
private calculatePiecesFromUnits(
  quantity: number,
  currentUnit: string,
  units: any[]
): number {
  
  // إذا كانت الوحدة الأساسية هي قطعة، قم بإرجاع الكمية نفسها
  if (currentUnit.includes('قطعة') || currentUnit.includes('حبة') || currentUnit === 'قطعة' || currentUnit === 'حبة') {
    return quantity;
  }
  
  // البحث عن وحدة القطعة في قائمة الوحدات
  const pieceUnit = units.find(u => 
    u.unit.includes('قطعة') || u.unit.includes('حبة') || u.unit === 'قطعة' || u.unit === 'حبة'
  );
  
  if (!pieceUnit) {
    return 0;
  }
  
  // البحث عن الوحدة الحالية
  const currentUnitObj = units.find(u => u.unit === currentUnit);
  
  if (!currentUnitObj) {
    return 0;
  }
  
  // حساب عدد القطع = (الكمية × معامل الوحدة الحالية) ÷ معامل وحدة القطعة
  const piecesQuantity = (quantity * currentUnitObj.factor) / pieceUnit.factor;
  
  return parseFloat(piecesQuantity.toFixed(2)); // تقريب لرقمين عشريين
}

// 5. بناء HTML التقرير
private buildOrdersInventoryHTML(data: any, filters: OrdersInventoryFilters): string {
  const currentDate = this.formatDate(new Date());
  
  return `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير جرد الطلبيات</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Segoe UI', Tahoma, Arial, 'Noto Kufi Arabic', sans-serif;
      padding: 15px;
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
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid #000;
    }
    
    .header .bakery-name {
      font-size: 18px;
      font-weight: bold;
      color: #000;
      margin-bottom: 3px;
    }
    
    .header h1 {
      font-size: 16px;
      font-weight: bold;
      color: #000;
      margin-bottom: 3px;
    }
    
    .header .summary {
      font-size: 12px;
      color: #000;
      font-weight: 700;
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
    
    .text-right {
      text-align: right;
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
    
    .text-success {
      color: #2e7d32;
      font-weight: bold;
    }
    
    @media print {
      @page {
        size: A4;
        margin: 10mm;
      }
      
      body {
        padding: 0;
        font-size: 12px;
        font-weight: 700;
        color: #000 !important;
      }
      
      .header .bakery-name {
        font-size: 17px;
      }
      
      .header h1 {
        font-size: 15px;
      }
      
      .header .summary {
        font-size: 11px;
        font-weight: 700;
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
    <h1>تقرير جرد الطلبيات</h1>
    <div class="summary">إجمالي ${data.summary.totalItems} مادة - ${data.summary.totalTrays} صاج - ${data.summary.totalPieces} قطعة - من ${data.summary.totalOrders} طلبية | التاريخ: ${currentDate}</div>
  </div>

  ${this.buildInventoryTable(data.items)}

  <script>
    window.onload = function() {
      setTimeout(() => {
        window.print();
      }, 500);
    };
  </script>
</body>
</html>
  `;
}

// 6. بناء جدول المواد
private buildInventoryTable(items: OrderInventoryItem[]): string {
  if (!items || items.length === 0) {
    return `
      <div style="text-align:center; padding: 30px; color: #666;">
        لا توجد مواد مطابقة للفلاتر المحددة
      </div>
    `;
  }
  
  const rows = items.map(item => {
    const traysDisplay = item.totalTrays && item.totalTrays > 0 ? 
      (item.totalTrays % 1 === 0 ? item.totalTrays.toString() : item.totalTrays.toFixed(2)) : '—';
    const piecesDisplay = item.totalPieces && item.totalPieces > 0 ? 
      (item.totalPieces % 1 === 0 ? item.totalPieces.toString() : item.totalPieces.toFixed(2)) : '—';
    
    return `
      <tr>
        <td class="text-center text-bold">${item.itemName}</td>
        <td class="text-center">${item.unit}</td>
        <td class="text-center text-bold">${item.totalQuantity}</td>
        <td class="text-center text-bold text-primary">${traysDisplay}</td>
        <td class="text-center text-bold text-success">${piecesDisplay}</td>
      </tr>
    `;
  }).join('');
  
  // حساب الإجماليات
  const totalQuantity = items.reduce((sum, item) => sum + item.totalQuantity, 0);
  const totalTrays = items.reduce((sum, item) => sum + (item.totalTrays || 0), 0);
  const totalPieces = items.reduce((sum, item) => sum + (item.totalPieces || 0), 0);
  
  const totalTraysFormatted = totalTrays > 0 ? 
    (totalTrays % 1 === 0 ? totalTrays.toString() : totalTrays.toFixed(2)) : '—';
  const totalPiecesFormatted = totalPieces > 0 ? 
    (totalPieces % 1 === 0 ? totalPieces.toString() : totalPieces.toFixed(2)) : '—';
  
  return `
    <table>
      <thead>
        <tr>
          <th style="width: 30%">اسم المادة</th>
          <th style="width: 18%">الوحدة</th>
          <th style="width: 17%">الكمية</th>
          <th style="width: 17%">الصاجات</th>
          <th style="width: 18%">القطع</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
        <tr class="total-row">
          <td class="text-center">المجموع الكلي</td>
          <td class="text-center">—</td>
          <td class="text-center">${totalQuantity}</td>
          <td class="text-center text-primary">${totalTraysFormatted}</td>
          <td class="text-center text-success">${totalPiecesFormatted}</td>
        </tr>
      </tbody>
    </table>
  `;
}

// 7. دالة الحصول على اسم الحالة بالعربية
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

// 8. تنسيق التاريخ بالصيغة الميلادية
private formatDate(date: Date | string): string {
  const d = new Date(date);
  const months = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  
  const day = d.getDate();
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  
  return `${day} ${month} ${year}`;
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
  
  // بناء جدول المخزون المحدث
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
  const tableRows = items.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${item.itemName}</td>
      <td>${item.itemGroup}</td>
      <td>${item.unit}</td>
      <td>${item.openingStock.toFixed(2)}</td>
      <td>${item.purchases.toFixed(2)}</td>
      <td>${item.currentStock.toFixed(2)}</td>
      <td>${item.consumedQuantity.toFixed(2)}</td>
      <td>${item.averageUnitPrice.toFixed(2)} ل.س</td>
      <td>${item.totalValue.toFixed(2)} ل.س</td>
    </tr>
  `).join('');

  return `
    <section class="section" id="inventory-section">
      <h2>تفاصيل المخزون</h2>
      <div class="table-container">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>اسم المادة</th>
              <th>المجموعة</th>
              <th>الوحدة</th>
              <th>الرصيد الافتتاحي</th>
              <th>المشتريات</th>
              <th>الرصيد الحالي</th>
              <th>الكمية المستهلكة</th>
              <th>القيمة الإفرادية</th>
              <th>القيمة الإجمالية</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
          <tfoot>
            <tr class="total-row">
              <td colspan="4"><strong>الإجمالي</strong></td>
              <td><strong>${items.reduce((sum, item) => sum + item.openingStock, 0).toFixed(2)}</strong></td>
              <td><strong>${items.reduce((sum, item) => sum + item.purchases, 0).toFixed(2)}</strong></td>
              <td><strong>${items.reduce((sum, item) => sum + item.currentStock, 0).toFixed(2)}</strong></td>
              <td><strong>${items.reduce((sum, item) => sum + item.consumedQuantity, 0).toFixed(2)}</strong></td>
              <td><strong>—</strong></td>
              <td><strong>${items.reduce((sum, item) => sum + item.totalValue, 0).toFixed(2)} ل.س</strong></td>
            </tr>
          </tfoot>
        </table>
      </div>
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
async generateFundsMovementReport(startDate: Date, endDate: Date, fundType?: string): Promise<string> {
  // بناء شروط البحث
  const whereConditions: any = {
    paidStatus: true,
    createdAt: {
      gte: startDate,
      lte: endDate
    }
  };

  // إضافة فلتر الصندوق إذا تم تحديده
  if (fundType) {
    whereConditions.fund = {
      fundType: fundType
    };
  }

  // جلب حركات الصناديق
  const fundsMovements = await this.prisma.invoice.findMany({
    where: whereConditions,
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
    const movementFundType = movement.fund.fundType;
    if (!fundsSummary.has(movementFundType)) {
      fundsSummary.set(movementFundType, {
        income: 0,
        expense: 0,
        count: 0,
        fundName: this.getFundTypeName(movementFundType)
      });
    }
    const fund = fundsSummary.get(movementFundType);
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

  // تحديد عنوان التقرير حسب الفلتر
  const reportTitle = fundType 
    ? `تقرير حركة ${this.getFundTypeName(fundType)}`
    : 'تقرير حركة الصناديق';

  const reportSubtitle = fundType
    ? `${this.getFundTypeName(fundType)} - من ${this.formatDate(startDate)} إلى ${this.formatDate(endDate)}`
    : `جميع الصناديق - من ${this.formatDate(startDate)} إلى ${this.formatDate(endDate)}`;

  // بناء HTML التقرير
  let template = this.getHTMLTemplate();
  
  const replacements = {
    '{{REPORT_TITLE}}': reportTitle,
    '{{REPORT_SUBTITLE}}': reportSubtitle,
    '{{CUSTOMER_NAME}}': fundType ? this.getFundTypeName(fundType) : 'جميع الصناديق',
    '{{CUSTOMER_PHONE}}': '—',
    '{{CUSTOMER_CATEGORY}}': '—',
    '{{TOTAL_UNPAID}}': `${fundsMovements.length} حركة`,
    '{{TOTAL_BREAK}}': this.formatCurrency(totalIncome),
    '{{TOTAL_DEBTS}}': this.formatCurrency(totalExpense),
    '{{GRAND_TOTAL}}': this.formatCurrency(totalIncome - totalExpense),
    '{{NOTES}}': this.buildFundsReportNotes(totalIncome, totalExpense, fundType)
  };

  Object.entries(replacements).forEach(([key, value]) => {
    template = template.replace(new RegExp(key, 'g'), value);
  });

  // ملخص خاص بحركة الصناديق
  const movementsSummaryHTML = this.buildFundsMovementSummary(totalIncome, totalExpense, fundType);

  // بناء جدول حركة الصناديق
  const tableHTML = this.buildFundsMovementTable(fundsSummary, fundType);

  template = template.replace(/(<section class="section" id="account-summary">[\s\S]*?<\/section>)/g, movementsSummaryHTML);
  template = template.replace(/(<section class="section" id="unpaid-section">[\s\S]*?<\/section>)/g, tableHTML);
  template = template.replace('{{ADDITIONAL_SECTIONS}}', '');

  return template;
}

// دالة مساعدة لبناء ملخص حركة الصناديق
private buildFundsMovementSummary(totalIncome: number, totalExpense: number, fundType?: string): string {
  const summaryTitle = fundType 
    ? `ملخص حركة ${this.getFundTypeName(fundType)}`
    : 'ملخص حركة الصناديق';

  return `
    <section class="section" id="account-summary">
      <h3>${summaryTitle}</h3>
      <div class="cards">
        <div class="card">
          <div class="label">إجمالي المدخولات</div>
          <div class="value" style="color: #059669;">${this.formatCurrency(totalIncome)}</div>
        </div>
        <div class="card">
          <div class="label">إجمالي المصروفات</div>
          <div class="value" style="color: #dc2626;">${this.formatCurrency(totalExpense)}</div>
        </div>
        <div class="card">
          <div class="label">صافي الحركة</div>
          <div class="value" style="color: ${totalIncome - totalExpense >= 0 ? '#059669' : '#dc2626'}; font-weight: bold;">
            ${this.formatCurrency(totalIncome - totalExpense)}
          </div>
        </div>
      </div>
    </section>
  `;
}

// دالة مساعدة لبناء جدول حركة الصناديق
private buildFundsMovementTable(fundsSummary: Map<string, any>, fundType?: string): string {
  const tableTitle = fundType 
    ? `تفاصيل حركة ${this.getFundTypeName(fundType)}`
    : 'تفاصيل حركة الصناديق';

  // إذا كان هناك فلتر لصندوق واحد وله بيانات
  if (fundType && fundsSummary.size === 1) {
    const fundData = fundsSummary.get(fundType);
    return `
      <section class="section">
        <h3>${tableTitle}</h3>
        <div class="single-fund-details">
          <div class="fund-info">
            <h4>${this.getFundTypeName(fundType)}</h4>
            <div class="fund-stats">
              <div class="stat-item">
                <span class="label">المدخولات:</span>
                <span class="value income">${this.formatCurrency(fundData.income)}</span>
              </div>
              <div class="stat-item">
                <span class="label">المصروفات:</span>
                <span class="value expense">${this.formatCurrency(fundData.expense)}</span>
              </div>
              <div class="stat-item">
                <span class="label">الصافي:</span>
                <span class="value net ${fundData.income - fundData.expense >= 0 ? 'positive' : 'negative'}">
                  ${this.formatCurrency(fundData.income - fundData.expense)}
                </span>
              </div>
              <div class="stat-item">
                <span class="label">عدد الحركات:</span>
                <span class="value">${fundData.count}</span>
              </div>
            </div>
          </div>
        </div>
        <style>
          .single-fund-details {
            background: #f8f9fa;
            padding: 20px;
            border-radius: 8px;
            margin: 15px 0;
          }
          .fund-info h4 {
            color: #1f2937;
            margin-bottom: 15px;
            text-align: center;
          }
          .fund-stats {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 15px;
          }
          .stat-item {
            display: flex;
            justify-content: space-between;
            padding: 10px;
            background: white;
            border-radius: 5px;
            border: 1px solid #e5e7eb;
          }
          .stat-item .label {
            font-weight: bold;
            color: #374151;
          }
          .stat-item .value.income { color: #059669; }
          .stat-item .value.expense { color: #dc2626; }
          .stat-item .value.net.positive { color: #059669; font-weight: bold; }
          .stat-item .value.net.negative { color: #dc2626; font-weight: bold; }
        </style>
      </section>
    `;
  }

  // جدول متعدد الصناديق
  const movementsRows = Array.from(fundsSummary.entries()).map(([fundTypeKey, data]) => {
    return `
      <tr>
        <td style="text-align:right; font-weight: bold;">${data.fundName}</td>
        <td style="text-align:center; color: #059669; font-weight: bold;">
          ${this.formatCurrency(data.income)}
        </td>
        <td style="text-align:center; color: #dc2626; font-weight: bold;">
          ${this.formatCurrency(data.expense)}
        </td>
        <td style="text-align:center; font-weight: bold; color: ${data.income - data.expense >= 0 ? '#059669' : '#dc2626'};">
          ${this.formatCurrency(data.income - data.expense)}
        </td>
        <td style="text-align:center; font-weight: bold;">
          ${data.count}
        </td>
      </tr>
    `;
  }).join('');

  // إضافة صف الإجمالي إذا كان هناك أكثر من صندوق
  const totalRow = fundsSummary.size > 1 ? `
    <tr style="background-color: #f3f4f6; border-top: 2px solid #d1d5db;">
      <td style="text-align:right; font-weight: bold;">الإجمالي العام</td>
      <td style="text-align:center; color: #059669; font-weight: bold;">
        ${this.formatCurrency(Array.from(fundsSummary.values()).reduce((sum, fund) => sum + fund.income, 0))}
      </td>
      <td style="text-align:center; color: #dc2626; font-weight: bold;">
        ${this.formatCurrency(Array.from(fundsSummary.values()).reduce((sum, fund) => sum + fund.expense, 0))}
      </td>
      <td style="text-align:center; font-weight: bold; color: #1f2937;">
        ${this.formatCurrency(Array.from(fundsSummary.values()).reduce((sum, fund) => sum + (fund.income - fund.expense), 0))}
      </td>
      <td style="text-align:center; font-weight: bold;">
        ${Array.from(fundsSummary.values()).reduce((sum, fund) => sum + fund.count, 0)}
      </td>
    </tr>
  ` : '';

  return `
    <section class="section">
      <h3>${tableTitle}</h3>
      <table>
        <thead>
          <tr style="background-color: #e5e7eb;">
            <th style="text-align:center;">نوع الصندوق</th>
            <th style="text-align:center;">المدخولات</th>
            <th style="text-align:center;">المصروفات</th>
            <th style="text-align:center;">الصافي</th>
            <th style="text-align:center;">عدد الحركات</th>
          </tr>
        </thead>
        <tbody>
          ${movementsRows}
          ${totalRow}
        </tbody>
      </table>
    </section>
  `;
}

// دالة مساعدة للحصول على اسم نوع الصندوق
private getFundTypeName(fundType: string): string {
  const fundNames = {
    'main': 'الخزينة الرئيسية',
    'general': 'الصندوق العام',
    'booth': 'البسطة',
    'university': 'الجامعة'
  };
  
  return fundNames[fundType] || fundType;
}

// دالة مساعدة لبناء ملاحظات التقرير
private buildFundsReportNotes(totalIncome: number, totalExpense: number, fundType?: string): string {
  const netAmount = totalIncome - totalExpense;
  const fundInfo =  ` لـ${this.getFundTypeName(fundType)}`;
  
  return `
    <div class="notes-section">
      <h4>ملخص التقرير:</h4>
      <ul>
        <li>صافي الحركة${fundInfo}: ${this.formatCurrency(netAmount)}</li>
        <li>نسبة المدخولات: ${totalIncome > 0 ? ((totalIncome / (totalIncome + totalExpense)) * 100).toFixed(1) : 0}%</li>
        <li>نسبة المصروفات: ${totalExpense > 0 ? ((totalExpense / (totalIncome + totalExpense)) * 100).toFixed(1) : 0}%</li>
        <li>حالة الصندوق: ${netAmount >= 0 ? 'إيجابية' : 'سلبية'}</li>
      </ul>
    </div>
  `;
}


// 5. تقرير ملخص الواردية
async getShiftSummary(shiftId: number): Promise<ShiftSummary> {
  try {
    // Get shift details with employee and invoices
    const shift = await this.prisma.shift.findUnique({
      where: { id: shiftId },
      include: {
        employee: true,
        invoices: {
          include: {
            fund: true
          }
        }
      }
    });

    if (!shift) {
      throw new NotFoundException(`Shift #${shiftId} not found`);
    }

    // Get relevant fund types (excluding main)
    const relevantFundTypes = Object.values(FundType).filter(
      fundType => fundType !== FundType.main
    );

    // Group invoices by fund type
    const fundSummaries: FundSummary[] = await Promise.all(
      relevantFundTypes.map(async (fundType) => {
        // Get all invoices for this fund type in the shift
        const fundInvoices = shift.invoices.filter(
          invoice => invoice.fund.fundType === fundType
        );

        // Calculate totals
        const incomeTotal = fundInvoices
          .filter(invoice => invoice.invoiceType === 'income')
          .reduce((sum, invoice) => sum + (invoice.totalAmount - (invoice.discount || 0)), 0);

        const expenseTotal = fundInvoices
          .filter(invoice => invoice.invoiceType === 'expense')
          .reduce((sum, invoice) => sum + (invoice.totalAmount - (invoice.discount || 0)), 0);

        return {
          fundType,
          invoiceCount: fundInvoices.length,
          incomeTotal,
          expenseTotal,
          netTotal: incomeTotal - expenseTotal,
        };
      })
    );

    // Calculate total net across all non-main funds
    const totalNet = fundSummaries.reduce(
      (sum, fund) => sum + fund.netTotal,
      0
    );

    return {
      shiftId: shift.id,
      employeeName: shift.employee.username,
      openTime: shift.openTime,
      closedTime: shift.closeTime,
      fundSummaries,
      totalNet,
      differenceStatus: shift.differenceStatus || null,
      differenceValue: shift.differenceValue || null,
    };
  } catch (error) {
    if (error instanceof NotFoundException) {
      throw error;
    }
    throw new InternalServerErrorException('Failed to generate shift summary');
  }
}

// تحديث دالة توليد تقرير ملخص الواردية
async generateShiftSummaryReport(shiftId?: number): Promise<string> {
  let targetShiftId: number;

  // تحديد الواردية (الحالية إذا لم يتم تحديد معرف)
  if (shiftId) {
    targetShiftId = shiftId;
  } else {
    const currentShift = await this.prisma.shift.findFirst({
      where: { status: 'open' }
    });
    
    if (!currentShift) {
      throw new BadRequestException('لا توجد واردية مفتوحة');
    }
    
    targetShiftId = currentShift.id;
  }

  // الحصول على ملخص الواردية باستخدام الدالة المحسنة
  const shiftSummary = await this.getShiftSummary(targetShiftId);

  // الحصول على تفاصيل الواردية الإضافية
  const shift = await this.prisma.shift.findUnique({
    where: { id: targetShiftId },
    include: {
      employee: true
    }
  });

  // بناء HTML التقرير
  let template = this.getHTMLTemplate();
  
  const shiftTypeAr = shift.shiftType === 'morning' ? 'صباحية' : 'مسائية';
  const shiftStatusAr = shift.status === 'open' ? 'مفتوحة' : 'مغلقة';
  
  const replacements = {
    '{{REPORT_TITLE}}': 'تقرير ملخص الواردية',
    '{{REPORT_SUBTITLE}}': `واردية ${shiftTypeAr} - ${shiftStatusAr} #${shiftSummary.shiftId}`,
    '{{CUSTOMER_NAME}}': shiftSummary.employeeName || '—',
    '{{CUSTOMER_PHONE}}': this.formatDate(shiftSummary.openTime),
    '{{CUSTOMER_CATEGORY}}': shiftSummary.closedTime ? this.formatDate(shiftSummary.closedTime) : 'مفتوحة',
    '{{TOTAL_UNPAID}}': `${shiftSummary.fundSummaries.reduce((sum, fund) => sum + fund.invoiceCount, 0)} فاتورة`,
    '{{TOTAL_BREAK}}': this.formatCurrency(shiftSummary.fundSummaries.reduce((sum, fund) => sum + fund.incomeTotal, 0)),
    '{{TOTAL_DEBTS}}': this.formatCurrency(shiftSummary.fundSummaries.reduce((sum, fund) => sum + fund.expenseTotal, 0)),
    '{{GRAND_TOTAL}}': this.formatCurrency(shiftSummary.totalNet),
    '{{NOTES}}': this.buildShiftSummaryNotes(shiftSummary)
  };

  Object.entries(replacements).forEach(([key, value]) => {
    template = template.replace(new RegExp(key, 'g'), value);
  });

  // ملخص خاص بالواردية
  const shiftSummaryHTML = this.buildShiftSummarySection(shiftSummary);

  // بناء جدول الصناديق المحسن
  const tableHTML = this.buildShiftFundsTable(shiftSummary);

  // إضافة قسم تفاصيل الفروقات إذا وجدت
  const differenceSection = this.buildDifferenceSection(shiftSummary);

  template = template.replace(/(<section class="section" id="account-summary">[\s\S]*?<\/section>)/g, shiftSummaryHTML);
  template = template.replace(/(<section class="section" id="unpaid-section">[\s\S]*?<\/section>)/g, tableHTML);
  template = template.replace('{{ADDITIONAL_SECTIONS}}', differenceSection);

  return template;
}

// دالة بناء قسم ملخص الواردية
private buildShiftSummarySection(shiftSummary: ShiftSummary): string {
  const totalIncome = shiftSummary.fundSummaries.reduce((sum, fund) => sum + fund.incomeTotal, 0);
  const totalExpense = shiftSummary.fundSummaries.reduce((sum, fund) => sum + fund.expenseTotal, 0);
  
  return `
    <section class="section" id="account-summary">
      <h3>ملخص الواردية #${shiftSummary.shiftId}</h3>
      <div class="shift-info">
        <div class="info-row">
          <span class="label">المسؤول:</span>
          <span class="value">${shiftSummary.employeeName}</span>
        </div>
        <div class="info-row">
          <span class="label">وقت الفتح:</span>
          <span class="value">${this.formatDateTime(shiftSummary.openTime)}</span>
        </div>
        <div class="info-row">
          <span class="label">وقت الإغلاق:</span>
          <span class="value">${shiftSummary.closedTime ? this.formatDateTime(shiftSummary.closedTime) : 'مفتوحة'}</span>
        </div>
      </div>
      <div class="cards">
        <div class="card">
          <div class="label">إجمالي المدخولات</div>
          <div class="value" style="color: #059669;">${this.formatCurrency(totalIncome)}</div>
        </div>
        <div class="card">
          <div class="label">إجمالي المصروفات</div>
          <div class="value" style="color: #dc2626;">${this.formatCurrency(totalExpense)}</div>
        </div>
        <div class="card">
          <div class="label">صافي الواردية</div>
          <div class="value" style="color: ${shiftSummary.totalNet >= 0 ? '#059669' : '#dc2626'}; font-weight: bold;">
            ${this.formatCurrency(shiftSummary.totalNet)}
          </div>
        </div>
      </div>
    </section>
  `;
}

// دالة بناء جدول الصناديق المحسن
private buildShiftFundsTable(shiftSummary: ShiftSummary): string {
  const fundsRows = shiftSummary.fundSummaries.map((fund) => {
    const fundName = this.getFundTypeName(fund.fundType);
    
    return `
      <tr>
        <td style="text-align:right; font-weight: bold;">${fundName}</td>
        <td style="text-align:center; color: #6b7280;">${fund.invoiceCount}</td>
        <td style="text-align:center; color: #059669; font-weight: bold;">
          ${this.formatCurrency(fund.incomeTotal)}
        </td>
        <td style="text-align:center; color: #dc2626; font-weight: bold;">
          ${this.formatCurrency(fund.expenseTotal)}
        </td>
        <td style="text-align:center; font-weight: bold; color: ${fund.netTotal >= 0 ? '#059669' : '#dc2626'};">
          ${this.formatCurrency(fund.netTotal)}
        </td>
      </tr>
    `;
  }).join('');

  // إضافة صف الإجمالي
  const totalInvoices = shiftSummary.fundSummaries.reduce((sum, fund) => sum + fund.invoiceCount, 0);
  const totalIncome = shiftSummary.fundSummaries.reduce((sum, fund) => sum + fund.incomeTotal, 0);
  const totalExpense = shiftSummary.fundSummaries.reduce((sum, fund) => sum + fund.expenseTotal, 0);

  const totalRow = `
    <tr style="background-color: #f3f4f6; border-top: 2px solid #d1d5db;">
      <td style="text-align:right; font-weight: bold;">الإجمالي العام</td>
      <td style="text-align:center; font-weight: bold;">${totalInvoices}</td>
      <td style="text-align:center; color: #059669; font-weight: bold;">
        ${this.formatCurrency(totalIncome)}
      </td>
      <td style="text-align:center; color: #dc2626; font-weight: bold;">
        ${this.formatCurrency(totalExpense)}
      </td>
      <td style="text-align:center; font-weight: bold; color: ${shiftSummary.totalNet >= 0 ? '#059669' : '#dc2626'};">
        ${this.formatCurrency(shiftSummary.totalNet)}
      </td>
    </tr>
  `;

  return `
    <section class="section">
      <h3>تفاصيل الصناديق في الواردية</h3>
      <table>
        <thead>
          <tr style="background-color: #e5e7eb;">
            <th style="text-align:center;">الصندوق</th>
            <th style="text-align:center;">عدد الفواتير</th>
            <th style="text-align:center;">المدخولات</th>
            <th style="text-align:center;">المصروفات</th>
            <th style="text-align:center;">الصافي</th>
          </tr>
        </thead>
        <tbody>
          ${fundsRows}
          ${totalRow}
        </tbody>
      </table>
    </section>
  `;
}

// دالة بناء قسم الفروقات
private buildDifferenceSection(shiftSummary: ShiftSummary): string {
  if (!shiftSummary.differenceStatus || !shiftSummary.differenceValue) {
    return '';
  }

  const statusText = shiftSummary.differenceStatus === 'surplus' ? 'فائض' : 'عجز';
  const statusColor = shiftSummary.differenceStatus === 'surplus' ? '#059669' : '#dc2626';

  return `
    <section class="section">
      <h3>حالة الفروقات</h3>
      <div class="difference-info">
        <div class="difference-card">
          <div class="difference-status" style="color: ${statusColor};">
            ${statusText}
          </div>
          <div class="difference-value" style="color: ${statusColor};">
            ${this.formatCurrency(Math.abs(shiftSummary.differenceValue))}
          </div>
        </div>
      </div>
    </section>
    <style>
      .difference-info {
        display: flex;
        justify-content: center;
        margin: 20px 0;
      }
      .difference-card {
        background: #f8f9fa;
        border: 2px solid #e9ecef;
        border-radius: 12px;
        padding: 20px;
        text-align: center;
        min-width: 200px;
      }
      .difference-status {
        font-size: 18px;
        font-weight: bold;
        margin-bottom: 10px;
      }
      .difference-value {
        font-size: 24px;
        font-weight: bold;
      }
    </style>
  `;
}

// دالة بناء الملاحظات
private buildShiftSummaryNotes(shiftSummary: ShiftSummary): string {
  const totalInvoices = shiftSummary.fundSummaries.reduce((sum, fund) => sum + fund.invoiceCount, 0);
  const activeFunds = shiftSummary.fundSummaries.filter(fund => fund.invoiceCount > 0).length;
  
  let notes = `
    <div class="notes-section">
      <h4>ملخص الواردية:</h4>
      <ul>
        <li>صافي الواردية: ${this.formatCurrency(shiftSummary.totalNet)}</li>
        <li>إجمالي الفواتير: ${totalInvoices} فاتورة</li>
        <li>الصناديق النشطة: ${activeFunds} من ${shiftSummary.fundSummaries.length}</li>
        <li>حالة الواردية: ${shiftSummary.closedTime ? 'مغلقة' : 'مفتوحة'}</li>
  `;

  if (shiftSummary.differenceStatus && shiftSummary.differenceValue) {
    const statusText = shiftSummary.differenceStatus === 'surplus' ? 'فائض' : 'عجز';
    notes += `<li>حالة الفروقات: ${statusText} بقيمة ${this.formatCurrency(Math.abs(shiftSummary.differenceValue))}</li>`;
  }

  notes += `
      </ul>
    </div>
  `;

  return notes;
}

// دالة مساعدة لتنسيق التاريخ والوقت
private formatDateTime(date: Date): string {
  return new Intl.DateTimeFormat('ar-SA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }).format(new Date(date));
}


// 1. تقرير أجور الورشات
async generateWorkshopSalariesReport(workshopId?: number, startDate?: Date, endDate?: Date): Promise<string> {
  // بناء شروط البحث
  const where: any = {};
  
  if (workshopId) {
    where.id = workshopId;
  }

  // جلب الورشات مع بياناتها
  const workshops = await this.prisma.workshop.findMany({
    where,
    include: {
      employees: {
        include: {
          withdrawals: {
            where: {
              ...(startDate && endDate ? {
                date: {
                  gte: startDate,
                  lte: endDate
                }
              } : {})
            },
            orderBy: {
              date: 'desc'
            }
          },
          productionRecords: {
            ...(startDate && endDate ? {
              where: {
                date: {
                  gte: startDate,
                  lte: endDate
                }
              }
            } : {}),
            include: {
              item: true
            },
            orderBy: {
              date: 'desc'
            }
          },
          hourRecords: {
            ...(startDate && endDate ? {
              where: {
                date: {
                  gte: startDate,
                  lte: endDate
                }
              }
            } : {}),
            orderBy: {
              date: 'desc'
            }
          },
          salaryPayments: {
            ...(startDate && endDate ? {
              where: {
                date: {
                  gte: startDate,
                  lte: endDate
                }
              }
            } : {}),
            include: {
              invoice: true
            },
            orderBy: {
              date: 'desc'
            }
          }
        }
      },
      productionRecords: {
        ...(startDate && endDate ? {
          where: {
            date: {
              gte: startDate,
              lte: endDate
            }
          }
        } : {}),
        orderBy: {
          date: 'desc'
        }
      },
      settlements: {
        ...(startDate && endDate ? {
          where: {
            date: {
              gte: startDate,
              lte: endDate
            }
          }
        } : {}),
        include: {
          fund: true,
          invoice: true
        },
        orderBy: {
          date: 'desc'
        }
      }
    }
  });

  if (workshops.length === 0) {
    throw new BadRequestException('لا توجد ورشات مطابقة للمعايير المحددة');
  }

  // حساب البيانات لكل ورشة
  const workshopsData = workshops.map(workshop => {
    // حساب إجمالي المبلغ المستحق
    let totalEarnings = 0;
    
    if (workshop.workType === 'production') {
      totalEarnings = workshop.productionRecords.reduce((sum, record) => sum + record.totalProduction, 0);
    } else {
      totalEarnings = workshop.employees.reduce((sum, employee) => 
        sum + employee.hourRecords.reduce((empSum, record) => empSum + record.totalAmount, 0), 0
      );
    }

    // حساب إجمالي السحوبات
    const totalWithdrawals = workshop.employees.reduce((sum, employee) => 
      sum + employee.withdrawals.reduce((empSum, withdrawal) => empSum + withdrawal.amount, 0), 0
    );

    // حساب إجمالي المبالغ المدفوعة
    const totalPaidAmount = workshop.settlements.reduce((sum, settlement) => sum + settlement.paidAmount, 0);

    // حساب الصافي
    const netAmount = totalEarnings - totalWithdrawals;

    // تفاصيل توزيع السحوبات على العمال
    const withdrawalsByEmployee = workshop.employees.map(employee => ({
      employeeId: employee.id,
      employeeName: employee.name,
      totalWithdrawals: employee.withdrawals.reduce((sum, w) => sum + w.amount, 0),
      withdrawalsCount: employee.withdrawals.length,
      withdrawalsDetails: employee.withdrawals
    })).filter(emp => emp.totalWithdrawals > 0);

    // تفاصيل توزيع المدفوعات على العمال
    const paymentsByEmployee = workshop.employees.map(employee => ({
      employeeId: employee.id,
      employeeName: employee.name,
      totalPayments: employee.salaryPayments.reduce((sum, p) => sum + p.amount, 0),
      paymentsCount: employee.salaryPayments.length,
      paymentsDetails: employee.salaryPayments
    })).filter(emp => emp.totalPayments > 0);

    return {
      workshop,
      totalEarnings,
      totalWithdrawals,
      totalPaidAmount,
      netAmount,
      withdrawalsByEmployee,
      paymentsByEmployee
    };
  });

  // حساب الإجماليات العامة
  const grandTotalEarnings = workshopsData.reduce((sum, data) => sum + data.totalEarnings, 0);
  const grandTotalWithdrawals = workshopsData.reduce((sum, data) => sum + data.totalWithdrawals, 0);
  const grandTotalPaid = workshopsData.reduce((sum, data) => sum + data.totalPaidAmount, 0);

  // بناء HTML التقرير
  let template = this.getHTMLTemplate();
  
  const reportTitle = workshopId ? 
    `تقرير أجور ورشة ${workshopsData[0].workshop.name}` : 
    'تقرير أجور جميع الورشات';
    
  const reportSubtitle = startDate && endDate ? 
    `من ${this.formatDate(startDate)} إلى ${this.formatDate(endDate)}` : 
    'جميع الفترات';
  
  const replacements = {
    '{{REPORT_TITLE}}': reportTitle,
    '{{REPORT_SUBTITLE}}': reportSubtitle,
    '{{CUSTOMER_NAME}}': '—',
    '{{CUSTOMER_PHONE}}': '—',
    '{{CUSTOMER_CATEGORY}}': '—',
    '{{TOTAL_UNPAID}}': `${workshopsData.length} ورشة`,
    '{{TOTAL_BREAK}}': this.formatCurrency(grandTotalEarnings),
    '{{TOTAL_DEBTS}}': this.formatCurrency(grandTotalWithdrawals),
    '{{GRAND_TOTAL}}': this.formatCurrency(grandTotalPaid),
    '{{NOTES}}': `صافي المبالغ المستحقة: ${this.formatCurrency(grandTotalEarnings - grandTotalWithdrawals)}`
  };

  Object.entries(replacements).forEach(([key, value]) => {
    template = template.replace(new RegExp(key, 'g'), value);
  });

  // ملخص خاص بأجور الورشات
  const salariesSummaryHTML = `
    <section class="section" id="account-summary">
      <h3>ملخص أجور الورشات</h3>
      <div class="cards">
        <div class="card"><div class="label">إجمالي المستحق</div><div class="value">${this.formatCurrency(grandTotalEarnings)}</div></div>
        <div class="card"><div class="label">إجمالي السحوبات</div><div class="value">${this.formatCurrency(grandTotalWithdrawals)}</div></div>
        <div class="card"><div class="label">إجمالي المدفوع</div><div class="value">${this.formatCurrency(grandTotalPaid)}</div></div>
      </div>
    </section>
  `;

  // بناء جدول تفاصيل الورشات
  const workshopsTableHTML = this.buildWorkshopsDetailsTable(workshopsData);

  template = template.replace(/(<section class="section" id="account-summary">[\s\S]*?<\/section>)/g, salariesSummaryHTML);
  template = template.replace(/(<section class="section" id="unpaid-section">[\s\S]*?<\/section>)/g, workshopsTableHTML);
  template = template.replace('{{ADDITIONAL_SECTIONS}}', '');

  return template;
}

// بناء جدول تفاصيل الورشات
private buildWorkshopsDetailsTable(workshopsData: any[]): string {
  let tablesHTML = '';

  workshopsData.forEach((data, index) => {
    const workshop = data.workshop;
    
    // جدول ملخص الورشة
    tablesHTML += `
      <section class="section">
        <h3>${workshop.name} - ${workshop.workType === 'production' ? 'ورشة إنتاج' : 'ورشة ساعات'}</h3>
        
        <div class="cards" style="margin-bottom: 15px;">
          <div class="card">
            <div class="label">المبلغ المستحق</div>
            <div class="value">${this.formatCurrency(data.totalEarnings)}</div>
          </div>
          <div class="card">
            <div class="label">إجمالي السحوبات</div>
            <div class="value">${this.formatCurrency(data.totalWithdrawals)}</div>
          </div>
          <div class="card">
            <div class="label">المبلغ المدفوع</div>
            <div class="value">${this.formatCurrency(data.totalPaidAmount)}</div>
          </div>
        </div>

        <h4>توزيع السحوبات على العمال</h4>
        <table style="margin-bottom: 20px;">
          <thead>
            <tr>
              <th>اسم العامل</th>
              <th>إجمالي السحوبات</th>
              <th>عدد السحوبات</th>
            </tr>
          </thead>
          <tbody>
    `;

    if (data.withdrawalsByEmployee.length > 0) {
      data.withdrawalsByEmployee.forEach(emp => {
        tablesHTML += `
          <tr>
            <td style="text-align:right">${emp.employeeName}</td>
            <td style="text-align:center; color: #dc2626;">${this.formatCurrency(emp.totalWithdrawals)}</td>
            <td style="text-align:center">${emp.withdrawalsCount}</td>
          </tr>
        `;
      });
    } else {
      tablesHTML += `
        <tr>
          <td colspan="3" style="text-align:center; color: #666;">لا توجد سحوبات</td>
        </tr>
      `;
    }

    tablesHTML += `
          </tbody>
        </table>

        <h4>توزيع المدفوعات على العمال</h4>
        <table>
          <thead>
            <tr>
              <th>اسم العامل</th>
              <th>إجمالي المدفوعات</th>
              <th>عدد المدفوعات</th>
            </tr>
          </thead>
          <tbody>
    `;

    if (data.paymentsByEmployee.length > 0) {
      data.paymentsByEmployee.forEach(emp => {
        tablesHTML += `
          <tr>
            <td style="text-align:right">${emp.employeeName}</td>
            <td style="text-align:center; color: #059669;">${this.formatCurrency(emp.totalPayments)}</td>
            <td style="text-align:center">${emp.paymentsCount}</td>
          </tr>
        `;
      });
    } else {
      tablesHTML += `
        <tr>
          <td colspan="3" style="text-align:center; color: #666;">لا توجد مدفوعات</td>
        </tr>
      `;
    }

    tablesHTML += `
          </tbody>
        </table>
        
        <p class="note" style="margin-top: 10px; text-align: center; font-weight: bold;">
          الصافي للورشة: ${this.formatCurrency(data.netAmount)}
        </p>
      </section>
    `;

    // إضافة فاصل بين الورشات إذا لم تكن الأخيرة
    if (index < workshopsData.length - 1) {
      tablesHTML += '<div class="page-break"></div>';
    }
  });

  return tablesHTML;
}

// 2. تقرير سحوبات الموظفين
async generateEmployeeWithdrawalsReport(employeeId?: number, startDate?: Date, endDate?: Date): Promise<string> {
  // بناء شروط البحث
  const where: any = {
  };
  
  if (employeeId) {
    where.employeeId = employeeId;
  }
  
  if (startDate && endDate) {
    where.date = {
      gte: startDate,
      lte: endDate
    };
  }

  // جلب السحوبات
  const withdrawals = await this.prisma.employeeWithdrawal.findMany({
    where,
    include: {
      employee: {
        include: {
          workshop: true
        }
      },
      invoice: true
    },
    orderBy: [
      { employee: { name: 'asc' } },
      { date: 'desc' }
    ]
  });

  // Handle empty results by returning empty report instead of throwing error
  if (withdrawals.length === 0) {
    return this.generateEmptyWithdrawalsReport(employeeId, startDate, endDate);
  }

  // تجميع البيانات حسب الموظف
  const employeesData = new Map();
  
  withdrawals.forEach(withdrawal => {
    const empId = withdrawal.employeeId;
    
    if (!employeesData.has(empId)) {
      employeesData.set(empId, {
        employee: withdrawal.employee,
        totalWithdrawals: 0,
        withdrawalsCount: 0,
        withdrawals: []
      });
    }
    
    const empData = employeesData.get(empId);
    empData.totalWithdrawals += withdrawal.amount;
    empData.withdrawalsCount++;
    empData.withdrawals.push(withdrawal);
  });

  const employeesArray = Array.from(employeesData.values());
  const grandTotal = employeesArray.reduce((sum, emp) => sum + emp.totalWithdrawals, 0);

  // بناء HTML التقرير
  let template = this.getHTMLTemplate();
  
  const reportTitle = employeeId ? 
    `تقرير سحوبات الموظف ${employeesArray[0].employee.name}` : 
    'تقرير سحوبات جميع الموظفين';
    
  const reportSubtitle = startDate && endDate ? 
    `من ${this.formatDate(startDate)} إلى ${this.formatDate(endDate)}` : 
    'جميع الفترات';
  
  const replacements = {
    '{{REPORT_TITLE}}': reportTitle,
    '{{REPORT_SUBTITLE}}': reportSubtitle,
    '{{CUSTOMER_NAME}}': '—',
    '{{CUSTOMER_PHONE}}': '—',
    '{{CUSTOMER_CATEGORY}}': '—',
    '{{TOTAL_UNPAID}}': `${employeesArray.length} موظف`,
    '{{TOTAL_BREAK}}': `${withdrawals.length} سحبة`,
    '{{TOTAL_DEBTS}}': this.formatCurrency(grandTotal),
    '{{GRAND_TOTAL}}': this.formatCurrency(grandTotal / employeesArray.length),
    '{{NOTES}}': `متوسط السحوبات لكل موظف: ${this.formatCurrency(grandTotal / employeesArray.length)}`
  };

  Object.entries(replacements).forEach(([key, value]) => {
    template = template.replace(new RegExp(key, 'g'), value);
  });

  // ملخص خاص بسحوبات الموظفين
  const withdrawalsSummaryHTML = `
    <section class="section" id="account-summary">
      <h3>ملخص سحوبات الموظفين</h3>
      <div class="cards">
        <div class="card"><div class="label">عدد الموظفين</div><div class="value">${employeesArray.length}</div></div>
        <div class="card"><div class="label">إجمالي السحوبات</div><div class="value">${this.formatCurrency(grandTotal)}</div></div>
        <div class="card"><div class="label">عدد العمليات</div><div class="value">${withdrawals.length}</div></div>
      </div>
    </section>
  `;

  // بناء جدول السحوبات
  const withdrawalsTableHTML = this.buildWithdrawalsTable(employeesArray);

  template = template.replace(/(<section class="section" id="account-summary">[\s\S]*?<\/section>)/g, withdrawalsSummaryHTML);
  template = template.replace(/(<section class="section" id="unpaid-section">[\s\S]*?<\/section>)/g, withdrawalsTableHTML);
  template = template.replace('{{ADDITIONAL_SECTIONS}}', '');

  return template;
}

// Helper method to generate empty report
private generateEmptyWithdrawalsReport(employeeId?: number, startDate?: Date, endDate?: Date): string {
  let template = this.getHTMLTemplate();
  
  const reportTitle = employeeId ? 
    'تقرير سحوبات الموظف' : 
    'تقرير سحوبات جميع الموظفين';
    
  const reportSubtitle = startDate && endDate ? 
    `من ${this.formatDate(startDate)} إلى ${this.formatDate(endDate)}` : 
    'جميع الفترات';
  
  const replacements = {
    '{{REPORT_TITLE}}': reportTitle,
    '{{REPORT_SUBTITLE}}': reportSubtitle,
    '{{CUSTOMER_NAME}}': '—',
    '{{CUSTOMER_PHONE}}': '—',
    '{{CUSTOMER_CATEGORY}}': '—',
    '{{TOTAL_UNPAID}}': '0 موظف',
    '{{TOTAL_BREAK}}': '0 سحبة',
    '{{TOTAL_DEBTS}}': this.formatCurrency(0),
    '{{GRAND_TOTAL}}': this.formatCurrency(0),
    '{{NOTES}}': 'لا توجد سحوبات مطابقة للمعايير المحددة'
  };

  Object.entries(replacements).forEach(([key, value]) => {
    template = template.replace(new RegExp(key, 'g'), value);
  });

  // Empty summary
  const emptySummaryHTML = `
    <section class="section" id="account-summary">
      <h3>ملخص سحوبات الموظفين</h3>
      <div class="cards">
        <div class="card"><div class="label">عدد الموظفين</div><div class="value">0</div></div>
        <div class="card"><div class="label">إجمالي السحوبات</div><div class="value">${this.formatCurrency(0)}</div></div>
        <div class="card"><div class="label">عدد العمليات</div><div class="value">0</div></div>
      </div>
    </section>
  `;

  // Empty table
  const emptyTableHTML = `
    <section class="section">
      <h3>تفاصيل سحوبات الموظفين</h3>
      <div style="text-align: center; padding: 40px; background-color: #f8f9fa; border-radius: 8px; color: #6b7280;">
        <p style="font-size: 18px; margin: 0;">لا توجد سحوبات مطابقة للمعايير المحددة</p>
        <p style="font-size: 14px; margin: 10px 0 0 0;">يرجى تعديل معايير البحث والمحاولة مرة أخرى</p>
      </div>
    </section>
  `;

  template = template.replace(/(<section class="section" id="account-summary">[\s\S]*?<\/section>)/g, emptySummaryHTML);
  template = template.replace(/(<section class="section" id="unpaid-section">[\s\S]*?<\/section>)/g, emptyTableHTML);
  template = template.replace('{{ADDITIONAL_SECTIONS}}', '');

  return template;
}

// بناء جدول السحوبات (unchanged)
private buildWithdrawalsTable(employeesArray: any[]): string {
  let tableHTML = `
    <section class="section">
      <h3>تفاصيل سحوبات الموظفين</h3>
      <table>
        <thead>
          <tr>
            <th>اسم الموظف</th>
            <th>الورشة</th>
            <th>التاريخ</th>
            <th>المبلغ</th>
            <th>رقم الفاتورة</th>
            <th>ملاحظات</th>
          </tr>
        </thead>
        <tbody>
  `;

  employeesArray.forEach(empData => {
    let isFirstRow = true;
    
    empData.withdrawals.forEach((withdrawal, index) => {
      tableHTML += `
        <tr>
          <td style="text-align:right; ${isFirstRow ? 'font-weight: bold;' : ''}">${isFirstRow ? empData.employee.name : ''}</td>
          <td style="text-align:center">${isFirstRow ? (empData.employee.workshop?.name || '—') : ''}</td>
          <td style="text-align:center">${this.formatDate(withdrawal.date)}</td>
          <td style="text-align:center; color: #dc2626;">${this.formatCurrency(withdrawal.amount)}</td>
          <td style="text-align:center">${withdrawal.invoice?.invoiceNumber || '—'}</td>
          <td style="text-align:center">${withdrawal.notes || '—'}</td>
        </tr>
      `;
      isFirstRow = false;
    });
    
    // صف المجموع لكل موظف
    tableHTML += `
      <tr style="background-color: #f8f9fa; font-weight: bold;">
        <td style="text-align:center" colspan="3">مجموع ${empData.employee.name}</td>
        <td style="text-align:center; color: #dc2626;">${this.formatCurrency(empData.totalWithdrawals)}</td>
        <td style="text-align:center">${empData.withdrawalsCount} سحبة</td>
        <td>—</td>
      </tr>
    `;
  });

  const grandTotal = employeesArray.reduce((sum, emp) => sum + emp.totalWithdrawals, 0);
  const totalCount = employeesArray.reduce((sum, emp) => sum + emp.withdrawalsCount, 0);

  tableHTML += `
        <tr style="background-color: #e3f2fd; font-weight: bold; border-top: 3px solid #2563eb;">
          <td colspan="3" style="text-align:center; font-size: 14px;">المجموع الكلي</td>
          <td style="text-align:center; color: #2563eb; font-size: 16px;">${this.formatCurrency(grandTotal)}</td>
          <td style="text-align:center; font-size: 14px;">${totalCount} سحبة</td>
          <td>—</td>
        </tr>
      </tbody>
    </table>
  </section>
  `;

  return tableHTML;
}


// 6. تقرير طباعة فاتورة وصل بتصميم محسّن
async generateInvoiceReceiptHTML(invoiceId: number): Promise<string> {
  const invoice = await this.prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      customer: true,
      employee: true,
      fund: true,
      shift: true,
      items: {
        include: {
          item: true
        }
      }
    }
  });

  if (!invoice) {
    throw new BadRequestException('الفاتورة غير موجودة');
  }

  return this.buildInvoiceReceiptHTML(invoice);
}

private buildInvoiceReceiptHTML(invoice: any): string {
  const receiptTemplate = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>فاتورة رقم ${invoice.invoiceNumber}</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    
    body {
      font-family: 'Segoe UI', Tahoma, Arial, 'Noto Kufi Arabic', sans-serif;
      padding: 15px;
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
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid #000;
    }
    
    .header .bakery-name {
      font-size: 18px;
      font-weight: bold;
      color: #000;
      margin-bottom: 3px;
    }
    
    .header h1 {
      font-size: 16px;
      font-weight: bold;
      color: #000;
      margin-bottom: 3px;
    }
    
    .header .summary {
      font-size: 12px;
      color: #000;
      font-weight: 700;
    }

    .invoice-details {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: 8px 0;
      justify-content: center;
    }

    .detail-item {
      font-size: 12px;
      font-weight: 700;
      color: #000;
      padding: 4px 8px;
      background: #fff;
      border: 1px solid #000;
      border-radius: 2px;
    }

    .detail-item .label {
      font-weight: bold;
      margin-left: 4px;
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
    
    .text-right {
      text-align: right;
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

    .no-items-message {
      text-align: center;
      padding: 30px;
      color: #000;
      font-size: 13px;
      font-weight: 700;
      border: 1px solid #000;
      margin-top: 10px;
    }

    .footer {
      text-align: center;
      margin-top: 10px;
      padding-top: 8px;
      border-top: 1px solid #000;
      font-size: 12px;
      color: #000;
      font-weight: 700;
    }

    .payment-status {
      font-size: 12px;
      font-weight: 700;
      color: #000;
    }

    .break-invoice-badge {
      color: #c41c3b;
      font-weight: bold;
    }
    
    @media print {
      @page {
        size: A4;
        margin: 10mm;
      }
      
      body {
        padding: 0;
        font-size: 12px;
        font-weight: 700;
        color: #000 !important;
      }
      
      .header .bakery-name {
        font-size: 17px;
      }
      
      .header h1 {
        font-size: 15px;
      }
      
      .header .summary {
        font-size: 11px;
        font-weight: 700;
      }

      .invoice-details {
        margin: 8px 0;
      }

      .detail-item {
        font-size: 11px;
        font-weight: 700;
        padding: 3px 6px;
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

      .footer {
        font-size: 11px;
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
    <h1>${this.getInvoiceTypeArabic(invoice.invoiceType)} ${this.getInvoiceCategoryArabic(invoice.invoiceCategory)}</h1>
    <div class="summary">
      رقم الفاتورة: ${this.convertToEnglishNumbers(invoice.invoiceNumber.split('-').pop() || invoice.id)} | 
      التاريخ: ${this.formatReceiptDate(invoice.createdAt)} | 
      الموظف: ${invoice.employee.username}
      ${invoice.paidStatus ? ' | ✓ مدفوع' : ' | ✗ غير مدفوع'}
    </div>
  </div>

  <div class="invoice-details">
    ${invoice.customer ? `
    <div class="detail-item">
      <span class="label">الزبون:</span>
      ${invoice.customer.name}
    </div>
    ` : ''}
    ${invoice.isBreak ? `
    <div class="detail-item">
      <span class="label break-invoice-badge">نوع:</span>
      <span class="break-invoice-badge">فاتورة كسر</span>
    </div>
    ` : ''}
    ${invoice.trayCount ? `
    <div class="detail-item">
      <span class="label">الصاجات:</span>
      ${this.convertToEnglishNumbers(invoice.trayCount)}
    </div>
    ` : ''}
    ${invoice.employeeInvoiceType ? `
    <div class="detail-item">
      <span class="label">نوع الفاتورة:</span>
      ${this.getEmployeeInvoiceTypeArabic(invoice.employeeInvoiceType)}
    </div>
    ` : ''}
    ${invoice.supplierPaymentAmount ? `
    <div class="detail-item">
      <span class="label">مبلغ المورد:</span>
      ${this.formatReceiptCurrency(invoice.supplierPaymentAmount)} ل.س
    </div>
    ` : ''}
  </div>

  ${this.buildItemsTableOptimized(invoice.items)}

  <div class="footer">
    ${invoice.notes ? `
    <div style="text-align: right; margin-bottom: 8px; padding: 8px; background: #fff; border-right: 2px solid #000; font-weight: 700; font-size: 12px;">
      <div style="font-weight: bold; margin-bottom: 4px;">ملاحظات:</div>
      <div>${invoice.notes}</div>
    </div>
    ` : ''}
    <div>شكراً لتعاملكم معنا - ${this.formatReceiptDate(new Date())}</div>
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

  return receiptTemplate;
}

// تحديث buildItemsTableOptimized مع نفس أسلوب تقرير الطلبيات
private buildItemsTableOptimized(items: any[]): string {
  if (!items || items.length === 0) {
    return `
      <div class="no-items-message">
        فاتورة مباشرة - بدون مواد
      </div>
    `;
  }

  const rows = items.map(item => {
    const itemName = item.item?.name || 'صنف';
    const unit = item.unit || '—';
    const quantity = item.quantity;
    const unitPrice = item.unitPrice;
    const subTotal = item.subTotal;

    return `
      <tr>
        <td class="text-center text-bold">${itemName}</td>
        <td class="text-center">${unit}</td>
        <td class="text-center text-bold">${this.convertToEnglishNumbers(quantity)}</td>
        <td class="text-center text-primary">${this.formatReceiptCurrency(unitPrice)} ل.س</td>
        <td class="text-center text-primary">${this.formatReceiptCurrency(subTotal)} ل.س</td>
      </tr>
    `;
  }).join('');

  // حساب الإجماليات
  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalAmount = items.reduce((sum, item) => sum + item.subTotal, 0);

  const finalTotal = totalAmount - (items[0]?.invoice?.discount || 0) + (items[0]?.invoice?.additionalAmount || 0);

  return `
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
        ${rows}
        <tr class="total-row">
          <td colspan="2" class="text-center">المجموع</td>
          <td class="text-center">${totalQuantity}</td>
          <td colspan="2" class="text-center">${this.formatReceiptCurrency(totalAmount)} ل.س</td>
        </tr>
      </tbody>
    </table>
  `;
}


// دالة تحويل الأرقام من العربية إلى الإنجليزية
private convertToEnglishNumbers(text: any): string {
  if (text === null || text === undefined) return '0';
  
  const arabicNumbers = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
  const englishNumbers = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  
  let result = text.toString();
  
  for (let i = 0; i < arabicNumbers.length; i++) {
    result = result.replace(new RegExp(arabicNumbers[i], 'g'), englishNumbers[i]);
  }
  
  return result;
}

// دوال مساعدة للفاتورة
private getInvoiceTypeArabic(type: string): string {
  return type === 'income' ? 'فاتورة بيع' : 'فاتورة شراء';
}

private getInvoiceCategoryArabic(category: string): string {
  const categories = {
    'products': 'منتجات',
    'services': 'خدمات', 
    'direct': 'مباشرة',
    'materials': 'مواد',
    'expenses': 'مصاريف'
  };
  return categories[category] || category;
}

private getEmployeeInvoiceTypeArabic(type: string): string {
  const types = {
    'withdrawal': 'سحب',
    'return': 'مرتجع',
    'debtPayment': 'دفع دين',
    'salary': 'راتب'
  };
  return types[type] || type;
}

// تحديث formatReceiptCurrency لاستخدام الأرقام الإنجليزية
private formatReceiptCurrency(amount: number | null | undefined): string {
  const numericAmount = Number(amount) || 0;
  // استخدام الأرقام الإنجليزية بدلاً من العربية
  const formatted = numericAmount.toLocaleString('en-US', { 
    minimumFractionDigits: 0,
    maximumFractionDigits: 0 
  });
  return this.convertToEnglishNumbers(formatted);
}

// تحديث formatReceiptDate لاستخدام الأرقام الإنجليزية
private formatReceiptDate(date: Date | string): string {
  const d = new Date(date);
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear().toString();
  const hours = d.getHours();
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const period = hours >= 12 ? 'مساءً' : 'صباحاً';
  const displayHours = hours > 12 ? hours - 12 : hours === 0 ? 12 : hours;
  
  const formattedDate = `${day}/${month}/${year} - ${displayHours}:${minutes} ${period}`;
  return this.convertToEnglishNumbers(formattedDate);
}

}
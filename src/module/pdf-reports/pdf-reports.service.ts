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

  


/**
 * تقرير جرد البسطة
 * جدول يوضح:
 * - الأيام (من البداية إلى النهاية)
 * - الواردية الصباحية والمسائية
 * - إجمالي مبيعات كل واردية
 * - إجمالي المحصل في كل يوم
 * - الإجمالي الكلي لكل الأيام
 */
async generateBoothInventoryReport(startDate: Date, endDate: Date): Promise<string> {
  // جلب جميع فواتير البسطة (دخل فقط) في الفترة المحددة

  console.log(startDate , endDate)
  const boothInvoices = await this.prisma.invoice.findMany({
    where: {
      fund: {
        fundType: FundType.booth
      },
      invoiceType: 'income',
      paidStatus: true,
      createdAt: {
        gte: startDate,
        lte: endDate
      }
    },
    include: {
      shift: true // للحصول على نوع الواردية
    },
    orderBy: {
      createdAt: 'asc'
    }
  });
  console.log(boothInvoices)

  // تنظيم البيانات حسب الأيام والواردية
  const dailyData = new Map<string, any>();
  let grandTotal = 0;

  boothInvoices.forEach(invoice => {
    const dateKey = this.formatDateKey(invoice.createdAt); // مثل: "2024-01-15"
    const dateDisplay = this.formatDate(invoice.createdAt); // مثل: "15 يناير 2024"
    
    if (!dailyData.has(dateKey)) {
      dailyData.set(dateKey, {
        dateKey,
        dateDisplay,
        shifts: {},
        dayTotal: 0
      });
    }

    const day = dailyData.get(dateKey);
    const shiftType = invoice.shift?.shiftType || 'unknown';
    const amount = invoice.totalAmount - (invoice.discount || 0);

    if (!day.shifts[shiftType]) {
      day.shifts[shiftType] = {
        type: shiftType === 'morning' ? 'الصباحية' : 'المسائية',
        total: 0
      };
    }

    day.shifts[shiftType].total += amount;
    day.dayTotal += amount;
    grandTotal += amount;
  });

  // تحويل البيانات إلى مصفوفة مرتبة
  const sortedDays = Array.from(dailyData.values()).sort((a, b) => {
    return new Date(a.dateKey).getTime() - new Date(b.dateKey).getTime();
  });

  // بناء صفوف الجدول
  const tableRows = sortedDays.map(day => {
    const morningShift = day.shifts['morning'];
    const eveningShift = day.shifts['evening'];

    const morningText = morningShift 
      ? `الصباحية: ${this.formatCurrency(morningShift.total)}`
      : '';
    
    const eveningText = eveningShift 
      ? `المسائية: ${this.formatCurrency(eveningShift.total)}`
      : '';

    const shiftsText = [morningText, eveningText].filter(t => t).join(' + ');

    return `
      <tr>
        <td class="date-cell">${day.dateDisplay}</td>
        <td class="shifts-cell">${shiftsText || '—'}</td>
        <td class="total-cell">${this.formatCurrency(day.dayTotal)}</td>
      </tr>
    `;
  }).join('');

  // بناء HTML التقرير
  const htmlContent = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير جرد البسطة</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html, body {
      width: 100%;
      height: 100%;
    }

    body {
      font-family: Arial, sans-serif;
      padding: 0;
      background: #ffffff;
      color: #333333;
      font-size: 13px; /* تم التكبير من 11px */
      line-height: 1.5;
    }

    .container {
      width: 100%;
      margin: 0;
      background: white;
      padding: 20mm 15mm;
    }

    .header {
      text-align: center;
      margin-bottom: 20mm;
      border-bottom: 3px solid #000000;
      padding-bottom: 12mm;
    }

    .bakery-name {
      font-size: 18px;
      font-weight: bold;
      color: #000000;
      margin-bottom: 6px;
    }

    .report-title {
      font-size: 15px;
      font-weight: bold;
      color: #000000;
      margin-bottom: 5px;
    }

    .date-range {
      font-size: 11px;
      color: #555555;
    }

    .section {
      margin-bottom: 20mm;
      page-break-inside: avoid;
    }

    .section-title {
      font-size: 13px;
      font-weight: bold;
      color: #000000;
      padding: 8px 10px;
      margin-bottom: 10px;
      border-bottom: 2px solid #000000;
      background: #f8f8f8;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10mm;
    }

th {
    background: #e8e8e8;
    color: #000000;
    padding: 8px;
    text-align: center;
    font-weight: bold;
    border: 1px solid #999999;
    font-size: 12px; /* تم التكبير من 10px */
  }
  
  td {
    padding: 7px 8px;
    border: 1px solid #999999;
    text-align: center;
    font-size: 12px; /* تم التكبير من 10px */
    background: #ffffff;
  }

    tr:nth-child(even) td {
      background: #f8f8f8;
    }

    .date-cell {
      text-align: center;
      font-weight: bold;
      width: 20%;
    }

    .shifts-cell {
      text-align: right;
      width: 50%;
    }

    .total-cell {
      text-align: center;
      font-weight: bold;
      width: 30%;
    }

    .total-row {
      background: #d9d9d9 !important;
      font-weight: bold;
      border-top: 2px solid #000000;
    }

    .total-row td {
      background: #d9d9d9 !important;
      border: 1px solid #999999;
    }

    .summary-box {
      margin-bottom: 10px;
      padding: 10px;
      background: #f8f8f8;
      border-left: 3px solid #000000;
      font-size: 11px;
    }

    .summary-label {
      font-weight: bold;
      margin-bottom: 5px;
    }

    .summary-value {
      font-size: 13px;
      font-weight: bold;
      color: #000000;
    }

    @media print {
      body {
        background: white;
        margin: 0;
        padding: 0;
      }

      .container {
        margin: 0;
        padding: 20mm 15mm;
      }

      .section {
        page-break-inside: avoid;
      }

      table {
        page-break-inside: avoid;
      }

      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }

    @page {
      size: A4;
      margin: 12mm;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- الرأس -->
    <div class="header">
      <div class="bakery-name">مخبز الإحسان الدمشقي</div>
      <div class="report-title">تقرير جرد البسطة</div>
      <div class="date-range">من ${this.formatDate(startDate)} إلى ${this.formatDate(endDate)}</div>
    </div>

    <!-- القسم الرئيسي -->
    <div class="section">
      <div class="section-title">تفاصيل مبيعات البسطة حسب الأيام</div>

      <!-- ملخص سريع -->
      <div class="summary-box">
        <div class="summary-label">إجمالي المبيعات</div>
        <div class="summary-value">${this.formatCurrency(grandTotal)}</div>
      </div>

      <!-- الجدول -->
      <table>
        <thead>
          <tr>
            <th>اليوم</th>
            <th>الواردية</th>
            <th>إجمالي المبيعات</th>
          </tr>
        </thead>
        <tbody>
          ${tableRows}
          <tr class="total-row">
            <td colspan="2" style="text-align: center;">المجموع الكلي</td>
            <td style="text-align: center;">${this.formatCurrency(grandTotal)}</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- معلومات إضافية -->
    <div class="section">
      <div class="section-title">الملخص</div>
      <div class="summary-box">
        <div><span class="summary-label">عدد الأيام:</span> ${sortedDays.length} يوم</div>
      </div>
      <div class="summary-box">
        <div><span class="summary-label">عدد الفواتير:</span> ${boothInvoices.length} فاتورة</div>
      </div>
      <div class="summary-box">
        <div><span class="summary-label">إجمالي المبيعات:</span> <strong>${this.formatCurrency(grandTotal)}</strong></div>
      </div>
    </div>
  </div>

  <script>
    window.addEventListener('load', function() {
      setTimeout(() => {
        window.print();
      }, 500);
    });
  </script>
</body>
</html>
  `;

  return htmlContent;
}

/**
 * دالة مساعدة: تنسيق التاريخ لاستخدام كمفتاح (YYYY-MM-DD)
 */
private formatDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
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


/**
 * تقرير أجور الورشات
 * يحتوي على 3 جداول لكل ورشة:
 * 1. جدول الإنتاج اليومي (اليوم، المواد، الإجمالي)
 * 2. جدول الملخص المالي (الدخل، السحوبات، المستحق، المأخوذ)
 * 3. جدول تفاصيل الموظفين (الاسم، المستحق، السحب، المتبقي)
 */
async generateWorkshopSalariesReport(
  workshopId?: number,
  startDate?: Date,
  endDate?: Date
): Promise<string> {
  // بناء شروط البحث
  const where: any = {};

  if (workshopId) {
    where.id = workshopId;
  }

  // جلب الورشات مع بياناتها الكاملة
  const workshops = await this.prisma.workshop.findMany({
    where,
    include: {
      employees: {
        include: {
          withdrawals: {
            where: startDate && endDate
              ? { date: { gte: startDate, lte: endDate } }
              : {},
            orderBy: { date: 'desc' }
          },
          productionRecords: {
            where: startDate && endDate
              ? { date: { gte: startDate, lte: endDate } }
              : {},
            include: { item: true },
            orderBy: { date: 'desc' }
          },
          hourRecords: {
            where: startDate && endDate
              ? { date: { gte: startDate, lte: endDate } }
              : {},
            orderBy: { date: 'desc' }
          },
          salaryPayments: {
            where: startDate && endDate
              ? { date: { gte: startDate, lte: endDate } }
              : {},
            include: { invoice: true },
            orderBy: { date: 'desc' }
          },
          debts: { where: { status: 'active' } }
        }
      },
      productionRecords: {
        where: startDate && endDate
          ? { date: { gte: startDate, lte: endDate } }
          : {},
        orderBy: { date: 'desc' }
      },
      settlements: {
        where: startDate && endDate
          ? { date: { gte: startDate, lte: endDate } }
          : {},
        include: { fund: true, invoice: true },
        orderBy: { date: 'desc' }
      }
    }
  });

  if (workshops.length === 0) {
    throw new BadRequestException('لا توجد ورشات مطابقة للمعايير المحددة');
  }

  // معالجة بيانات كل ورشة
  const workshopsData = workshops.map(workshop => {
    // ===== تحديد نطاق التاريخ =====
    const filterStartDate = startDate || workshop.lastSettlementDate || new Date(0);
    const filterEndDate = endDate || new Date();

    // ===== الجدول الأول: الإنتاج اليومي =====
    const dailyProductionMap = new Map<string, any>();

    // ✅ معالجة سجلات إنتاج الورشة فقط
    workshop.productionRecords
      .filter(record => record.date >= filterStartDate && record.date <= filterEndDate)
      .forEach(record => {
        const dateKey = this.formatDateKey(record.date);
        const dateDisplay = this.formatDateDisplay(record.date);

        if (!dailyProductionMap.has(dateKey)) {
          dailyProductionMap.set(dateKey, {
            dateKey,
            dateDisplay,
            items: [],
            dayTotal: 0,
            totalQuantity: 0
          });
        }

    
        const day = dailyProductionMap.get(dateKey);

        const items = Array.isArray(record.items) ? record.items : [];

        items.forEach((item: any) => {
          const itemCost = (item.quantity || 0) * (item.rate || 0);

          day.items.push({
            itemName: item.itemName || 'مادة غير محددة',
            quantity: item.quantity || 0,
            unitCost: item.rate || 0,
            totalCost: itemCost
          });

          day.dayTotal += itemCost;
          day.totalQuantity += item.quantity || 0;
        });
      });


    const productionTableData = Array.from(dailyProductionMap.values()).sort(
      (a, b) => new Date(a.dateKey).getTime() - new Date(b.dateKey).getTime()
    );

    const totalProductionAmount = productionTableData.reduce((sum, day) => sum + day.dayTotal, 0);
    const totalProductionQuantity = productionTableData.reduce((sum, day) => sum + day.totalQuantity, 0);

    // ===== حساب إجمالي المستحقات =====
    let totalEarnings = 0;
    if (workshop.workType === 'production') {
      totalEarnings = totalProductionAmount; // الإنتاج من سجلات الورشة
    } else {
      totalEarnings = workshop.employees.reduce(
        (sum, employee) =>
          sum +
          employee.hourRecords
            .filter(record => record.date >= filterStartDate && record.date <= filterEndDate)
            .reduce((empSum, record) => empSum + record.totalAmount, 0),
        0
      );
    }

    // ===== إجمالي السحوبات =====
    const totalWithdrawals = workshop.employees.reduce(
      (sum, employee) =>
        sum +
        employee.withdrawals
          .filter(w => w.date >= filterStartDate && w.date <= filterEndDate)
          .reduce((empSum, w) => empSum + w.amount, 0),
      0
    );

    // ===== إجمالي المدفوعات =====
    const totalPaidAmount = workshop.settlements
      .filter(s => s.date >= filterStartDate && s.date <= filterEndDate)
      .reduce((sum, s) => sum + s.paidAmount, 0);

    const amountDue = totalEarnings - totalWithdrawals;

    // ===== الجدول الثاني: الملخص المالي =====
    const financialSummary = {
      totalIncome: totalEarnings,
      totalWithdrawals,
      amountDue,
      lastPaid: totalPaidAmount
    };

    // ===== الجدول الثالث: تفاصيل الموظفين =====
    const employeesDetails = workshop.employees.map(employee => {
      let employeeEarnings = 0;

      if (workshop.workType === 'production') {
        // ✅ توزيع الإنتاج الكلي بالتساوي بين الموظفين
        const totalEmployees = workshop.employees.length || 1;
        employeeEarnings = totalProductionAmount / totalEmployees;
      } else {
        // في حالة الورش غير الإنتاجية (بالساعات)
        employeeEarnings = employee.hourRecords
          .filter(record => record.date >= filterStartDate && record.date <= filterEndDate)
          .reduce((sum, record) => sum + record.totalAmount, 0);
      }

      const employeeWithdrawals = employee.withdrawals
        .filter(w => w.date >= filterStartDate && w.date <= filterEndDate)
        .reduce((sum, w) => sum + w.amount, 0);

      const employeeBalance = employeeEarnings - employeeWithdrawals;
      const activeDebt = employee.debts.find(debt => debt.status === 'active');
      const debtAmount = activeDebt ? activeDebt.remainingAmount : 0;

      return {
        employeeId: employee.id,
        employeeName: employee.name,
        position: workshop.workType === 'production' ? 'إنتاج' : 'ساعات',
        totalDue: employeeEarnings,
        totalWithdrawals: employeeWithdrawals,
        balance: employeeBalance,
        activeDebt: debtAmount,
        notes:
          employeeBalance > 0
            ? `له حق: ${this.formatCurrency(employeeBalance)}`
            : employeeBalance < 0
              ? `عليه دين: ${this.formatCurrency(Math.abs(employeeBalance))}`
              : 'صفر'
      };
    }).filter(emp => emp.totalDue > 0 || emp.totalWithdrawals > 0);

    return {
      workshop,
      productionTableData,
      totalProductionAmount,
      totalProductionQuantity,
      financialSummary,
      employeesDetails
    };
  });


  // ===== بناء HTML التقرير =====
  return this.buildWorkshopSalariesReportHTML(workshopsData, startDate, endDate);
}


/**
 * بناء HTML التقرير
 */
private buildWorkshopSalariesReportHTML(
  workshopsData: any[],
  startDate?: Date,
  endDate?: Date
): string {
  const workshopSections = workshopsData
    .map((data, index) => {
      return `
      <!-- ورشة ${data.workshop.name} -->
      <div class="section">
        <div class="section-title">${data.workshop.name}</div>

        <!-- الجدول الأول: الإنتاج اليومي -->
        <div class="subsection">
          <div class="subsection-title">جدول الإنتاج اليومي</div>
          ${this.buildDailyProductionTable(data)}
        </div>

        <!-- الجدول الثاني: الملخص المالي -->
        <div class="subsection">
          <div class="subsection-title">الملخص المالي</div>
          ${this.buildFinancialSummaryTable(data)}
        </div>

        <!-- الجدول الثالث: تفاصيل الموظفين -->
        <div class="subsection">
          <div class="subsection-title">تفاصيل الموظفين</div>
          ${this.buildEmployeesDetailsTable(data)}
        </div>
      </div>
    `;
    })
    .join('<div class="page-break"></div>');

  const html = `
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>تقرير أجور الورشات</title>
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html, body {
      width: 100%;
      height: 100%;
    }

    body {
      font-family: Arial, sans-serif;
      background: #ffffff;
      color: #333333;
      font-size: 11px;
      line-height: 1.5;
    }

    .container {
      width: 100%;
      margin: 0;
      background: white;
      padding: 20mm 15mm;
    }

    .header {
      text-align: center;
      margin-bottom: 20mm;
      border-bottom: 3px solid #000000;
      padding-bottom: 12mm;
    }

    .bakery-name {
      font-size: 18px;
      font-weight: bold;
      color: #000000;
      margin-bottom: 6px;
    }

    .report-title {
      font-size: 15px;
      font-weight: bold;
      color: #000000;
      margin-bottom: 5px;
    }

    .date-range {
      font-size: 10px;
      color: #555555;
    }

    .section {
      margin-bottom: 20mm;
      page-break-inside: avoid;
    }

    .section-title {
      font-size: 13px;
      font-weight: bold;
      color: #000000;
      padding: 8px 10px;
      margin-bottom: 10px;
      border-bottom: 2px solid #000000;
      background: #f8f8f8;
    }

    .subsection {
      margin-bottom: 15mm;
      page-break-inside: avoid;
    }

    .subsection-title {
      font-size: 12px; /* تم التكبير من 11px */
      font-weight: bold;
      color: #000000;
      margin-bottom: 8px;
      padding-bottom: 5px;
      border-bottom: 1px solid #cccccc;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 10mm;
    }

    th {
      background: #e8e8e8;
      color: #000000;
      padding: 7px;
      text-align: center;
      font-weight: bold;
      border: 1px solid #999999;
      font-size: 10px;
    }

    td {
      padding: 6px 7px;
      border: 1px solid #999999;
      font-size: 10px;
      background: #ffffff;
    }

    tr:nth-child(even) td {
      background: #f8f8f8;
    }

    .text-right {
      text-align: right;
    }

    .text-center {
      text-align: center;
    }

    .font-bold {
      font-weight: bold;
    }

    .total-row {
      background: #d9d9d9 !important;
      font-weight: bold;
      border-top: 2px solid #000000;
    }

    .total-row td {
      background: #d9d9d9 !important;
      border: 1px solid #999999;
      font-weight: bold;
    }

    .page-break {
      page-break-after: always;
      margin-bottom: 20mm;
    }

    .no-data {
      padding: 10px;
      background: #f5f5f5;
      text-align: center;
      color: #666;
      font-size: 10px;
    }

    @media print {
      body {
        background: white;
        margin: 0;
        padding: 0;
      }

      .container {
        margin: 0;
        padding: 20mm 15mm;
      }

      .section {
        page-break-inside: avoid;
      }

      table {
        page-break-inside: avoid;
      }

      * {
        -webkit-print-color-adjust: exact !important;
        print-color-adjust: exact !important;
      }
    }

    @page {
      size: A4;
      margin: 12mm;
    }
  </style>
</head>
<body>
  <div class="container">
    <!-- الرأس -->
    <div class="header">
      <div class="bakery-name">مخبز الإحسان الدمشقي</div>
      <div class="report-title">تقرير أجور الورشات</div>
      <div class="date-range">
        ${
          startDate && endDate
            ? `من ${this.formatDate(startDate)} إلى ${this.formatDate(endDate)}`
            : 'جميع الفترات'
        }
      </div>
    </div>

    <!-- أقسام الورشات -->
    ${workshopSections}
  </div>

  <script>
    window.addEventListener('load', function() {
      setTimeout(() => {
        window.print();
      }, 500);
    });
  </script>
</body>
</html>
  `;

  return html;
}

/**
 * بناء جدول الإنتاج اليومي
 */
private buildDailyProductionTable(data: any): string {
  if (data.productionTableData.length === 0) {
    return '<div class="no-data">لا توجد بيانات إنتاج</div>';
  }

  let tableRows = '';

  data.productionTableData.forEach(day => {
    let itemsHTML = '';

    day.items.forEach((item, index) => {
      itemsHTML += `
        <tr>
          ${index === 0 ? `<td class="text-center" rowspan="${day.items.length + 1}">${day.dateDisplay}</td>` : ''}
          <td class="text-right">
            ${item.itemName}<br>
            <small>(${item.quantity} × ${this.formatCurrency(item.unitCost)} = ${this.formatCurrency(item.totalCost)})</small>
          </td>
          <td class="text-center">${this.formatCurrency(item.totalCost)}</td>
        </tr>
      `;
    });

    // صف الإجمالي اليومي
    itemsHTML += `
      <tr style="background: #eeeeee; font-weight: bold;">
        <td colspan="2" class="text-right">إجمالي ${day.dateDisplay}</td>
        <td class="text-center">${this.formatCurrency(day.dayTotal)}</td>
      </tr>
    `;

    tableRows += itemsHTML;
  });

  // صف الإجمالي الكلي
  tableRows += `
    <tr class="total-row">
      <td colspan="2" class="text-right">الإجمالي الكلي - المواد: ${data.totalProductionQuantity}</td>
      <td class="text-center">${this.formatCurrency(data.totalProductionAmount)}</td>
    </tr>
  `;

  return `
    <table>
      <thead>
        <tr>
          <th class="text-center">اليوم والتاريخ</th>
          <th class="text-right">المادة والكمية</th>
          <th class="text-center">الإجمالي</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  `;
}

/**
 * بناء جدول الملخص المالي
 */
private buildFinancialSummaryTable(data: any): string {
  const summary = data.financialSummary;

  return `
    <table>
      <thead>
        <tr>
          <th>إجمالي الدخل</th>
          <th>إجمالي السحوبات</th>
          <th>المبلغ المستحق</th>
          <th>المبلغ المأخوذ الأخير</th>
        </tr>
      </thead>
      <tbody>
        <tr class="total-row">
          <td class="text-center">${this.formatCurrency(summary.totalIncome)}</td>
          <td class="text-center">${this.formatCurrency(summary.totalWithdrawals)}</td>
          <td class="text-center">${this.formatCurrency(summary.amountDue)}</td>
          <td class="text-center">${this.formatCurrency(summary.lastPaid)}</td>
        </tr>
      </tbody>
    </table>
  `;
}

/**
 * بناء جدول تفاصيل الموظفين
 */
private buildEmployeesDetailsTable(data: any): string {
  if (data.employeesDetails.length === 0) {
    return '<div class="no-data">لا يوجد موظفون</div>';
  }

  let tableRows = '';
  let totalDue = 0;
  let totalWithdrawals = 0;
  let totalBalance = 0;

  data.employeesDetails.forEach(emp => {
    totalDue += emp.totalDue;
    totalWithdrawals += emp.totalWithdrawals;
    totalBalance += emp.balance;

    tableRows += `
      <tr>
        <td class="text-right">${emp.employeeName}</td>
        <td class="text-center">${this.formatCurrency(emp.totalDue)}</td>
        <td class="text-center">${this.formatCurrency(emp.totalWithdrawals)}</td>
        <td class="text-center">${this.formatCurrency(emp.balance)}</td>
        <td class="text-center"><small>${emp.notes}</small></td>
      </tr>
    `;
  });

  // صف الإجمالي
  tableRows += `
    <tr class="total-row">
      <td class="text-right">الإجمالي</td>
      <td class="text-center">${this.formatCurrency(totalDue)}</td>
      <td class="text-center">${this.formatCurrency(totalWithdrawals)}</td>
      <td class="text-center">${this.formatCurrency(totalBalance)}</td>
      <td class="text-center">—</td>
    </tr>
  `;

  return `
    <table>
      <thead>
        <tr>
          <th class="text-right">اسم الموظف</th>
          <th class="text-center">المبلغ المستحق</th>
          <th class="text-center">السحب</th>
          <th class="text-center">المبلغ المتبقي</th>
          <th class="text-center">ملاحظات</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
  `;
}

/**
 * دوال مساعدة
 */
private formatDateDisplay(date: Date): string {
  const days = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const months = [
    'يناير',
    'فبراير',
    'مارس',
    'أبريل',
    'مايو',
    'يونيو',
    'يوليو',
    'أغسطس',
    'سبتمبر',
    'أكتوبر',
    'نوفمبر',
    'ديسمبر'
  ];

  const d = new Date(date);
  const dayName = days[d.getDay()];
  const dayNum = d.getDate();
  const monthName = months[d.getMonth()];
  const year = d.getFullYear();

  return `${dayName} ${dayNum}/${String(d.getMonth() + 1).padStart(2, '0')}/${year}`;
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



/**
   * التقرير الشامل - تقرير واحد يحتوي على جميع المعلومات الهامة
   */
  async generateComprehensiveReportHTML(
    startDate: Date, 
    endDate: Date,
    shiftIds?: number[] // فلتر الوارديات المتعدد - اختياري
  ): Promise<string> {
    const [fundsData, workshopsData, deliveriesData, invoicesData] = await Promise.all([
      this.getFundsData(startDate, endDate, shiftIds),
      this.getWorkshopsData(startDate, endDate),  // لا يتأثر بفلتر الوارديات
      this.getDeliveriesData(startDate, endDate),  // لا يتأثر بفلتر الوارديات
      this.getInvoicesData(startDate, endDate, shiftIds)  // يتأثر بفلتر الوارديات
    ]);

    return this.buildComprehensiveReportHTML(
      fundsData,
      workshopsData,
      deliveriesData,
      invoicesData,
      startDate,
      endDate,
      shiftIds  
    );
  }

private async getFundsData(startDate: Date, endDate: Date, shiftIds?: number[]) {
    // إنشاء شروط البحث
  const whereConditions: any = {};

  // إنشاء مصفوفة الشروط لـ OR
  const orConditions = [];

  // إضافة شرط التاريخ
  orConditions.push({
    openTime: {
      gte: startDate,
      lte: endDate
    }
  });

  // إذا تم تمرير IDs الوارديات، أضف شرط الـ ID
  if (shiftIds && shiftIds.length > 0) {
    orConditions.push({
      id: {
        in: shiftIds 
      }
    });
  }

  // إذا كان هناك أكثر من شرط، استخدم OR
  if (orConditions.length > 1) {
    whereConditions.OR = orConditions;
  } else if (orConditions.length === 1) {
    // إذا كان هناك شرط واحد فقط، استخدمه مباشرة
    Object.assign(whereConditions, orConditions[0]);
  }

  const shifts = await this.prisma.shift.findMany({
    where: whereConditions,
    include: {
      invoices: {
        include: {
          fund: true
        }
      },
      employee: true
    },
    orderBy: {
      openTime: 'asc'
    }
  });

  const fundTypes = ['general', 'booth', 'university'];
  const shiftsData = new Map();

  shifts.forEach(shift => {
    const shiftKey = `${shift.id}-${shift.shiftType}`;
    shiftsData.set(shiftKey, {
      shiftId: shift.id,
      shiftType: shift.shiftType,
      employeeName: shift.employee.username,
      openTime: shift.openTime,
      funds: {}
    });
  });

  fundTypes.forEach(fundType => {
    shifts.forEach(shift => {
      const shiftKey = `${shift.id}-${shift.shiftType}`;
      const shiftData = shiftsData.get(shiftKey);

      const fundInvoices = shift.invoices.filter(inv => inv.fund.fundType === fundType);
      
      const income = fundInvoices
        .filter(inv => inv.invoiceType === 'income')
        .reduce((sum, inv) => sum + (inv.totalAmount - (inv.discount || 0)), 0);

      const expense = fundInvoices
        .filter(inv => inv.invoiceType === 'expense')
        .reduce((sum, inv) => sum + (inv.totalAmount - (inv.discount || 0)), 0);

      shiftData.funds[fundType] = {
        income,
        expense,
        net: income - expense
      };
    });
  });

  return {
    shifts: Array.from(shiftsData.values()),
    fundTypes
  };
}

private async getWorkshopsData(startDate: Date, endDate: Date) {
  // لا يتم تطبيق فلتر الوارديات على الورشات
  const workshops = await this.prisma.workshop.findMany({
    include: {
      productionRecords: {
        where: {
          date: {
            gte: startDate,
            lte: endDate
          }
        }
      }
    }
  });

  const itemsMap = new Map();
  const workshopsMap = new Map();

  // جلب بيانات المواد مع وحداتها لمرة واحدة
  const allItemIds = new Set<number>();
  workshops.forEach(workshop => {
    workshop.productionRecords.forEach(record => {
      const items = Array.isArray(record.items) ? record.items : [];
      items.forEach((item: any) => {
        if (item.itemId) {
          allItemIds.add(item.itemId);
        }
      });
    });
  });

  // جلب بيانات المواد مع الوحدات
  const itemsData = await this.prisma.item.findMany({
    where: {
      id: {
        in: Array.from(allItemIds)
      }
    },
    select: {
      id: true,
      name: true,
      defaultUnit: true,
      units: true
    }
  });

  const itemsDataMap = new Map();
  itemsData.forEach(item => {
    itemsDataMap.set(item.id, item);
  });

  workshops.forEach(workshop => {
    // ✅ تخطي الورشات التي ليس لها سجلات إنتاج في الفترة المحددة
    if (!workshop.productionRecords || workshop.productionRecords.length === 0) {
      return;
    }

    workshopsMap.set(workshop.id, {
      workshopId: workshop.id,
      workshopName: workshop.name,
      workType: workshop.workType,
      items: {},
      totalQuantity: 0 // ✅ إضافة متتبع للإجمالي
    });

    // ✅ معالجة سجلات إنتاج الورشة مباشرة
    workshop.productionRecords.forEach(record => {
      const items = Array.isArray(record.items) ? record.items : [];
      
      items.forEach((item: any) => {
        const itemId = item.itemId;
        const itemName = item.itemName || 'مادة غير محددة';
        let quantity = item.quantity || 0;
        const unit = item.unit;

        const itemData = itemsDataMap.get(itemId);

        // تحويل الكمية إلى قطع إذا كانت الوحدة ليست الوحدة الافتراضية
        if (itemData && unit && unit !== itemData.defaultUnit) {
          const units = itemData.units as any[];
          if (units && Array.isArray(units)) {
            // البحث عن معامل التحويل للوحدة المستخدمة
            const unitData = units.find(u => u.unit === unit);
            if (unitData && unitData.factor) {
              // ضرب الكمية بمعامل التحويل للحصول على القطع
              quantity = quantity * unitData.factor;
            }
          }
        }

        // إضافة المادة إلى itemsMap إذا لم تكن موجودة
        if (!itemsMap.has(itemId)) {
          itemsMap.set(itemId, {
            itemId: itemId,
            itemName: itemName
          });
        }

        // إضافة الكمية إلى الورشة
        const workshopData = workshopsMap.get(workshop.id);
        if (!workshopData.items[itemId]) {
          workshopData.items[itemId] = 0;
        }
        workshopData.items[itemId] += quantity;
        workshopData.totalQuantity += quantity; // ✅ إضافة للإجمالي
      });
    });
  });

  // ✅ تصفية الورشات لإزالة الورشات التي إجماليها 0
  const filteredWorkshops = Array.from(workshopsMap.values()).filter(workshop => {
    return workshop.totalQuantity > 0;
  });

  // ✅ إزالة خاصية totalQuantity قبل الإرجاع (اختياري)
  filteredWorkshops.forEach(workshop => {
    delete workshop.totalQuantity;
  });

  return {
    workshops: filteredWorkshops,
    items: Array.from(itemsMap.values())
  };
}



private async getDeliveriesData(startDate: Date, endDate: Date) {
  const deliveredOrders = await this.prisma.order.findMany({
    where: {
      status: 'delivered',
      createdAt: {
        gte: startDate,
        lte: endDate
      }
    },
    include: {
      items: {
        include: {
          item: {
            include: {
              group: true
            }
          }
        }
      },
      category: true
    }
  });

  console.log(deliveredOrders);
  
  const itemGroupsMap = new Map();
  const orderCategoriesMap = new Map();

  deliveredOrders.forEach(order => {
    if (!orderCategoriesMap.has(order.categoryId)) {
      orderCategoriesMap.set(order.categoryId, {
        categoryId: order.categoryId,
        categoryName: order.category.name,
        itemGroups: {}
      });
    }

    const categoryData = orderCategoriesMap.get(order.categoryId);

    order.items.forEach(orderItem => {
      const groupName = orderItem.item.group.name;
      
      if (!itemGroupsMap.has(groupName)) {
        itemGroupsMap.set(groupName, groupName);
      }

      if (!categoryData.itemGroups[groupName]) {
        categoryData.itemGroups[groupName] = 0;
      }

      // حساب الكمية بالقطع
      let quantityInPieces = orderItem.quantity;
      
      // إذا كانت الوحدة ليست الوحدة الافتراضية، نحتاج للتحويل
      if (orderItem.unit !== orderItem.item.defaultUnit) {
        const units = orderItem.item.units as any[];
        if (units && Array.isArray(units)) {
          // البحث عن معامل التحويل للوحدة المستخدمة
          const unitData = units.find(u => u.unit === orderItem.unit);
          if (unitData && unitData.factor) {
            // ضرب الكمية بمعامل التحويل للحصول على القطع
            quantityInPieces = orderItem.quantity * unitData.factor;
          }
        }
      }

      categoryData.itemGroups[groupName] += quantityInPieces;
    });
  });

  return {
    categories: Array.from(orderCategoriesMap.values()),
    itemGroups: Array.from(itemGroupsMap.values()),
    totalDelivered: deliveredOrders.length
  };
}



/**
 * جلب بيانات الفواتير مُنظمة حسب الوارديات
 */
private async getInvoicesData(startDate: Date, endDate: Date, shiftIds?: number[]) {
  // إنشاء شروط البحث للوارديات
  const shiftWhereConditions: any = {};

  // إنشاء مصفوفة الشروط لـ OR
  const orConditions = [];

  // إضافة شرط التاريخ
  orConditions.push({
    openTime: {
      gte: startDate,
      lte: endDate
    }
  });

  // إذا تم تمرير IDs الوارديات، أضف شرط الـ ID
  if (shiftIds && shiftIds.length > 0) {
    orConditions.push({
      id: {
        in: shiftIds
      }
    });
  }

  // إذا كان هناك أكثر من شرط، استخدم OR
  if (orConditions.length > 1) {
    shiftWhereConditions.OR = orConditions;
  } else if (orConditions.length === 1) {
    // إذا كان هناك شرط واحد فقط، استخدمه مباشرة
    Object.assign(shiftWhereConditions, orConditions[0]);
  }

  // جلب الوارديات مع الفواتير
  const shifts = await this.prisma.shift.findMany({
    where: shiftWhereConditions,
    include: {
      employee: true,
      invoices: {
        where: {
          paidStatus: true,
          fund: {
            fundType: {
              not: 'main' // استبعاد فواتير الخزينة الرئيسية
            }
          }
        },
        include: {
          customer: true,
          fund: true,
          relatedEmployee: true,
          items: {
            include: {
              item: true
            }
          }
        },
        orderBy: {
          createdAt: 'asc'
        }
      }
    },
    orderBy: {
      openTime: 'asc'
    }
  });

  // جلب فواتير الخزينة الرئيسية بشكل منفصل
  const mainFundInvoices = await this.prisma.invoice.findMany({
    where: {
      paidStatus: true,
      createdAt: {
        gte: startDate,
        lte: endDate
      },
      fund: {
        fundType: 'main'
      }
    },
    include: {
      customer: true,
      fund: true,
      relatedEmployee: true,
      items: {
        include: {
          item: true
        }
      }
    },
    orderBy: {
      createdAt: 'asc'
    }
  });

  const shiftsData = [];

  shifts.forEach(shift => {
    const fundTypesMap = new Map();

    shift.invoices.forEach(invoice => {
      const fundType = invoice.fund.fundType;
      
      if (!fundTypesMap.has(fundType)) {
        fundTypesMap.set(fundType, {
          fundType,
          incomeInvoices: [],
          expenseInvoices: []
        });
      }

      // تحديد اسم الزبون/الموظف
      let customerName = 'مباشر';
      if (invoice.invoiceCategory === 'employee' && invoice.relatedEmployee) {
        customerName = invoice.relatedEmployee.name;
      } else if (invoice.customer) {
        customerName = invoice.customer.name;
      }

      const invoiceData = {
        customerName: customerName,
        amount: invoice.totalAmount - (invoice.discount || 0),
        invoiceType: invoice.invoiceType === 'income' ? 'دخل' : 'صرف',
        category: this.getInvoiceCategory(invoice),
        notes: invoice.notes || '—'
      };

      if (invoice.invoiceType === 'income') {
        fundTypesMap.get(fundType).incomeInvoices.push(invoiceData);
      } else {
        fundTypesMap.get(fundType).expenseInvoices.push(invoiceData);
      }
    });

    if (shift.invoices.length > 0) {
      shiftsData.push({
        shiftId: shift.id,
        shiftType: shift.shiftType === 'morning' ? 'صباحية' : 'مسائية',
        employeeName: shift.employee.username,
        openTime: shift.openTime,
        fundTypes: Array.from(fundTypesMap.values())
      });
    }
  });

  // معالجة فواتير الخزينة الرئيسية
  const mainFundData = {
    incomeInvoices: [],
    expenseInvoices: []
  };

  mainFundInvoices.forEach(invoice => {
    // تحديد اسم الزبون/الموظف
    let customerName = 'مباشر';
    if (invoice.invoiceCategory === 'employee' && invoice.relatedEmployee) {
      customerName = invoice.relatedEmployee.name;
    } else if (invoice.customer) {
      customerName = invoice.customer.name;
    }

    const invoiceData = {
      customerName: customerName,
      amount: invoice.totalAmount - (invoice.discount || 0),
      invoiceType: invoice.invoiceType === 'income' ? 'دخل' : 'صرف',
      category: this.getInvoiceCategory(invoice),
      notes: invoice.notes || '—'
    };

    if (invoice.invoiceType === 'income') {
      mainFundData.incomeInvoices.push(invoiceData);
    } else {
      mainFundData.expenseInvoices.push(invoiceData);
    }
  });

  return {
    shifts: shiftsData,
    mainFund: mainFundData
  };
}

/**
 * دالة مساعدة لتحديد نوع الفاتورة بناءً على invoiceCategory
 */
private getInvoiceCategory(invoice: any): string {
  // استخدام invoiceCategory من قاعدة البيانات
  switch (invoice.invoiceCategory) {
    case 'products':
      return 'منتجات';
    
    case 'debt':
      return 'دين زبون';
    
    case 'direct':
      return 'مباشر';
    
    case 'employee':
      // التفريق بين أنواع فواتير الموظفين بناءً على الملاحظات
      if (invoice.notes) {
        const notesLower = invoice.notes.toLowerCase();
        
        // فواتير الدخل من الموظفين
        if (invoice.invoiceType === 'income') {
          if (notesLower.includes('إرجاع') || notesLower.includes('ارجاع')) {
            return 'إرجاع سحب';
          } else if (notesLower.includes('تسديد دين') || notesLower.includes('دفع دين')) {
            return 'تسديد دين موظف';
          }
          return 'دخل من موظف';
        }
        
        // فواتير الصرف للموظفين
        if (invoice.invoiceType === 'expense') {
          if (notesLower.includes('سلفة')) {
            return 'سلفة موظف';
          } else if (notesLower.includes('راتب') || notesLower.includes('أجر')) {
            return 'راتب/أجر';
          } else if (notesLower.includes('دين')) {
            return 'دين موظف';
          } else if (notesLower.includes('سحب')) {
            return 'سحب راتب';
          }
          return 'صرف لموظف';
        }
      }
      return 'موظف';
    
    case 'advance':
      if (invoice.invoiceType === 'income') {
        return 'استلام سلفة';
      } else {
        return 'إرجاع سلفة';
      }
    
    case 'workshop':
      return 'تسوية ورشة';
    
    default:
      // في حالة عدم وجود invoiceCategory، نحاول التخمين
      if (invoice.items && invoice.items.length > 0) {
        return 'منتجات';
      } else if (invoice.relatedEmployee) {
        return 'موظف';
      } else if (invoice.notes) {
        // محاولة التعرف من الملاحظات
        const notesLower = invoice.notes.toLowerCase();
        if (notesLower.includes('دين')) return 'دين';
        if (notesLower.includes('سلفة')) return 'سلفة';
        if (notesLower.includes('ورشة')) return 'ورشة';
      }
      return 'أخرى';
  }
}



  /**
   * بناء HTML التقرير الشامل - تصميم احترافي بسيط
   */
    private buildComprehensiveReportHTML(
    fundsData: any,
    workshopsData: any,
    deliveriesData: any,
    invoicesData: any,
    startDate: Date,
    endDate: Date,
    shiftIds?: number[]
  ): string {
    // إعداد نص معلومات الفلتر
    const filterInfo = shiftIds && shiftIds.length > 0 
      ? `<span class="filter-info">(مُفلتر حسب الوارديات المحددة)</span>` 
      : '';

    return `
  <!DOCTYPE html>
  <html lang="ar" dir="rtl">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>التقرير الشامل</title>
   <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      
      html, body {
        width: 100%;
        height: 100%;
      }
      
      body {
        font-family: Arial, sans-serif;
        padding: 0;
        background: #ffffff;
        color: #333333;
        font-size: 13px; /* تم التكبير من 11px */
        line-height: 1.6;
      }
      
      .container {
        width: 100%;
        margin: 0;
        background: white;
        padding: 20mm 15mm;
      }
      
      .header {
        text-align: center;
        margin-bottom: 20mm;
        border-bottom: 3px solid #000000;
        padding-bottom: 12mm;
      }
      
      .bakery-name {
        font-size: 22px; /* تم التكبير من 18px */
        font-weight: bold;
        color: #000000;
        margin-bottom: 8px;
        letter-spacing: 0.3px;
      }
      
      .report-title {
        font-size: 18px; /* تم التكبير من 15px */
        font-weight: bold;
        color: #000000;
        margin-bottom: 6px;
      }
      
      .date-range {
        font-size: 14px; /* تم التكبير من 11px */
        color: #555555;
        font-weight: normal;
        margin-bottom: 5px;
      }

      .filter-info {
        font-size: 12px; /* تم التكبير من 9px */
        color: #d9534f;
        font-weight: bold;
        display: block;
        margin-top: 3px;
      }
      
      .section {
        margin-bottom: 20mm;
        page-break-inside: avoid;
      }
      
      .section-title {
        font-size: 16px; /* تم التكبير من 13px */
        font-weight: bold;
        color: #000000;
        padding: 10px 12px;
        margin-bottom: 12px;
        border-bottom: 2px solid #000000;
        background: #f8f8f8;
      }
      
      table {
        width: 100%;
        border-collapse: collapse;
        margin-bottom: 10mm;
      }
      
      th {
        background: #e8e8e8;
        color: #000000;
        padding: 9px;
        text-align: center;
        font-weight: bold;
        border: 1px solid #999999;
        font-size: 13px; /* تم التكبير من 10px */
      }
      
      td {
        padding: 8px 9px;
        border: 1px solid #999999;
        text-align: center;
        font-size: 13px; /* تم التكبير من 10px */
        background: #ffffff;
      }
      
      tr:nth-child(even) td {
        background: #f8f8f8;
      }
      
      .total-row {
        background: #d9d9d9 !important;
        font-weight: bold;
        border-top: 2px solid #000000;
      }
      
      .total-row td {
        background: #d9d9d9 !important;
        font-weight: bold;
        border: 1px solid #999999;
        font-size: 14px; /* تم التكبير */
      }
      
      .text-right {
        text-align: right;
      }
      
      .text-left {
        text-align: left;
      }
      
      .font-bold {
        font-weight: bold;
      }
      
      .no-data {
        text-align: center;
        padding: 18px;
        color: #666666;
        background: #f5f5f5;
        border: 1px solid #cccccc;
        font-size: 14px; /* تم التكبير من 12px */
      }
      
      .subsection {
        margin-bottom: 15mm;
        page-break-inside: avoid;
      }
      
      .subsection-title {
        font-size: 14px; /* تم التكبير من 11px */
        font-weight: bold;
        color: #000000;
        margin-bottom: 10px;
        padding-bottom: 6px;
        border-bottom: 1px solid #cccccc;
      }
      
      .summary-box {
        margin-bottom: 12px;
        padding: 10px 12px;
        background: #f8f8f8;
        border-left: 3px solid #000000;
        font-size: 14px; /* تم التكبير من 12px */
      }

      
      .summary-box .label {
        font-weight: bold;
        margin-bottom: 4px;
        font-size: 14px;
      }
      
      .summary-box .value {
        margin-left: 15px;
      }
      
      @media print {
        body {
          background: white;
          margin: 0;
          padding: 0;
        }
        
        .container {
          margin: 0;
          padding: 20mm 15mm;
          box-shadow: none;
        }
        
        .section {
          page-break-inside: avoid;
        }
        
        table {
          page-break-inside: avoid;
        }
        
        * {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
      }
      
      @page {
        size: A4;
        margin: 12mm;
        orphans: 3;
        widows: 3;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="header">
        <div class="bakery-name">مخبز الإحسان الدمشقي</div>
        <div class="report-title">التقرير الشامل</div>
        <div class="date-range">من ${this.formatDate(startDate)} إلى ${this.formatDate(endDate)}</div>
        ${filterInfo}
      </div>

      <!-- قسم ملخص الصناديق -->
      <div class="section">
        <div class="section-title">ملخص الصناديق</div>
        ${this.buildFundsSection(fundsData)}
      </div>

      <!-- قسم ملخص عمل الورشات -->
      <div class="section">
        <div class="section-title">ملخص عمل الورشات</div>
        ${this.buildWorkshopsSection(workshopsData)}
      </div>

      <!-- قسم ملخص التسليم بالطلبيات -->
      <div class="section">
        <div class="section-title">ملخص التسليم بالطلبيات</div>
        ${this.buildDeliveriesSection(deliveriesData)}
      </div>

      <!-- قسم ملخص الفواتير -->
      <div class="section">
        <div class="section-title">ملخص الفواتير</div>
        ${this.buildInvoicesSection(invoicesData)}
      </div>
    </div>

    <script>
      window.addEventListener('load', function() {
        setTimeout(() => {
          window.print();
        }, 500);
      });
    </script>
  </body>
  </html>
    `;
  }

  /**
   * بناء قسم الصناديق
   */
  private buildFundsSection(fundsData: any): string {
    let html = '';
    const fundLabels = {
      'general': 'الصندوق العام',
      'booth': 'البسطة',
      'university': 'الجامعات'
    };

    fundsData.fundTypes.forEach(fundType => {
      html += `
        <div class="subsection">
          <div class="subsection-title">${fundLabels[fundType]}</div>
          <table>
            <thead>
              <tr>
                <th>الواردية</th>
                <th>المسؤول</th>
                <th>الدخل (ل.س)</th>
                <th>الخرج (ل.س)</th>
                <th>الصافي (ل.س)</th>
              </tr>
            </thead>
            <tbody>
      `;

      let totalIncome = 0;
      let totalExpense = 0;

      fundsData.shifts.forEach(shift => {
        const fundData = shift.funds[fundType];
        if (fundData) {
          totalIncome += fundData.income;
          totalExpense += fundData.expense;

          const shiftTypeAr = shift.shiftType === 'morning' ? 'صباحية' : 'مسائية';
          const net = fundData.income - fundData.expense;

          html += `
            <tr>
              <td>${shiftTypeAr}</td>
              <td>${shift.employeeName}</td>
              <td>${this.formatNumber(fundData.income)}</td>
              <td>${this.formatNumber(fundData.expense)}</td>
              <td class="font-bold">${this.formatNumber(net)}</td>
            </tr>
          `;
        }
      });

      const totalNet = totalIncome - totalExpense;

      html += `
              <tr class="total-row">
                <td colspan="2">الإجمالي</td>
                <td>${this.formatNumber(totalIncome)}</td>
                <td>${this.formatNumber(totalExpense)}</td>
                <td>${this.formatNumber(totalNet)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      `;
    });

    return html || '<div class="no-data">لا توجد بيانات متاحة</div>';
  }


  /**
   * بناء قسم الورشات
   */
  private buildWorkshopsSection(workshopsData: any): string {
    if (workshopsData.workshops.length === 0) {
      return '<div class="no-data">لا توجد بيانات للورشات في هذه الفترة</div>';
    }

    let html = `<table><thead><tr><th>الورشة</th>`;

    workshopsData.items.forEach(item => {
      html += `<th>${item.itemName}</th>`;
    });

    html += `<th>الإجمالي</th></tr></thead><tbody>`;

    // مصفوفة لتخزين إجمالي كل منتج
    const itemTotals = new Map();
    workshopsData.items.forEach(item => {
      itemTotals.set(item.itemId, 0);
    });

    let totalEstimated = 0;

    // صفوف الورشات
    workshopsData.workshops.forEach(workshop => {
      html += `<tr><td class="text-right font-bold">${workshop.workshopName}</td>`;

      let workshopTotal = 0;

      workshopsData.items.forEach(item => {
        const quantity = workshop.items[item.itemId] || 0;
        html += `<td>${quantity > 0 ? quantity : '—'}</td>`;
        workshopTotal += quantity;
        
        // إضافة الكمية إلى إجمالي المنتج
        itemTotals.set(item.itemId, itemTotals.get(item.itemId) + quantity);
      });

      totalEstimated += workshopTotal;
      html += `<td class="font-bold">${workshopTotal}</td></tr>`;
    });

    // صف الإجماليات لكل منتج
    html += `<tr class="total-row"><td class="text-right font-bold">إجمالي المنتجات</td>`;
    
    workshopsData.items.forEach(item => {
      const itemTotal = itemTotals.get(item.itemId);
      html += `<td class="font-bold">${itemTotal > 0 ? itemTotal : '—'}</td>`;
    });

    html += `<td class="font-bold">${totalEstimated}</td></tr>`;

    html += `</tbody></table>`;

    return html;
  }

  /**
   * بناء قسم التسليم
   */
 private buildDeliveriesSection(deliveriesData: any): string {
  if (deliveriesData.categories.length === 0) {
    return '<div class="no-data">لا توجد طلبيات مسلمة في هذه الفترة</div>';
  }

  let html = `
    <div class="summary-box">
      <div class="label">إجمالي الطلبيات المسلمة: ${deliveriesData.totalDelivered}</div>
      <div class="label" style="margin-top: 5px; font-size: 11px; color: #666;">
        * جميع الكميات محسوبة بالقطع (تم تحويل الصاجات تلقائياً)
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>تصنيف الطلبية</th>
  `;

  deliveriesData.itemGroups.forEach(group => {
    html += `<th>${group}</th>`;
  });

  html += `<th>المجموع (قطع)</th></tr></thead><tbody>`;

  let grandTotal = 0;
  // إنشاء كائن لتجميع إجمالي كل منتج
  const groupTotals = {};
  deliveriesData.itemGroups.forEach(group => {
    groupTotals[group] = 0;
  });

  deliveriesData.categories.forEach(category => {
    html += `<tr><td class="text-right font-bold">${category.categoryName}</td>`;

    let categoryTotal = 0;

    deliveriesData.itemGroups.forEach(group => {
      const quantity = category.itemGroups[group] || 0;
      // تجميع إجمالي المنتج
      groupTotals[group] += quantity;
      // عرض الكميات بدون كسور عشرية
      html += `<td>${quantity > 0 ? Math.round(quantity) : '—'}</td>`;
      categoryTotal += quantity;
    });

    grandTotal += categoryTotal;
    html += `<td class="font-bold">${Math.round(categoryTotal)}</td></tr>`;
  });

  // إضافة صف إجمالي كل منتج
  html += `
      <tr class="total-row">
        <td class="font-bold">إجمالي كل منتج</td>
  `;
  
  deliveriesData.itemGroups.forEach(group => {
    html += `<td class="font-bold">${Math.round(groupTotals[group])}</td>`;
  });
  
  html += `
        <td class="font-bold">${Math.round(grandTotal)}</td>
      </tr>
      </tbody>
    </table>
  `;

  return html;
}


 /**
 * بناء قسم الفواتير
 */
private buildInvoicesSection(invoicesData: any): string {
  const fundLabels = {
    'general': 'الصندوق العام',
    'booth': 'البسطة',
    'university': 'الجامعات',
    'main': 'الخزينة الرئيسية'
  };

  let html = '';

  // قسم فواتير الوارديات
  if (invoicesData.shifts && invoicesData.shifts.length > 0) {
    html += '<div class="section-title" style="font-size: 16px; font-weight: bold; margin: 20px 0 15px; padding: 10px; background: #1976d2; color: white;">فواتير الوارديات</div>';

    invoicesData.shifts.forEach(shift => {
      html += `
        <div class="subsection" style="page-break-inside: avoid; margin-bottom: 25px;">
          <div class="subsection-title" style="font-size: 14px; background: #e0e0e0; padding: 10px;">
            الواردية ${shift.shiftType} - المسؤول: ${shift.employeeName} - التاريخ: ${this.formatDate(shift.openTime)}
          </div>
      `;

      shift.fundTypes.forEach(fundTypeData => {
        const fundLabel = fundLabels[fundTypeData.fundType] || fundTypeData.fundType;

        // جدول فواتير الدخل
        if (fundTypeData.incomeInvoices.length > 0) {
          html += this.buildInvoiceTable(fundLabel, 'دخل', fundTypeData.incomeInvoices, '#2e7d32', '#e8f5e9');
        }

        // جدول فواتير الخرج
        if (fundTypeData.expenseInvoices.length > 0) {
          html += this.buildInvoiceTable(fundLabel, 'خرج', fundTypeData.expenseInvoices, '#c62828', '#ffebee');
        }
      });

      html += `</div>`;
    });
  }

  // قسم فواتير الخزينة الرئيسية (منفصل تماماً)
  if (invoicesData.mainFund && (invoicesData.mainFund.incomeInvoices.length > 0 || invoicesData.mainFund.expenseInvoices.length > 0)) {
    html += '<div class="section-title" style="font-size: 16px; font-weight: bold; margin: 30px 0 15px; padding: 10px; background: #f57c00; color: white;">فواتير الخزينة الرئيسية</div>';
    
    html += '<div class="subsection" style="page-break-inside: avoid; margin-bottom: 25px;">';

    // جدول فواتير الدخل للخزينة
    if (invoicesData.mainFund.incomeInvoices.length > 0) {
      html += this.buildInvoiceTable('الخزينة الرئيسية', 'دخل', invoicesData.mainFund.incomeInvoices, '#2e7d32', '#e8f5e9');
    }

    // جدول فواتير الخرج للخزينة
    if (invoicesData.mainFund.expenseInvoices.length > 0) {
      html += this.buildInvoiceTable('الخزينة الرئيسية', 'خرج', invoicesData.mainFund.expenseInvoices, '#c62828', '#ffebee');
    }

    html += '</div>';
  }

  // رسالة في حالة عدم وجود بيانات
  if ((!invoicesData.shifts || invoicesData.shifts.length === 0) && 
      (!invoicesData.mainFund || (invoicesData.mainFund.incomeInvoices.length === 0 && invoicesData.mainFund.expenseInvoices.length === 0))) {
    return '<div class="no-data">لا توجد فواتير مسددة في هذه الفترة</div>';
  }

  return html;
}

/**
 * دالة مساعدة لبناء جدول الفواتير
 */
private buildInvoiceTable(fundLabel: string, type: string, invoices: any[], color: string, bgColor: string): string {
  const typeLabel = type === 'دخل' ? 'فواتير الدخل' : 'فواتير الخرج';
  
  let html = `
    <div style="margin: 15px 0;">
      <div style="font-size: 13px; font-weight: bold; margin-bottom: 8px; color: ${color}; background: ${bgColor}; padding: 8px; border-right: 4px solid ${color};">
        ${fundLabel} - ${typeLabel}
      </div>
      <table>
        <thead>
          <tr>
            <th style="width: 30%;">الزبون</th>
            <th style="width: 15%;">المبلغ (ل.س)</th>
            <th style="width: 15%;">نوع الفاتورة</th>
            <th style="width: 40%;">الملاحظات</th>
          </tr>
        </thead>
        <tbody>
  `;

  let total = 0;
  invoices.forEach(invoice => {
    total += invoice.amount;
    
    html += `
      <tr>
        <td style="text-align: center; font-size: 15px; font-weight: 600; vertical-align: middle;">${invoice.customerName}</td>
        <td style="font-size: 13px; font-weight: bold; color: ${color};">${this.formatNumber(invoice.amount)}</td>
        <td style="font-size: 13px;">${invoice.category}</td>
        <td class="text-right" style="font-size: 12px;">${invoice.notes}</td>
      </tr>
    `;
  });

  html += `
        <tr class="total-row">
          <td colspan="1" style="font-size: 13px;">إجمالي ${typeLabel}</td>
          <td colspan="3" style="font-size: 14px; font-weight: bold; color: ${color};">${this.formatNumber(total)}</td>
        </tr>
      </tbody>
    </table>
    </div>
  `;

  return html;
}



  private formatNumber(num: number): string {
    return num.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }


}
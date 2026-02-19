import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

interface CreateAuditLogInput {
  userId: number | null;
  username: string | null;
  action: string;
  entity: string;
  entityId: number | null;
  description: string;
  oldData: any;
  newData: any;
  metadata: any;
  ipAddress: string | null;
  userAgent: string | null;
  method: string;
  route: string;
  statusCode: number;
  duration: number;
}

// ترجمة أنواع الفواتير
const INVOICE_TYPE_MAP: Record<string, string> = {
  income: 'دخل',
  expense: 'مصروف',
};

const INVOICE_CATEGORY_MAP: Record<string, string> = {
  products: 'سحب',
  direct: 'مباشر',
  debt: 'دين',
  advance: 'سلفة',
  employee: 'موظف',
};

const ORDER_STATUS_MAP: Record<string, string> = {
  pending: 'قيد الانتظار',
  processing: 'قيد التنفيذ',
  ready: 'جاهز',
  delivered: 'تم التسليم',
  cancelled: 'ملغي',
};

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * تنسيق بيانات الفاتورة بشكل مقروء
   */
  private formatInvoiceData(data: any): any {
    if (!data || typeof data !== 'object') return data;

    const formatted: any = {};
    formatted['رقم الفاتورة'] = data.invoiceNumber || '-';
    formatted['اسم العميل'] = data.customer?.name || data.customerName || '-';
    formatted['نوع الفاتورة'] = INVOICE_TYPE_MAP[data.invoiceType] || data.invoiceType || '-';
    formatted['تصنيف الفاتورة'] = INVOICE_CATEGORY_MAP[data.invoiceCategory] || data.invoiceCategory || '-';
    formatted['المبلغ الإجمالي'] = data.totalAmount ?? '-';
    formatted['الخصم'] = data.discount ?? 0;
    formatted['مبلغ إضافي'] = data.additionalAmount ?? 0;
    formatted['حالة الدفع'] = data.paidStatus ? 'مدفوعة' : 'غير مدفوعة';
    formatted['عدد الصواني'] = data.trayCount ?? 0;
    formatted['ملاحظات'] = data.notes || '-';
    formatted['تاريخ الإنشاء'] = data.createdAt ? new Date(data.createdAt).toLocaleString('ar-IQ') : '-';
    formatted['تاريخ الدفع'] = data.paymentDate ? new Date(data.paymentDate).toLocaleString('ar-IQ') : '-';

    if (data.items && Array.isArray(data.items) && data.items.length > 0) {
      formatted['العناصر'] = data.items.map((item: any, index: number) => ({
        [`#${index + 1}`]: item.item?.name || item.itemName || `عنصر ${item.itemId}`,
        'الكمية': item.quantity,
        'سعر الوحدة': item.unitPrice,
        'الوحدة': item.unit || 'قطعة',
        'المجموع الفرعي': item.subTotal,
      }));
    }

    if (data.employee?.username || data.employeeName) {
      formatted['الموظف'] = data.employee?.username || data.employeeName || '-';
    }

    const FUND_TYPE_MAP: Record<string, string> = {
      main: 'الصندوق الرئيسي',
      general: 'الصندوق العام',
      booth: 'صندوق البسطة',
      university: 'صندوق الجامعة',
    };
    if (data.fund?.fundType || data.fundName) {
      formatted['الصندوق'] = FUND_TYPE_MAP[data.fund?.fundType] || data.fund?.fundType || data.fundName || '-';
    }

    return formatted;
  }

  /**
   * تنسيق بيانات الطلبية بشكل مقروء
   */
  private formatOrderData(data: any): any {
    if (!data || typeof data !== 'object') return data;

    const formatted: any = {};
    formatted['رقم الطلبية'] = data.orderNumber || '-';
    formatted['اسم العميل'] = data.customer?.name || data.customerName || '-';
    formatted['المبلغ الإجمالي'] = data.totalAmount ?? '-';
    formatted['حالة الدفع'] = data.paidStatus ? 'مدفوعة' : 'غير مدفوعة';
    formatted['حالة الطلبية'] = ORDER_STATUS_MAP[data.status] || data.status || '-';
    formatted['الفئة'] = data.category?.name || data.categoryName || '-';
    formatted['تاريخ التسليم المجدول'] = data.scheduledFor ? new Date(data.scheduledFor).toLocaleString('ar-IQ') : '-';
    formatted['تاريخ التسليم'] = data.deliveryDate ? new Date(data.deliveryDate).toLocaleString('ar-IQ') : '-';
    formatted['ملاحظات'] = data.notes || '-';
    formatted['رقم الدور'] = data.queueNumber ?? '-';
    formatted['تاريخ الإنشاء'] = data.createdAt ? new Date(data.createdAt).toLocaleString('ar-IQ') : '-';

    if (data.items && Array.isArray(data.items) && data.items.length > 0) {
      formatted['العناصر'] = data.items.map((item: any, index: number) => ({
        [`#${index + 1}`]: item.item?.name || item.itemName || `عنصر ${item.itemId}`,
        'الكمية': item.quantity,
        'سعر الوحدة': item.unitPrice,
        'الوحدة': item.unit || 'قطعة',
        'المجموع الفرعي': item.subTotal,
      }));
    }

    if (data.employee?.username || data.employeeName) {
      formatted['الموظف'] = data.employee?.username || data.employeeName || '-';
    }

    return formatted;
  }

  /**
   * تنسيق البيانات حسب نوع الكيان
   */
  formatDataForEntity(entity: string, data: any): any {
    if (!data) return null;
    if (entity === 'Invoice') return this.formatInvoiceData(data);
    if (entity === 'Order') return this.formatOrderData(data);
    return data;
  }

  async createLog(input: CreateAuditLogInput): Promise<void> {
    // تنسيق البيانات للفاتورة والطلبية
    const formattedOldData = this.formatDataForEntity(input.entity, input.oldData);
    const formattedNewData = this.formatDataForEntity(input.entity, input.newData);

    // استخراج اسم العميل ونوع الفاتورة للتخزين في metadata
    let enrichedMetadata = input.metadata || {};
    if (input.entity === 'Invoice' || input.entity === 'Order') {
      const sourceData = input.oldData || input.newData;
      if (sourceData) {
        enrichedMetadata = {
          ...enrichedMetadata,
          customerName: sourceData.customer?.name || sourceData.customerName || null,
          invoiceType: sourceData.invoiceType ? INVOICE_TYPE_MAP[sourceData.invoiceType] || sourceData.invoiceType : null,
          invoiceCategory: sourceData.invoiceCategory ? INVOICE_CATEGORY_MAP[sourceData.invoiceCategory] || sourceData.invoiceCategory : null,
        };
      }
    }

    await this.prisma.auditLog.create({
      data: {
        userId: input.userId,
        username: input.username,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        description: input.description,
        oldData: formattedOldData ?? Prisma.JsonNull,
        newData: formattedNewData ?? Prisma.JsonNull,
        metadata: enrichedMetadata ?? Prisma.JsonNull,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        method: input.method,
        route: input.route,
        statusCode: input.statusCode,
        duration: input.duration,
      },
    });
  }

  async findAll(query: QueryAuditLogDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const {
      userId,
      action,
      entity,
      entityId,
      startDate,
      endDate,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      method,
      customerName,
    } = query;

    const where: Prisma.AuditLogWhereInput = {};

    if (userId) {
      where.userId = Number(userId);
    }

    if (action) {
      where.action = action;
    }

    if (entity) {
      where.entity = entity;
    }

    if (entityId) {
      where.entityId = Number(entityId);
    }

    if (method) {
      where.method = method;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate + 'T23:59:59.999Z');
      }
    }

    // فلتر حسب اسم العميل (زبون / مورد / ورشة) - البحث في metadata.customerName
    if (customerName) {
      where.metadata = {
        path: ['customerName'],
        string_contains: customerName,
      };
    }

    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { route: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    return this.prisma.auditLog.findUnique({ where: { id } });
  }

  async getEntityHistory(entity: string, entityId: number) {
    return this.prisma.auditLog.findMany({
      where: { entity, entityId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getUserActivity(userId: number, limit = 50) {
    return this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getActionSummary(startDate?: string, endDate?: string) {
    const where: Prisma.AuditLogWhereInput = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate + 'T23:59:59.999Z');
    }

    const result = await this.prisma.auditLog.groupBy({
      by: ['action', 'entity'],
      where,
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    return result.map((item) => ({
      action: item.action,
      entity: item.entity,
      count: item._count.id,
    }));
  }
}

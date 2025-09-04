import { 
  Controller, 
  Get, 
  Post,
  Param, 
  Query, 
  Res, 
  Body,
  ParseIntPipe,
  HttpException,
  HttpStatus,
  BadRequestException
} from '@nestjs/common';
import { Response } from 'express';
import { PDFReportsService } from './pdf-reports.service';



@Controller('reports')
export class ReportsController {
  constructor(private readonly pdfReportsService: PDFReportsService) {}

  /**
   * عرض كشف حساب عميل في المتصفح
   */
  @Get('customer/:id/statement')
  async getCustomerStatement(
    @Param('id', ParseIntPipe) customerId: number,
    @Query('download') download: string,
    @Res() res: Response
  ) {
    try {
      const htmlContent = await this.pdfReportsService.generateCustomerStatementHTML(customerId);
      
      if (download === 'true') {
        // تحميل كملف
        const filename = `customer-statement-${customerId}-${new Date().getTime()}.html`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(htmlContent);
      } else {
        // عرض في المتصفح
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(htmlContent);
      }
    } catch (error) {
      throw new HttpException(
        `خطأ في توليد كشف الحساب: ${error.message}`, 
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }



  /**
   * تقرير المبيعات
   */
  @Get('sales')
  async getSalesReport(
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('download') download?: string,
    @Res() res?: Response
  ) {
    try {
      // تحديد التواريخ الافتراضية (الشهر الحالي)
      const now = new Date();
      const defaultStartDate = startDate ? 
        new Date(startDate) : 
        new Date(now.getFullYear(), now.getMonth(), 1);
      
      const defaultEndDate = endDate ? 
        new Date(endDate) : 
        new Date(now.getFullYear(), now.getMonth() + 1, 0);

      const htmlContent = await this.pdfReportsService.generateSalesReportHTML(
        defaultStartDate, 
        defaultEndDate
      );
      
      if (download === 'true' && res) {
        const filename = `sales-report-${defaultStartDate.toISOString().split('T')[0]}-to-${defaultEndDate.toISOString().split('T')[0]}.html`;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        return res.send(htmlContent);
      } else if (res) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        return res.send(htmlContent);
      }
      
      return {
        success: true,
        data: htmlContent,
        period: {
          startDate: defaultStartDate.toISOString().split('T')[0],
          endDate: defaultEndDate.toISOString().split('T')[0]
        }
      };
    } catch (error) {
      throw new HttpException(
        `خطأ في توليد تقرير المبيعات: ${error.message}`, 
        HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }


  /**
 * تقرير جرد الطلبيات
 */
@Get('orders/inventory')
async getOrdersInventoryReport(
  @Query('customerName') customerName?: string,
  @Query('categoryId') categoryId?: string,
  @Query('status') status?: string,
  @Query('paidStatus') paidStatus?: string,
  @Query('itemIds') itemIds?: string,
  @Query('startDate') startDate?: string,
  @Query('endDate') endDate?: string,
  @Query('download') download?: string,
  @Res() res?: Response
) {
  try {
    // تحضير الفلاتر
    const filters: any = {};
    
    if (customerName) {
      filters.customerName = customerName;
    }
    
    if (categoryId && !isNaN(parseInt(categoryId))) {
      filters.categoryId = parseInt(categoryId);
    }
    
    if (status) {
      // تحويل النص إلى مصفوفة من الحالات
      const statusArray = status.split(',').map(s => s.trim());
      filters.status = statusArray;
    }
    
    if (paidStatus) {
      if (paidStatus === 'true') {
        filters.paidStatus = true;
      } else if (paidStatus === 'false') {
        filters.paidStatus = false;
      }
      // إذا كان 'all' أو أي قيمة أخرى، لا نضع فلتر
    }
    
    if (itemIds) {
      const itemIdsArray = itemIds.split(',')
        .map(id => parseInt(id.trim()))
        .filter(id => !isNaN(id));
      if (itemIdsArray.length > 0) {
        filters.itemIds = itemIdsArray;
      }
    }
    
    if (startDate) {
      filters.startDate = new Date(startDate);
    }
    
    if (endDate) {
      filters.endDate = new Date(endDate);
    }
    
    // توليد التقرير
    const htmlContent = await this.pdfReportsService.generateOrdersInventoryReportHTML(filters);
    
    if (download === 'true' && res) {
      const filename = `orders-inventory-report-${Date.now()}.html`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(htmlContent);
    } else if (res) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(htmlContent);
    }
    
    return {
      success: true,
      data: htmlContent,
      message: 'تم توليد تقرير جرد الطلبيات بنجاح'
    };
  } catch (error) {
    throw new HttpException(
      `خطأ في توليد تقرير جرد الطلبيات: ${error.message}`, 
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}

// warehous

/**
 * تقرير جرد المستودع الشهري
 */
@Get('warehouse/inventory/monthly')
async getMonthlyWarehouseInventoryReport(
  @Query('year') year?: string,
  @Query('month') month?: string,
  @Query('itemGroupId') itemGroupId?: string,
  @Query('itemIds') itemIds?: string,
  @Query('download') download?: string,
  @Res() res?: Response
) {
  try {
    // تحديد السنة والشهر الافتراضي (الشهر الحالي)
    const now = new Date();
    const reportYear = year ? parseInt(year) : now.getFullYear();
    const reportMonth = month ? parseInt(month) : now.getMonth() + 1;
    
    // التحقق من صحة المدخلات
    if (reportMonth < 1 || reportMonth > 12) {
      throw new BadRequestException('الشهر يجب أن يكون بين 1 و 12');
    }
    
    if (reportYear < 2000 || reportYear > 2100) {
      throw new BadRequestException('السنة غير صحيحة');
    }
    
    // تحضير الفلاتر
    const filters: any = {
      year: reportYear,
      month: reportMonth
    };
    
    if (itemGroupId && !isNaN(parseInt(itemGroupId))) {
      filters.itemGroupId = parseInt(itemGroupId);
    }
    
    if (itemIds) {
      const itemIdsArray = itemIds.split(',')
        .map(id => parseInt(id.trim()))
        .filter(id => !isNaN(id));
      if (itemIdsArray.length > 0) {
        filters.itemIds = itemIdsArray;
      }
    }
    
    // توليد التقرير
    const htmlContent = await this.pdfReportsService.generateWarehouseInventoryReportHTML(filters);
    
    if (download === 'true' && res) {
      const filename = `warehouse-inventory-${reportYear}-${reportMonth.toString().padStart(2, '0')}-${Date.now()}.html`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(htmlContent);
    } else if (res) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(htmlContent);
    }
    
    return {
      success: true,
      data: htmlContent,
      period: {
        year: reportYear,
        month: reportMonth
      },
      message: 'تم توليد تقرير جرد المستودع الشهري بنجاح'
    };
  } catch (error) {
    throw new HttpException(
      `خطأ في توليد تقرير جرد المستودع: ${error.message}`, 
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}



/**
 * تقرير مقارنة الاستهلاك الشهري (بين شهرين)
 */
@Get('warehouse/inventory/comparison')
async getWarehouseConsumptionComparison(
  @Query('year1') year1?: string,
  @Query('month1') month1?: string,
  @Query('year2') year2?: string,
  @Query('month2') month2?: string,
  @Query('download') download?: string,
  @Res() res?: Response
) {
  try {
    const now = new Date();
    
    // الفترة الأولى (افتراضياً الشهر الحالي)
    const reportYear1 = year1 ? parseInt(year1) : now.getFullYear();
    const reportMonth1 = month1 ? parseInt(month1) : now.getMonth() + 1;
    
    // الفترة الثانية (افتراضياً الشهر السابق)
    const previousMonth = now.getMonth() === 0 ? 12 : now.getMonth();
    const previousYear = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
    const reportYear2 = year2 ? parseInt(year2) : previousYear;
    const reportMonth2 = month2 ? parseInt(month2) : previousMonth;
    
    // توليد التقارير للفترتين
    const period1Data = await this.pdfReportsService.getWarehouseInventoryData({
      year: reportYear1,
      month: reportMonth1
    });
    
    const period2Data = await this.pdfReportsService.getWarehouseInventoryData({
      year: reportYear2,
      month: reportMonth2
    });
    
    // بناء تقرير المقارنة
    const comparisonHTML = await this.pdfReportsService.buildWarehouseComparisonHTML(
      period1Data, 
      period2Data, 
      {
        period1: { year: reportYear1, month: reportMonth1 },
        period2: { year: reportYear2, month: reportMonth2 }
      }
    );
    
    if (download === 'true' && res) {
      const filename = `warehouse-comparison-${reportYear1}-${reportMonth1.toString().padStart(2, '0')}_vs_${reportYear2}-${reportMonth2.toString().padStart(2, '0')}-${Date.now()}.html`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(comparisonHTML);
    } else if (res) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(comparisonHTML);
    }
    
    return {
      success: true,
      data: comparisonHTML,
      periods: {
        period1: { year: reportYear1, month: reportMonth1 },
        period2: { year: reportYear2, month: reportMonth2 }
      },
      message: 'تم توليد تقرير مقارنة الاستهلاك بنجاح'
    };
  } catch (error) {
    throw new HttpException(
      `خطأ في توليد تقرير مقارنة الاستهلاك: ${error.message}`, 
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}



/**
 * تقرير جرد البسطة
 */
@Get('booth/inventory')
async getBoothInventoryReport(
  @Query('startDate') startDate: string,
  @Query('endDate') endDate: string,
  @Query('download') download?: string,
  @Res() res?: Response
) {
  try {
    if (!startDate || !endDate) {
      throw new BadRequestException('يجب تحديد تاريخ البداية والنهاية');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start > end) {
      throw new BadRequestException('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');
    }

    const htmlContent = await this.pdfReportsService.generateBoothInventoryReport(start, end);
    
    if (download === 'true' && res) {
      const filename = `booth-inventory-${startDate}-to-${endDate}.html`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(htmlContent);
    } else if (res) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(htmlContent);
    }
    
    return {
      success: true,
      data: htmlContent,
      message: 'تم توليد تقرير جرد البسطة بنجاح'
    };
  } catch (error) {
    throw new HttpException(
      `خطأ في توليد تقرير جرد البسطة: ${error.message}`, 
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}

/**
 * تقرير جرد استهلاك مادة معينة
 */
@Get('item/:id/consumption')
async getItemConsumptionReport(
  @Param('id', ParseIntPipe) itemId: number,
  @Query('startDate') startDate: string,
  @Query('endDate') endDate: string,
  @Query('download') download?: string,
  @Res() res?: Response
) {
  try {
    if (!startDate || !endDate) {
      throw new BadRequestException('يجب تحديد تاريخ البداية والنهاية');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start > end) {
      throw new BadRequestException('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');
    }

    const htmlContent = await this.pdfReportsService.generateItemConsumptionReport(itemId, start, end);
    
    if (download === 'true' && res) {
      const filename = `item-consumption-${itemId}-${startDate}-to-${endDate}.html`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(htmlContent);
    } else if (res) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(htmlContent);
    }
    
    return {
      success: true,
      data: htmlContent,
      message: 'تم توليد تقرير استهلاك المادة بنجاح'
    };
  } catch (error) {
    throw new HttpException(
      `خطأ في توليد تقرير استهلاك المادة: ${error.message}`, 
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}

/**
 * تقرير جرد شراء مادة معينة
 */
@Get('item/:id/purchases')
async getItemPurchaseReport(
  @Param('id', ParseIntPipe) itemId: number,
  @Query('startDate') startDate: string,
  @Query('endDate') endDate: string,
  @Query('download') download?: string,
  @Res() res?: Response
) {
  try {
    if (!startDate || !endDate) {
      throw new BadRequestException('يجب تحديد تاريخ البداية والنهاية');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start > end) {
      throw new BadRequestException('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');
    }

    const htmlContent = await this.pdfReportsService.generateItemPurchaseReport(itemId, start, end);
    
    if (download === 'true' && res) {
      const filename = `item-purchases-${itemId}-${startDate}-to-${endDate}.html`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(htmlContent);
    } else if (res) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(htmlContent);
    }
    
    return {
      success: true,
      data: htmlContent,
      message: 'تم توليد تقرير مشتريات المادة بنجاح'
    };
  } catch (error) {
    throw new HttpException(
      `خطأ في توليد تقرير مشتريات المادة: ${error.message}`, 
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}


/**
 * تقرير جرد الديون
 */
@Get('debts/inventory')
async getDebtsInventoryReport(
  @Query('categoryId') categoryId?: string,
  @Query('customerIds') customerIds?: string,
  @Query('download') download?: string,
  @Res() res?: Response
) {
  try {
    const filters: any = {};
    
    if (categoryId && !isNaN(parseInt(categoryId))) {
      filters.categoryId = parseInt(categoryId);
    }
    
    if (customerIds) {
      const customerIdsArray = customerIds.split(',')
        .map(id => parseInt(id.trim()))
        .filter(id => !isNaN(id));
      if (customerIdsArray.length > 0) {
        filters.customerIds = customerIdsArray;
      }
    }

    const htmlContent = await this.pdfReportsService.generateDebtsInventoryReport(
      filters.categoryId, 
      filters.customerIds
    );
    
    if (download === 'true' && res) {
      const filename = `debts-inventory-${Date.now()}.html`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(htmlContent);
    } else if (res) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(htmlContent);
    }
    
    return {
      success: true,
      data: htmlContent,
      message: 'تم توليد تقرير جرد الديون بنجاح'
    };
  } catch (error) {
    throw new HttpException(
      `خطأ في توليد تقرير جرد الديون: ${error.message}`, 
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}

/**
 * تقرير تفاصيل دين معين
 */
@Get('debt/:id/details')
async getDebtDetailsReport(
  @Param('id', ParseIntPipe) debtId: number,
  @Query('startDate') startDate: string,
  @Query('endDate') endDate: string,
  @Query('download') download?: string,
  @Res() res?: Response
) {
  try {
    if (!startDate || !endDate) {
      throw new BadRequestException('يجب تحديد تاريخ البداية والنهاية');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start > end) {
      throw new BadRequestException('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');
    }

    const htmlContent = await this.pdfReportsService.generateDebtDetailsReport(debtId, start, end);
    
    if (download === 'true' && res) {
      const filename = `debt-details-${debtId}-${startDate}-to-${endDate}.html`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(htmlContent);
    } else if (res) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(htmlContent);
    }
    
    return {
      success: true,
      data: htmlContent,
      message: 'تم توليد تقرير تفاصيل الدين بنجاح'
    };
  } catch (error) {
    throw new HttpException(
      `خطأ في توليد تقرير تفاصيل الدين: ${error.message}`, 
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}

/**
 * تقرير جرد مبيعات منتج معين
 */
@Get('products/sales')
async getProductSalesReport(
  @Query('itemIds') itemIds: string,
  @Query('startDate') startDate: string,
  @Query('endDate') endDate: string,
  @Query('download') download?: string,
  @Res() res?: Response
) {
  try {
    if (!itemIds) {
      throw new BadRequestException('يجب تحديد معرفات المنتجات');
    }
    
    if (!startDate || !endDate) {
      throw new BadRequestException('يجب تحديد تاريخ البداية والنهاية');
    }

    const itemIdsArray = itemIds.split(',')
      .map(id => parseInt(id.trim()))
      .filter(id => !isNaN(id));
      
    if (itemIdsArray.length === 0) {
      throw new BadRequestException('معرفات المنتجات غير صحيحة');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start > end) {
      throw new BadRequestException('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');
    }

    const htmlContent = await this.pdfReportsService.generateProductSalesReport(itemIdsArray, start, end);
    
    if (download === 'true' && res) {
      const filename = `product-sales-${startDate}-to-${endDate}.html`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(htmlContent);
    } else if (res) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(htmlContent);
    }
    
    return {
      success: true,
      data: htmlContent,
      message: 'تم توليد تقرير مبيعات المنتجات بنجاح'
    };
  } catch (error) {
    throw new HttpException(
      `خطأ في توليد تقرير مبيعات المنتجات: ${error.message}`, 
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}

/**
 * تقرير حركة الصناديق
 */
@Get('funds/movement')
async getFundsMovementReport(
  @Query('startDate') startDate: string,
  @Query('endDate') endDate: string,
  @Query('download') download?: string,
  @Res() res?: Response
) {
  try {
    if (!startDate || !endDate) {
      throw new BadRequestException('يجب تحديد تاريخ البداية والنهاية');
    }

    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start > end) {
      throw new BadRequestException('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');
    }

    const htmlContent = await this.pdfReportsService.generateFundsMovementReport(start, end);
    
    if (download === 'true' && res) {
      const filename = `funds-movement-${startDate}-to-${endDate}.html`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(htmlContent);
    } else if (res) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(htmlContent);
    }
    
    return {
      success: true,
      data: htmlContent,
      message: 'تم توليد تقرير حركة الصناديق بنجاح'
    };
  } catch (error) {
    throw new HttpException(
      `خطأ في توليد تقرير حركة الصناديق: ${error.message}`, 
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}

/**
 * تقرير ملخص الواردية
 */
@Get('shift/summary')
async getShiftSummaryReport(
  @Query('shiftId') shiftId?: string,
  @Query('download') download?: string,
  @Res() res?: Response
) {
  try {
    const shiftIdNumber = shiftId ? parseInt(shiftId) : undefined;
    
    if (shiftId && isNaN(shiftIdNumber!)) {
      throw new BadRequestException('معرف الواردية غير صحيح');
    }

    const htmlContent = await this.pdfReportsService.generateShiftSummaryReport(shiftIdNumber);
    
    if (download === 'true' && res) {
      const filename = `shift-summary-${shiftIdNumber || 'current'}-${Date.now()}.html`;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.send(htmlContent);
    } else if (res) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(htmlContent);
    }
    
    return {
      success: true,
      data: htmlContent,
      message: 'تم توليد تقرير ملخص الواردية بنجاح'
    };
  } catch (error) {
    throw new HttpException(
      `خطأ في توليد تقرير ملخص الواردية: ${error.message}`, 
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}


}
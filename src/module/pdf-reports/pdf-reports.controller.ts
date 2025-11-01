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
        new Date(startDate + 'T00:00:00') : 
        new Date(now.getFullYear(), now.getMonth(), 1);
      
      const defaultEndDate = endDate ? 
        new Date(endDate + 'T23:59:59') : 
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
  @Query('customerIds') customerIds?: string, // تغيير من customerName إلى customerIds
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
    
    // تعديل فلتر الزبائن
    if (customerIds) {
      const customerIdsArray = customerIds.split(',')
        .map(id => parseInt(id.trim()))
        .filter(id => !isNaN(id));
      if (customerIdsArray.length > 0) {
        filters.customerIds = customerIdsArray;
      }
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
      filters.startDate = new Date(startDate + 'T00:00:00'); // يحافظ على نفس اليوم
    }
    
    if (endDate) {
      filters.endDate = new Date(endDate + 'T23:59:59');
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

    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T23:59:59');
    
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

    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T23:59:59');
    
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

    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T23:59:59');
    
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

    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T23:59:59');
    
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

    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T23:59:59');
    
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
  @Query('fundType') fundType?: string, // إضافة معامل فلتر الصندوق
  @Query('download') download?: string,
  @Res() res?: Response
) {
  try {
    if (!startDate || !endDate) {
      throw new BadRequestException('يجب تحديد تاريخ البداية والنهاية');
    }

    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T23:59:59');
    
    if (start > end) {
      throw new BadRequestException('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');
    }

    // التحقق من صحة نوع الصندوق إذا تم تمريره
    if (fundType) {
      const validFundTypes = ['main', 'general', 'booth', 'university'];
      if (!validFundTypes.includes(fundType)) {
        throw new BadRequestException('نوع الصندوق غير صحيح');
      }
    }

    const htmlContent = await this.pdfReportsService.generateFundsMovementReport(start, end, fundType);
    
    if (download === 'true' && res) {
      const fundSuffix = fundType ? `-${fundType}` : '-all';
      const filename = `funds-movement${fundSuffix}-${startDate}-to-${endDate}.html`;
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



/**
 * تقرير أجور الورشات
 */
@Get('workshops/salaries')
async getWorkshopSalariesReport(
  @Query('workshopId') workshopId?: string,
  @Query('startDate') startDate?: string,
  @Query('endDate') endDate?: string,
  @Query('download') download?: string,
  @Res() res?: Response
) {
  try {
    let workshopIdNumber;
    let start;
    let end;
    
    // التحقق من معرف الورشة
    if (workshopId) {
      workshopIdNumber = parseInt(workshopId);
      if (isNaN(workshopIdNumber)) {
        throw new BadRequestException('معرف الورشة غير صحيح');
      }
    }
    
    // التحقق من التواريخ
    if (startDate && endDate) {
      start = new Date(startDate + 'T00:00:00');
      end = new Date(endDate + 'T23:59:59');
      
      if (start > end) {
        throw new BadRequestException('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');
      }
    }

    const htmlContent = await this.pdfReportsService.generateWorkshopSalariesReport(
      workshopIdNumber, 
      start, 
      end
    );
    
    if (download === 'true' && res) {
      const filename = `workshop-salaries-${workshopIdNumber || 'all'}-${Date.now()}.html`;
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
      message: 'تم توليد تقرير أجور الورشات بنجاح'
    };
  } catch (error) {
    throw new HttpException(
      `خطأ في توليد تقرير أجور الورشات: ${error.message}`, 
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}

/**
 * تقرير سحوبات الموظفين
 */
@Get('employees/withdrawals')
async getEmployeeWithdrawalsReport(
  @Query('employeeId') employeeId?: string,
  @Query('startDate') startDate?: string,
  @Query('endDate') endDate?: string,
  @Query('download') download?: string,
  @Res() res?: Response
) {
  try {
    let employeeIdNumber;
    let start;
    let end;
    
    // التحقق من معرف الموظف
    if (employeeId) {
      employeeIdNumber = parseInt(employeeId);
      if (isNaN(employeeIdNumber)) {
        throw new BadRequestException('معرف الموظف غير صحيح');
      }
    }
    
    // التحقق من التواريخ
    if (startDate && endDate) {
      start = new Date(startDate + 'T00:00:00');
      end = new Date(endDate + 'T23:59:59');
      
      if (start > end) {
        throw new BadRequestException('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');
      }
    }

    const htmlContent = await this.pdfReportsService.generateEmployeeWithdrawalsReport(
      employeeIdNumber, 
      start, 
      end
    );
    
    if (download === 'true' && res) {
      const filename = `employee-withdrawals-${employeeIdNumber || 'all'}-${Date.now()}.html`;
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
      message: 'تم توليد تقرير سحوبات الموظفين بنجاح'
    };
  } catch (error) {
    throw new HttpException(
      `خطأ في توليد تقرير سحوبات الموظفين: ${error.message}`, 
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}

  /**
 * طباعة فاتورة وصل
 * GET /reports/invoice-receipt/:invoiceId
 */

@Get('invoice-receipt/:invoiceId')
async generateInvoiceReceipt(
  @Param('invoiceId', ParseIntPipe) invoiceId: number,
  @Res() res: Response
) {
  try {
    // توليد HTML الفاتورة المحسن
    const htmlContent = await this.pdfReportsService.generateInvoiceReceiptHTML(invoiceId);
  
    
    // إعداد headers محسنة للطباعة كـ PDF
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    
    // إضافة headers خاصة لتحسين PDF
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Disposition', 'inline');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    
    return res.status(HttpStatus.OK).send(htmlContent);
    
  } catch (error) {
    console.error('Error generating invoice receipt:', error);
    return this.sendErrorPage(error, invoiceId, res);
  }
}

/**
 * التقرير الشامل - يجمع جميع البيانات الهامة
 * GET /reports/comprehensive
 * 
 * الاستخدام:
 * - بدون فلتر: /reports/comprehensive?startDate=2024-01-01&endDate=2024-01-31
 * - مع فلتر واحد: /reports/comprehensive?startDate=2024-01-01&endDate=2024-01-31&shiftIds=shift-id-1
 * - مع عدة فلاتر: /reports/comprehensive?startDate=2024-01-01&endDate=2024-01-31&shiftIds=shift-id-1&shiftIds=shift-id-2&shiftIds=shift-id-3
 */
@Get('comprehensive')
async getComprehensiveReport(
  @Query('startDate') startDate: string,
  @Query('endDate') endDate: string,
  @Query('shiftIds') shiftIds?: string | string[],
  @Query('download') download?: string,
  @Res() res?: Response
) {
  try {
    if (!startDate || !endDate) {
      throw new BadRequestException('يجب تحديد تاريخ البداية والنهاية');
    }

    const start = new Date(`${startDate}T00:00:00`);
    const end = new Date(`${endDate}T23:59:59`);

    if (start > end) {
      throw new BadRequestException('تاريخ البداية يجب أن يكون قبل تاريخ النهاية');
    }

    // ✅ تحويل IDs إلى أرقام صحيحة
    const shiftsFilter = Array.isArray(shiftIds)
      ? shiftIds.map(id => Number(id))
      : shiftIds
      ? [Number(shiftIds)]
      : undefined;

    // تمرير فلتر الوارديات
    const htmlContent = await this.pdfReportsService.generateComprehensiveReportHTML(
      start,
      end,
      shiftsFilter
    );

    if (res) {
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      if (download === 'true') {
        const filename = `comprehensive-report-${startDate}-to-${endDate}.html`;
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="${filename}"`
        );
      }
      return res.send(htmlContent);
    }

    return {
      success: true,
      data: htmlContent,
      period: {
        startDate,
        endDate,
        shiftFilters: shiftsFilter || 'جميع الوارديات',
      },
      message: 'تم توليد التقرير الشامل بنجاح',
    };
  } catch (error) {
    throw new HttpException(
      `خطأ في توليد التقرير الشامل: ${error.message}`,
      HttpStatus.INTERNAL_SERVER_ERROR
    );
  }
}



/**
 * إرسال صفحة خطأ محسنة
 */
private sendErrorPage(error: any, invoiceId: number, res: Response) {
  const errorHTML = `
    <!DOCTYPE html>
    <html lang="ar" dir="rtl">
    <head>
      <meta charset="utf-8">
      <meta name="viewport" content="width=80mm, initial-scale=1">
      <title>خطأ في طباعة الفاتورة</title>
      <style>
        @page { size: 80mm auto; margin: 2mm; }
        
        html, body { 
          width: 80mm;
          margin: 0;
          padding: 0;
          font-family: Arial, sans-serif; 
          font-size: 11px;
        }
        
        .error-container {
          width: 100%;
          padding: 10px;
          text-align: center; 
          color: #d32f2f;
          border: 2px solid #d32f2f;
          border-radius: 5px;
          background: #ffebee;
          margin: 5px;
        }
        
        h1 { 
          margin-bottom: 10px; 
          font-size: 13px;
        }
        
        p { 
          margin: 5px 0; 
          font-size: 10px;
        }
        
        .retry-btn {
          background: #1976d2;
          color: white;
          padding: 6px 12px;
          border: none;
          border-radius: 3px;
          cursor: pointer;
          margin: 3px;
          font-size: 9px;
        }
        
        .close-btn {
          background: #757575;
        }
        
        @media print {
          html, body { width: 80mm !important; }
          .error-container { margin: 0 !important; }
          .retry-btn { 
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
        }
      </style>
    </head>
    <body>
      <div class="error-container">
        <h1>خطأ في طباعة الفاتورة</h1>
        <p>${error.message || 'حدث خطأ غير متوقع'}</p>
        <p>رقم الفاتورة: ${invoiceId}</p>
        <p>الوقت: ${new Date().toLocaleString('ar-SY')}</p>
        <div>
          <button class="retry-btn" onclick="window.location.reload()">
            إعادة المحاولة
          </button>
          <button class="retry-btn close-btn" onclick="window.close()">
            إغلاق
          </button>
        </div>
      </div>
    </body>
    </html>
  `;
  
  return res.status(HttpStatus.BAD_REQUEST).send(errorHTML);
}


}
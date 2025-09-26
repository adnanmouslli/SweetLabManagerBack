import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerCategoryDto } from './dto/create-customer-category.dto';
import { UpdateCustomerCategoryDto } from './dto/update-customer-category.dto';

import * as XLSX from 'xlsx';

interface ExcelCustomerRow {
  'اسم الزبون': string;
  'التصنيف': string;
  'الرقم'?: string;
}

interface ExcelSupplierRow {
  'اسم المورد': string;
  'التصنيف': string;
  'الرقم'?: string;
  'الرصيد الافتتاحي'?: number;
}

@Injectable()
export class CustomerCategoriesService {
  constructor(private prisma: PrismaService) {}

  async create(createCategoryDto: CreateCustomerCategoryDto) {
    // التحقق من عدم وجود صنف بنفس الاسم
    const existingCategory = await this.prisma.customerCategory.findUnique({
      where: { name: createCategoryDto.name }
    });

    if (existingCategory) {
      throw new BadRequestException('يوجد صنف بهذا الاسم مسبقًا');
    }

    return this.prisma.customerCategory.create({
      data: createCategoryDto
    });
  }

  findAll() {
    return this.prisma.customerCategory.findMany({
      include: {
        customers: {
          select: {
            id: true,
            name: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });
  }

  async findOne(id: number) {
    const category = await this.prisma.customerCategory.findUnique({
      where: { id },
      include: {
        customers: {
          select: {
            id: true,
            name: true,
            phone: true,
            createdAt: true
          }
        }
      }
    });

    if (!category) {
      throw new NotFoundException('صنف المستهلكين غير موجود');
    }

    return category;
  }

  async update(id: number, updateCategoryDto: UpdateCustomerCategoryDto) {
    // التحقق من وجود الصنف
    const category = await this.prisma.customerCategory.findUnique({
      where: { id }
    });

    if (!category) {
      throw new NotFoundException('صنف المستهلكين غير موجود');
    }

    // التحقق من عدم وجود صنف آخر بنفس الاسم الجديد
    if (updateCategoryDto.name && updateCategoryDto.name !== category.name) {
      const existingCategory = await this.prisma.customerCategory.findUnique({
        where: { name: updateCategoryDto.name }
      });

      if (existingCategory) {
        throw new BadRequestException('يوجد صنف بهذا الاسم مسبقًا');
      }
    }

    return this.prisma.customerCategory.update({
      where: { id },
      data: updateCategoryDto
    });
  }

  async remove(id: number) {
    // التحقق من وجود الصنف
    const category = await this.prisma.customerCategory.findUnique({
      where: { id },
      include: {
        customers: true
      }
    });

    if (!category) {
      throw new NotFoundException('صنف المستهلكين غير موجود');
    }

    // التحقق من عدم ارتباط الصنف بأي مستهلكين
    if (category.customers && category.customers.length > 0) {
      throw new BadRequestException('لا يمكن حذف الصنف - يوجد مستهلكين مرتبطين به');
    }

    return this.prisma.customerCategory.delete({
      where: { id }
    });
  }

  // الحصول على قائمة الأصناف للاختيار (بدون التفاصيل)
  async getCategoriesList() {
    return this.prisma.customerCategory.findMany({
      select: {
        id: true,
        name: true,
        _count: {
          select: {
            customers: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });
  }


  async importCustomersFromExcel(fileBuffer: Buffer) {
  try {
    // قراءة ملف Excel
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // تحويل البيانات إلى JSON
    const excelData: ExcelCustomerRow[] = XLSX.utils.sheet_to_json(worksheet);
    
    if (!excelData || excelData.length === 0) {
      throw new BadRequestException('الملف فارغ أو لا يحتوي على بيانات صحيحة');
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
      createdCategories: [] as string[]
    };

    for (let i = 0; i < excelData.length; i++) {
      const row = excelData[i];
      const rowNumber = i + 2; // +2 لأن Excel يبدأ من 1 وهناك صف العناوين

      try {
        // التحقق من الحقول المطلوبة
        if (!row['اسم الزبون'] || !row['التصنيف']) {
          results.errors.push(`الصف ${rowNumber}: اسم الزبون والتصنيف مطلوبان`);
          results.failed++;
          continue;
        }

        // تنظيف البيانات
        const customerName = row['اسم الزبون'].toString().trim();
        const categoryName = row['التصنيف'].toString().trim();
        const phoneNumber = row['الرقم'] ? row['الرقم'].toString().trim() : null;

        // التحقق من صحة رقم الهاتف إذا كان موجوداً
        if (phoneNumber && phoneNumber !== '') {
          // التحقق من وجود رقم الهاتف لدى زبون آخر
          const existingCustomerWithPhone = await this.prisma.customer.findFirst({
            where: {
              phone: phoneNumber
            }
          });

          if (existingCustomerWithPhone) {
            results.errors.push(`الصف ${rowNumber}: رقم الهاتف ${phoneNumber} مستخدم بالفعل`);
            results.failed++;
            continue;
          }
        }

        // التحقق من عدم وجود زبون بنفس الاسم
        const existingCustomer = await this.prisma.customer.findFirst({
          where: {
            name: customerName
          }
        });

        if (existingCustomer) {
          results.errors.push(`الصف ${rowNumber}: الزبون ${customerName} موجود بالفعل`);
          results.failed++;
          continue;
        }

        // البحث عن التصنيف أو إنشاؤه
        let customerCategory = await this.prisma.customerCategory.findFirst({
          where: {
            name: categoryName
          }
        });

        if (!customerCategory) {
          customerCategory = await this.prisma.customerCategory.create({
            data: {
              name: categoryName,
              description: `تم إنشاؤه تلقائياً من استيراد Excel`
            }
          });
          
          if (!results.createdCategories.includes(categoryName)) {
            results.createdCategories.push(categoryName);
          }
        }

        // إنشاء الزبون الجديد
        await this.prisma.customer.create({
          data: {
            name: customerName,
            phone: phoneNumber && phoneNumber !== '' ? phoneNumber : null,
            customerType: 'CUSTOMER', // افتراضياً زبون عادي
            supplierBalance: 0,
            isUniversity: false,
            notes: null,
            categoryId: customerCategory.id
          }
        });

        results.success++;

      } catch (error) {
        results.errors.push(`الصف ${rowNumber}: ${error.message}`);
        results.failed++;
      }
    }

    // تحضير الرسالة النهائية
    let message = `تم استيراد ${results.success} زبون بنجاح، فشل في ${results.failed} زبون`;
    
    if (results.createdCategories.length > 0) {
      message += `\nتم إنشاء ${results.createdCategories.length} تصنيف جديد: ${results.createdCategories.join(', ')}`;
    }

    return {
      message,
      success: results.success,
      failed: results.failed,
      errors: results.errors,
      createdCategories: results.createdCategories
    };

  } catch (error) {
    throw new BadRequestException(`خطأ في قراءة الملف: ${error.message}`);
  }
}


async importSuppliersFromExcel(fileBuffer: Buffer) {
  try {
    // قراءة ملف Excel
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // تحويل البيانات إلى JSON
    const excelData: ExcelSupplierRow[] = XLSX.utils.sheet_to_json(worksheet);
    
    if (!excelData || excelData.length === 0) {
      throw new BadRequestException('الملف فارغ أو لا يحتوي على بيانات صحيحة');
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[],
      createdCategories: [] as string[]
    };

    for (let i = 0; i < excelData.length; i++) {
      const row = excelData[i];
      const rowNumber = i + 2; // +2 لأن Excel يبدأ من 1 وهناك صف العناوين

      try {
        // التحقق من الحقول المطلوبة
        if (!row['اسم المورد'] || !row['التصنيف']) {
          results.errors.push(`الصف ${rowNumber}: اسم المورد والتصنيف مطلوبان`);
          results.failed++;
          continue;
        }

        // تنظيف البيانات
        const supplierName = row['اسم المورد'].toString().trim();
        const categoryName = row['التصنيف'].toString().trim();
        const phoneNumber = row['الرقم'] ? row['الرقم'].toString().trim() : null;
        const openingBalance = row['الرصيد الافتتاحي'] ? Number(row['الرصيد الافتتاحي']) : 0;

        // التحقق من صحة رقم الهاتف إذا كان موجوداً
        if (phoneNumber && phoneNumber !== '') {
          // التحقق من وجود رقم الهاتف لدى مورد أو زبون آخر
          const existingCustomerWithPhone = await this.prisma.customer.findFirst({
            where: {
              phone: phoneNumber
            }
          });

          if (existingCustomerWithPhone) {
            results.errors.push(`الصف ${rowNumber}: رقم الهاتف ${phoneNumber} مستخدم بالفعل`);
            results.failed++;
            continue;
          }
        }

        // التحقق من عدم وجود مورد بنفس الاسم
        const existingSupplier = await this.prisma.customer.findFirst({
          where: {
            name: supplierName,
            customerType: 'SUPPLIER'
          }
        });

        if (existingSupplier) {
          results.errors.push(`الصف ${rowNumber}: المورد ${supplierName} موجود بالفعل`);
          results.failed++;
          continue;
        }

        // البحث عن التصنيف أو إنشاؤه
        let customerCategory = await this.prisma.customerCategory.findFirst({
          where: {
            name: categoryName
          }
        });

        if (!customerCategory) {
          customerCategory = await this.prisma.customerCategory.create({
            data: {
              name: categoryName,
              description: `تصنيف موردين - تم إنشاؤه تلقائياً من استيراد Excel`
            }
          });
          
          if (!results.createdCategories.includes(categoryName)) {
            results.createdCategories.push(categoryName);
          }
        }

        // التحقق من صحة الرصيد الافتتاحي
        if (isNaN(openingBalance)) {
          results.errors.push(`الصف ${rowNumber}: الرصيد الافتتاحي غير صحيح`);
          results.failed++;
          continue;
        }

        // إنشاء المورد الجديد
        await this.prisma.customer.create({
          data: {
            name: supplierName,
            phone: phoneNumber && phoneNumber !== '' ? phoneNumber : null,
            customerType: 'SUPPLIER', // تحديد النوع كمورد
            supplierBalance: openingBalance, // رصيد المورد
            isUniversity: false,
            notes: 'تم استيراده من ملف Excel',
            categoryId: customerCategory.id
          }
        });

        results.success++;

      } catch (error) {
        results.errors.push(`الصف ${rowNumber}: ${error.message}`);
        results.failed++;
      }
    }

    // تحضير الرسالة النهائية
    let message = `تم استيراد ${results.success} مورد بنجاح، فشل في ${results.failed} مورد`;
    
    if (results.createdCategories.length > 0) {
      message += `\nتم إنشاء ${results.createdCategories.length} تصنيف جديد: ${results.createdCategories.join(', ')}`;
    }

    return {
      message,
      success: results.success,
      failed: results.failed,
      errors: results.errors,
      createdCategories: results.createdCategories
    };

  } catch (error) {
    throw new BadRequestException(`خطأ في قراءة الملف: ${error.message}`);
  }
}
}
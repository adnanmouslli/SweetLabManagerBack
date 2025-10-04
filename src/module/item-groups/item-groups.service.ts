
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateItemGroupDto } from './dto/create-item-group.dto';
import { UpdateItemGroupDto } from './dto/update-item-group.dto';
import { ItemType } from '@prisma/client';


import * as XLSX from 'xlsx';

interface ExcelItemRow {
  'اسم المادة': string;
  'النوع': string;
  'التصنيف': string;
  'الوحدة الأولى ( الافتراضية )': string;
  'السعر': number;
  'الوحدة الثانية'?: string;
  'السعر.1'?: number; // قد يضيف Excel .1 للأعمدة المكررة
  'معامل التحويل'?: number;
  'سعر الإنتاج'?: number;
}


@Injectable()
export class ItemGroupsService {
  constructor(private prisma: PrismaService) {}

  create(createItemGroupDto: CreateItemGroupDto) {
    return this.prisma.itemGroup.create({
      data: createItemGroupDto,
    });
  }

  findAll() {
    return this.prisma.itemGroup.findMany({
      include: {
        items: true,
      },
    });
  }

  async findOne(id: number) {
    const itemGroup = await this.prisma.itemGroup.findUnique({
      where: { id },
      include: {
        items: true,
      },
    });

    if (!itemGroup) {
      throw new NotFoundException(`Item group with ID ${id} not found`);
    }

    return itemGroup;
  }

  async update(id: number, updateItemGroupDto: UpdateItemGroupDto) {
    try {
      return await this.prisma.itemGroup.update({
        where: { id },
        data: updateItemGroupDto,
      });
    } catch (error) {
      throw new NotFoundException(`Item group with ID ${id} not found`);
    }
  }

  async remove(id: number) {
    try {
      return await this.prisma.itemGroup.delete({
        where: { id },
      });
    } catch (error) {
      throw new NotFoundException(`Item group with ID ${id} not found`);
    }
  }

  findByType(type: ItemType) {
    return this.prisma.itemGroup.findMany({
      where: { type },
      include: {
        items: true,
      },
    });
  }


async importItemsFromExcel(fileBuffer: Buffer) {
  try {
    // قراءة ملف Excel
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    
    // تحويل البيانات إلى JSON
    const excelData: ExcelItemRow[] = XLSX.utils.sheet_to_json(worksheet);
    
    if (!excelData || excelData.length === 0) {
      throw new BadRequestException('الملف فارغ أو لا يحتوي على بيانات صحيحة');
    }

    const results = {
      success: 0,
      failed: 0,
      errors: [] as string[]
    };

    for (let i = 0; i < excelData.length; i++) {
      const row = excelData[i];
      const rowNumber = i + 2; // +2 لأن Excel يبدأ من 1 وهناك صف العناوين

      try {
        // التحقق من الحقول المطلوبة
        if (!row['اسم المادة'] || !row['النوع'] || !row['التصنيف'] || 
            !row['الوحدة الأولى ( الافتراضية )'] || !row['السعر الأساسي']) {
          results.errors.push(`الصف ${rowNumber}: حقول مطلوبة مفقودة (اسم المادة، النوع، التصنيف، الوحدة الأولى، السعر الأساسي)`);
          results.failed++;
          continue;
        }

        // التحقق من صحة النوع
        const itemType = row['النوع'].toString().trim();
        if (itemType !== 'production' && itemType !== 'raw') {
          results.errors.push(`الصف ${rowNumber}: نوع المادة يجب أن يكون 'production' أو 'raw'`);
          results.failed++;
          continue;
        }

        // البحث عن التصنيف أو إنشاؤه
        let itemGroup = await this.prisma.itemGroup.findFirst({
          where: { 
            name: row['التصنيف'].toString().trim(),
            type: itemType as ItemType
          }
        });

        if (!itemGroup) {
          itemGroup = await this.prisma.itemGroup.create({
            data: {
              name: row['التصنيف'].toString().trim(),
              type: itemType as ItemType,
              description: `تم إنشاؤه تلقائياً من الاستيراد`
            }
          });
        }

        // تحضير الوحدات
        const units = [];
        
        // السعر الأساسي للوحدة الأولى
        const basePrice = this.parseNumber(row['السعر الأساسي'], 0);
        
        // الوحدة الأولى (الافتراضية)
        units.push({
          unit: row['الوحدة الأولى ( الافتراضية )'].toString().trim(),
          price: basePrice,
          conversionFactor: 1
        });

        // الوحدة الثانية إذا كانت موجودة
        if (row['الوحدة الثانية'] && row['الوحدة الثانية'].toString().trim()) {
          const secondPrice = this.parseNumber(row['السعر الثاني'], 0);
          const conversionFactor = this.parseNumber(row['معامل التحويل'], 1);
          
          units.push({
            unit: row['الوحدة الثانية'].toString().trim(),
            price: secondPrice,
            conversionFactor: conversionFactor
          });
        }

        // قراءة الأسعار الإضافية
        const packagingPrice = this.parseNumber(row['سعر التكييس'], 0);
        const deliveryPrice = this.parseNumber(row['سعر التوصيل'], 0);
        const cost = this.parseNumber(row['التكلفة'], 0);
        const productionRate = this.parseNumber(row['سعر الإنتاج'], null);

        // حساب السعر النهائي
        const finalPrice = basePrice + packagingPrice + deliveryPrice;

        // تحديث سعر الوحدة الافتراضية ليساوي السعر النهائي
        units[0].price = finalPrice;

        // التحقق من عدم وجود مادة بنفس الاسم
        const existingItem = await this.prisma.item.findFirst({
          where: { 
            name: row['اسم المادة'].toString().trim(),
            groupId: itemGroup.id
          }
        });

        if (existingItem) {
          results.errors.push(`الصف ${rowNumber}: المادة "${row['اسم المادة']}" موجودة بالفعل في نفس التصنيف`);
          results.failed++;
          continue;
        }

        // إنشاء المادة
        await this.prisma.item.create({
          data: {
            name: row['اسم المادة'].toString().trim(),
            type: itemType as ItemType,
            description: row['الوصف'] ? row['الوصف'].toString().trim() : '',
            units: units,
            defaultUnit: row['الوحدة الأولى ( الافتراضية )'].toString().trim(),
            basePrice: basePrice,
            packagingPrice: packagingPrice,
            deliveryPrice: deliveryPrice,
            price: finalPrice,
            cost: cost,
            productionRate: productionRate,
            groupId: itemGroup.id
          }
        });

        results.success++;

      } catch (error) {
        const errorMessage = error.message || 'خطأ غير معروف';
        results.errors.push(`الصف ${rowNumber}: ${errorMessage}`);
        results.failed++;
        
        // تسجيل الخطأ في console للمراجعة
        console.error(`خطأ في الصف ${rowNumber}:`, error);
      }
    }

    return {
      message: `تم استيراد ${results.success} عنصر بنجاح، فشل في ${results.failed} عنصر`,
      success: results.success,
      failed: results.failed,
      errors: results.errors.length > 0 ? results.errors : undefined
    };

  } catch (error) {
    const errorMessage = error.message || 'خطأ في قراءة الملف';
    throw new BadRequestException(`خطأ في قراءة الملف: ${errorMessage}`);
  }
}

/**
 * دالة مساعدة لتحويل القيم إلى أرقام بشكل آمن
 */
private parseNumber(value: any, defaultValue: number | null): number | null {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }
  
  const parsed = Number(value);
  
  if (isNaN(parsed)) {
    return defaultValue;
  }
  
  return parsed;
}


}
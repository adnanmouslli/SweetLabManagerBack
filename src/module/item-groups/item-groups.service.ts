
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
            !row['الوحدة الأولى ( الافتراضية )'] || !row['السعر']) {
          results.errors.push(`الصف ${rowNumber}: حقول مطلوبة مفقودة`);
          results.failed++;
          continue;
        }

        // البحث عن التصنيف أو إنشاؤه
        let itemGroup = await this.prisma.itemGroup.findFirst({
          where: { 
            name: row['التصنيف'].trim(),
            type: row['النوع'] as any
          }
        });

        if (!itemGroup) {
          itemGroup = await this.prisma.itemGroup.create({
            data: {
              name: row['التصنيف'].trim(),
              type: row['النوع'] as any,
              description: `تم إنشاؤه تلقائياً من الاستيراد`
            }
          });
        }

        // تحضير الوحدات
        const units = [];
        
        // الوحدة الأولى (الافتراضية)
        units.push({
          unit: row['الوحدة الأولى ( الافتراضية )'].trim(),
          price: Number(row['السعر']),
          conversionFactor: 1
        });

        // الوحدة الثانية إذا كانت موجودة
        if (row['الوحدة الثانية'] && row['الوحدة الثانية'].trim()) {
          const secondPrice = row['السعر.1'] || 0; // السعر الثاني
          const conversionFactor = row['معامل التحويل'] || 1;
          
          units.push({
            unit: row['الوحدة الثانية'].trim(),
            price: Number(secondPrice),
            conversionFactor: Number(conversionFactor)
          });
        }

        // إنشاء المادة
        await this.prisma.item.create({
          data: {
            name: row['اسم المادة'].trim(),
            type: row['النوع'] as any,
            description: '',
            units: units,
            defaultUnit: row['الوحدة الأولى ( الافتراضية )'].trim(),
            price: Number(row['السعر']),
            cost: 0,
            productionRate: row['سعر الإنتاج'] ? Number(row['سعر الإنتاج']) : undefined,
            groupId: itemGroup.id
          }
        });

        results.success++;

      } catch (error) {
        results.errors.push(`الصف ${rowNumber}: ${error.message}`);
        results.failed++;
      }
    }

    return {
      message: `تم استيراد ${results.success} عنصر بنجاح، فشل في ${results.failed} عنصر`,
      success: results.success,
      failed: results.failed,
      errors: results.errors
    };

  } catch (error) {
    throw new BadRequestException(`خطأ في قراءة الملف: ${error.message}`);
  }
}
}
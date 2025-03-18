import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateItemDto } from './dto/create-item.dto';

@Injectable()
export class ItemsService {
  constructor(private prisma: PrismaService) {}

  async create(createItemDto: CreateItemDto) {
    // التحقق من وجود وحدات
    if (!createItemDto.units || createItemDto.units.length === 0) {
      throw new BadRequestException('يجب تحديد وحدة قياس واحدة على الأقل');
    }

    // التحقق من أن الوحدة الافتراضية موجودة في قائمة الوحدات
    const defaultUnitExists = createItemDto.units.some(
      (unitObj) => unitObj.unit === createItemDto.defaultUnit
    );

    if (!defaultUnitExists) {
      throw new BadRequestException(
        `الوحدة الافتراضية ${createItemDto.defaultUnit} غير موجودة في قائمة الوحدات المحددة`
      );
    }

    // تحديد سعر البيع بناءً على الوحدة الافتراضية إذا لم يتم تحديده
    if (createItemDto.price === undefined) {
      const defaultUnitData = createItemDto.units.find(
        (unitObj) => unitObj.unit === createItemDto.defaultUnit
      );
      createItemDto.price = defaultUnitData.price;
    }

    // إنشاء العنصر الجديد
    try {
      return await this.prisma.item.create({
        data: {
          name: createItemDto.name,
          type: createItemDto.type,
          description: createItemDto.description,
          units: JSON.parse(JSON.stringify(createItemDto.units)),
          defaultUnit: createItemDto.defaultUnit,
          price: createItemDto.price,
          cost: createItemDto.cost,
          groupId: createItemDto.groupId
        },
        include: {
          group: true
        }
      });
    } catch (error) {
      // يمكن إضافة معالجة أخطاء إضافية هنا
      if (error.code === 'P2002') {
        throw new BadRequestException('هذا المنتج موجود بالفعل');
      }
      throw error;
    }
  }

  findAll() {
    return this.prisma.item.findMany({
      include: {
        group: true
      }
    });
  }

  async findByGroup(groupId: number) {
    const items = await this.prisma.item.findMany({
      where: { groupId },
      include: {
        group: true
      }
    });

    if (!items.length) {
      throw new NotFoundException(`No items found for group ${groupId}`);
    }

    return items;
  }

  // يمكن إضافة وظائف أخرى مثل التحديث والحذف والبحث
}
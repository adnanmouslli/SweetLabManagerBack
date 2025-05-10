import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';

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
          productionRate: createItemDto.productionRate, // إضافة سعر الإنتاج
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

  async update(id: number, updateItemDto: UpdateItemDto) {
    // التحقق من وجود العنصر
    const existingItem = await this.prisma.item.findUnique({
      where: { id }
    });
  
    if (!existingItem) {
      throw new NotFoundException(`العنصر برقم ${id} غير موجود`);
    }
  
    // التحقق من الوحدات إذا تم تحديثها
    if (updateItemDto.units && updateItemDto.units.length > 0) {
      // إذا تم تحديث الوحدة الافتراضية أيضًا
      if (updateItemDto.defaultUnit) {
        const defaultUnitExists = updateItemDto.units.some(
          (unitObj) => unitObj.unit === updateItemDto.defaultUnit
        );
  
        if (!defaultUnitExists) {
          throw new BadRequestException(
            `الوحدة الافتراضية ${updateItemDto.defaultUnit} غير موجودة في قائمة الوحدات المحددة`
          );
        }
      } 
      // إذا لم يتم تحديث الوحدة الافتراضية، نتحقق من أن الوحدة الافتراضية الحالية موجودة في الوحدات الجديدة
      else if (existingItem.defaultUnit) {
        const defaultUnitExists = updateItemDto.units.some(
          (unitObj) => unitObj.unit === existingItem.defaultUnit
        );
  
        if (!defaultUnitExists) {
          throw new BadRequestException(
            `الوحدة الافتراضية الحالية ${existingItem.defaultUnit} غير موجودة في قائمة الوحدات المحددة الجديدة`
          );
        }
      }
    }
  
    // التحقق من وجود المجموعة إذا تم تحديثها
    if (updateItemDto.groupId) {
      const group = await this.prisma.itemGroup.findUnique({
        where: { id: updateItemDto.groupId }
      });
  
      if (!group) {
        throw new NotFoundException(`مجموعة العناصر برقم ${updateItemDto.groupId} غير موجودة`);
      }
    }
  
    // تحديد سعر البيع بناءً على الوحدة الافتراضية المحدثة إذا تم تحديثها
    if (updateItemDto.defaultUnit && updateItemDto.units && !updateItemDto.price) {
      const defaultUnitData = updateItemDto.units.find(
        (unitObj) => unitObj.unit === updateItemDto.defaultUnit
      );
      if (defaultUnitData) {
        updateItemDto.price = defaultUnitData.price;
      }
    }
  
    // تحضير البيانات للتحديث
    const dataToUpdate: any = {};
  
    // نسخ الخصائص البسيطة
    if (updateItemDto.name !== undefined) dataToUpdate.name = updateItemDto.name;
    if (updateItemDto.type !== undefined) dataToUpdate.type = updateItemDto.type;
    if (updateItemDto.barcode !== undefined) dataToUpdate.barcode = updateItemDto.barcode;
    if (updateItemDto.description !== undefined) dataToUpdate.description = updateItemDto.description;
    if (updateItemDto.defaultUnit !== undefined) dataToUpdate.defaultUnit = updateItemDto.defaultUnit;
    if (updateItemDto.price !== undefined) dataToUpdate.price = updateItemDto.price;
    if (updateItemDto.cost !== undefined) dataToUpdate.cost = updateItemDto.cost;
    if (updateItemDto.productionRate !== undefined) dataToUpdate.productionRate = updateItemDto.productionRate;
    if (updateItemDto.groupId !== undefined) dataToUpdate.groupId = updateItemDto.groupId;
    
    // معالجة الوحدات كـ JSON
    if (updateItemDto.units) {
      dataToUpdate.units = updateItemDto.units; // Prisma ستتعامل مع التحويل إلى JSON
    }
    
    // تحديث العنصر
    try {
      return await this.prisma.item.update({
        where: { id },
        data: dataToUpdate,
        include: {
          group: true
        }
      });
    } catch (error) {
      if (error.code === 'P2002') {
        throw new BadRequestException('هذا المنتج موجود بالفعل');
      }
      throw error;
    }
  }
  
  async remove(id: number) {
    // التحقق من وجود العنصر
    const existingItem = await this.prisma.item.findUnique({
      where: { id }
    });
  
    if (!existingItem) {
      throw new NotFoundException(`العنصر برقم ${id} غير موجود`);
    }
  
    // التحقق من استخدام العنصر في الفواتير
    const itemInInvoices = await this.prisma.invoiceItem.findFirst({
      where: {
        itemId: id
      }
    });
  
    if (itemInInvoices) {
      throw new BadRequestException('لا يمكن حذف هذا العنصر لأنه مستخدم في فواتير');
    }
  
    // حذف العنصر
    try {
      return await this.prisma.item.delete({
        where: { id }
      });
    } catch (error) {
      throw new BadRequestException(`حدث خطأ أثناء حذف العنصر: ${error.message}`);
    }
  }
  
  async findOne(id: number) {
    const item = await this.prisma.item.findUnique({
      where: { id },
      include: {
        group: true
      }
    });
  
    if (!item) {
      throw new NotFoundException(`العنصر برقم ${id} غير موجود`);
    }
  
    return item;
  }
}
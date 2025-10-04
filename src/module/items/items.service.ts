import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateItemDto } from './dto/create-item.dto';
import { UpdateItemDto } from './dto/update-item.dto';

@Injectable()
export class ItemsService {
  constructor(private prisma: PrismaService) {}

  /**
   * حساب السعر النهائي للمادة
   */
  private calculateFinalPrice(basePrice: number, packagingPrice: number = 0, deliveryPrice: number = 0): number {
    return basePrice + packagingPrice + deliveryPrice;
  }

  /**
   * تحديث سعر الوحدة الافتراضية في units
   */
  private updateDefaultUnitPrice(units: any[], defaultUnit: string, newPrice: number): any[] {
    return units.map(unitObj => {
      if (unitObj.unit === defaultUnit) {
        return { ...unitObj, price: newPrice };
      }
      return unitObj;
    });
  }

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

    // تحديد السعر الأساسي بناءً على الوحدة الافتراضية إذا لم يتم تحديده
    if (createItemDto.basePrice === undefined) {
      const defaultUnitData = createItemDto.units.find(
        (unitObj) => unitObj.unit === createItemDto.defaultUnit
      );
      createItemDto.basePrice = defaultUnitData.price;
    }

    // تعيين القيم الافتراضية لسعر التكييس والتوصيل
    const packagingPrice = createItemDto.packagingPrice ?? 0;
    const deliveryPrice = createItemDto.deliveryPrice ?? 0;

    // حساب السعر النهائي
    const finalPrice = this.calculateFinalPrice(
      createItemDto.basePrice,
      packagingPrice,
      deliveryPrice
    );

    // تحديث سعر الوحدة الافتراضية في units ليساوي السعر النهائي
    const updatedUnits = this.updateDefaultUnitPrice(
      createItemDto.units,
      createItemDto.defaultUnit,
      finalPrice
    );

    // إنشاء العنصر الجديد
    try {
      return await this.prisma.item.create({
        data: {
          name: createItemDto.name,
          type: createItemDto.type,
          description: createItemDto.description,
          units: JSON.parse(JSON.stringify(updatedUnits)),
          defaultUnit: createItemDto.defaultUnit,
          basePrice: createItemDto.basePrice,
          packagingPrice: packagingPrice,
          deliveryPrice: deliveryPrice,
          price: finalPrice,
          cost: createItemDto.cost,
          productionRate: createItemDto.productionRate,
          groupId: createItemDto.groupId
        },
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
      if (updateItemDto.defaultUnit) {
        const defaultUnitExists = updateItemDto.units.some(
          (unitObj) => unitObj.unit === updateItemDto.defaultUnit
        );
  
        if (!defaultUnitExists) {
          throw new BadRequestException(
            `الوحدة الافتراضية ${updateItemDto.defaultUnit} غير موجودة في قائمة الوحدات المحددة`
          );
        }
      } else if (existingItem.defaultUnit) {
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
  
    // تحديد السعر الأساسي بناءً على الوحدة الافتراضية المحدثة إذا تم تحديثها
    if (updateItemDto.defaultUnit && updateItemDto.units && !updateItemDto.basePrice) {
      const defaultUnitData = updateItemDto.units.find(
        (unitObj) => unitObj.unit === updateItemDto.defaultUnit
      );
      if (defaultUnitData) {
        updateItemDto.basePrice = defaultUnitData.price;
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
    if (updateItemDto.cost !== undefined) dataToUpdate.cost = updateItemDto.cost;
    if (updateItemDto.productionRate !== undefined) dataToUpdate.productionRate = updateItemDto.productionRate;
    if (updateItemDto.groupId !== undefined) dataToUpdate.groupId = updateItemDto.groupId;

    // تحديد القيم الحالية أو المحدثة
    const basePrice = updateItemDto.basePrice !== undefined 
      ? updateItemDto.basePrice 
      : existingItem.basePrice;
    
    const packagingPrice = updateItemDto.packagingPrice !== undefined 
      ? updateItemDto.packagingPrice 
      : existingItem.packagingPrice;
    
    const deliveryPrice = updateItemDto.deliveryPrice !== undefined 
      ? updateItemDto.deliveryPrice 
      : existingItem.deliveryPrice;

    const defaultUnit = updateItemDto.defaultUnit !== undefined
      ? updateItemDto.defaultUnit
      : existingItem.defaultUnit;

    // الحصول على units الحالية أو المحدثة
    let currentUnits = updateItemDto.units 
      ? updateItemDto.units 
      : (existingItem.units as any[]);

    let finalPrice: number;
    let shouldUpdateUnits = false;

    // تحديث القيم في dataToUpdate
    if (updateItemDto.basePrice !== undefined) {
      dataToUpdate.basePrice = updateItemDto.basePrice;
    }
    if (updateItemDto.packagingPrice !== undefined) {
      dataToUpdate.packagingPrice = updateItemDto.packagingPrice;
    }
    if (updateItemDto.deliveryPrice !== undefined) {
      dataToUpdate.deliveryPrice = updateItemDto.deliveryPrice;
    }

    // حساب السعر النهائي إذا تم تحديث أي من المكونات
    if (updateItemDto.basePrice !== undefined || 
        updateItemDto.packagingPrice !== undefined || 
        updateItemDto.deliveryPrice !== undefined) {
      finalPrice = this.calculateFinalPrice(basePrice, packagingPrice, deliveryPrice);
      dataToUpdate.price = finalPrice;
      shouldUpdateUnits = true;
    }

    // إذا تم تحديث السعر النهائي مباشرة
    if (updateItemDto.price !== undefined) {
      finalPrice = updateItemDto.price;
      dataToUpdate.price = updateItemDto.price;
      // إعادة حساب السعر الأساسي
      dataToUpdate.basePrice = updateItemDto.price - packagingPrice - deliveryPrice;
      shouldUpdateUnits = true;
    }

    // تحديث سعر الوحدة الافتراضية في units
    if (shouldUpdateUnits && finalPrice !== undefined) {
      currentUnits = this.updateDefaultUnitPrice(currentUnits, defaultUnit, finalPrice);
      dataToUpdate.units = currentUnits;
    } else if (updateItemDto.units) {
      // إذا تم تحديث units فقط بدون تحديث الأسعار
      dataToUpdate.units = updateItemDto.units;
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
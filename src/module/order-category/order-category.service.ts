import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrderCategoryDto } from './dto/create-order-category.dto';
import { UpdateOrderCategoryDto } from './dto/update-order-category.dto';

@Injectable()
export class OrderCategoriesService {
  constructor(private prisma: PrismaService) {}

  async create(createOrderCategoryDto: CreateOrderCategoryDto) {
    // Verificar si ya existe una categoría con el mismo nombre
    const existingCategory = await this.prisma.orderCategory.findUnique({
      where: { name: createOrderCategoryDto.name }
    });

    if (existingCategory) {
      throw new BadRequestException('يوجد فئة طلبيات بنفس الاسم');
    }

    return this.prisma.orderCategory.create({
      data: createOrderCategoryDto
    });
  }

  async findAll() {
    return this.prisma.orderCategory.findMany({
      include: {
        // Incluir el conteo de órdenes por categoría
        orders: {
          select: {
            id: true
          }
        }
      }
    });
  }

  async findOne(id: number) {
    const category = await this.prisma.orderCategory.findUnique({
      where: { id },
      include: {
        orders: {
          select: {
            id: true,
            orderNumber: true,
            customerId: true,
            customer: {
              select: {
                name: true
              }
            },
            totalAmount: true,
            paidStatus: true,
            status: true,
            scheduledFor: true
          }
        }
      }
    });

    if (!category) {
      throw new NotFoundException(`فئة الطلبيات برقم ${id} غير موجودة`);
    }

    return category;
  }

  async update(id: number, updateOrderCategoryDto: UpdateOrderCategoryDto) {
    // Verificar si la categoría existe
    const existingCategory = await this.prisma.orderCategory.findUnique({
      where: { id }
    });

    if (!existingCategory) {
      throw new NotFoundException(`فئة الطلبيات برقم ${id} غير موجودة`);
    }

    // Verificar si hay otra categoría con el mismo nombre
    if (updateOrderCategoryDto.name) {
      const categoryWithSameName = await this.prisma.orderCategory.findUnique({
        where: { name: updateOrderCategoryDto.name }
      });

      if (categoryWithSameName && categoryWithSameName.id !== id) {
        throw new BadRequestException('يوجد فئة طلبيات أخرى بنفس الاسم');
      }
    }

    return this.prisma.orderCategory.update({
      where: { id },
      data: updateOrderCategoryDto
    });
  }

  async remove(id: number) {
    // Verificar si la categoría existe
    const existingCategory = await this.prisma.orderCategory.findUnique({
      where: { id },
      include: {
        orders: true
      }
    });

    if (!existingCategory) {
      throw new NotFoundException(`فئة الطلبيات برقم ${id} غير موجودة`);
    }

    // Verificar si hay pedidos asociados a esta categoría
    if (existingCategory.orders && existingCategory.orders.length > 0) {
      throw new BadRequestException('لا يمكن حذف فئة مرتبطة بطلبيات');
    }

    // Eliminar la categoría
    return this.prisma.orderCategory.delete({
      where: { id }
    });
  }


  async getCategoriesWithCustomersAndOrders(forToday?: boolean, forTomorrow?: boolean) {
    // إنشاء تاريخ سوريا
    const syriaDate = this.createSyriaDate();
    
    // تحديد نطاق التاريخ للتصفية (إذا تم تحديده)
    let dateFilter: any = {};
    
    if (forToday === true) {
      const startOfToday = this.getStartOfDay(syriaDate);
      const endOfToday = this.getEndOfDay(syriaDate);
      
      dateFilter = {
        scheduledFor: {
          gte: startOfToday,
          lte: endOfToday
        }
      };
    } else if (forTomorrow === true) {
      const tomorrow = new Date(syriaDate);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      const startOfTomorrow = this.getStartOfDay(tomorrow);
      const endOfTomorrow = this.getEndOfDay(tomorrow);
      
      dateFilter = {
        scheduledFor: {
          gte: startOfTomorrow,
          lte: endOfTomorrow
        }
      };
    }
    
    // جلب جميع الأصناف
    const categories = await this.prisma.orderCategory.findMany({
      include: {
        // جلب عدد الطلبيات لكل صنف
        _count: {
          select: {
            orders: true
          }
        }
      },
      orderBy: {
        name: 'asc'
      }
    });
    
    // جلب الزبائن مع الطلبيات لكل صنف
    const result = await Promise.all(categories.map(async (category) => {
      // العثور على الزبائن الذين لديهم طلبيات في هذا الصنف
      const customersWithOrders = await this.prisma.customer.findMany({
        where: {
          orders: {
            some: {
              categoryId: category.id,
              ...dateFilter // تطبيق فلتر التاريخ إذا وجد
            }
          }
        },
        select: {
          id: true,
          name: true,
          phone: true,
          // جلب الطلبيات المرتبطة بهذا الصنف للزبون
          orders: {
            where: {
              categoryId: category.id,
              ...dateFilter // تطبيق فلتر التاريخ إذا وجد
            },
            include: {
              items: {
                include: {
                  item: true
                }
              }
            },
            orderBy: {
              scheduledFor: 'asc'
            }
          }
        },
        orderBy: {
          name: 'asc'
        }
      });
      
      // إرجاع الصنف مع الزبائن وطلبياتهم
      return {
        ...category,
        customersCount: customersWithOrders.length,
        customers: customersWithOrders
      };
    }));
    
    // تصفية الأصناف التي ليس لها زبائن مع طلبيات (إذا تم تطبيق فلتر التاريخ)
    const filteredResult = (forToday === true || forTomorrow === true) 
      ? result.filter(category => category.customersCount > 0) 
      : result;
    
    return filteredResult;
  }
  
  // دالة مساعدة لإنشاء تاريخ بتوقيت سوريا
  private createSyriaDate(date?: Date): Date {
    const syriaDate = date ? new Date(date) : new Date();
    
    // الحصول على فرق الوقت بين التوقيت المحلي و UTC بالدقائق
    const localOffset = syriaDate.getTimezoneOffset();
    
    // توقيت سوريا هو UTC+3 أي -180 دقيقة من UTC
    const syriaOffset = -180;
    
    // حساب الفرق بين التوقيت المحلي وتوقيت سوريا
    const offsetDiff = syriaOffset - localOffset;
    
    // تعديل التاريخ بإضافة الفرق بالدقائق
    syriaDate.setMinutes(syriaDate.getMinutes() + offsetDiff);
    
    return syriaDate;
  }
  
  // دالة مساعدة للحصول على بداية اليوم بتوقيت سوريا
  private getStartOfDay(date: Date): Date {
    const syriaDate = this.createSyriaDate(date);
    return new Date(
      syriaDate.getFullYear(),
      syriaDate.getMonth(),
      syriaDate.getDate(),
      0, 0, 0
    );
  }
  
  // دالة مساعدة للحصول على نهاية اليوم بتوقيت سوريا
  private getEndOfDay(date: Date): Date {
    const syriaDate = this.createSyriaDate(date);
    return new Date(
      syriaDate.getFullYear(),
      syriaDate.getMonth(),
      syriaDate.getDate(),
      23, 59, 59
    );
  }
  
}
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateCustomerCategoryDto } from './dto/create-customer-category.dto';
import { UpdateCustomerCategoryDto } from './dto/update-customer-category.dto';

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
}
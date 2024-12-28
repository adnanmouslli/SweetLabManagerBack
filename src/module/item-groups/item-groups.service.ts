
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateItemGroupDto } from './dto/create-item-group.dto';
import { UpdateItemGroupDto } from './dto/update-item-group.dto';
import { ItemType } from '@prisma/client';


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
}
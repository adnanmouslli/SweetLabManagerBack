import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateItemDto } from './dto/create-item.dto';

@Injectable()
export class ItemsService {
  constructor(private prisma: PrismaService) {}

  create(createItemDto: CreateItemDto) {
    return this.prisma.item.create({
      data: createItemDto,
      include: {
        group: true
      }
    });
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
}
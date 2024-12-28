import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import { ShiftStatus } from '@prisma/client';

@Injectable()
export class ShiftsService {
  constructor(private prisma: PrismaService) {}

  async create(createShiftDto: CreateShiftDto) {
    const openShift = await this.prisma.shift.findFirst({
      where: { status: ShiftStatus.open }
    });

    if (openShift) {
      throw new Error('Cannot create new shift while another is open');
    }

    return this.prisma.shift.create({
      data: {
        ...createShiftDto,
        openTime: new Date(),
        status: ShiftStatus.open
      }
    });
    
  }

  findAll() {
    return this.prisma.shift.findMany({
      include: {
        employee: {
          select: {
            id: true,
            username: true
          }
        }
      }
    });
  }

  async closeShift(id: number) {
    const shift = await this.prisma.shift.findUnique({
      where: { id },
      include: {
        invoices: true
      }
    });

    if (!shift) {
      throw new NotFoundException(`Shift #${id} not found`);
    }

    return this.prisma.shift.update({
      where: { id },
      data: {
        status: ShiftStatus.closed,
        closeTime: new Date()
      }
    });
  }
}
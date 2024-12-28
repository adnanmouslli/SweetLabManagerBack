import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateFundDto } from './dto/create-fund.dto';

@Injectable()
export class FundsService {
  constructor(private prisma: PrismaService) {}

  create(createFundDto: CreateFundDto) {
    return this.prisma.fund.create({
      data: createFundDto
    });
  }

  findAll() {
    return this.prisma.fund.findMany();
  }

  async updateBalance(id: number, amount: number) {
    const fund = await this.prisma.fund.findUnique({ where: { id } });
    
    return this.prisma.fund.update({
      where: { id },
      data: {
        currentBalance: fund.currentBalance + amount
      }
    });
  }
}
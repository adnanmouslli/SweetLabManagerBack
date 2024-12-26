import { Injectable, ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateUserDto } from './dto/create-user.dto';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async create(createUserDto: CreateUserDto) {
    try {
      const hashedPassword = await bcrypt.hash(createUserDto.password, 10);
      
      const user = await this.prisma.user.create({
        data: {
          username: createUserDto.username,
          password: hashedPassword,
        },
        select: {
          id: true,
          username: true,
          createdAt: true,
        },
      });
      
      return user;
    } catch (error) {
      if (error.code === 'P2002') {
        throw new ConflictException('Username already exists');
      }
      throw error;
    }
  }
}
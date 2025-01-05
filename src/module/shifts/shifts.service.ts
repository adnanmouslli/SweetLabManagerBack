import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateShiftDto } from './dto/create-shift.dto';
import { ShiftStatus, User } from '@prisma/client';
import { UpdateShiftDto } from './dto/update-shift.dto';

@Injectable()
export class ShiftsService {
 constructor(private prisma: PrismaService) {}

 async create(createShiftDto: CreateShiftDto , user: User){
  
   try {
     const openShift = await this.prisma.shift.findFirst({
       where: { status: ShiftStatus.open }
     });

     if (openShift) {
       throw new BadRequestException('Cannot create new shift while another is open');
     }

     const employee = await this.prisma.user.findUnique({
       where: { id: user.id }
     });

     if (!employee) {
       throw new NotFoundException(`Employee with ID ${user.id} not found`);
     }

     return await this.prisma.shift.create({
       data: {
        employeeId: user.id,
        shiftType: createShiftDto.shiftType,
        openTime: new Date(),
         status: ShiftStatus.open
       },
       include: {
         employee: {
           select: {
             id: true,
             username: true
           }
         }
       }
     });

   } catch (error) {
     if (error instanceof BadRequestException || error instanceof NotFoundException) {
       throw error;
     }
     throw new InternalServerErrorException('Failed to create shift');
   }
 }

 async findAll() {
   try {
     return await this.prisma.shift.findMany({
       include: {
         employee: {
           select: {
             id: true,
             username: true
           }
         }
       },
       orderBy: {
         openTime: 'desc'
       }
     });
   } catch (error) {
     throw new InternalServerErrorException('Failed to fetch shifts');
   }
 }

 async update(id: number, updateShiftDto: UpdateShiftDto) {
  try {
    const shift = await this.prisma.shift.findUnique({
      where: { id },
      include: {
        invoices: true
      }
    });

    if (!shift) {
      throw new NotFoundException(`Shift #${id} not found`);
    }

    if (shift.status === ShiftStatus.closed) {
      throw new BadRequestException('Cannot update a closed shift');
    }


    return await this.prisma.shift.update({
      where: { id },
      data: {
        shiftType: updateShiftDto.shiftType,
        // Don't allow updating status through this endpoint
      },
      include: {
        employee: {
          select: {
            id: true,
            username: true
          }
        }
      }
    });

  } catch (error) {
    if (error instanceof BadRequestException || error instanceof NotFoundException) {
      throw error;
    }
    throw new InternalServerErrorException('Failed to update shift');
  }
}

async remove(id: number) {
  try {
    const shift = await this.prisma.shift.findUnique({
      where: { id },
      include: {
        invoices: true
      }
    });

    if (!shift) {
      throw new NotFoundException(`Shift #${id} not found`);
    }

    // Check if shift has associated invoices
    if (shift.invoices.length > 0) {
      throw new BadRequestException('Cannot delete shift with associated invoices');
    }

    // Only allow deleting open shifts
    if (shift.status === ShiftStatus.closed) {
      throw new BadRequestException('Cannot delete a closed shift');
    }

    await this.prisma.shift.delete({
      where: { id }
    });
    
    return {
       message: `Shift #${id} has been successfully deleted`
     };

  } catch (error) {
    if (error instanceof BadRequestException || error instanceof NotFoundException) {
      throw error;
    }
    throw new InternalServerErrorException('Failed to delete shift');
  }
}



 async closeShift(id: number) {
   try {
     const shift = await this.prisma.shift.findUnique({
       where: { id },
       include: {
         invoices: true,
         employee: true
       }
     });

     if (!shift) {
       throw new NotFoundException(`Shift #${id} not found`);
     }

     if (shift.status === ShiftStatus.closed) {
       throw new BadRequestException('Shift is already closed');
     }

     return await this.prisma.shift.update({
       where: { id },
       data: {
         status: ShiftStatus.closed,
         closeTime: new Date()
       },
       include: {
         employee: {
           select: {
             id: true,
             username: true
           }
         }
       }
     });

   } catch (error) {
     if (error instanceof BadRequestException || error instanceof NotFoundException) {
       throw error;
     }
     throw new InternalServerErrorException('Failed to close shift');
   }
 }
}
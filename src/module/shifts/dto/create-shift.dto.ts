import { IsEnum, IsNumber } from 'class-validator';
import { ShiftType } from '@prisma/client';

export class CreateShiftDto {
  @IsEnum(ShiftType)
  shiftType: ShiftType;

  @IsNumber()
  employeeId: number;
}
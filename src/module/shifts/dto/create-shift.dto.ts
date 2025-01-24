import { ShiftType } from '@prisma/client';
import { IsEnum, IsNumber, IsOptional, IsPositive } from 'class-validator';

export class CreateShiftDto {
  @IsEnum(ShiftType)
  shiftType: ShiftType;

  // @IsNumber()
  // employeeId: number;

  @IsEnum(['surplus', 'deficit', null])
  @IsOptional()
  differenceStatus?: 'surplus' | 'deficit' | null; 

  @IsNumber()
  @IsPositive() 
  @IsOptional()
  differenceValue?: number;
}
import { IsEnum, IsOptional, IsString, IsNumber } from 'class-validator';
import { WorkType } from '@prisma/client';

export class CreateEmployeeDto {
  @IsString()
  name: string;
  
  @IsString()
  @IsOptional()
  phone?: string;
  
  @IsEnum(WorkType)
  workType: WorkType;
  
  @IsNumber()
  @IsOptional()
  workshopId?: number;
}
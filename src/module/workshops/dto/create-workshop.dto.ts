import { IsEnum, IsOptional, IsString } from 'class-validator';
import { WorkType } from '@prisma/client';

export class CreateWorkshopDto {
  @IsString()
  name: string;
  
  @IsEnum(WorkType)
  workType: WorkType;
  
  @IsString()
  password: string;
  
  @IsString()
  @IsOptional()
  notes?: string;
}
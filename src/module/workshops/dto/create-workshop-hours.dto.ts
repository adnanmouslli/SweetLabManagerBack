import { IsDate, IsNumber, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateWorkshopHoursDto {
  @IsNumber()
  employeeId: number;
  
  @IsNumber()
  hours: number;
  
  @IsNumber()
  hourlyRate: number;
  
  @IsOptional()
  @IsDate()
  @Type(() => Date)
  date?: Date;
  
  @IsString()
  @IsOptional()
  notes?: string;
}
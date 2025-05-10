import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateEmployeeHoursDto {
  @IsNumber()
  employeeId: number;
  
  @IsDateString()
  @IsOptional()
  date?: string;
  
  @IsNumber()
  hours: number;
  
  @IsNumber()
  hourlyRate: number;
  
  @IsString()
  @IsOptional()
  notes?: string;
}
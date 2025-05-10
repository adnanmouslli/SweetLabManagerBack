import { IsDateString, IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateEmployeeProductionDto {
  @IsNumber()
  employeeId: number;
  
  @IsDateString()
  @IsOptional()
  date?: string;
  
  @IsNumber()
  itemId: number;
  
  @IsNumber()
  quantity: number;
  
  @IsNumber()
  productionRate: number;
  
  @IsString()
  @IsOptional()
  notes?: string;
}
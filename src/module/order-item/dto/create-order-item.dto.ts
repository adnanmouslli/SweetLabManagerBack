import { IsString, IsNumber, IsBoolean, IsOptional, IsArray, ValidateNested, IsEnum, IsISO8601, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { OrderStatus } from '@prisma/client';

export class CreateOrderItemDto {
  @IsInt()
  itemId: number;

  @IsNumber()
  quantity: number;

  @IsNumber()
  unitPrice: number;
  
  @IsString()
  unit: string;
  
  @IsString()
  @IsOptional()
  notes?: string;
}
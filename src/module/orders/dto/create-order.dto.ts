import { IsString, IsNumber, IsBoolean, IsOptional, IsArray, ValidateNested, IsEnum, IsISO8601, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { OrderStatus } from '@prisma/client';
import { CreateOrderItemDto } from '@/module/order-item/dto/create-order-item.dto';


export class CreateOrderDto {
  @IsInt()
  customerId: number;
  
  @IsNumber()
  totalAmount: number;
  
  @IsBoolean()
  @IsOptional()
  paidStatus?: boolean;
  
  @IsEnum(OrderStatus)
  @IsOptional()
  status?: OrderStatus;
  
  @IsISO8601()
  @IsOptional()
  scheduledFor?: string; 
  
  @IsString()
  @IsOptional()
  notes?: string;
  
  @IsInt()
  categoryId: number;
  
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items: CreateOrderItemDto[];
  
  @IsBoolean()
  @IsOptional()
  isForToday?: boolean; 
}
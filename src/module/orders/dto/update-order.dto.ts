import { IsString, IsNumber, IsBoolean, IsOptional, IsArray, ValidateNested, IsEnum, IsISO8601, IsInt } from 'class-validator';
import { Type } from 'class-transformer';
import { OrderStatus } from '@prisma/client';
import { CreateOrderItemDto } from '@/module/order-item/dto/create-order-item.dto';

export class UpdateOrderDto {
  @IsInt()
  @IsOptional()
  customerId?: number;
  
  @IsNumber()
  @IsOptional()
  totalAmount?: number;
  
  @IsBoolean()
  @IsOptional()
  paidStatus?: boolean;
  
  @IsEnum(OrderStatus)
  @IsOptional()
  status?: OrderStatus;
  
  @IsISO8601()
  @IsOptional()
  scheduledFor?: string;
  
  @IsISO8601()
  @IsOptional()
  deliveryDate?: string;
  
  @IsString()
  @IsOptional()
  notes?: string;
  
  @IsInt()
  @IsOptional()
  categoryId?: number;
  
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  @IsOptional()
  items?: CreateOrderItemDto[];
}
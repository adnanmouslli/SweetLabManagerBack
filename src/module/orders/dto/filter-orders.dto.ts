import { IsString, IsBoolean, IsOptional, IsEnum, IsISO8601, IsInt } from 'class-validator';
import { Transform } from 'class-transformer';
import { OrderStatus } from '@prisma/client';

export class FilterOrdersDto {
  @IsInt()
  @IsOptional()
  @Transform(({ value }) => value ? parseInt(value) : undefined)
  customerId?: number;
  
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  paidStatus?: boolean;
  
  @IsEnum(OrderStatus)
  @IsOptional()
  status?: OrderStatus;
  
  @IsISO8601()
  @IsOptional()
  startDate?: string;
  
  @IsISO8601()
  @IsOptional()
  endDate?: string;
  
  @IsInt()
  @IsOptional()
  @Transform(({ value }) => value ? parseInt(value) : undefined)
  categoryId?: number;
  
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  forToday?: boolean; // Para filtrar pedidos de hoy
  
  @IsBoolean()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  forTomorrow?: boolean; // Para filtrar pedidos de mañana
}
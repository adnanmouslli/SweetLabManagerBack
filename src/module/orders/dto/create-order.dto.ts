import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsDate, IsNotEmpty, IsNumber, IsOptional, IsString, ValidateNested } from 'class-validator';
import { OrderStatus } from '@prisma/client';

class OrderItemDto {
  @IsNumber()
  itemId: number;

  @IsNumber()
  quantity: number;

  @IsNumber()
  unitPrice: number;

  @IsString()
  unit: string;

  @IsOptional()
  @IsString()
  notes?: string;
}

class InvoiceDataDto {
  @IsOptional()
  @IsNumber()
  discount?: number;

  @IsOptional()
  @IsNumber()
  additionalAmount?: number;

  @IsOptional()
  @IsNumber()
  trayCount?: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @IsBoolean()
  isBreak?: boolean;

  @IsOptional()
  @IsNumber()
  initialPayment?: number;
}

export class CreateOrderDto {
  @IsNumber()
  customerId: number;

  @IsNumber()
  categoryId: number;

  @IsOptional() // Making totalAmount optional when useLastOrder is true
  @IsNumber()
  totalAmount?: number;

  @IsOptional() // Making items optional when useLastOrder is true
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items?: OrderItemDto[];

  @IsOptional()
  @IsBoolean()
  paidStatus?: boolean;

  @IsOptional()
  @IsString()
  status?: OrderStatus;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  scheduledFor?: Date;

  @IsOptional()
  @IsBoolean()
  isForToday?: boolean;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => InvoiceDataDto)
  invoiceData?: InvoiceDataDto;
  
  @IsOptional()
  @IsBoolean()
  useLastOrder?: boolean;
}
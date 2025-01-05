import { IsEnum, IsString, IsNumber, IsOptional, IsBoolean, IsArray } from 'class-validator';
import { InvoiceType, InvoiceCategory } from '@prisma/client';

export class CreateInvoiceItemDto {
  @IsNumber()
  itemId: number;

  @IsNumber()
  quantity: number;

  @IsNumber()
  unitPrice: number;

  @IsNumber()
  @IsOptional()
  trayCount?: number;
}

export class CreateInvoiceDto {
  @IsEnum(InvoiceType)
  invoiceType: InvoiceType;

  @IsEnum(InvoiceCategory)
  invoiceCategory: InvoiceCategory;

  @IsString()
  @IsOptional()
  customerName?: string;

  @IsString()
  @IsOptional()
  customerPhone?: string;

  @IsBoolean()
  paidStatus: boolean;

  @IsNumber()
  totalAmount: number;

  @IsNumber()
  @IsOptional()
  discount?: number;

  @IsString()
  @IsOptional()
  notes?: string;

  @IsNumber()
  fundId: number;

  @IsNumber()
  shiftId: number;

  @IsArray()
  items: CreateInvoiceItemDto[];
}
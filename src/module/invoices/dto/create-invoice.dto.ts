import { IsEnum, IsString, IsNumber, IsOptional, IsBoolean, IsArray } from 'class-validator';
import { InvoiceType, InvoiceCategory } from '@prisma/client';

export class CreateInvoiceItemDto {
  @IsNumber()
  itemId: number;

  @IsNumber()
  quantity: number;

  @IsNumber()
  unitPrice: number;
  
  @IsString()
  unit: string;
}

export class CreateInvoiceDto {
  @IsEnum(InvoiceType)
  invoiceType: InvoiceType;

  @IsEnum(InvoiceCategory)
  invoiceCategory: InvoiceCategory;

  @IsNumber()
  @IsOptional()
  customerId?: number;

  @IsBoolean()
  @IsOptional()
  paidStatus: boolean;

  @IsNumber()
  totalAmount: number;

  @IsNumber()
  @IsOptional()
  discount?: number;


  @IsNumber()
  @IsOptional()
  additionalAmount?: number;

  @IsString()
  @IsOptional()
  additionalAmountNotes?: string; 

  @IsString()
  @IsOptional()
  notes?: string;

  @IsNumber()
  fundId: number;

  @IsArray()
  @IsOptional()
  items: CreateInvoiceItemDto[];

  @IsNumber()
  @IsOptional()
  trayCount?: number;

  @IsBoolean()
  @IsOptional()
  isBreak?: boolean;

  @IsNumber()
  @IsOptional()
  initialPayment?: number;

  @IsNumber()
  @IsOptional()
  relatedEmployeeId?: number;
  
  @IsString()
  @IsOptional()
  employeeInvoiceType?: 'withdrawal' | 'return' | 'debtPayment' | "salary";
  
  @IsNumber()
  @IsOptional()
  supplierPaymentAmount?: number; // المبلغ المدفوع للمورد (للموردين فقط)

}
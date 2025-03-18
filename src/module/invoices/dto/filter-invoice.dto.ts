import { InvoiceCategory, InvoiceType } from "@prisma/client";
import { Transform } from "class-transformer";
import { IsBoolean, IsDateString, IsEnum, IsNumber, IsOptional } from "class-validator";

export class FilterInvoiceDto {
    @IsEnum(InvoiceType)
    @IsOptional()
    type?: InvoiceType;
  
    @IsEnum(InvoiceCategory)
    @IsOptional()
    category?: InvoiceCategory;
  
    @IsDateString()
    @IsOptional()
    startDate?: string;
  
    @IsDateString()
    @IsOptional()
    endDate?: string;
  
    @IsOptional()
    paidStatus?: string;
    
    @IsNumber()
    @IsOptional()
    @Transform(({ value }) => value ? parseInt(value) : undefined)
    fundId?: number;
  
    
    @IsOptional()
    status?: 'paid' | 'unpaid' | 'debt' | 'breakage';

  }
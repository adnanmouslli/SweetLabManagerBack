import { InvoiceCategory, InvoiceType } from "@prisma/client";
import { IsBoolean, IsDateString, IsEnum, IsOptional } from "class-validator";

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
  
    @IsBoolean()
    @IsOptional()
    paidStatus?: boolean;
  }
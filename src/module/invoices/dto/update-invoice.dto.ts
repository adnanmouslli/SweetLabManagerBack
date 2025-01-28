import { Type } from "class-transformer";
import { IsArray, IsInt, IsNumber, IsOptional, Min, ValidateNested } from "class-validator";

export class UpdateInvoiceDto {
    @IsOptional()
    @IsInt()
    @Min(1)
    customerId?: number; // ID العميل
  
    @IsOptional()
    @IsNumber()
    @Min(0)
    discount?: number; // الخصم
  
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => InvoiceItemDto)
    items?: InvoiceItemDto[]; // العناصر المرتبطة بالفاتورة
  
    @IsOptional()
    @IsInt()
    @Min(0)
    trayCount?: number; // عدد الصواني
  }
  
  export class InvoiceItemDto {
    @IsInt()
    @Min(1)
    itemId: number; // ID العنصر
  
    @IsNumber()
    @Min(0.01)
    unitPrice: number; // سعر الوحدة
  
    @IsInt()
    @Min(1)
    quantity: number; // الكمية
  
    @IsNumber()
    @Min(0)
    subTotal: number; // الإجمالي الفرعي
  }
  
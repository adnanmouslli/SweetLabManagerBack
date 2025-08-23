import { IsNotEmpty, IsOptional, IsString, IsInt, Min, IsEnum } from 'class-validator';
import { Type } from 'class-transformer';

export enum CustomerType {
  CUSTOMER = 'CUSTOMER',
  SUPPLIER = 'SUPPLIER'
}

export class CreateCustomerDto {
  @IsNotEmpty({ message: 'اسم العميل مطلوب' })
  @IsString({ message: 'اسم العميل يجب أن يكون نصًا' })
  name: string;

  @IsOptional()
  @IsString({ message: 'رقم الهاتف يجب أن يكون نصًا' })
  phone?: string;  
  
  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصًا' })
  notes?: string;

  @IsOptional()
  @IsEnum(CustomerType, { message: 'نوع العميل يجب أن يكون CUSTOMER أو SUPPLIER' })
  customerType?: CustomerType;

  @IsOptional()
  @Type(() => String)
  categoryId?: string;
}
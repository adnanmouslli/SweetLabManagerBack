import { IsNotEmpty, IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class CreateCustomerDto {
  @IsNotEmpty({ message: 'اسم العميل مطلوب' })
  @IsString({ message: 'اسم العميل يجب أن يكون نصًا' })
  name: string;

  @IsNotEmpty({ message: 'رقم الهاتف مطلوب' })
  @IsString({ message: 'رقم الهاتف يجب أن يكون نصًا' })
  phone: string;

  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصًا' })
  notes?: string;

  @IsOptional()
  @IsInt({ message: 'معرف الصنف يجب أن يكون رقمًا صحيحًا' })
  @Min(1, { message: 'معرف الصنف يجب أن يكون أكبر من 0' })
  @Type(() => Number)
  categoryId?: number;
}
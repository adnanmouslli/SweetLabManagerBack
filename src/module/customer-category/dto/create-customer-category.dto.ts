import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreateCustomerCategoryDto {
  @IsNotEmpty({ message: 'اسم الصنف مطلوب' })
  @IsString({ message: 'اسم الصنف يجب أن يكون نصًا' })
  name: string;

  @IsOptional()
  @IsString({ message: 'الوصف يجب أن يكون نصًا' })
  description?: string;
}
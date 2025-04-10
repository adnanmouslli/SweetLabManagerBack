import { IsNotEmpty, IsNumber, IsOptional, IsPositive, Min } from 'class-validator';

export class ApplyDiscountDto {
  @IsNotEmpty()
  @IsNumber()
  @IsPositive()
  @Min(0)
  discountAmount: number;

  @IsOptional()
  notes?: string;
}
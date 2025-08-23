// dto/currency-exchange.dto.ts

import { IsNumber, IsPositive, IsString, IsOptional, Min } from 'class-validator';

export class SellUSDDto {
  @IsNumber()
  @IsPositive({ message: 'مبلغ الدولار يجب أن يكون أكبر من صفر' })
  usdAmount: number;

  @IsNumber()
  @IsPositive({ message: 'مبلغ السوري يجب أن يكون أكبر من صفر' })
  syrAmount: number;

  @IsNumber()
  @Min(1, { message: 'معرف الصندوق المستهدف مطلوب' })
  targetFundId: number;

  @IsOptional()
  @IsString()
  notes?: string;
}

export class BuyUSDDto {
  @IsNumber()
  @IsPositive({ message: 'مبلغ الدولار يجب أن يكون أكبر من صفر' })
  usdAmount: number;

  @IsNumber()
  @IsPositive({ message: 'مبلغ السوري يجب أن يكون أكبر من صفر' })
  syrAmount: number;

  @IsNumber()
  @Min(1, { message: 'معرف الصندوق المصدر مطلوب' })
  sourceFundId: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
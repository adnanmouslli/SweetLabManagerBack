import { IsEnum, IsNumber } from 'class-validator';
import { FundType } from '@prisma/client';

export class CreateFundDto {
  @IsEnum(FundType)
  fundType: FundType;

  @IsNumber()
  currentBalance: number;
}
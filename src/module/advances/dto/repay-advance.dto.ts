import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class RepayAdvanceDto {
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  amount: number;

  @IsNotEmpty()
  @IsNumber()
  fundId: number;

  @IsOptional()
  @IsString()
  notes?: string;
}
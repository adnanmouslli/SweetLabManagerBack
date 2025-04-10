import { IsNotEmpty, IsNumber, Min } from 'class-validator';

export class CloseShiftDto {
  @IsNotEmpty()
  @IsNumber()
  @Min(0)
  actualAmount: number;
}
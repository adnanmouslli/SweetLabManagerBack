import { IsNumber, IsPositive } from "class-validator";

export class CompleteShiftClosureDto {
  @IsNumber({}, { message: 'المبلغ الفعلي يجب أن يكون رقم' })
  @IsPositive({ message: 'المبلغ الفعلي يجب أن يكون أكبر من صفر' })
  actualAmount: number;  // المبلغ الفعلي المستلم
}
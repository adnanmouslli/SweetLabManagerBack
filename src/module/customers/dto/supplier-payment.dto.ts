import { IsNotEmpty, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class SupplierPaymentDto {
  @IsNotEmpty({ message: 'مبلغ الدفع مطلوب' })
  @IsNumber({}, { message: 'مبلغ الدفع يجب أن يكون رقماً' })
  @Min(0.01, { message: 'مبلغ الدفع يجب أن يكون أكبر من الصفر' })
  paymentAmount: number;

  @IsOptional()
  @IsString({ message: 'الملاحظات يجب أن تكون نصاً' })
  notes?: string;

  @IsNotEmpty({ message: 'معرف الصندوق مطلوب' })
  @IsNumber({}, { message: 'معرف الصندوق يجب أن يكون رقماً' })
  fundId: number;
}

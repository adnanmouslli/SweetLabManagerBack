import { IsNumber, IsString, IsOptional, Min } from 'class-validator';

export class ConvertToBreakDto {
  @IsNumber()
  @Min(1)
  initialPayment: number; // قيمة الدفعة الأولية

  @IsString()
  @IsOptional()
  notes?: string; // ملاحظات إضافية عن تحويل الفاتورة
}
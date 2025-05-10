import { IsNumber, IsOptional, IsString } from 'class-validator';

export class CreateWorkshopSettlementDto {
  @IsNumber()
  amount: number; // المبلغ المراد دفعه للورشة
  
  @IsNumber()
  fundId: number; // الصندوق المستخدم للدفع
  
  @IsString()
  @IsOptional()
  notes?: string; // ملاحظات إضافية
}
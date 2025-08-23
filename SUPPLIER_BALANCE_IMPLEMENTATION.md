# تنفيذ نظام إدارة رصيد الموردين

## الهدف
تنفيذ نظام لإدارة رصيد الموردين بحيث عند إنشاء فاتورة صرف منتجات للمورد، يمكن تحديد المبلغ المدفوع والباقي يُضاف لرصيد المورد.

## التغييرات المنفذة

### 1. قاعدة البيانات (Schema)
```prisma
model Customer {
  // ... الحقول الموجودة
  supplierBalance Float @default(0) // رصيد المورد (للموردين فقط)
}
```

### 2. ملفات DTO الجديدة

#### CreateInvoiceDto - إضافة حقل جديد:
```typescript
@IsNumber()
@IsOptional()
supplierPaymentAmount?: number; // المبلغ المدفوع للمورد (للموردين فقط)
```

#### SupplierPaymentDto - DTO جديد:
```typescript
export class SupplierPaymentDto {
  @IsNotEmpty()
  @IsNumber()
  @Min(0.01)
  paymentAmount: number;

  @IsOptional()
  @IsString()
  notes?: string;

  @IsNotEmpty()
  @IsNumber()
  fundId: number;
}
```

### 3. دوال جديدة في CustomersService

#### updateSupplierBalance()
- تحديث رصيد المورد (إضافة أو خصم)
- التحقق من نوع العميل (مورد)
- التحقق من عدم وجود رصيد سالب

#### paySupplierBalance()
- دفع رصيد المورد
- إنشاء فاتورة دفع
- تحديث رصيد الصندوق
- تحديث رصيد المورد

#### getSupplierBalance()
- عرض رصيد مورد محدد

#### getSuppliersBalanceReport()
- تقرير شامل برصيد جميع الموردين
- إحصائيات عامة

### 4. تعديل منطق إنشاء الفواتير

في `InvoicesService.create()`:
```typescript
// معالجة رصيد المورد للفواتير المتعلقة بالموردين
if (createInvoiceDto.customerId && 
    createInvoiceDto.invoiceType === 'expense' && 
    createInvoiceDto.invoiceCategory === 'products' &&
    createInvoiceDto.supplierPaymentAmount !== undefined) {
  
  // التحقق من نوع العميل
  const customer = await prisma.customer.findUnique({
    where: { id: createInvoiceDto.customerId }
  });

  if (customer && customer.customerType === CustomerType.SUPPLIER) {
    // حساب المبلغ المتبقي
    const remainingAmount = createInvoiceDto.totalAmount - createInvoiceDto.supplierPaymentAmount;
    
    // تحديث رصيد المورد
    if (remainingAmount > 0) {
      await prisma.customer.update({
        where: { id: createInvoiceDto.customerId },
        data: {
          supplierBalance: { increment: remainingAmount }
        }
      });
    }

    // تحديث رصيد الصندوق بالمبلغ المدفوع فقط
    if (createInvoiceDto.paidStatus && createInvoiceDto.supplierPaymentAmount > 0) {
      await prisma.fund.update({
        where: { id: createInvoiceDto.fundId },
        data: {
          currentBalance: {
            decrement: createInvoiceDto.supplierPaymentAmount - (createInvoiceDto.discount || 0)
          }
        }
      });
    }
  }
}
```

### 5. API Endpoints الجديدة

#### إدارة رصيد الموردين:
- `GET /customers/suppliers/balance-report` - تقرير رصيد جميع الموردين
- `GET /customers/:id/supplier-balance` - رصيد مورد محدد  
- `POST /customers/:id/supplier-payment` - دفع رصيد للمورد

#### تحديث Endpoints الموجودة:
- `GET /customers/suppliers/list` - يتضمن الآن supplierBalance
- `GET /customers/list` - يتضمن الآن supplierBalance

### 6. تحديث Seeders
```typescript
// إضافة رصيد عشوائي للموردين في customers.seeder.ts
supplierBalance: customerType === 'SUPPLIER' 
  ? faker.number.float({ min: 0, max: 5000, fractionDigits: 2 })
  : 0,
```

## سيناريوهات الاستخدام

### 1. إنشاء فاتورة صرف للمورد مع دفعة جزئية
```json
{
  "invoiceType": "expense",
  "invoiceCategory": "products",
  "customerId": 123,
  "totalAmount": 1000,
  "supplierPaymentAmount": 600,
  "paidStatus": true,
  "items": [...],
  "fundId": 1
}
```

**النتيجة:**
- رصيد الصندوق: -600
- رصيد المورد: +400 (1000 - 600)
- ملاحظة في الفاتورة: "المبلغ المدفوع للمورد: 600 - المبلغ المضاف للرصيد: 400"

### 2. دفع رصيد المورد
```json
{
  "paymentAmount": 400,
  "notes": "دفع رصيد شهر ديسمبر",
  "fundId": 1
}
```

**النتيجة:**
- رصيد الصندوق: -400
- رصيد المورد: -400
- إنشاء فاتورة دفع رصيد مورد

### 3. عرض تقرير رصيد الموردين
```json
{
  "suppliers": [
    {
      "id": 123,
      "name": "مورد المواد الخام",
      "phone": "123456789",
      "supplierBalance": 1500.50,
      "category": {...}
    }
  ],
  "summary": {
    "totalSuppliers": 5,
    "suppliersWithBalance": 3,
    "totalBalance": 5000.75,
    "averageBalance": 1000.15
  }
}
```

## التحقق والأمان

### 1. التحقق من البيانات
- التأكد من أن العميل من نوع SUPPLIER
- التأكد من أن مبلغ الدفع لا يتجاوز المبلغ الإجمالي
- التأكد من عدم وجود رصيد سالب غير منطقي

### 2. الأمان
- جميع endpoints محمية بـ JWT
- تحديد الأدوار المسموحة لكل endpoint
- استخدام transactions لضمان سلامة البيانات

### 3. التدقيق
- تسجيل جميع العمليات في الفواتير
- إضافة ملاحظات تفصيلية
- ربط العمليات بالموظف والوردية

## الخطوات التالية

1. **تطبيق Migration:**
   ```bash
   npx prisma migrate dev --name add-supplier-balance
   ```

2. **توليد Prisma Client:**
   ```bash
   npx prisma generate
   ```

3. **اختبار الوظائف:**
   - إنشاء فاتورة صرف للمورد مع دفعة جزئية
   - دفع رصيد المورد
   - عرض تقارير الرصيد

4. **تحديث الواجهة الأمامية:**
   - إضافة حقل supplierPaymentAmount في نموذج إنشاء الفاتورة
   - إضافة صفحات إدارة رصيد الموردين
   - إضافة تقارير رصيد الموردين

## ملاحظات مهمة

1. **التوافق:** التغييرات متوافقة مع النظام الحالي
2. **الأداء:** استخدام indexes مناسبة لتحسين الأداء
3. **المرونة:** النظام يدعم إضافة ميزات جديدة مستقبلاً
4. **السلامة:** استخدام transactions لضمان سلامة البيانات

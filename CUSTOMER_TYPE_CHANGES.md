# تغييرات فصل الزبائن عن الموردين

## التغييرات المطبقة

### 1. قاعدة البيانات (Prisma Schema)

#### إضافة Enum جديد:
```prisma
enum CustomerType {
  CUSTOMER
  SUPPLIER
}
```

#### تعديل جدول Customer:
```prisma
model Customer {
  id           Int               @id @default(autoincrement())
  name         String
  phone        String?           @unique
  notes        String?
  customerType CustomerType      @default(CUSTOMER)  // الحقل الجديد
  createdAt    DateTime          @default(now())
  updatedAt    DateTime          @updatedAt
  categoryId   Int?
  // ... باقي الحقول
}
```

### 2. ملفات DTO

#### create-customer.dto.ts:
- إضافة حقل `customerType` اختياري
- إضافة validation للقيم المسموحة

#### update-customer.dto.ts:
- يرث من CreateCustomerDto تلقائياً

### 3. ملفات الخدمات (Services)

#### customers.service.ts:
- إضافة `customerType` في دالة `create`
- إضافة دوال جديدة:
  - `findCustomers()` - البحث عن الزبائن فقط
  - `findSuppliers()` - البحث عن الموردين فقط
  - `getOnlyCustomersList()` - قائمة الزبائن
  - `getSuppliersList()` - قائمة الموردين

### 4. ملفات التحكم (Controllers)

#### customers.controller.ts:
- إضافة endpoints جديدة:
  - `GET /customers/customers` - جميع الزبائن
  - `GET /customers/suppliers` - جميع الموردين
  - `GET /customers/customers/list` - قائمة الزبائن
  - `GET /customers/suppliers/list` - قائمة الموردين

### 5. ملفات Seeders

#### customers.seeder.ts:
- إضافة `customerType` عشوائي (CUSTOMER أو SUPPLIER)

## الملفات التي ستتأثر بالتغيير

### ملفات الفواتير:
- `src/module/invoices/invoices.service.ts` - قد تحتاج لتعديل منطق التحقق
- `src/module/invoices/dto/create-invoice.dto.ts` - قد تحتاج لإضافة حقل نوع العميل

### ملفات الديون:
- `src/module/debts/debts.service.ts` - قد تحتاج لفصل ديون الموردين عن الزبائن

### ملفات الطلبات:
- `src/module/orders/orders.service.ts` - قد تحتاج لتمييز طلبات الشراء والبيع

### ملفات السلف:
- `src/module/advances/advances.service.ts` - قد تحتاج لفصل سلف الموردين عن الزبائن

## الخطوات التالية المطلوبة

1. **تطبيق Migration:**
   ```bash
   npx prisma migrate dev --name add-customer-type
   ```

2. **توليد Prisma Client:**
   ```bash
   npx prisma generate
   ```

3. **تحديث البيانات الموجودة:**
   - تحديد نوع العميل للبيانات الموجودة
   - تحديث الفواتير والديون المرتبطة

4. **تعديل منطق الأعمال:**
   - تعديل منطق الفواتير للتمييز بين فواتير الشراء والبيع
   - تعديل منطق الديون لفصل ديون الموردين عن الزبائن
   - تعديل منطق الطلبات للتمييز بين طلبات الشراء والبيع

## API Endpoints الجديدة

### الزبائن:
- `GET /customers/customers` - جميع الزبائن مع التفاصيل
- `GET /customers/customers/list` - قائمة الزبائن المبسطة

### الموردين:
- `GET /customers/suppliers` - جميع الموردين مع التفاصيل
- `GET /customers/suppliers/list` - قائمة الموردين المبسطة

## ملاحظات مهمة

1. **البيانات الموجودة:** جميع العملاء الحاليين سيصبحون `CUSTOMER` افتراضياً
2. **التوافق:** التغييرات متوافقة مع API الحالي
3. **الأمان:** جميع endpoints محمية بـ JWT و Roles
4. **التحقق:** تم إضافة validation للحقل الجديد

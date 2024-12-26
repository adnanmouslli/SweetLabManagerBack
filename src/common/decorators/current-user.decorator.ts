import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const User = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;

    // إذا تم تحديد حقل معين، أرجع قيمة هذا الحقل فقط
    return data ? user?.[data] : user;
  },
);
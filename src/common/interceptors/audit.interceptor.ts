import {
  Injectable,
  NestInterceptor,
  ExecutionContext,
  CallHandler,
  Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from } from 'rxjs';
import { tap, catchError, switchMap } from 'rxjs/operators';
import { AUDIT_LOG_KEY, AuditLogMetadata } from '../decorators/audit-log.decorator';
import { AuditLogService } from '../../module/audit-log/audit-log.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly auditLogService: AuditLogService,
    private readonly prisma: PrismaService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const auditMetadata = this.reflector.get<AuditLogMetadata>(
      AUDIT_LOG_KEY,
      context.getHandler(),
    );

    if (!auditMetadata) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const startTime = Date.now();

    const user = request.user;
    const userId = user?.id || null;
    const username = user?.username || null;

    const idParam = auditMetadata.idParam || 'id';
    const entityId = request.params[idParam]
      ? parseInt(request.params[idParam], 10)
      : null;

    const ipAddress =
      request.headers['x-forwarded-for'] ||
      request.headers['x-real-ip'] ||
      request.connection?.remoteAddress ||
      request.ip;

    const requestBody = auditMetadata.captureBody !== false
      ? this.sanitizeBody(request.body)
      : undefined;

    // جلب البيانات القديمة قبل التعديل (للفاتورة والطلبية فقط)
    const needsOldData = (auditMetadata.action === 'UPDATE' || auditMetadata.action.startsWith('UPDATE_'))
      && entityId
      && (auditMetadata.entity === 'Invoice' || auditMetadata.entity === 'Order');

    const oldDataPromise = needsOldData
      ? this.fetchEntityData(auditMetadata.entity, entityId)
      : Promise.resolve(null);

    return from(oldDataPromise).pipe(
      switchMap((fetchedOldData) => {
        return next.handle().pipe(
          tap(async (responseData) => {
            try {
              const duration = Date.now() - startTime;
              const statusCode = response.statusCode;

              let oldData = null;
              let newData = null;

              if (auditMetadata.action === 'DELETE' || auditMetadata.action.startsWith('DELETE_') || auditMetadata.action === 'REMOVE_EMPLOYEE') {
                oldData = responseData;
                newData = null;
              } else if (auditMetadata.action === 'CREATE' || auditMetadata.action.startsWith('ADD_') || auditMetadata.action === 'IMPORT_EXCEL' || auditMetadata.action.endsWith('_EXCEL')) {
                oldData = null;
                newData = responseData;
              } else if (auditMetadata.action === 'UPDATE' || auditMetadata.action.startsWith('UPDATE_')) {
                oldData = fetchedOldData;
                newData = responseData;
              } else {
                newData = responseData;
              }

              const description = this.buildDescription(
                auditMetadata,
                entityId,
                responseData,
              );

              await this.auditLogService.createLog({
                userId,
                username,
                action: auditMetadata.action,
                entity: auditMetadata.entity,
                entityId: entityId || this.extractIdFromResponse(responseData),
                description,
                oldData,
                newData,
                metadata: {
                  requestBody,
                  routeParams: request.params,
                  queryParams: request.query,
                },
                ipAddress: typeof ipAddress === 'string' ? ipAddress : ipAddress?.[0],
                userAgent: request.headers['user-agent'],
                method: request.method,
                route: request.originalUrl || request.url,
                statusCode,
                duration,
              });
            } catch (error) {
              this.logger.error(
                `Failed to write audit log: ${error.message}`,
                error.stack,
              );
            }
          }),
          catchError((error) => {
            const duration = Date.now() - startTime;
            this.auditLogService
              .createLog({
                userId,
                username,
                action: `FAILED_${auditMetadata.action}`,
                entity: auditMetadata.entity,
                entityId,
                description: `Failed: ${error.message}`,
                oldData: null,
                newData: null,
                metadata: {
                  requestBody,
                  error: error.message,
                  routeParams: request.params,
                },
                ipAddress: typeof ipAddress === 'string' ? ipAddress : ipAddress?.[0],
                userAgent: request.headers['user-agent'],
                method: request.method,
                route: request.originalUrl || request.url,
                statusCode: error.status || 500,
                duration,
              })
              .catch((logError) => {
                this.logger.error(`Failed to log error audit: ${logError.message}`);
              });

            throw error;
          }),
        );
      }),
    );
  }

  /**
   * جلب بيانات الكيان من قاعدة البيانات قبل التعديل
   */
  private async fetchEntityData(entity: string, entityId: number): Promise<any> {
    try {
      if (entity === 'Invoice') {
        return await this.prisma.invoice.findUnique({
          where: { id: entityId },
          include: {
            items: { include: { item: { select: { name: true } } } },
            customer: { select: { name: true, customerType: true } },
            employee: { select: { username: true } },
            fund: { select: { fundType: true } },
          },
        });
      }
      if (entity === 'Order') {
        return await this.prisma.order.findUnique({
          where: { id: entityId },
          include: {
            items: { include: { item: { select: { name: true } } } },
            customer: { select: { name: true, customerType: true } },
            category: { select: { name: true } },
            employee: { select: { username: true } },
          },
        });
      }
      return null;
    } catch (error) {
      this.logger.warn(`Failed to fetch old data for ${entity} #${entityId}: ${error.message}`);
      return null;
    }
  }

  private sanitizeBody(body: any): any {
    if (!body) return null;
    const sanitized = { ...body };
    delete sanitized.password;
    delete sanitized.token;
    delete sanitized.accessToken;
    delete sanitized.access_token;
    return sanitized;
  }

  private extractIdFromResponse(response: any): number | null {
    if (!response) return null;
    if (typeof response === 'object' && response.id) return response.id;
    if (typeof response === 'object' && response.data?.id) return response.data.id;
    return null;
  }

  private buildDescription(
    metadata: AuditLogMetadata,
    entityId: number | null,
    responseData: any,
  ): string {
    if (metadata.description) return metadata.description;
    const idStr = entityId ? ` #${entityId}` : '';
    return `${metadata.action} ${metadata.entity}${idStr}`;
  }
}

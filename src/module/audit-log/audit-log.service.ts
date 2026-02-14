import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { QueryAuditLogDto } from './dto/query-audit-log.dto';

interface CreateAuditLogInput {
  userId: number | null;
  username: string | null;
  action: string;
  entity: string;
  entityId: number | null;
  description: string;
  oldData: any;
  newData: any;
  metadata: any;
  ipAddress: string | null;
  userAgent: string | null;
  method: string;
  route: string;
  statusCode: number;
  duration: number;
}

@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async createLog(input: CreateAuditLogInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: input.userId,
        username: input.username,
        action: input.action,
        entity: input.entity,
        entityId: input.entityId,
        description: input.description,
        oldData: input.oldData ?? Prisma.JsonNull,
        newData: input.newData ?? Prisma.JsonNull,
        metadata: input.metadata ?? Prisma.JsonNull,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        method: input.method,
        route: input.route,
        statusCode: input.statusCode,
        duration: input.duration,
      },
    });
  }

  async findAll(query: QueryAuditLogDto) {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 20;
    const {
      userId,
      action,
      entity,
      entityId,
      startDate,
      endDate,
      search,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      method,
    } = query;

    const where: Prisma.AuditLogWhereInput = {};

    if (userId) {
      where.userId = Number(userId);
    }

    if (action) {
      where.action = action;
    }

    if (entity) {
      where.entity = entity;
    }

    if (entityId) {
      where.entityId = Number(entityId);
    }

    if (method) {
      where.method = method;
    }

    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) {
        where.createdAt.gte = new Date(startDate);
      }
      if (endDate) {
        where.createdAt.lte = new Date(endDate + 'T23:59:59.999Z');
      }
    }

    if (search) {
      where.OR = [
        { description: { contains: search, mode: 'insensitive' } },
        { route: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
      ];
    }

    const skip = (page - 1) * limit;

    const [data, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { [sortBy]: sortOrder },
        skip,
        take: limit,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      data,
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: number) {
    return this.prisma.auditLog.findUnique({ where: { id } });
  }

  async getEntityHistory(entity: string, entityId: number) {
    return this.prisma.auditLog.findMany({
      where: { entity, entityId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getUserActivity(userId: number, limit = 50) {
    return this.prisma.auditLog.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async getActionSummary(startDate?: string, endDate?: string) {
    const where: Prisma.AuditLogWhereInput = {};
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt.gte = new Date(startDate);
      if (endDate) where.createdAt.lte = new Date(endDate + 'T23:59:59.999Z');
    }

    const result = await this.prisma.auditLog.groupBy({
      by: ['action', 'entity'],
      where,
      _count: { id: true },
      orderBy: { _count: { id: 'desc' } },
    });

    return result.map((item) => ({
      action: item.action,
      entity: item.entity,
      count: item._count.id,
    }));
  }
}

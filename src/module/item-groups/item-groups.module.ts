import { Module } from '@nestjs/common';
import { ItemGroupsService } from './item-groups.service';
import { ItemGroupsController } from './item-groups.controller';
import { PrismaService } from '@/prisma/prisma.service';

@Module({
  controllers: [ItemGroupsController],
  providers: [ItemGroupsService , PrismaService],
  exports:[ItemGroupsService]
})
export class ItemGroupsModule {}

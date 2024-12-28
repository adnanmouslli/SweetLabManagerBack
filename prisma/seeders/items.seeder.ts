// prisma/seeders/items.seeder.ts
import { PrismaClient, ItemType } from '@prisma/client';

const productionItems = [
  { 
    name: 'كروسان سادة',
    unit: 'قطعة',
    price: 2.5,
    description: 'كروسان طازج بالزبدة'
  },
  { 
    name: 'كروسان جبنة',
    unit: 'قطعة',
    price: 3.0,
    description: 'كروسان محشو بالجبنة'
  },
  { 
    name: 'بقلاوة',
    unit: 'كيلو',
    price: 50.0,
    description: 'بقلاوة بالفستق الحلبي'
  },
  { 
    name: 'كنافة',
    unit: 'صينية',
    price: 35.0,
    description: 'كنافة ناعمة بالجبنة'
  }
];

const rawItems = [
  { 
    name: 'طحين',
    unit: 'كيلو',
    price: 2.0,
    description: 'طحين درجة أولى'
  },
  { 
    name: 'سكر',
    unit: 'كيلو',
    price: 3.0,
    description: 'سكر أبيض ناعم'
  },
  { 
    name: 'زبدة',
    unit: 'كيلو',
    price: 15.0,
    description: 'زبدة طبيعية'
  },
  { 
    name: 'فستق حلبي',
    unit: 'كيلو',
    price: 80.0,
    description: 'فستق حلبي درجة أولى'
  }
];

export async function seedItems(prisma: PrismaClient) {
  console.log('Seeding items...');

  const productionGroup = await prisma.itemGroup.findFirst({
    where: { type: ItemType.production },
  });

  for (const item of productionItems) {
    await prisma.item.create({
      data: {
        ...item,
        type: ItemType.production,
        groupId: productionGroup.id,
      },
    });
  }

  const rawGroup = await prisma.itemGroup.findFirst({
    where: { type: ItemType.raw },
  });

  for (const item of rawItems) {
    await prisma.item.create({
      data: {
        ...item,
        type: ItemType.raw,
        groupId: rawGroup.id,
      },
    });
  }

  console.log('✅ Items seeded successfully');
}
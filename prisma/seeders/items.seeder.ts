// prisma/seeders/items.seeder.ts
import { PrismaClient, ItemType } from '@prisma/client';

const productionItems = [
  { 
    name: 'كروسان سادة',
    description: 'كروسان طازج بالزبدة',
    units: [
      { unit: 'قطعة', price: 2.5, factor: 1 },
      { unit: 'صينية', price: 50, factor: 20 }
    ],
    defaultUnit: 'قطعة',
    price: 2.5,
    cost: 1.5
  },
  { 
    name: 'كروسان جبنة',
    description: 'كروسان محشو بالجبنة',
    units: [
      { unit: 'قطعة', price: 3.0, factor: 1 },
      { unit: 'صينية', price: 60, factor: 20 }
    ],
    defaultUnit: 'قطعة',
    price: 3.0,
    cost: 2.0
  },
  { 
    name: 'بقلاوة',
    description: 'بقلاوة بالفستق الحلبي',
    units: [
      { unit: 'قطعة', price: 5.0, factor: 1 },
      { unit: 'كيلو', price: 50.0, factor: 10 },
      { unit: 'صينية', price: 120, factor: 24 }
    ],
    defaultUnit: 'كيلو',
    price: 50.0,
    cost: 35.0
  },
  { 
    name: 'كنافة',
    description: 'كنافة ناعمة بالجبنة',
    units: [
      { unit: 'قطعة', price: 7.0, factor: 1 },
      { unit: 'صينية', price: 35.0, factor: 5 }
    ],
    defaultUnit: 'صينية',
    price: 35.0,
    cost: 25.0
  }
];

const rawItems = [
  { 
    name: 'طحين',
    description: 'طحين درجة أولى',
    units: [
      { unit: 'كيلو', price: 2.0, factor: 1 },
      { unit: 'كيس', price: 50.0, factor: 25 }
    ],
    defaultUnit: 'كيلو',
    price: 2.0,
    cost: 1.8
  },
  { 
    name: 'سكر',
    description: 'سكر أبيض ناعم',
    units: [
      { unit: 'كيلو', price: 3.0, factor: 1 },
      { unit: 'كيس', price: 75.0, factor: 25 }
    ],
    defaultUnit: 'كيلو',
    price: 3.0,
    cost: 2.5
  },
  { 
    name: 'زبدة',
    description: 'زبدة طبيعية',
    units: [
      { unit: 'كيلو', price: 15.0, factor: 1 },
      { unit: 'عبوة', price: 7.5, factor: 0.5 }
    ],
    defaultUnit: 'كيلو',
    price: 15.0,
    cost: 12.0
  },
  { 
    name: 'فستق حلبي',
    description: 'فستق حلبي درجة أولى',
    units: [
      { unit: 'كيلو', price: 80.0, factor: 1 },
      { unit: 'جرام', price: 0.08, factor: 0.001 }
    ],
    defaultUnit: 'كيلو',
    price: 80.0,
    cost: 70.0
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
        name: item.name,
        type: ItemType.production,
        description: item.description,
        units: JSON.parse(JSON.stringify(item.units)),
        defaultUnit: item.defaultUnit,
        price: item.price,
        cost: item.cost,
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
        name: item.name,
        type: ItemType.raw,
        description: item.description,
        units: item.units,
        defaultUnit: item.defaultUnit,
        price: item.price,
        cost: item.cost,
        groupId: rawGroup.id,
      },
    });
  }

  console.log('✅ Items seeded successfully');
}
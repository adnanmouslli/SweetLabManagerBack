import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { FilterOrdersDto } from './dto/filter-orders.dto';
import { InvoicesService } from '../invoices/invoices.service';
import { OrderQueueService } from '../order-queue/order-queue.service';
import { OrderStatus } from '@prisma/client';
import { CreateInvoiceDto } from '../invoices/dto/create-invoice.dto';

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private invoicesService: InvoicesService,
    private orderQueueService: OrderQueueService,
  ) {}
  
  // دالة مساعدة للحصول على الصندوق المناسب حسب نوع العميل
  private async getAppropriateFund(customerId: number) {
    // جلب معلومات العميل
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { isUniversity: true }
    });

    if (!customer) {
      throw new BadRequestException('العميل غير موجود');
    }

    // تحديد نوع الصندوق حسب نوع العميل
    const fundType = customer.isUniversity ? 'university' : 'general';
    
    // البحث عن الصندوق المناسب
    const fund = await this.prisma.fund.findFirst({
      where: { fundType }
    });

    if (!fund) {
      const fundName = customer.isUniversity ? 'صندوق الجامعة' : 'الصندوق العام';
      throw new BadRequestException(`لا يوجد ${fundName}، لا يمكن إنشاء فاتورة`);
    }

    return { fund, customer };
  }

  // تعديل دالة create
async create(createOrderDto: CreateOrderDto, employeeId: number) {
  // Verify customer exists
  const customer = await this.prisma.customer.findUnique({
    where: { id: createOrderDto.customerId }
  });
  
  if (!customer) {
    throw new BadRequestException('العميل غير موجود');
  }
  
  // If useLastOrder flag is set, find and use the most recent order for this customer
  if (createOrderDto.useLastOrder) {
    const lastOrder = await this.prisma.order.findFirst({
      where: { 
        customerId: createOrderDto.customerId
      },
      orderBy: { 
        createdAt: 'desc' 
      },
      include: {
        items: {
          include: {
            item: true
          }
        }
      }
    });
    
    if (lastOrder) {
      // Use items from the last order and ignore any items sent from frontend
      createOrderDto.items = lastOrder.items.map(item => ({
        itemId: item.itemId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        unit: item.unit,
        notes: item.notes
      }));
      
      console.log('Using last order items. New calculated total:', createOrderDto.totalAmount);
    } else {
      // No previous order found
      throw new BadRequestException('لا توجد طلبية سابقة لهذا العميل');
    }
  }
  
  // Verify category exists
  const category = await this.prisma.orderCategory.findUnique({
    where: { id: createOrderDto.categoryId }
  });
  
  if (!category) {
    throw new BadRequestException('فئة الطلبية غير موجودة');
  }
  
  // Verify all items exist
  for (const item of createOrderDto.items) {
    const existingItem = await this.prisma.item.findUnique({
      where: { id: item.itemId }
    });
    
    if (!existingItem) {
      throw new BadRequestException(`المنتج برقم ${item.itemId} غير موجود`);
    }
  }
  
  // Determine scheduled date
  let scheduledDate: Date;

  const now = this.createSyriaDate(); // تاريخ/وقت محلي (مثلاً Asia/Damascus)

  if (createOrderDto.scheduledFor) {
    scheduledDate = new Date(createOrderDto.scheduledFor);
  } else {
    const isForToday = createOrderDto.isForToday || false;

    if (isForToday) {
      // التسليم اليوم الساعة 12:00
      scheduledDate = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate(),
        12, 0, 0
      );
    } else {
      // التسليم غداً
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(12, 0, 0, 0);

      // معالجة حالة الخميس (الغد = الجمعة → عطلة)
      // getDay() → 0 الأحد , 4 الخميس , 5 الجمعة , 6 السبت
      if (now.getDay() === 4) { 
        // اليوم الخميس، الغد جمعة → نحرك يومين للسبت
        tomorrow.setDate(tomorrow.getDate() + 1);
      }

      scheduledDate = tomorrow;
    }
  }

  const orderNumber = `ORD-${Date.now()}`;
  
  return this.prisma.$transaction(async (prisma) => {
    // Create order
    const order = await prisma.order.create({
      data: {
        orderNumber,
        customerId: createOrderDto.customerId,
        totalAmount: createOrderDto.totalAmount,
        paidStatus: createOrderDto.paidStatus || false,
        status: OrderStatus.pending,
        scheduledFor: scheduledDate,
        notes: createOrderDto.notes,
        categoryId: createOrderDto.categoryId,
        employeeId,
        items: {
          create: createOrderDto.items.map(item => ({
            itemId: item.itemId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            unit: item.unit,
            subTotal: item.quantity * item.unitPrice,
            notes: item.notes
          }))
        }
      },
      include: {
        customer: true,
        category: true,
        employee: {
          select: {
            username: true
          }
        },
        items: {
          include: {
            item: true
          }
        }
      }
    });
    
    // تعيين رقم الدور للطلبية
    const queueNumber = await this.orderQueueService.getNextQueueNumber();
    await prisma.order.update({
      where: { id: order.id },
      data: { queueNumber },
    });

    // If order is marked as paid, create an invoice
    let invoice = null;
    if (createOrderDto.paidStatus) {
      // Find active shift
      const activeShift = await prisma.shift.findFirst({
        where: {
          status: 'open',
        },
      });
    
      if (!activeShift) {
        throw new BadRequestException('لا يوجد واردية مفتوحة، لا يمكن إنشاء فاتورة للطلبية المدفوعة');
      }
      
      // الحصول على الصندوق المناسب حسب نوع العميل
      const { fund: appropriateFund } = await this.getAppropriateFund(createOrderDto.customerId);
      
      const invoiceNumber = `INV-ORD-${Date.now()}`;
      
      // Handle break invoice (partial payment)
      if (createOrderDto.invoiceData?.isBreak) {
        if (!createOrderDto.invoiceData.initialPayment) {
          throw new BadRequestException('يجب تحديد قيمة الدفعة الأولى عند إنشاء فاتورة كسر');
        }
        
        if (createOrderDto.invoiceData.initialPayment >= createOrderDto.totalAmount) {
          throw new BadRequestException('قيمة الدفعة الأولى يجب أن تكون أقل من إجمالي المبلغ');
        }

        // Create first invoice (paid, initial payment)
        const paidInvoice = await prisma.invoice.create({
          data: {
            invoiceNumber: `${invoiceNumber}-A`,
            employeeId,
            invoiceType: 'income',
            invoiceCategory: 'products',
            customerId: createOrderDto.customerId,
            paidStatus: true,
            totalAmount: createOrderDto.invoiceData.initialPayment,
            discount: createOrderDto.invoiceData.discount || 0,
            additionalAmount: createOrderDto.invoiceData.additionalAmount || 0,
            fundId: appropriateFund.id,
            shiftId: activeShift.id,
            paymentDate: new Date(),
            trayCount: createOrderDto.invoiceData.trayCount || 0,
            isBreak: false
          },
          include: {
            customer: true
          }
        });
        
        // Create invoice items
        for (const item of createOrderDto.items) {
          await prisma.invoiceItem.create({
            data: {
              invoiceId: paidInvoice.id,
              itemId: item.itemId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              unit: item.unit,
              subTotal: item.quantity * item.unitPrice
            }
          });
        }
        
        // Create second invoice (unpaid, remaining amount)
        const remainingAmount = createOrderDto.totalAmount - createOrderDto.invoiceData.initialPayment;
        const breakInvoice = await prisma.invoice.create({
          data: {
            invoiceNumber: `${invoiceNumber}-B`,
            employeeId,
            invoiceType: 'income',
            invoiceCategory: 'products',
            customerId: createOrderDto.customerId,
            paidStatus: false,
            totalAmount: remainingAmount,
            discount: 0,
            additionalAmount: 0,
            fundId: appropriateFund.id,
            shiftId: activeShift.id,
            paymentDate: null,
            trayCount: 0,
            isBreak: true
          },
          include: {
            customer: true
          }
        });
        
        // Create invoice items for break invoice
        for (const item of createOrderDto.items) {
          await prisma.invoiceItem.create({
            data: {
              invoiceId: breakInvoice.id,
              itemId: item.itemId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              unit: item.unit,
              subTotal: item.quantity * item.unitPrice
            }
          });
        }
        
        // Update order to link to break invoice (unpaid portion)
        await prisma.order.update({
          where: { id: order.id },
          data: { 
            invoiceId: breakInvoice.id,
            paidStatus: false,
            status: OrderStatus.pending 
          }
        });
        
        // Update fund balance with initial payment
        await prisma.fund.update({
          where: { id: appropriateFund.id },
          data: {
            currentBalance: {
              increment: createOrderDto.invoiceData.initialPayment
            }
          }
        });
        
        // Handle tray tracking if needed
        if (createOrderDto.invoiceData.trayCount > 0) {
          await prisma.trayTracking.create({
            data: {
              customerId: createOrderDto.customerId,
              totalTrays: createOrderDto.invoiceData.trayCount,
              status: 'pending',
              invoiceId: paidInvoice.id
            }
          });
        }
        
        // Get invoices with items
        const paidInvoiceWithItems = await prisma.invoice.findUnique({
          where: { id: paidInvoice.id },
          include: {
            items: {
              include: {
                item: true
              }
            },
            customer: true
          }
        });
        
        const breakInvoiceWithItems = await prisma.invoice.findUnique({
          where: { id: breakInvoice.id },
          include: {
            items: {
              include: {
                item: true
              }
            },
            customer: true
          }
        });
        
        invoice = {
          paidInvoice: paidInvoiceWithItems,
          breakInvoice: breakInvoiceWithItems,
          isBreakInvoice: true
        };
      }
      else {
        // Create standard invoice with all invoice data
        const standardInvoice = await prisma.invoice.create({
          data: {
            invoiceNumber,
            employeeId,
            invoiceType: 'income',
            invoiceCategory: 'products',
            customerId: createOrderDto.customerId,
            paidStatus: true,
            totalAmount: createOrderDto.totalAmount,
            discount: createOrderDto.invoiceData?.discount || 0,
            additionalAmount: createOrderDto.invoiceData?.additionalAmount || 0,
            notes: createOrderDto.invoiceData?.notes,
            fundId: appropriateFund.id,
            shiftId: activeShift.id,
            paymentDate: new Date(),
            trayCount: createOrderDto.invoiceData?.trayCount || 0,
            isBreak: false
          },
          include: {
            customer: true
          }
        });
        
        // Create invoice items
        for (const item of createOrderDto.items) {
          await prisma.invoiceItem.create({
            data: {
              invoiceId: standardInvoice.id,
              itemId: item.itemId,
              quantity: item.quantity,
              unitPrice: item.unitPrice,
              unit: item.unit,
              subTotal: item.quantity * item.unitPrice
            }
          });
        }

        // Update order with invoice ID
        await prisma.order.update({
          where: { id: order.id },
          data: {
            invoiceId: standardInvoice.id
          }
        });

        // Update fund balance
        await prisma.fund.update({
          where: { id: appropriateFund.id },
          data: {
            currentBalance: {
              increment: createOrderDto.totalAmount
            }
          }
        });
        
        // Handle tray tracking if needed
        if (createOrderDto.invoiceData?.trayCount > 0) {
          await prisma.trayTracking.create({
            data: {
              customerId: createOrderDto.customerId,
              totalTrays: createOrderDto.invoiceData.trayCount,
              status: 'pending',
              invoiceId: standardInvoice.id
            }
          });
        }
        
        // Get the invoice with items
        const invoiceWithItems = await prisma.invoice.findUnique({
          where: { id: standardInvoice.id },
          include: {
            items: {
              include: {
                item: true
              }
            },
            customer: true
          }
        });
        
        invoice = invoiceWithItems;
      }
    }
    

    // 📱 إرسال الفاتورة للزبون
    if (invoice) {
      if (invoice.isBreakInvoice) {
        // إرسال كلا الفاتورتين
        await this.invoicesService.sendInvoiceToCustomer(invoice.paidInvoice);
        await this.invoicesService.sendInvoiceToCustomer(invoice.breakInvoice);
      } else {
        // إرسال الفاتورة العادية
        await this.invoicesService.sendInvoiceToCustomer(invoice);
      }
    }

    // Get updated order with all relations
    const updatedOrder = await prisma.order.findUnique({
      where: { id: order.id },
      include: {
        customer: true,
        category: true,
        employee: {
          select: {
            username: true
          }
        },
        items: {
          include: {
            item: true
          }
        },
        invoice: true
      }
    });
    
    
    return {
      order: updatedOrder,
      invoice,
      message: 'تم إنشاء الطلبية بنجاح'
    };
  });
}


  // Method to get the last order for a specific customer
  async getLastOrderForCustomer(customerId: number) {
    const customer = await this.prisma.customer.findUnique({
      where: { id: customerId }
    });
    
    if (!customer) {
      throw new BadRequestException('العميل غير موجود');
    }
    
    const lastOrder = await this.prisma.order.findFirst({
      where: { 
        customerId: customerId 
      },
      orderBy: { 
        createdAt: 'desc' 
      },
      include: {
        customer: true,
        category: true,
        items: {
          include: {
            item: true
          }
        }
      }
    });
    
    if (!lastOrder) {
      throw new NotFoundException('لا توجد طلبيات سابقة لهذا العميل');
    }
    
    return lastOrder;
  }
  
  async findAll(filterDto: FilterOrdersDto) {
    const where: any = {};
    
    // Filtros básicos
    if (filterDto.customerId) {
      where.customerId = filterDto.customerId;
    }
    
    if (filterDto.paidStatus !== undefined) {
      where.paidStatus = filterDto.paidStatus;
    }
    
    if (filterDto.status) {
      where.status = filterDto.status;
    }
    
    if (filterDto.categoryId) {
      where.categoryId = filterDto.categoryId;
    }
    
    // Filtro por rango de fechas específico
    if (filterDto.startDate || filterDto.endDate) {
      where.scheduledFor = {};
      
      if (filterDto.startDate) {
        const startDate = new Date(filterDto.startDate);
        where.scheduledFor.gte = this.getStartOfDay(startDate);
      }
      
      if (filterDto.endDate) {
        const endDate = new Date(filterDto.endDate);
        where.scheduledFor.lte = this.getEndOfDay(endDate);
      }
    }
    
    // Filtro para pedidos de hoy
    if (filterDto.forToday) {
      // Obtener la fecha actual en la zona horaria de Siria
      const today = this.createSyriaDate();
      
      // Es importante redefinir scheduledFor completamente para evitar conflictos con otros filtros
      where.scheduledFor = {
        gte: this.getStartOfDay(today),
        lte: this.getEndOfDay(today)
      };
      
      
    }
    
    // Filtro para pedidos de mañana
    if (filterDto.forTomorrow) {
      // Obtener la fecha de mañana en la zona horaria de Siria
      const today = this.createSyriaDate();
      const tomorrow = new Date(today);
      tomorrow.setDate(tomorrow.getDate() + 1);
      
      // Es importante redefinir scheduledFor completamente para evitar conflictos
      where.scheduledFor = {
        gte: this.getStartOfDay(tomorrow),
        lte: this.getEndOfDay(tomorrow)
      };
      
    }
    
    // If no date filter is applied (no forToday, forTomorrow, startDate, endDate), default to last 2 weeks
    if (!filterDto.forToday && !filterDto.forTomorrow && !filterDto.startDate && !filterDto.endDate) {
      const today = this.createSyriaDate();
      const twoWeeksAgo = new Date(today);
      twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
      where.createdAt = {
        gte: this.getStartOfDay(twoWeeksAgo),
      };
    }

    // Realizar la consulta
    const orders = await this.prisma.order.findMany({
      where,
      take: 100,
      include: {
        customer: true,
        category: true,
        employee: {
          select: {
            username: true
          }
        },
        items: {
          include: {
            item: true
          }
        },
        invoice: true
      },
      orderBy: {
        scheduledFor: 'asc'
      }
    });
    
    console.log(`Se encontraron ${orders.length} pedidos con los filtros aplicados.`);
    return orders;
  }
  
  async findOne(id: number) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        customer: true,
        category: true,
        employee: {
          select: {
            username: true
          }
        },
        items: {
          include: {
            item: true
          }
        },
        invoice: true
      }
    });
    
    if (!order) {
      throw new NotFoundException(`الطلبية برقم ${id} غير موجودة`);
    }
    
    return order;
  }
  
  async update(id: number, updateOrderDto: UpdateOrderDto, employeeId: number) {
    // Verificar que el pedido existe
    const existingOrder = await this.prisma.order.findUnique({
      where: { id },
      include: {
        items: true,
        invoice: true
      }
    });
    
    if (!existingOrder) {
      throw new NotFoundException(`الطلبية برقم ${id} غير موجودة`);
    }
    
    if (existingOrder.invoice) {
      throw new BadRequestException('لا يمكن تعديل طلبية مرتبطة بفاتورة');
    }
    

    if (updateOrderDto.customerId) {
      const customer = await this.prisma.customer.findUnique({
        where: { id: updateOrderDto.customerId }
      });
      
      if (!customer) {
        throw new BadRequestException('العميل غير موجود');
      }
    }
    

    if (updateOrderDto.categoryId) {
      const category = await this.prisma.orderCategory.findUnique({
        where: { id: updateOrderDto.categoryId }
      });
      
      if (!category) {
        throw new BadRequestException('فئة الطلبية غير موجودة');
      }
    }
    

    if (updateOrderDto.items) {
      for (const item of updateOrderDto.items) {
        const existingItem = await this.prisma.item.findUnique({
          where: { id: item.itemId }
        });
        
        if (!existingItem) {
          throw new BadRequestException(`المنتج برقم ${item.itemId} غير موجود`);
        }
      }
      

      const calculatedTotal = updateOrderDto.items.reduce(
        (sum, item) => sum + (item.quantity * item.unitPrice),
        0
      );
      
      if (updateOrderDto.totalAmount && 
          Math.abs(calculatedTotal - updateOrderDto.totalAmount) > 0.01) {
        throw new BadRequestException('المجموع الكلي غير صحيح');
      }
      

      if (!updateOrderDto.totalAmount) {
        updateOrderDto.totalAmount = calculatedTotal;
      }
    }
    

    let scheduledDate = undefined;
    if (updateOrderDto.scheduledFor) {
      scheduledDate = new Date(updateOrderDto.scheduledFor);
    }
    

    let deliveryDate = undefined;
    if (updateOrderDto.deliveryDate) {
      deliveryDate = new Date(updateOrderDto.deliveryDate);
    }
    
    return this.prisma.$transaction(async (prisma) => {

      if (updateOrderDto.items) {

          await prisma.orderItem.deleteMany({
            where: { orderId: id }
          });
          
          for (const item of updateOrderDto.items) {
            await prisma.orderItem.create({
              data: {
                orderId: id,
                itemId: item.itemId,
                quantity: item.quantity,
                unitPrice: item.unitPrice,
                unit: item.unit,
                subTotal: item.quantity * item.unitPrice,
                notes: item.notes
              }
            });
          }
      }
      
      const updatedOrder = await prisma.order.update({
        where: { id },
        data: {
          customerId: updateOrderDto.customerId,
          totalAmount: updateOrderDto.totalAmount,
          paidStatus: updateOrderDto.paidStatus,
          status: updateOrderDto.status,
          scheduledFor: scheduledDate,
          deliveryDate: deliveryDate,
          notes: updateOrderDto.notes,
          categoryId: updateOrderDto.categoryId
        },
        include: {
          customer: true,
          category: true,
          employee: {
            select: {
              username: true
            }
          },
          items: {
            include: {
              item: true
            }
          }
        }
      });
      
      return {
        ...updatedOrder,
        message: 'تم تحديث الطلبية بنجاح'
      };
    });
  }
  
  async remove(id: number) {

    const existingOrder = await this.prisma.order.findUnique({
      where: { id },
      include: {
        invoice: true
      }
    });
    
    if (!existingOrder) {
      throw new NotFoundException(`الطلبية برقم ${id} غير موجودة`);
    }
    

    if (existingOrder.invoice) {
      throw new BadRequestException('لا يمكن حذف طلبية مرتبطة بفاتورة');
    }
    
    return this.prisma.$transaction(async (prisma) => {

      await prisma.orderItem.deleteMany({
        where: { orderId: id }
      });
      

      const deletedOrder = await prisma.order.delete({
        where: { id }
      });
      
      return {
        ...deletedOrder,
        message: 'تم حذف الطلبية بنجاح'
      };
    });
  }
  

  async convertToInvoice(id: number, employeeId: number, invoiceData?: Partial<CreateInvoiceDto>) {
  // Find the order with its items and customer
  const order = await this.prisma.order.findUnique({
    where: { id },
    include: {
      items: {
        include: {
          item: true
        }
      },
      customer: true,
      invoice: true
    }
  });
  
  if (!order) {
    throw new NotFoundException(`الطلبية برقم ${id} غير موجودة`);
  }

  // Check if order already has an invoice
  if (order.invoice) {
    throw new BadRequestException('الطلبية مرتبطة بفاتورة بالفعل');
  }

  // Find active shift
  const activeShift = await this.prisma.shift.findFirst({
    where: {
      status: 'open',
    },
  });

  if (!activeShift) {
    throw new BadRequestException('لا يوجد واردية مفتوحة، لا يمكن إنشاء فاتورة');
  }

  // الحصول على الصندوق المناسب حسب نوع العميل
  const { fund: appropriateFund } = await this.getAppropriateFund(order.customerId);
  
  return this.prisma.$transaction(async (prisma) => {
    const invoiceNumber = `INV-ORD-${Date.now()}`;
    
    // If it's a break invoice (partial payment)
    if (invoiceData?.isBreak) {
      if (!invoiceData.initialPayment) {
        throw new BadRequestException('يجب تحديد قيمة الدفعة الأولى عند إنشاء فاتورة كسر');
      }
      
      if (invoiceData.initialPayment >= order.totalAmount) {
        throw new BadRequestException('قيمة الدفعة الأولى يجب أن تكون أقل من إجمالي المبلغ');
      }

      // Create first invoice (paid, initial payment) using unchecked create
      const paidInvoice = await prisma.invoice.create({
        data: {
          invoiceNumber: `${invoiceNumber}-A`,
          employeeId: employeeId,
          invoiceType: 'income',
          invoiceCategory: 'products',
          customerId: order.customerId,
          paidStatus: true,
          totalAmount: invoiceData.initialPayment,
          discount: invoiceData.discount || 0,
          additionalAmount: invoiceData.additionalAmount || 0,
          fundId: appropriateFund.id, // استخدام الصندوق المناسب
          shiftId: activeShift.id,
          paymentDate: new Date(),
          trayCount: invoiceData.trayCount || 0,
          isBreak: false
        },
        include: {
          customer: true
        }
      });
      
      // Create invoice items
      for (const item of order.items) {
        await prisma.invoiceItem.create({
          data: {
            invoiceId: paidInvoice.id,
            itemId: item.itemId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            unit: item.unit,
            subTotal: item.quantity * item.unitPrice
          }
        });
      }
      
      // Create second invoice (unpaid, remaining amount)
      const remainingAmount = order.totalAmount - invoiceData.initialPayment;
      const breakInvoice = await prisma.invoice.create({
        data: {
          invoiceNumber: `${invoiceNumber}-B`,
          employeeId: employeeId,
          invoiceType: 'income',
          invoiceCategory: 'products',
          customerId: order.customerId,
          paidStatus: false,
          totalAmount: remainingAmount,
          discount: 0,
          additionalAmount: 0,
          fundId: appropriateFund.id, // استخدام الصندوق المناسب
          shiftId: activeShift.id,
          paymentDate: null,
          trayCount: 0,
          isBreak: true
        },
        include: {
          customer: true
        }
      });
      
      // Create invoice items for break invoice
      for (const item of order.items) {
        await prisma.invoiceItem.create({
          data: {
            invoiceId: breakInvoice.id,
            itemId: item.itemId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            unit: item.unit,
            subTotal: item.quantity * item.unitPrice
          }
        });
      }
      
      // Update order to link to first invoice (paid portion)
      await prisma.order.update({
        where: { id: order.id },
        data: { 
          invoiceId: breakInvoice.id,
          paidStatus: false, // Partially paid
          status: OrderStatus.delivered 
        }
      });
      
      // Update fund balance with initial payment
      await prisma.fund.update({
        where: { id: appropriateFund.id },
        data: {
          currentBalance: {
            increment: invoiceData.initialPayment
          }
        }
      });
      
      // Handle tray tracking if needed
      if (invoiceData.trayCount > 0) {
        await prisma.trayTracking.create({
          data: {
            customerId: order.customerId,
            totalTrays: invoiceData.trayCount,
            status: 'pending',
            notes: `تم تسليم ${invoiceData.trayCount} صاج مع الفاتورة ${paidInvoice.invoiceNumber}`,
            invoiceId: paidInvoice.id
          }
        });
      }
      
      // Get the invoice with items
      const paidInvoiceWithItems = await prisma.invoice.findUnique({
        where: { id: paidInvoice.id },
        include: {
          items: {
            include: {
              item: true
            }
          },
          customer: true
        }
      });
      
      const breakInvoiceWithItems = await prisma.invoice.findUnique({
        where: { id: breakInvoice.id },
        include: {
          items: {
            include: {
              item: true
            }
          },
          customer: true
        }
      });
      
      // 📱 إرسال الفاتورات للزبون
     await this.invoicesService.sendInvoiceToCustomer(paidInvoiceWithItems);

      return {
        order: await prisma.order.findUnique({
          where: { id: order.id },
          include: {
            customer: true,
            category: true,
            items: {
              include: {
                item: true
              }
            }
          }
        }),
        paidInvoice: paidInvoiceWithItems,
        breakInvoice: breakInvoiceWithItems,
        isBreakInvoice: true,
        message: 'تم تحويل الطلبية إلى فاتورة كسر بنجاح'
      };
    } 
    else {
      // Create standard invoice
      
      const invoice = await prisma.invoice.create({
        data: {
          invoiceNumber,
          employeeId: employeeId,
          invoiceType: 'income',
          invoiceCategory: 'products',
          customerId: order.customerId,
          paidStatus: invoiceData.paidStatus,
          totalAmount: order.totalAmount + (invoiceData?.additionalAmount || 0) - (invoiceData?.discount || 0),
          discount: invoiceData?.discount || 0,
          additionalAmount: invoiceData?.additionalAmount || 0,
          notes: invoiceData?.notes 
            ? invoiceData?.notes  : null,
          fundId: appropriateFund.id, // استخدام الصندوق المناسب
          shiftId: activeShift.id,
          paymentDate: new Date(),
          trayCount: invoiceData?.trayCount || 0,
          isBreak: false
        },
        include: {
          customer: true
        }
      });
      
      // Create invoice items separately
      for (const item of order.items) {
        await prisma.invoiceItem.create({
          data: {
            invoiceId: invoice.id,
            itemId: item.itemId,
            quantity: item.quantity,
            unitPrice: item.unitPrice,
            unit: item.unit,
            subTotal: item.quantity * item.unitPrice
          }
        });
      }
      
      // Update order with invoice ID
      const updatedOrder = await prisma.order.update({
        where: { id: order.id },
        data: { 
          invoiceId: invoice.id,
          paidStatus: invoiceData.paidStatus, 
          status: OrderStatus.delivered 

        },
        include: {
          customer: true,
          category: true,
          items: {
            include: {
              item: true
            }
          }
        }
      });
      
      if(invoiceData.paidStatus == true) {

        // Update fund balance
        await prisma.fund.update({
          where: { id: appropriateFund.id },
          data: {
            currentBalance: {
              increment: order.totalAmount - (invoiceData?.discount || 0)
            }
          }
        });
      }
        
      // Handle tray tracking if needed
      if (invoiceData?.trayCount > 0) {
        await prisma.trayTracking.create({
          data: {
            customerId: order.customerId,
            totalTrays: invoiceData.trayCount,
            status: 'pending',
            notes: `تم تسليم ${invoiceData.trayCount} صاج مع الفاتورة ${invoiceNumber}`,
            invoiceId: invoice.id
          }
        });
      }
      
      // Get the invoice with items
      const invoiceWithItems = await prisma.invoice.findUnique({
        where: { id: invoice.id },
        include: {
          items: {
            include: {
              item: true
            }
          },
          customer: true
        }
      });
      await this.invoicesService.sendInvoiceToCustomer(invoiceWithItems);

      return {
        order: updatedOrder,
        invoice: invoiceWithItems,
        isBreakInvoice: false,
        message: 'تم تحويل الطلبية إلى فاتورة بنجاح'
      };
    }
  });
}

  
  async updateOrderStatus(id: number, status: OrderStatus) {

    const existingOrder = await this.prisma.order.findUnique({
      where: { id }
    });
    
    if (!existingOrder) {
      throw new NotFoundException(`الطلبية برقم ${id} غير موجودة`);
    }
    

    const updatedOrder = await this.prisma.order.update({
      where: { id },
      data: { status },
      include: {
        customer: true,
        category: true,
        employee: {
          select: {
            username: true
          }
        },
        items: {
          include: {
            item: true
          }
        }
      }
    });
    
    return {
      ...updatedOrder,
      message: `تم تحديث حالة الطلبية إلى "${this.getStatusArabicName(status)}" بنجاح`
    };
  }
  

  async cancelOrder(id: number, employeeId: number, reason?: string) {
  // التحقق من وجود الطلبية
  const existingOrder = await this.prisma.order.findUnique({
    where: { id },
    include: {
      invoice: true,
      items: true
    }
  });
  
  if (!existingOrder) {
    throw new NotFoundException(`الطلبية برقم ${id} غير موجودة`);
  }
  
  // التحقق من أن الطلبية ليست ملغاة بالفعل
  if (existingOrder.status === OrderStatus.cancelled) {
    throw new BadRequestException('الطلبية ملغاة بالفعل');
  }
  
  // التحقق من أن الطلبية لم يتم تسليمها
  if (existingOrder.status === OrderStatus.delivered) {
    throw new BadRequestException('لا يمكن إلغاء طلبية تم تسليمها');
  }
  
  // التحقق من أن الطلبية غير مرتبطة بفاتورة مدفوعة
  if (existingOrder.invoice && existingOrder.paidStatus) {
    throw new BadRequestException('لا يمكن إلغاء طلبية مدفوعة ومرتبطة بفاتورة. يجب إلغاء الفاتورة أولاً');
  }
  
  return this.prisma.$transaction(async (prisma) => {
    // تحديث حالة الطلبية إلى ملغاة
    const cancelledOrder = await prisma.order.update({
      where: { id },
      data: {
        status: OrderStatus.cancelled,
        notes: existingOrder.notes 
          ? `${existingOrder.notes} - تم الإلغاء: ${reason || 'بدون سبب محدد'}`
          : `تم الإلغاء: ${reason || 'بدون سبب محدد'}`
      },
      include: {
        customer: true,
        category: true,
        employee: {
          select: {
            username: true
          }
        },
        items: {
          include: {
            item: true
          }
        },
        invoice: true
      }
    });
    
    // إذا كانت الطلبية مرتبطة بفاتورة غير مدفوعة، قم بإلغائها أيضاً
    if (existingOrder.invoice && !existingOrder.paidStatus) {
      await prisma.invoice.update({
        where: { id: existingOrder.invoice.id },
        data: {
          notes: existingOrder.invoice.notes 
            ? existingOrder.invoice.notes 
            : null
        }
      });
      
      // حذف عناصر الفاتورة
      await prisma.invoiceItem.deleteMany({
        where: { invoiceId: existingOrder.invoice.id }
      });
      
      // حذف الفاتورة
      await prisma.invoice.delete({
        where: { id: existingOrder.invoice.id }
      });
    }
    
    return {
      ...cancelledOrder,
      message: 'تم إلغاء الطلبية بنجاح'
    };
  });
}


  private getStatusArabicName(status: OrderStatus): string {
    const statusNames = {
      [OrderStatus.pending]: 'قيد الانتظار',
      [OrderStatus.processing]: 'قيد المعالجة',
      [OrderStatus.ready]: 'جاهزة للتسليم',
      [OrderStatus.delivered]: 'تم التسليم',
      [OrderStatus.cancelled]: 'ملغية'
    };
    
    return statusNames[status] || status;
  }
  

  async getOrdersForPreparation() {
    // Obtener la fecha de mañana en zona horaria de Siria
    const today = this.createSyriaDate();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    // Crear el rango de fechas para mañana
    const startOfTomorrow = this.getStartOfDay(tomorrow);
    const endOfTomorrow = this.getEndOfDay(tomorrow);
    
    console.log('Buscando pedidos para preparación (mañana):', {
      start: startOfTomorrow.toISOString(),
      end: endOfTomorrow.toISOString()
    });
    
    return this.prisma.order.findMany({
      where: {
        scheduledFor: {
          gte: startOfTomorrow,
          lte: endOfTomorrow
        },
        status: {
          in: [OrderStatus.pending, OrderStatus.processing]
        }
      },
      include: {
        customer: true,
        category: true,
        employee: {
          select: {
            username: true
          }
        },
        items: {
          include: {
            item: true
          }
        }
      },
      orderBy: {
        scheduledFor: 'asc'
      }
    });
  }
  
  async getOrdersForDeliveryToday() {
    // Obtener la fecha de hoy en zona horaria de Siria
    const today = this.createSyriaDate();
    
    // Crear el rango de fechas para hoy
    const startOfToday = this.getStartOfDay(today);
    const endOfToday = this.getEndOfDay(today);
    
    console.log('Buscando pedidos para entrega (hoy):', {
      start: startOfToday.toISOString(),
      end: endOfToday.toISOString()
    });
    
    return this.prisma.order.findMany({
      where: {
        scheduledFor: {
          gte: startOfToday,
          lte: endOfToday
        },
        status: {
          in: [OrderStatus.pending, OrderStatus.processing, OrderStatus.ready]
        }
      },
      include: {
        customer: true,
        category: true,
        employee: {
          select: {
            username: true
          }
        },
        items: {
          include: {
            item: true
          }
        }
      },
      orderBy: {
        scheduledFor: 'asc'
      }
    });
  }
  
  // Obtener resumen de pedidos por estado
  async getOrdersSummary() {
    // Contar pedidos por estado
    const statusCounts = await this.prisma.order.groupBy({
      by: ['status'],
      _count: {
        _all: true
      }
    });
    
    // Obtener la fecha actual en zona horaria de Siria
    const today = this.createSyriaDate();
    
    // Contar pedidos para hoy
    const startOfToday = this.getStartOfDay(today);
    const endOfToday = this.getEndOfDay(today);
    
    const todayOrders = await this.prisma.order.count({
      where: {
        scheduledFor: {
          gte: startOfToday,
          lte: endOfToday
        }
      }
    });
    
    // Contar pedidos para mañana
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    
    const startOfTomorrow = this.getStartOfDay(tomorrow);
    const endOfTomorrow = this.getEndOfDay(tomorrow);
    
    const tomorrowOrders = await this.prisma.order.count({
      where: {
        scheduledFor: {
          gte: startOfTomorrow,
          lte: endOfTomorrow
        }
      }
    });
    
    // Obtener el total de pedidos
    const totalOrders = await this.prisma.order.count();
    
    // Obtener suma total de pedidos pagados
    const totalPaidAmount = await this.prisma.order.aggregate({
      _sum: {
        totalAmount: true
      },
      where: {
        paidStatus: true
      }
    });
    
    // Generar resumen completo
    const summary = {
      total: totalOrders,
      byStatus: statusCounts.reduce((acc, curr) => {
        acc[curr.status] = curr._count._all;
        return acc;
      }, {}),
      forToday: todayOrders,
      forTomorrow: tomorrowOrders,
      totalPaidAmount: totalPaidAmount._sum.totalAmount || 0
    };
    
    return summary;
  }



  private createSyriaDate(date?: Date): Date {
    const syriaDate = date ? new Date(date) : new Date();
    
    // Ajustar a la zona horaria de Siria (UTC+3)
    // Obtener la diferencia en minutos entre la zona horaria local y UTC
    const localOffset = syriaDate.getTimezoneOffset();
    
    // La zona horaria de Siria es UTC+3, que es -180 minutos desde UTC
    const syriaOffset = -180;
    
    // Calcular la diferencia en minutos entre la zona horaria local y la de Siria
    const offsetDiff = syriaOffset - localOffset;
    
    // Ajustar la fecha sumando la diferencia en minutos
    syriaDate.setMinutes(syriaDate.getMinutes() + offsetDiff);
    
    return syriaDate;
  }

// Función para obtener el inicio de día para una fecha en Siria
private getStartOfDay(date: Date): Date {
  const syriaDate = this.createSyriaDate(date);
  return new Date(
    syriaDate.getFullYear(),
    syriaDate.getMonth(),
    syriaDate.getDate(),
    0, 0, 0
  );
}

// Función para obtener el fin de día para una fecha en Siria
private getEndOfDay(date: Date): Date {
  const syriaDate = this.createSyriaDate(date);
  return new Date(
    syriaDate.getFullYear(),
    syriaDate.getMonth(),
    syriaDate.getDate(),
    23, 59, 59
  );
}

}

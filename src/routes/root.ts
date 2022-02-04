import { FastifyPluginAsync } from 'fastify';
import {
  Product, UUID, Order, OrderStatus,
} from '@getf1tickets/sdk';
import { to } from 'await-to-js';
import { Op } from 'sequelize';
import { DateTime } from 'luxon';
import { orderCreationSchema, orderResponseSchema } from '@/schemas/order';

const root: FastifyPluginAsync = async (fastify): Promise<void> => {
  fastify.route<{
    Body: {
      products: Product[],
      addressId: UUID,
    }
  }>({
    method: 'POST',
    url: '/',
    preHandler: [
      fastify.authentication.authorize(),
      fastify.middlewares.useUser({
        useToken: true,
        includeAddresses: true,
      }),
    ],
    schema: {
      body: orderCreationSchema,
      response: {
        200: orderResponseSchema,
      },
    },
    handler: async (request, reply) => {
      // iterate through all products
      const [err, products] = await to(Product.findAll({
        where: {
          id: request.body.products.map((p) => p.id),
        },
      }));

      if (err) {
        fastify.log.error(err);
        throw fastify.httpErrors.internalServerError();
      }

      if (products.length !== request.body.products.length) {
        throw fastify.httpErrors.notFound();
      }

      if (!request.user.addresses?.find((address) => address.id === request.body.addressId)) {
        throw fastify.httpErrors.notFound();
      }

      const subtotal = products.reduce((sum, product) => {
        const { quantity } = request.body.products.find((p) => p.id === product.id) as any;
        return sum + (product.price * quantity);
      }, 0);

      const [err2, order] = await to<Order>(request.user.createOrder({
        subtotal,
        discount: 0,
        total: subtotal,
        status: OrderStatus.CREATED,
        addressId: request.body.addressId,
      }));

      if (err2) {
        fastify.log.error(err2);
        throw fastify.httpErrors.internalServerError();
      }

      for (const product of products) {
        const { quantity } = request.body.products.find((p) => p.id === product.id) as any;
        // eslint-disable-next-line no-await-in-loop
        const [err3] = await to(order.createProduct({
          quantity,
          productId: product.id,
        }));

        if (err3) {
          fastify.log.error(err3);
          throw fastify.httpErrors.internalServerError();
        }
      }

      await fastify.amqp.publish('order.crud', 'created', {
        user: request.user.toJSON(),
        order: order.toJSON(),
      });

      reply.send(order);
    },
  });

  fastify.route({
    method: 'GET',
    url: '/:id',
    preHandler: [
      fastify.authentication.authorize(),
      fastify.middlewares.useUser({
        useToken: true,
      }),
      fastify.middlewares.useOrder(),
    ],
    handler: async (request) => {
      const { order } = request;

      return {
        id: order.id,
        status: order.status,
        subtotal: order.subtotal,
        total: order.total,
        address: (order as any).address,
        products: order.products.map((product) => ({
          id: product.id,
          quantity: product.quantity,
          description: {
            name: product.product.name,
            price: product.product.price,
          },
        })),
      };
    },
  });

  fastify.route({
    method: 'GET',
    url: '/stats',
    preHandler: [
      fastify.authentication.authorize(),
      fastify.middlewares.useUser({
        useToken: true,
        shouldBeAdmin: true,
      }),
    ],
    handler: async () => {
      const date = new Date();

      const ordersThisMonth = await fastify.to500(Order.findAll({
        where: {
          status: 'completed',
          createdAt: {
            [Op.gte]: new Date(date.getFullYear(), date.getMonth(), 1).toISOString(),
          },
        } as any,
      }));

      const lastOrders = await fastify.to500(Order.findAll({
        where: {
          status: 'completed',
          createdAt: {
            [Op.gte]: DateTime.now().minus({ days: 30 }).startOf('day').toISO(),
          },
        } as any,
      }));

      const lastOrdersByDate = [];
      for (let i = 0; i <= 30; i += 1) {
        const currentDate = DateTime.now().minus({ days: (30 - i) }).startOf('day');

        lastOrdersByDate.push({
          date: currentDate.toFormat('dd/MM'),
          orders: lastOrders.filter((order) => {
            const createdAt = DateTime.fromISO(order.createdAt.toISOString());
            return createdAt.hasSame(currentDate, 'day');
          }),
        });
      }

      return {
        orderCount: ordersThisMonth.length,
        revenues: ordersThisMonth.reduce((acc, order) => acc + order.total, 0),
        lastOrders: lastOrdersByDate,
      };
    },
  });
};

export default root;

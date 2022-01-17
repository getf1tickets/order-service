import { FastifyPluginAsync } from 'fastify';
import {
  Product, UUID, Order, OrderStatus,
} from '@getf1tickets/sdk';
import { to } from 'await-to-js';
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
};

export default root;

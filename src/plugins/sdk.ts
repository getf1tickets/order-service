import fp from 'fastify-plugin';
import { registerPlugins } from '@getf1tickets/sdk';

export default fp(async (fastify) => {
  await registerPlugins(fastify);
}, {
  name: 'sdk-registration',
});

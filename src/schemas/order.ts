export const orderCreationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['products', 'addressId'],
  properties: {
    products: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'quantity'],
        properties: {
          id: { type: 'string' },
          quantity: { type: 'number' },
        },
      },
    },
    addressId: { type: 'string' },
  },
};

export const orderResponseSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    status: { type: 'string' },
  },
};

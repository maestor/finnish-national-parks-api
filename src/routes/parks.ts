import { createRoute, z } from '@hono/zod-openapi';

import { errorSchema } from '../contracts/common.js';
import {
  createVisitRequestSchema,
  parkDetailSchema,
  parkListResponseSchema,
  personalParkListResponseSchema,
  personalParkSchema,
  updateVisitRequestSchema,
  visitSchema
} from '../contracts/parks.js';
import { supportedParkTypeSlugs } from '../parks/park-types.js';

export const listParksRoute = createRoute({
  method: 'get',
  path: '/api/parks',
  tags: ['Catalog'],
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      type: z.enum(supportedParkTypeSlugs).optional()
    })
  },
  responses: {
    200: {
      description: 'Catalog park list',
      content: {
        'application/json': {
          schema: parkListResponseSchema
        }
      }
    },
    304: {
      description: 'Catalog park list not modified'
    }
  }
});

export const getParkRoute = createRoute({
  method: 'get',
  path: '/api/parks/{slug}',
  tags: ['Catalog'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      slug: z.string()
    }),
    query: z.object({
      includeBoundary: z.enum(['true', 'false']).optional()
    })
  },
  responses: {
    200: {
      description: 'Catalog park detail',
      content: {
        'application/json': {
          schema: parkDetailSchema
        }
      }
    },
    304: {
      description: 'Catalog park detail not modified'
    },
    404: {
      description: 'Park was not found',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    }
  }
});

export const listPersonalParksRoute = createRoute({
  method: 'get',
  path: '/api/me/parks',
  tags: ['Personal'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Personal park list',
      content: {
        'application/json': {
          schema: personalParkListResponseSchema
        }
      }
    }
  }
});

export const getPersonalParkRoute = createRoute({
  method: 'get',
  path: '/api/me/parks/{slug}',
  tags: ['Personal'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      slug: z.string()
    })
  },
  responses: {
    200: {
      description: 'Personal park detail',
      content: {
        'application/json': {
          schema: personalParkSchema
        }
      }
    },
    404: {
      description: 'Park was not found',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    }
  }
});

export const createVisitRoute = createRoute({
  method: 'post',
  path: '/api/me/parks/{slug}/visits',
  tags: ['Personal'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      slug: z.string()
    }),
    body: {
      content: {
        'application/json': {
          schema: createVisitRequestSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Created park visit',
      content: {
        'application/json': {
          schema: visitSchema
        }
      }
    },
    404: {
      description: 'Park was not found',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    }
  }
});

export const updateVisitRoute = createRoute({
  method: 'patch',
  path: '/api/me/visits/{id}',
  tags: ['Personal'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.coerce.number().int()
    }),
    body: {
      content: {
        'application/json': {
          schema: updateVisitRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Updated park visit',
      content: {
        'application/json': {
          schema: visitSchema
        }
      }
    },
    404: {
      description: 'Visit was not found',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    }
  }
});

export const deleteVisitRoute = createRoute({
  method: 'delete',
  path: '/api/me/visits/{id}',
  tags: ['Personal'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.coerce.number().int()
    })
  },
  responses: {
    204: {
      description: 'Deleted park visit'
    },
    404: {
      description: 'Visit was not found',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    }
  }
});

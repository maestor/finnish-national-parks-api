import { createRoute, z } from '@hono/zod-openapi';

import { errorSchema } from '../contracts/common.js';
import {
  createTripRequestSchema,
  createTripStopRequestSchema,
  tripDetailSchema,
  tripListResponseSchema,
  tripSchema,
  tripStopSchema,
  updateTripRequestSchema,
  updateTripStopRequestSchema
} from '../contracts/parks.js';

export const listTripsRoute = createRoute({
  method: 'get',
  path: '/api/trips',
  tags: ['Trips'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Trip list with derived visit counts and date ranges',
      content: {
        'application/json': {
          schema: tripListResponseSchema
        }
      }
    },
    304: {
      description: 'Trip list not modified'
    }
  }
});

export const createTripRoute = createRoute({
  method: 'post',
  path: '/api/trips',
  tags: ['Trips'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: createTripRequestSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Created trip',
      content: {
        'application/json': {
          schema: tripSchema
        }
      }
    },
    401: {
      description: 'Admin session required',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    503: {
      description: 'OAuth not configured',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    }
  }
});

export const getTripRoute = createRoute({
  method: 'get',
  path: '/api/trips/{id}',
  tags: ['Trips'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.coerce.number().int()
    })
  },
  responses: {
    200: {
      description: 'Trip detail with merged itinerary',
      content: {
        'application/json': {
          schema: tripDetailSchema
        }
      }
    },
    404: {
      description: 'Trip was not found',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    }
  }
});

export const updateTripRoute = createRoute({
  method: 'patch',
  path: '/api/trips/{id}',
  tags: ['Trips'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    params: z.object({
      id: z.coerce.number().int()
    }),
    body: {
      content: {
        'application/json': {
          schema: updateTripRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Updated trip',
      content: {
        'application/json': {
          schema: tripSchema
        }
      }
    },
    401: {
      description: 'Admin session required',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    404: {
      description: 'Trip was not found',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    503: {
      description: 'OAuth not configured',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    }
  }
});

export const createTripStopRoute = createRoute({
  method: 'post',
  path: '/api/trips/{id}/stops',
  tags: ['Trips'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    params: z.object({
      id: z.coerce.number().int()
    }),
    body: {
      content: {
        'application/json': {
          schema: createTripStopRequestSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Created trip stop',
      content: {
        'application/json': {
          schema: tripStopSchema
        }
      }
    },
    401: {
      description: 'Admin session required',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    404: {
      description: 'Trip was not found',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    422: {
      description: 'Invalid trip stop payload',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    503: {
      description: 'OAuth not configured',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    }
  }
});

export const updateTripStopRoute = createRoute({
  method: 'patch',
  path: '/api/trip-stops/{id}',
  tags: ['Trips'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    params: z.object({
      id: z.coerce.number().int()
    }),
    body: {
      content: {
        'application/json': {
          schema: updateTripStopRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Updated trip stop',
      content: {
        'application/json': {
          schema: tripStopSchema
        }
      }
    },
    401: {
      description: 'Admin session required',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    404: {
      description: 'Trip stop was not found',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    422: {
      description: 'Invalid trip stop payload',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    503: {
      description: 'OAuth not configured',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    }
  }
});

export const deleteTripStopRoute = createRoute({
  method: 'delete',
  path: '/api/trip-stops/{id}',
  tags: ['Trips'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    params: z.object({
      id: z.coerce.number().int()
    })
  },
  responses: {
    204: {
      description: 'Deleted trip stop'
    },
    401: {
      description: 'Admin session required',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    404: {
      description: 'Trip stop was not found',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    503: {
      description: 'OAuth not configured',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    }
  }
});

export const deleteTripRoute = createRoute({
  method: 'delete',
  path: '/api/trips/{id}',
  tags: ['Trips'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    params: z.object({
      id: z.coerce.number().int()
    })
  },
  responses: {
    204: {
      description: 'Deleted trip'
    },
    401: {
      description: 'Admin session required',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    404: {
      description: 'Trip was not found',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    503: {
      description: 'OAuth not configured',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    }
  }
});

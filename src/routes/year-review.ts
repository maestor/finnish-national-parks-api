import { createRoute, z } from '@hono/zod-openapi';

import { errorSchema } from '../contracts/common.js';
import {
  yearReviewPreviewSchema,
  yearReviewPublishResponseSchema,
  yearReviewShareResponseSchema
} from '../contracts/year-review.js';

const yearReviewYearParamsSchema = z.object({
  year: z.coerce.number().int().min(1900).max(2100)
});

export const getYearReviewPreviewRoute = createRoute({
  method: 'get',
  path: '/api/year-review/{year}/preview',
  tags: ['Year Review'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    params: yearReviewYearParamsSchema
  },
  responses: {
    200: {
      description: 'Generated admin preview for a year review',
      content: {
        'application/json': {
          schema: yearReviewPreviewSchema
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

export const publishYearReviewRoute = createRoute({
  method: 'post',
  path: '/api/year-review/{year}/publish',
  tags: ['Year Review'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    params: yearReviewYearParamsSchema
  },
  responses: {
    200: {
      description: 'Published year review share snapshot',
      content: {
        'application/json': {
          schema: yearReviewPublishResponseSchema
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

export const unpublishYearReviewRoute = createRoute({
  method: 'delete',
  path: '/api/year-review/{year}/publish',
  tags: ['Year Review'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    params: yearReviewYearParamsSchema
  },
  responses: {
    204: {
      description: 'Removed the published year review share'
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
      description: 'Published year review share was not found',
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

export const getYearReviewShareRoute = createRoute({
  method: 'get',
  path: '/api/year-review/shares/{shareId}',
  tags: ['Year Review'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      shareId: z.string().uuid()
    })
  },
  responses: {
    200: {
      description: 'Published year review share snapshot for trusted callers',
      content: {
        'application/json': {
          schema: yearReviewShareResponseSchema
        }
      }
    },
    401: {
      description: 'API key required for non-localhost callers',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    404: {
      description: 'Published year review share was not found',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    }
  }
});

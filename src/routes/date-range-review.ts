import { createRoute, z } from '@hono/zod-openapi';

import { errorSchema } from '../contracts/common.js';
import {
  dateRangeReviewPreviewQuerySchema,
  dateRangeReviewPreviewSchema,
  dateRangeReviewPublishRequestSchema,
  dateRangeReviewPublishResponseSchema,
  dateRangeReviewShareResponseSchema,
  dateRangeReviewUnpublishQuerySchema
} from '../contracts/date-range-review.js';

export const getDateRangeReviewPreviewRoute = createRoute({
  method: 'get',
  path: '/api/date-range-review/preview',
  tags: ['Date Range Review'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    query: dateRangeReviewPreviewQuerySchema
  },
  responses: {
    200: {
      description: 'Generated admin preview for a named date range review',
      content: {
        'application/json': {
          schema: dateRangeReviewPreviewSchema
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
    409: {
      description: 'Overview name is already bound to a different date range',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    422: {
      description: 'Date range review request is not valid for generation',
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

export const publishDateRangeReviewRoute = createRoute({
  method: 'post',
  path: '/api/date-range-review/publish',
  tags: ['Date Range Review'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    body: {
      content: {
        'application/json': {
          schema: dateRangeReviewPublishRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Published named date range review share snapshot',
      content: {
        'application/json': {
          schema: dateRangeReviewPublishResponseSchema
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
    409: {
      description: 'Overview name is already bound to a different date range',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    422: {
      description: 'Date range review request is not valid for generation',
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

export const unpublishDateRangeReviewRoute = createRoute({
  method: 'delete',
  path: '/api/date-range-review/publish',
  tags: ['Date Range Review'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    query: dateRangeReviewUnpublishQuerySchema
  },
  responses: {
    204: {
      description: 'Removed the published named date range review share'
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
      description: 'Published date range review share was not found',
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

export const getDateRangeReviewShareRoute = createRoute({
  method: 'get',
  path: '/api/date-range-review/shares/{shareId}',
  tags: ['Date Range Review'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      shareId: z.string().uuid()
    })
  },
  responses: {
    200: {
      description: 'Published named date range review share snapshot for trusted callers',
      content: {
        'application/json': {
          schema: dateRangeReviewShareResponseSchema
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
      description: 'Published date range review share was not found',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    }
  }
});

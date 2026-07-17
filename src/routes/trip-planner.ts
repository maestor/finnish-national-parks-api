import { createRoute } from '@hono/zod-openapi';
import { errorSchema } from '../contracts/common.js';
import {
  tripPlannerErrorSchema,
  tripPlannerNearbyRequestSchema,
  tripPlannerNearbyResponseSchema,
  tripPlannerSearchRequestSchema,
  tripPlannerSearchResponseSchema,
  tripPlannerSuggestionsRequestSchema,
  tripPlannerSuggestionsResponseSchema
} from '../contracts/trip-planner.js';

export const suggestTripPlannerRoute = createRoute({
  method: 'post',
  path: '/api/trip-planner/suggestions',
  request: {
    body: {
      content: {
        'application/json': {
          schema: tripPlannerSuggestionsRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: tripPlannerSuggestionsResponseSchema
        }
      },
      description: 'Trip planner place suggestions'
    },
    401: {
      content: {
        'application/json': {
          schema: errorSchema
        }
      },
      description: 'Bearer token required outside localhost'
    },
    503: {
      content: {
        'application/json': {
          schema: tripPlannerErrorSchema
        }
      },
      description: 'Trip planner provider is unavailable or not configured'
    }
  },
  security: [{ bearerAuth: [] }],
  tags: ['Trip planner']
});

export const searchTripPlannerRoute = createRoute({
  method: 'post',
  path: '/api/trip-planner/search',
  request: {
    body: {
      content: {
        'application/json': {
          schema: tripPlannerSearchRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: tripPlannerSearchResponseSchema
        }
      },
      description: 'Trip planner search results near the routed path'
    },
    401: {
      content: {
        'application/json': {
          schema: errorSchema
        }
      },
      description: 'Bearer token required outside localhost'
    },
    422: {
      content: {
        'application/json': {
          schema: tripPlannerErrorSchema
        }
      },
      description: 'Origin, destination, or route could not be resolved'
    },
    503: {
      content: {
        'application/json': {
          schema: tripPlannerErrorSchema
        }
      },
      description: 'Trip planner provider is unavailable or not configured'
    }
  },
  security: [{ bearerAuth: [] }],
  tags: ['Trip planner']
});

export const searchNearbyTripPlannerRoute = createRoute({
  method: 'post',
  path: '/api/trip-planner/nearby',
  request: {
    body: {
      content: {
        'application/json': {
          schema: tripPlannerNearbyRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: tripPlannerNearbyResponseSchema
        }
      },
      description: 'Trip planner nearby-origin results around a single point'
    },
    401: {
      content: {
        'application/json': {
          schema: errorSchema
        }
      },
      description: 'Bearer token required outside localhost'
    },
    422: {
      content: {
        'application/json': {
          schema: tripPlannerErrorSchema
        }
      },
      description: 'Origin could not be resolved'
    },
    503: {
      content: {
        'application/json': {
          schema: tripPlannerErrorSchema
        }
      },
      description: 'Trip planner provider is unavailable or not configured'
    }
  },
  security: [{ bearerAuth: [] }],
  tags: ['Trip planner']
});

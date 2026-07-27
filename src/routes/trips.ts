import { createRoute, z } from '@hono/zod-openapi';

import { errorSchema } from '../contracts/common.js';
import {
  completeDirectVisitImageUploadRequestSchema,
  completeDirectVisitImageUploadResponseSchema,
  createTripRequestSchema,
  createTripStopRequestSchema,
  directVisitImageUploadPlanSchema,
  directVisitImageUploadRequestSchema,
  publicTripDetailSchema,
  reorderVisitImagesRequestSchema,
  tripDetailSchema,
  tripListResponseSchema,
  tripSchema,
  tripStopSchema,
  updateTripRequestSchema,
  updateTripStopRequestSchema,
  visitImageSchema
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

export const getTripBySlugRoute = createRoute({
  method: 'get',
  path: '/api/trips/slug/{slug}',
  tags: ['Trips'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      slug: z.string().trim().min(1)
    })
  },
  responses: {
    200: {
      description: 'Page-ready trip detail by slug',
      content: {
        'application/json': {
          schema: publicTripDetailSchema
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

export const createTripStopImageUploadUrlRoute = createRoute({
  method: 'post',
  path: '/api/trip-stops/{id}/images/upload-url',
  tags: ['Trips'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    params: z.object({
      id: z.coerce.number().int()
    }),
    body: {
      content: {
        'application/json': {
          schema: directVisitImageUploadRequestSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Created a direct upload plan for one trip stop image',
      content: {
        'application/json': {
          schema: directVisitImageUploadPlanSchema
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
    413: {
      description: 'Declared file size exceeds the allowed upload limit',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    422: {
      description: 'Invalid upload request',
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

export const completeTripStopImageUploadRoute = createRoute({
  method: 'post',
  path: '/api/trip-stops/{id}/images/complete',
  tags: ['Trips'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    params: z.object({
      id: z.coerce.number().int()
    }),
    body: {
      content: {
        'application/json': {
          schema: completeDirectVisitImageUploadRequestSchema
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Stored one directly uploaded trip stop image',
      content: {
        'application/json': {
          schema: completeDirectVisitImageUploadResponseSchema
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
      description: 'Upload is missing or invalid',
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

export const uploadTripStopImagesRoute = createRoute({
  method: 'post',
  path: '/api/trip-stops/{id}/images',
  tags: ['Trips'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    params: z.object({
      id: z.coerce.number().int()
    }),
    body: {
      content: {
        'multipart/form-data': {
          schema: z.object({
            images: z.any().openapi({ type: 'string', format: 'binary' })
          })
        }
      }
    }
  },
  responses: {
    201: {
      description: 'Uploaded trip stop images',
      content: {
        'application/json': {
          schema: z.object({
            errors: z.array(
              z.object({
                originalName: z.string(),
                reason: z.string()
              })
            ),
            images: z.array(visitImageSchema)
          })
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
    400: {
      description: 'No images provided',
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
    413: {
      description: 'File too large',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    501: {
      description: 'Server-side multipart uploads are disabled for this runtime',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    422: {
      description: 'Invalid file type, image limit, or all uploads failed',
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

export const deleteTripStopImageRoute = createRoute({
  method: 'delete',
  path: '/api/trip-stops/{tripStopId}/images/{imageId}',
  tags: ['Trips'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    params: z.object({
      imageId: z.coerce.number().int(),
      tripStopId: z.coerce.number().int()
    })
  },
  responses: {
    204: {
      description: 'Deleted trip stop image'
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
      description: 'Image or trip stop was not found',
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

export const reorderTripStopImagesRoute = createRoute({
  method: 'patch',
  path: '/api/trip-stops/{id}/images/reorder',
  tags: ['Trips'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    params: z.object({
      id: z.coerce.number().int()
    }),
    body: {
      content: {
        'application/json': {
          schema: reorderVisitImagesRequestSchema
        }
      }
    }
  },
  responses: {
    204: {
      description: 'Reordered trip stop images'
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
      description: 'Invalid image order',
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

import { createRoute, z } from '@hono/zod-openapi';

import { errorSchema } from '../contracts/common.js';
import {
  adminParkVisibilityResponseSchema,
  completeDirectVisitImageUploadRequestSchema,
  completeDirectVisitImageUploadResponseSchema,
  createVisitRequestSchema,
  directVisitImageUploadPlanSchema,
  directVisitImageUploadRequestSchema,
  parkDetailSchema,
  parkListResponseSchema,
  parkSearchResponseSchema,
  parkVisitsResponseSchema,
  publicHomeSummaryResponseSchema,
  publicMapSummaryResponseSchema,
  reorderVisitImagesRequestSchema,
  updateParkRemovedRequestSchema,
  updateParkRequestSchema,
  updateVisitRequestSchema,
  visitImageSchema,
  visitListResponseSchema,
  visitSchema,
  visitTimelineResponseSchema,
  visitWithParkSchema
} from '../contracts/parks.js';
import { supportedParkCategorySlugs, supportedParkTypeSlugs } from '../parks/park-types.js';

export const listParksRoute = createRoute({
  method: 'get',
  path: '/api/parks',
  tags: ['Catalog'],
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      category: z.enum(supportedParkCategorySlugs).optional(),
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

export const updateParkRoute = createRoute({
  method: 'patch',
  path: '/api/parks/{slug}',
  tags: ['Parks'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    params: z.object({
      slug: z.string()
    }),
    body: {
      content: {
        'application/json': {
          schema: updateParkRequestSchema
        }
      }
    }
  },
  responses: {
    200: {
      description: 'Updated park detail',
      content: {
        'application/json': {
          schema: parkDetailSchema
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
    },
    404: {
      description: 'Park was not found',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    409: {
      description: 'Requested park slug is already in use',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    },
    422: {
      description: 'Invalid park update payload',
      content: {
        'application/json': {
          schema: errorSchema
        }
      }
    }
  }
});

export const listParkSearchRoute = createRoute({
  method: 'get',
  path: '/api/parks/search',
  tags: ['Catalog'],
  security: [{ bearerAuth: [] }],
  request: {
    query: z.object({
      category: z.enum(supportedParkCategorySlugs).optional(),
      type: z.enum(supportedParkTypeSlugs).optional()
    })
  },
  responses: {
    200: {
      description: 'Lightweight catalog park search list',
      content: {
        'application/json': {
          schema: parkSearchResponseSchema
        }
      }
    },
    304: {
      description: 'Catalog park search list not modified'
    }
  }
});

export const listAdminParkVisibilityRoute = createRoute({
  method: 'get',
  path: '/api/admin/parks/visibility',
  tags: ['Parks'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  responses: {
    200: {
      description: 'Lightweight visible and removed parks for admin visibility management',
      content: {
        'application/json': {
          schema: adminParkVisibilityResponseSchema
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

export const getParkVisitsRoute = createRoute({
  method: 'get',
  path: '/api/parks/{slug}/visits',
  tags: ['Visits'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      slug: z.string()
    })
  },
  responses: {
    200: {
      description: 'Park visit history',
      content: {
        'application/json': {
          schema: parkVisitsResponseSchema
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

export const getPublicHomeSummaryRoute = createRoute({
  method: 'get',
  path: '/api/home-summary',
  tags: ['Frontend'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Frontend visit summary for the home page',
      content: {
        'application/json': {
          schema: publicHomeSummaryResponseSchema
        }
      }
    },
    304: {
      description: 'Home summary not modified'
    }
  }
});

export const getPublicMapSummaryRoute = createRoute({
  method: 'get',
  path: '/api/map-summary',
  tags: ['Frontend'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Frontend park and visit summary for the map page',
      content: {
        'application/json': {
          schema: publicMapSummaryResponseSchema
        }
      }
    },
    304: {
      description: 'Map summary not modified'
    }
  }
});

export const listVisitsTimelineRoute = createRoute({
  method: 'get',
  path: '/api/visits-timeline',
  tags: ['Frontend'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Frontend visits timeline dataset',
      content: {
        'application/json': {
          schema: visitTimelineResponseSchema
        }
      }
    },
    304: {
      description: 'Visits timeline not modified'
    }
  }
});

export const listVisitsRoute = createRoute({
  method: 'get',
  path: '/api/visits',
  tags: ['Visits'],
  security: [{ bearerAuth: [] }],
  responses: {
    200: {
      description: 'Visit list',
      content: {
        'application/json': {
          schema: visitListResponseSchema
        }
      }
    }
  }
});

export const getVisitRoute = createRoute({
  method: 'get',
  path: '/api/visits/{id}',
  tags: ['Visits'],
  security: [{ bearerAuth: [] }],
  request: {
    params: z.object({
      id: z.coerce.number().int()
    })
  },
  responses: {
    200: {
      description: 'Visit detail',
      content: {
        'application/json': {
          schema: visitWithParkSchema
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

export const createVisitRoute = createRoute({
  method: 'post',
  path: '/api/parks/{slug}/visits',
  tags: ['Visits'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
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
    401: {
      description: 'Admin session required',
      content: {
        'application/json': {
          schema: errorSchema
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
    },
    422: {
      description: 'Visit payload is invalid for the requested trip ordering',
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

export const updateParkRemovedRoute = createRoute({
  method: 'patch',
  path: '/api/parks/{slug}/removed',
  tags: ['Parks'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    params: z.object({
      slug: z.string()
    }),
    body: {
      content: {
        'application/json': {
          schema: updateParkRemovedRequestSchema
        }
      }
    }
  },
  responses: {
    204: {
      description: 'Updated park removed state'
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
      description: 'Park was not found',
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

export const updateVisitRoute = createRoute({
  method: 'patch',
  path: '/api/visits/{id}',
  tags: ['Visits'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
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
    401: {
      description: 'Admin session required',
      content: {
        'application/json': {
          schema: errorSchema
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
    },
    422: {
      description: 'Visit payload is invalid for the requested trip ordering',
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

export const deleteVisitRoute = createRoute({
  method: 'delete',
  path: '/api/visits/{id}',
  tags: ['Visits'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    params: z.object({
      id: z.coerce.number().int()
    })
  },
  responses: {
    204: {
      description: 'Deleted park visit'
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
      description: 'Visit was not found',
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

export const createVisitImageUploadUrlRoute = createRoute({
  method: 'post',
  path: '/api/visits/{id}/images/upload-url',
  tags: ['Visits'],
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
      description: 'Created a direct upload plan for one visit image',
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
      description: 'Visit was not found',
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

export const completeVisitImageUploadRoute = createRoute({
  method: 'post',
  path: '/api/visits/{id}/images/complete',
  tags: ['Visits'],
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
      description: 'Stored one directly uploaded visit image',
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
      description: 'Visit was not found',
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

export const uploadVisitImagesRoute = createRoute({
  method: 'post',
  path: '/api/visits/{id}/images',
  tags: ['Visits'],
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
      description: 'Uploaded visit images',
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
      description: 'Visit was not found',
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
      description: 'Invalid file type or all uploads failed',
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

export const deleteVisitImageRoute = createRoute({
  method: 'delete',
  path: '/api/visits/{visitId}/images/{imageId}',
  tags: ['Visits'],
  security: [{ bearerAuth: [], sessionAuth: [] }],
  request: {
    params: z.object({
      imageId: z.coerce.number().int(),
      visitId: z.coerce.number().int()
    })
  },
  responses: {
    204: {
      description: 'Deleted visit image'
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
      description: 'Image or visit was not found',
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

export const reorderVisitImagesRoute = createRoute({
  method: 'patch',
  path: '/api/visits/{id}/images/reorder',
  tags: ['Visits'],
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
      description: 'Reordered visit images'
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
      description: 'Visit was not found',
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

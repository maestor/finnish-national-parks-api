import { createRoute, z } from '@hono/zod-openapi';

import { errorSchema } from '../contracts/common.js';
import {
  createVisitRequestSchema,
  parkDetailSchema,
  parkListResponseSchema,
  parkVisitsResponseSchema,
  publicHomeSummaryResponseSchema,
  publicMapSummaryResponseSchema,
  reorderVisitImagesRequestSchema,
  updateParkRemovedRequestSchema,
  updateVisitRequestSchema,
  visitImageSchema,
  visitListResponseSchema,
  visitSchema,
  visitWithParkSchema
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
  path: '/api/public/home-summary',
  tags: ['Public'],
  responses: {
    200: {
      description: 'Public visit summary for the home page',
      content: {
        'application/json': {
          schema: publicHomeSummaryResponseSchema
        }
      }
    },
    304: {
      description: 'Public home summary not modified'
    }
  }
});

export const getPublicMapSummaryRoute = createRoute({
  method: 'get',
  path: '/api/public/map-summary',
  tags: ['Public'],
  responses: {
    200: {
      description: 'Public park and visit summary for the map page',
      content: {
        'application/json': {
          schema: publicMapSummaryResponseSchema
        }
      }
    },
    304: {
      description: 'Public map summary not modified'
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

export const updateParkRemovedRoute = createRoute({
  method: 'patch',
  path: '/api/parks/{slug}/removed',
  tags: ['Parks'],
  security: [{ bearerAuth: [] }],
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
  path: '/api/visits/{id}',
  tags: ['Visits'],
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
  path: '/api/visits/{id}',
  tags: ['Visits'],
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

export const uploadVisitImagesRoute = createRoute({
  method: 'post',
  path: '/api/visits/{id}/images',
  tags: ['Visits'],
  security: [{ bearerAuth: [] }],
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
    422: {
      description: 'Invalid file type or all uploads failed',
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
  security: [{ bearerAuth: [] }],
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
    404: {
      description: 'Image or visit was not found',
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
  security: [{ bearerAuth: [] }],
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
    }
  }
});

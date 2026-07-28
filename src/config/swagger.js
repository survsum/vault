/**
 * Swagger/OpenAPI Configuration
 * 
 * Why Swagger?
 * 1. Auto-generates interactive API documentation
 * 2. Allows testing endpoints directly from the browser
 * 3. Serves as a contract between frontend and backend teams
 * 4. Self-documenting - code comments become documentation
 * 
 * Access at: http://localhost:3000/api-docs
 */

const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Digital Evidence Vault API',
      version: '1.0.0',
      description: `
# Digital Evidence Vault

A secure backend system for law enforcement agencies and forensic investigators to:
- Securely upload and store digital evidence
- Maintain complete chain of custody
- Verify evidence integrity using SHA-256 hashing
- Manage cases and investigations
- Generate audit logs for all actions

## Authentication

This API uses JWT (JSON Web Tokens) for authentication. Include the token in the Authorization header:

\`\`\`
Authorization: Bearer <your-access-token>
\`\`\`

## Rate Limiting

- General endpoints: 100 requests per 15 minutes
- Authentication endpoints: 10 requests per 15 minutes

## Error Responses

All errors follow this format:
\`\`\`json
{
  "success": false,
  "message": "Error description",
  "errors": [] // Optional validation errors
}
\`\`\`
      `,
      contact: {
        name: 'Digital Evidence Vault Support',
        email: 'support@evidence-vault.com'
      },
      license: {
        name: 'MIT',
        url: 'https://opensource.org/licenses/MIT'
      }
    },
    servers: [
      {
        url: 'http://localhost:3000/api/v1',
        description: 'Development server'
      },
      {
        url: 'https://api.evidence-vault.com/api/v1',
        description: 'Production server'
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token'
        }
      },
      schemas: {
        Error: {
          type: 'object',
          properties: {
            success: {
              type: 'boolean',
              example: false
            },
            message: {
              type: 'string',
              example: 'An error occurred'
            },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  message: { type: 'string' }
                }
              }
            }
          }
        },
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 10 },
            total: { type: 'integer', example: 100 },
            totalPages: { type: 'integer', example: 10 }
          }
        }
      },
      responses: {
        UnauthorizedError: {
          description: 'Access token is missing or invalid',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Unauthorized: No token provided'
              }
            }
          }
        },
        ForbiddenError: {
          description: 'User does not have permission to perform this action',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Forbidden: Insufficient permissions'
              }
            }
          }
        },
        ValidationError: {
          description: 'Request validation failed',
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/Error'
              },
              example: {
                success: false,
                message: 'Validation failed',
                errors: [
                  { field: 'email', message: 'Invalid email format' }
                ]
              }
            }
          }
        }
      }
    },
    tags: [
      {
        name: 'Authentication',
        description: 'User authentication and authorization'
      },
      {
        name: 'Users',
        description: 'User management (Admin only)'
      },
      {
        name: 'Cases',
        description: 'Case management'
      },
      {
        name: 'Evidence',
        description: 'Evidence upload, download, and management'
      },
      {
        name: 'Audit Logs',
        description: 'Chain of custody audit trail'
      },
      {
        name: 'Notifications',
        description: 'User notifications'
      },
      {
        name: 'Dashboard',
        description: 'Statistics and reports'
      }
    ]
  },
  apis: [
    './src/routes/*.js',
    './src/validators/*.js'
  ]
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;

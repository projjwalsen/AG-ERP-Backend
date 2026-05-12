import swaggerJsdoc from "swagger-jsdoc";

export const swaggerSpec = swaggerJsdoc({
  definition: {
    openapi: "3.0.0",
    info: {
      title: "ERP Backend API",
      version: "1.0.0",
      description: "API documentation for ERP backend"
    },
    servers: [
      {
        url: "http://localhost:5100",
        description: "Local development server"
      }
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT"
        }
      },
      schemas: {
        SuccessResponse: {
          type: "object",
          properties: {
            status: {
              type: "boolean",
              example: true
            },
            message: {
              type: "string",
              example: "Operation successful"
            },
            data: {
              type: "object"
            }
          }
        },
        ErrorResponse: {
          type: "object",
          properties: {
            status: {
              type: "boolean",
              example: false
            },
            message: {
              type: "string",
              example: "Something went wrong"
            },
            errors: {
              type: "array",
              items: {
                type: "object"
              }
            }
          }
        }
      }
    }
  },
  apis: ["./src/**/*.ts"]
});
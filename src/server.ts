import express from 'express';
import cors from 'cors';
import { httpLogger, logger } from './config/logger';
import { errorHandler } from './core/middleware/errorHandler';
import { prisma } from './config/db';
import dotenv from 'dotenv';
import { apiReference } from '@scalar/express-api-reference';
import { swaggerSpec } from './core/docs/swagger';
import cookieParser from 'cookie-parser';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.use(httpLogger);


app.use(
  '/docs',
  apiReference({
    content: swaggerSpec
  })
);

// Health check
/**
 * @openapi
 * /health:
 *   get:
 *     tags:
 *       - Health
 *     summary: Check server health
 *     description: Returns basic API health status for ERP backend.
 *     responses:
 *       200:
 *         description: Server is running successfully
 *         content:
 *           application/json:
 *             example:
 *               status: true
 *               message: ERP backend is running
 *               timestamp: 2026-05-12T10:00:00.000Z
 */
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Routes (placeholder - add your routes here)
// app.use('/api/v1/users', userRoutes);
// app.use('/api/v1/products', productRoutes);

// Global error handler
app.use(errorHandler);

const startServer = async () => {
  try {
    // Test database connection
    await prisma.$connect();
    logger.info('Database connected successfully');

    app.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`);
    });
  } catch (error) {
    logger.error({ err: error }, 'Failed to start server');
    process.exit(1);
  }
};

startServer();

export default app;
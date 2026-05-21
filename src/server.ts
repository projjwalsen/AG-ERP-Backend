import app from './app';
import { prisma } from './config/db';
import { logger } from './config/logger';

const PORT = process.env.PORT || 3000;

const startServer = async () => {
  try {
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
import dotenv from 'dotenv';
dotenv.config();

import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';

import { httpLogger } from './config/logger';
import { errorHandler } from './core/middleware/errorHandler';
import { apiReference } from '@scalar/express-api-reference';
import { swaggerSpec } from './core/docs/swagger';

import routes from './routes/index';

const app = express();

app.use(cors({
  origin: [
    process.env.FRONTEND_URL!,
    "http://localhost:3000",
  ],
  credentials: true,
}));

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

app.get('/health', (_, res) => {
  res.status(200).json({
    status: "ok"
  });
});

app.use('/api', routes);

app.use(errorHandler);

export default app;
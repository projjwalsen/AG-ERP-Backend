import pino from 'pino';
import pinoHttp from 'pino-http';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV !== 'PROD' ? {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname,req,res,responseTime',
    },
  } : undefined,
});

const getIp = (req: any) => {
  const forwardedFor = req.headers["x-forwarded-for"];

  if (typeof forwardedFor === "string") {
    return forwardedFor.split(",")[0].trim();
  }

  return req.ip || req.socket?.remoteAddress || "unknown";
};

const httpLogger = pinoHttp({
  logger,

  autoLogging: true,

  customSuccessMessage: (req, res, responseTime) => {
    return `${req.method} ${req.url} ${res.statusCode} - ${getIp(req)} took ${responseTime} ms`;
  },

  customErrorMessage: (req, res, responseTime) => {
    return `${req.method} ${req.url} ${res.statusCode} - ${getIp(req)} took ${responseTime} ms`;
  },

  serializers: {
    req() {
      return undefined;
    },
    res() {
      return undefined;
    },
  },
});

export { logger, httpLogger };
import pino from 'pino';

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  formatters: {
    level: (label) => {
      return { level: label };
    },
  },
});

// Performance-optimized logging functions
export const logDetectedPool = (mintAddress: string, source: string) => {
  logger.info({
    code: 'DETECTED_POOL',
    mintAddress,
    source,
    timestamp: Date.now()
  });
};

export const logSkipFilter = (filterName: string, mintAddress: string, reason: string, score?: number) => {
  logger.info({
    code: `SKIP_${filterName.toUpperCase()}`,
    mintAddress,
    reason,
    score,
    timestamp: Date.now()
  });
};

export const logBuySuccess = (mintAddress: string, amount: number, price: number, txSignature: string) => {
  logger.info({
    code: 'BUY_SUCCESS',
    mintAddress,
    amount,
    price,
    txSignature,
    timestamp: Date.now()
  });
};

export const logBuyError = (mintAddress: string, error: string) => {
  logger.error({
    code: 'BUY_ERROR',
    mintAddress,
    error,
    timestamp: Date.now()
  });
};

export const logSellSuccess = (mintAddress: string, reason: string, pnl: number, txSignature: string) => {
  logger.info({
    code: `SELL_${reason}`,
    mintAddress,
    pnl,
    txSignature,
    timestamp: Date.now()
  });
};

export const logPerformanceMetric = (metrics: any) => {
  logger.info({
    code: 'PERFORMANCE_METRIC',
    ...metrics,
    timestamp: Date.now()
  });
};

export const logHealthCheck = (component: string, status: string, latency?: number) => {
  logger.info({
    code: 'HEALTH_CHECK',
    component,
    status,
    latency,
    timestamp: Date.now()
  });
};

export const logCircuitBreaker = (reason: string, details: any) => {
  logger.error({
    code: 'CIRCUIT_BREAKER',
    reason,
    ...details,
    timestamp: Date.now()
  });
};

export default logger;
import dotenv from 'dotenv';
import { Config } from '../types/index.js';

console.log('🔧 Config: Loading environment variables...');
dotenv.config();
console.log('✅ Config: Environment variables loaded');

export const config: Config = {
  // Environment
  nodeEnv: process.env.NODE_ENV || 'development',
  logLevel: process.env.LOG_LEVEL || 'info',
  
  // RPC Configuration - WORKING ENDPOINTS ONLY
  rpcEndpoints: [
    process.env.RPC_ENDPOINT_1 || 'https://mainnet.helius-rpc.com/?api-key=7c8922d6-1031-42c1-b4ee-bf5daa29abd4',
    process.env.RPC_ENDPOINT_2 || 'https://vivianne-2tu8xb-fast-mainnet.helius-rpc.com',
    process.env.RPC_ENDPOINT_3 || 'https://mainnet.helius-rpc.com/?api-key=7c8922d6-1031-42c1-b4ee-bf5daa29abd4',
    process.env.RPC_ENDPOINT_4 || 'https://mainnet.helius-rpc.com/?api-key=7c8922d6-1031-42c1-b4ee-bf5daa29abd4'
  ].filter(Boolean) as string[],
  rpcTimeout: parseInt(process.env.RPC_TIMEOUT || '3000'),
  rpcRateLimit: parseInt(process.env.RPC_RATE_LIMIT || '500'),
  rpcBatchSize: parseInt(process.env.RPC_BATCH_SIZE || '50'),
  rpcKeepAlive: process.env.RPC_KEEP_ALIVE === 'true',
  
  // CONSERVATIVE Performance Settings
  maxConcurrentTrades: parseInt(process.env.MAX_CONCURRENT_TRADES || '5'), // Conservative: 5 max
  maxConcurrentFilters: parseInt(process.env.MAX_CONCURRENT_FILTERS || '10'), // Reduced load
  maxPositions: parseInt(process.env.MAX_POSITIONS || '5'), // Conservative: 5 max positions
  workerThreads: parseInt(process.env.WORKER_THREADS || '2'), // Reduced for stability
  memoryLimit: parseInt(process.env.MEMORY_LIMIT || '1024'), // Conservative memory
  cpuLimit: parseInt(process.env.CPU_LIMIT || '60'), // Conservative CPU usage
  
  // Rate Limiting
  jupiterRateLimit: parseInt(process.env.JUPITER_RATE_LIMIT || '0'), // DISABLED - use only Helius RPC
  dexScreenerRateLimit: parseInt(process.env.DEXSCREENER_RATE_LIMIT || '100'),
  apiRateLimit: parseInt(process.env.API_RATE_LIMIT || '1000'),
  
  // Jupiter API Configuration
  jupiterApiKey: process.env.JUPITER_API_KEY || '', // Optional but improves rate limits
  jupiterApiUrl: process.env.JUPITER_API_URL || 'https://quote-api.jup.ag/v6',
  
  enableRaydiumFallback: process.env.ENABLE_RAYDIUM_FALLBACK !== 'false', // ENABLED - primary liquidity source
  maxTokensPerSecond: parseInt(process.env.MAX_TOKENS_PER_SECOND || '2'),
  skipDexScreenerWhenRateLimited: process.env.SKIP_DEXSCREENER_WHEN_RATE_LIMITED !== 'false',
  
  // Caching
  cacheTtlMetadata: parseInt(process.env.CACHE_TTL_METADATA || '300'),
  cacheTtlPool: parseInt(process.env.CACHE_TTL_POOL || '60'),
  cacheTtlPrice: parseInt(process.env.CACHE_TTL_PRICE || '30'),
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  
  // CONSERVATIVE Trading Configuration
  quoteAmount: parseFloat(process.env.QUOTE_AMOUNT || '0.00001'), // MINIMAL: 0.00001 SOL
  slippageLimit: parseFloat(process.env.SLIPPAGE_LIMIT || '10'), // Conservative slippage
  maxSlippage: parseFloat(process.env.MAX_SLIPPAGE || '15'), // Lower max slippage
  takeProfit: parseFloat(process.env.TAKE_PROFIT || '50'), // 50% take profit
  stopLoss: parseFloat(process.env.STOP_LOSS || '25'), // 25% stop loss
  ttlMinutes: parseInt(process.env.TTL_MINUTES || '3'), // Shorter TTL: 3 minutes
  
  // CONSERVATIVE Filters - ALL ENABLED FOR SAFETY
  enableRouteGate: process.env.ENABLE_ROUTE_GATE !== 'false', // Default enabled
  enableOnChain: process.env.ENABLE_ON_CHAIN !== 'false', // Default enabled  
  enableDexScreener: process.env.ENABLE_DEXSCREENER !== 'false', // Default enabled
  riskThreshold: parseInt(process.env.RISK_THRESHOLD || '30'), // LOWERED for testing - allow more tokens through
  filterTimeout: parseInt(process.env.FILTER_TIMEOUT || '10000'), // Увеличено до 10 сек
  
  paperMode: false, // LIVE TRADING ONLY
  testMode: false, // NO TEST MODE
  dryRun: false, // NO DRY RUN
  
  // Monitoring
  enableMetrics: process.env.ENABLE_METRICS === 'true',
  metricsPort: parseInt(process.env.METRICS_PORT || '9090'),
  healthCheckInterval: parseInt(process.env.HEALTH_CHECK_INTERVAL || '5000'),
  performanceLogInterval: parseInt(process.env.PERFORMANCE_LOG_INTERVAL || '10000'),
  
  // Wallet Configuration
  walletPrivateKeyPath: process.env.WALLET_PRIVATE_KEY_PATH || './wallets/wallet.json',
  walletPassphrase: process.env.WALLET_PASSPHRASE || '',
  
  // API Configuration
  apiPort: parseInt(process.env.API_PORT || '3001'),
  apiHost: process.env.API_HOST || 'localhost',
  enableApi: process.env.ENABLE_API !== 'false', // Default enabled for monitoring
  corsOrigin: process.env.CORS_ORIGIN || '*',
  
  // Database
  dbPath: process.env.DB_PATH || './data/bot.db',
  dbBackupInterval: parseInt(process.env.DB_BACKUP_INTERVAL || '3600000'),
  
  // Notifications
  telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || '',
  telegramChatId: process.env.TELEGRAM_CHAT_ID || '',
  discordWebhookUrl: process.env.DISCORD_WEBHOOK_URL || '',
  enableNotifications: process.env.ENABLE_NOTIFICATIONS === 'true',
  
  circuitBreakerMaxFailures: parseInt(process.env.CIRCUIT_BREAKER_MAX_FAILURES || '5'), // Conservative: 5 failures
  dailyLossLimit: parseFloat(process.env.DAILY_LOSS_LIMIT || '0.01'), // MINIMAL: 0.01 SOL daily loss
  maxExposure: parseFloat(process.env.MAX_EXPOSURE || '0.05'), // MINIMAL: 0.05 SOL max exposure
  reserveSol: parseFloat(process.env.RESERVE_SOL || '0.005'), // MINIMAL: 0.005 SOL reserve
  
  maxPriceImpact: parseFloat(process.env.MAX_PRICE_IMPACT || '10'), // Conservative: Max 10% price impact
  minPoolSize: parseFloat(process.env.MIN_POOL_SIZE || '1.0'), // Conservative: Minimum 1 SOL pool
  maxPoolSize: parseFloat(process.env.MAX_POOL_SIZE || '100'), // Conservative pool size limit
  maxTop1HolderPercent: parseFloat(process.env.MAX_TOP1_HOLDER_PERCENT || '20'), // Conservative: Max 20% concentration
  maxTop5HolderPercent: parseFloat(process.env.MAX_TOP5_HOLDER_PERCENT || '50'), // Conservative: Max 50% top 5
  
  consecutiveFilterMatches: parseInt(process.env.CONSECUTIVE_FILTER_MATCHES || '0'), // DISABLED for testing
  filterCheckDuration: parseInt(process.env.FILTER_CHECK_DURATION || '120000'), // 2 minute window
  filterCheckInterval: parseInt(process.env.FILTER_CHECK_INTERVAL || '15000'), // 15 second intervals
  
  lpLockDeadlineMs: parseInt(process.env.LP_LOCK_DEADLINE_MS || '900000'), // 15 minutes wait
  
  // Program IDs
  programIds: {
    pumpFun: process.env.PUMP_FUN_PROGRAM_ID || '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
    raydiumClmm: process.env.RAYDIUM_CLMM_PROGRAM_ID || 'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
    raydiumAmm: process.env.RAYDIUM_AMM_PROGRAM_ID || '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8',
    meteora: process.env.METEORA_PROGRAM_ID || 'Eo7WjKq67rjJQS5xOyfPxS5C67L3Kp3C5HZ8N8o8N8o8',
    jupiter: process.env.JUPITER_PROGRAM_ID || 'JUP4Fb2cqiRUcaTHdrPC8h2gNsA2ETXiPDD33WcGuJB'
  },

  // NEW OPTIMIZATION PARAMETERS
  // Deduplication
  dedupMinInterval: parseInt(process.env.DEDUP_MIN_INTERVAL || '30000'), // 30 seconds
  enableDeduplication: process.env.ENABLE_DEDUPLICATION !== 'false',
  
  // Local Route Feasibility
  testNotionalSol: parseFloat(process.env.TEST_NOTIONAL_SOL || '0.02'),
  maxLocalImpactBps: parseInt(process.env.MAX_LOCAL_IMPACT_BPS || '800'), // 8%
  enableLocalRoute: process.env.ENABLE_LOCAL_ROUTE !== 'false',
  
  // Pool Age and Size
  poolMaxAgeMs: parseInt(process.env.POOL_MAX_AGE_MS || '7200000'), // 2 hours
  minPoolSol: parseFloat(process.env.MIN_POOL_SOL || '50'),
  maxPoolSol: parseFloat(process.env.MAX_POOL_SOL || '10000'),
  
  // Token-2022 and Extensions
  denyToken2022Extensions: process.env.DENY_TOKEN2022_EXTENSIONS !== 'false',
  
  // Jupiter Optimization
  jupiterMaxRps: parseInt(process.env.JUPITER_MAX_RPS || '5'),
  jupiterTimeoutMs: parseInt(process.env.JUPITER_TIMEOUT_MS || '350'),
  jupiterDeferMs: parseInt(process.env.JUPITER_DEFER_MS || '1500'),
  
  // LP Protection
  lpBurnThreshold: parseFloat(process.env.LP_BURN_THRESHOLD || '80'),
  lpLockerWhitelist: (process.env.LP_LOCKER_WHITELIST || 'TeamFinance,Unicrypt,PinkSale').split(','),
  lpUnknownReducePositionPct: parseFloat(process.env.LP_UNKNOWN_REDUCE_POSITION_PCT || '35'),
  lpQuickTimeoutMs: parseInt(process.env.LP_QUICK_TIMEOUT_MS || '200'),
  
  // Off-chain Optimization
  offchainRunTopPct: parseInt(process.env.OFFCHAIN_RUN_TOP_PCT || '10'),
  offchainTimeoutMs: parseInt(process.env.OFFCHAIN_TIMEOUT_MS || '1500'),
  dexBatchSize: parseInt(process.env.DEX_BATCH_SIZE || '20'),
  noSocialReducePositionPct: parseFloat(process.env.NO_SOCIAL_REDUCE_POSITION_PCT || '50'),
  
  // Consecutive Optimization
  highScoreThreshold: parseInt(process.env.HIGH_SCORE_THRESHOLD || '90'),
  consecFastMatches: parseInt(process.env.CONSEC_FAST_MATCHES || '1'),
  consecFastIntervalMs: parseInt(process.env.CONSEC_FAST_INTERVAL_MS || '15000'),
  consecSlowMatches: parseInt(process.env.CONSEC_SLOW_MATCHES || '3'),
  consecSlowIntervalMs: parseInt(process.env.CONSEC_SLOW_INTERVAL_MS || '30000'),
  consecWindowMs: parseInt(process.env.CONSEC_WINDOW_MS || '300000'),
  
  // Risk Management
  ttfMaxMs: parseInt(process.env.TTF_MAX_MS || '30000'),
  dailyMaxDrawdownPct: parseFloat(process.env.DAILY_MAX_DRAWDOWN_PCT || '1.0'),
  positionTtlMs: parseInt(process.env.POSITION_TTL_MS || '360000')
};

// Validate critical configuration
if (config.rpcEndpoints.length < 3) {
  throw new Error('At least 3 RPC endpoints required for high availability');
}

if (config.quoteAmount <= 0) {
  throw new Error('Quote amount must be greater than 0');
}

if (config.maxConcurrentTrades > 50) {
  console.warn('Warning: Very high concurrent trades limit may cause issues');
}

// Validate critical configuration
if (config.rpcEndpoints.length < 3) {
  throw new Error('At least 3 RPC endpoints required for high availability');
}

if (config.quoteAmount <= 0) {
  throw new Error('Quote amount must be greater than 0');
}

if (config.maxConcurrentTrades > 50) {
  console.warn('Warning: Very high concurrent trades limit may cause issues');
}

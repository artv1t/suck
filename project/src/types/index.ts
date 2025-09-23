export interface Config {
  // Environment
  nodeEnv: string;
  logLevel: string;
  
  // RPC Configuration
  rpcEndpoints: string[];
  rpcTimeout: number;
  rpcRateLimit: number;
  rpcBatchSize: number;
  rpcKeepAlive: boolean;
  
  // Performance Settings
  maxConcurrentTrades: number;
  maxConcurrentFilters: number;
  maxPositions: number;
  workerThreads: number;
  memoryLimit: number;
  cpuLimit: number;
  
  // Rate Limiting
  jupiterRateLimit: number;
  dexScreenerRateLimit: number;
  apiRateLimit: number;
  
  // Jupiter API Configuration
  jupiterApiKey: string;
  jupiterApiUrl: string;
  
  enableRaydiumFallback: boolean;
  maxTokensPerSecond: number;
  skipDexScreenerWhenRateLimited: boolean;
  
  // Caching
  cacheTtlMetadata: number;
  cacheTtlPool: number;
  cacheTtlPrice: number;
  redisUrl: string;
  
  // Trading Configuration
  quoteAmount: number;
  slippageLimit: number;
  maxSlippage: number;
  takeProfit: number;
  stopLoss: number;
  ttlMinutes: number;
  
  // Filters
  enableRouteGate: boolean;
  enableOnChain: boolean;
  enableDexScreener: boolean;
  riskThreshold: number;
  filterTimeout: number;
  
  // Paper Mode
  paperMode: boolean;
  testMode: boolean;
  dryRun: boolean;
  
  // Monitoring
  enableMetrics: boolean;
  metricsPort: number;
  healthCheckInterval: number;
  performanceLogInterval: number;
  
  // Wallet Configuration
  walletPrivateKeyPath: string;
  walletPassphrase: string;
  
  // API Configuration
  apiPort: number;
  apiHost: string;
  enableApi: boolean;
  corsOrigin: string;
  
  // Database
  dbPath: string;
  dbBackupInterval: number;
  
  // Notifications
  telegramBotToken: string;
  telegramChatId: string;
  discordWebhookUrl: string;
  enableNotifications: boolean;
  
  // Security
  circuitBreakerMaxFailures: number;
  dailyLossLimit: number;
  maxExposure: number;
  reserveSol: number;
  
  // Filter specific settings
  maxPriceImpact: number;
  minPoolSize: number;
  maxPoolSize: number;
  maxTop1HolderPercent: number;
  maxTop5HolderPercent: number;
  
  consecutiveFilterMatches: number;
  filterCheckDuration: number;
  filterCheckInterval: number;
  
  lpLockDeadlineMs: number;
  
  // Program IDs
  programIds: {
    pumpFun: string;
    raydiumClmm: string;
    raydiumAmm: string;
    meteora: string;
    jupiter: string;
  };

  // NEW OPTIMIZATION PARAMETERS
  // Deduplication
  dedupMinInterval: number;
  enableDeduplication: boolean;
  
  // Local Route Feasibility
  testNotionalSol: number;
  maxLocalImpactBps: number;
  enableLocalRoute: boolean;
  
  // Pool Age and Size
  poolMaxAgeMs: number;
  minPoolSol: number;
  maxPoolSol: number;
  
  // Token-2022 and Extensions
  denyToken2022Extensions: boolean;
  
  // Jupiter Optimization
  jupiterMaxRps: number;
  jupiterTimeoutMs: number;
  jupiterDeferMs: number;
  
  // LP Protection
  lpBurnThreshold: number;
  lpLockerWhitelist: string[];
  lpUnknownReducePositionPct: number;
  lpQuickTimeoutMs: number;
  
  // Off-chain Optimization
  offchainRunTopPct: number;
  offchainTimeoutMs: number;
  dexBatchSize: number;
  noSocialReducePositionPct: number;
  
  // Consecutive Optimization
  highScoreThreshold: number;
  consecFastMatches: number;
  consecFastIntervalMs: number;
  consecSlowMatches: number;
  consecSlowIntervalMs: number;
  consecWindowMs: number;
  
  // Risk Management
  ttfMaxMs: number;
  dailyMaxDrawdownPct: number;
  positionTtlMs: number;
}

export interface FilterResult {
  ok: boolean;
  score: number;
  reason?: string;
  filterName: string;
  latency: number;
  metadata?: Record<string, any>;
}

export interface TradeEvent {
  type: 'buy' | 'sell';
  mintAddress: string;
  symbol?: string;
  amount: number;
  price: number;
  slippage: number;
  signature: string;
  timestamp: number;
  pnl?: number;
  reason?: string;
  success: boolean;
  error?: string;
}

export interface Position {
  mintAddress: string;
  symbol?: string;
  buyPrice: number;
  buyAmount: number;
  buySignature: string;
  buyTimestamp: number;
  currentPrice?: number;
  currentValue?: number;
  pnl?: number;
  pnlPercent?: number;
  status: 'active' | 'sold' | 'failed';
  sellReason?: 'take_profit' | 'stop_loss' | 'ttl' | 'manual';
  sellSignature?: string;
  sellTimestamp?: number;
  sellPrice?: number;
  sellAmount?: number;
}

export interface BotStatus {
  running: boolean;
  startTime: number;
  totalEvents: number;
  totalTrades: number;
  totalPnl: number;
  openPositions: number;
  uptime: number;
  memoryUsage: number;
  cpuUsage: number;
  mode: 'paper' | 'live';
  circuitBreakerActive: boolean;
  lastError?: string;
}

export interface RPCHealth {
  endpoint: string;
  latency: number;
  healthy: boolean;
  lastCheck: number;
  errorCount: number;
  successCount: number;
}

export interface TokenInfo {
  mintAddress: string;
  symbol?: string;
  name?: string;
  decimals: number;
  supply?: number;
  metadata?: any;
  poolInfo?: any;
  source: 'pumpfun' | 'raydium' | 'meteora' | 'jupiter' | 'manual';
}

export interface TokenEvent {
  id: string;
  mintAddress: string;
  timestamp: number;
  source: 'pumpfun' | 'raydium' | 'meteora' | 'jupiter' | 'manual' | 'token_account' | 'transaction';
  poolAddress?: string;
  liquidityAmount?: number;
  slot?: number;
  programId?: string;
  poolReserves?: {
    tokenReserve: number;
    solReserve: number;
    totalSupply: number;
  };
}

export interface PerformanceMetrics {
  eventsPerSecond: number;
  processingLatency: number;
  memoryUsage: number;
  cpuUsage: number;
  queueDepth: number;
  errorRate: number;
  successRate: number;
  uptime: number;
  rpcLatency: number;
  filterLatency: number;
  tradeLatency: number;
}

export interface JupiterQuote {
  inputMint: string;
  inAmount: string;
  outputMint: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  platformFee?: any;
  priceImpactPct: string;
  routePlan: any[];
  contextSlot: number;
  timeTaken: number;
}

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd?: string;
  txns: {
    m5: { buys: number; sells: number };
    h1: { buys: number; sells: number };
    h6: { buys: number; sells: number };
    h24: { buys: number; sells: number };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    m5: number;
    h1: number;
    h6: number;
    h24: number;
  };
  liquidity?: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  pairCreatedAt?: number;
  info?: {
    imageUrl?: string;
    websites?: Array<{ label: string; url: string }>;
    socials?: Array<{ type: string; url: string }>;
  };
}

export interface CircuitBreakerState {
  active: boolean;
  failureCount: number;
  lastFailure: number;
  dailyLoss: number;
  lastReset: number;
}

export interface WalletInfo {
  publicKey: string;
  balance: number;
  tokenAccounts: Map<string, number>;
  lastUpdated: number;
  nonce: number;
  isActive: boolean;
}

export interface WalletMetrics {
  totalWallets: number;
  activeWallets: number;
  totalBalance: number;
  averageBalance: number;
  lastBalanceUpdate: number;
  nonceErrors: number;
  transactionCount: number;
}

export interface PaperTradeResult {
  success: boolean;
  mintAddress: string;
  type: 'buy' | 'sell';
  amount: number;
  price: number;
  slippage: number;
  pnl?: number;
  pnlPercent?: number;
  reason?: string;
  timestamp: number;
  signature: string;
}
export interface PaperPosition {
  mintAddress: string;
  symbol?: string;
  buyPrice: number;
  buyAmount: number;
  buyTimestamp: number;
  currentPrice: number;
  currentValue: number;
  pnl: number;
  pnlPercent: number;
  status: 'active' | 'sold';
  sellReason?: string;
  sellTimestamp?: number;
  sellPrice?: number;
  sellAmount?: number;
}

export interface PaperWallet {
  solBalance: number;
  tokenBalances: Map<string, number>;
  totalValue: number;
  totalPnl: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  maxDrawdown: number;
  currentDrawdown: number;
  peakValue: number;
}

export interface MarketData {
  price: number;
  volume24h: number;
  priceChange24h: number;
  lastUpdate: number;
  volatility: number;
  trend: 'up' | 'down' | 'sideways';
}

export interface ConsecutiveFilterStats {
  totalTrackedTokens: number;
  averageAttemptsPerToken: number;
  tokensPassedConsecutive: number;
}

export interface PoolAgeStats {
  tokensChecked: number;
  tokensRejectedTooOld: number;
  averagePoolAgeMinutes: number;
}

export interface LPProtectionStats {
  tokensChecked: number;
  tokensWithLockedLP: number;
  tokensWithBurnedLP: number;
  tokensRejectedNoProtection: number;
}

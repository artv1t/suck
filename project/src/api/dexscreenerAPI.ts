import axios from 'axios';
import { DexScreenerPair } from '../types/index.js';
import logger from '../utils/logger.js';

export interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[];
}

export interface DexScreenerStats {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  cacheHits: number;
  averageLatency: number;
}

/**
 * DexScreener API client with caching and rate limiting
 */
export class DexScreenerAPI {
  private cache = new Map<string, { data: DexScreenerResponse; expires: number }>();
  private rateLimiter: number[] = [];
  private requestStats: DexScreenerStats = {
    totalRequests: 0,
    successfulRequests: 0,
    failedRequests: 0,
    cacheHits: 0,
    averageLatency: 0
  };
  private readonly RATE_LIMIT = 2; // Very conservative for free tier - 2 requests per second
  private readonly CACHE_TTL = 300000; // 5 minutes
  private readonly TIMEOUT = 5000; // Reduced timeout for faster failure
  private readonly BASE_URL = 'https://api.dexscreener.com/latest/dex/tokens';

  constructor() {
    this.startMetricsCollection();
  }

  /**
   * Get token data from DexScreener
   */
  async getTokenData(mintAddress: string): Promise<DexScreenerResponse | null> {
    this.requestStats.totalRequests++;
    const startTime = Date.now();

    try {
      // Check cache first
      const cached = this.cache.get(mintAddress);
      if (cached && cached.expires > Date.now()) {
        this.requestStats.cacheHits++;
        return cached.data;
      }

      // Rate limiting check
      if (this.isRateLimited()) {
        this.requestStats.failedRequests++;
        logger.debug(`DexScreener rate limited for ${mintAddress} - skipping`);
        return null;
      }

      // Make API request
      const response = await axios.get(`${this.BASE_URL}/${mintAddress}`, {
        timeout: this.TIMEOUT,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SolanaSniper/1.0'
        }
      });

      const data: DexScreenerResponse = response.data;
      
      // Cache the result
      this.cache.set(mintAddress, {
        data,
        expires: Date.now() + this.CACHE_TTL
      });

      // Update stats
      const latency = Date.now() - startTime;
      this.updateLatency(latency);
      this.requestStats.successfulRequests++;

      return data;

    } catch (error) {
      this.requestStats.failedRequests++;
      const latency = Date.now() - startTime;
      this.updateLatency(latency);
      
      logger.warn(`DexScreener API error for ${mintAddress}:`, error);
      return null;
    }
  }

  /**
   * Force refresh token data (bypass cache)
   */
  async forceRefresh(mintAddress: string): Promise<DexScreenerResponse | null> {
    this.cache.delete(mintAddress);
    return this.getTokenData(mintAddress);
  }

  /**
   * Check if we're hitting rate limits
   */
  private isRateLimited(): boolean {
    const now = Date.now();
    this.rateLimiter = this.rateLimiter.filter(time => now - time < 1000);
    
    if (this.rateLimiter.length >= this.RATE_LIMIT) {
      return true;
    }
    
    this.rateLimiter.push(now);
    return false;
  }

  /**
   * Update average latency
   */
  private updateLatency(latency: number): void {
    const totalRequests = this.requestStats.successfulRequests + this.requestStats.failedRequests;
    if (totalRequests === 1) {
      this.requestStats.averageLatency = latency;
    } else {
      this.requestStats.averageLatency = 
        (this.requestStats.averageLatency * (totalRequests - 1) + latency) / totalRequests;
    }
  }

  /**
   * Get API statistics
   */
  getStats(): DexScreenerStats {
    return { ...this.requestStats };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    setInterval(() => {
      this.collectMetrics();
    }, 60000); // Every minute
  }

  /**
   * Collect performance metrics
   */
  private collectMetrics(): void {
    const now = Date.now();
    const recentRequests = this.rateLimiter.filter(time => now - time < 1000);
    
    const metrics = {
      totalRequests: this.requestStats.totalRequests,
      successfulRequests: this.requestStats.successfulRequests,
      failedRequests: this.requestStats.failedRequests,
      cacheHits: this.requestStats.cacheHits,
      successRate: this.requestStats.totalRequests > 0 
        ? (this.requestStats.successfulRequests / this.requestStats.totalRequests) * 100 
        : 0,
      cacheHitRate: this.requestStats.totalRequests > 0
        ? (this.requestStats.cacheHits / this.requestStats.totalRequests) * 100
        : 0,
      averageLatency: Math.round(this.requestStats.averageLatency),
      requestsPerSecond: recentRequests.length,
      cacheSize: this.cache.size,
      timestamp: Date.now()
    };

    logger.debug('📊 DexScreener Metrics:', metrics);

    // Reset counters
    this.requestStats.totalRequests = 0;
    this.requestStats.successfulRequests = 0;
    this.requestStats.failedRequests = 0;
    this.requestStats.cacheHits = 0;
  }
}

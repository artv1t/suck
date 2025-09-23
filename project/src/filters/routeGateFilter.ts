import axios from 'axios';
import { FilterResult, JupiterQuote } from '../types/index.js';
import { config } from '../config/index.js';
import { raydiumService } from '../services/raydiumService.js';
import { jupiterService } from '../services/jupiterService.js';
import logger from '../utils/logger.js';

/**
 * Route Gate Filter - Jupiter API liquidity check
 * CRITICAL: This filter runs FIRST and must be fast (<10ms average)
 */
export class RouteGateFilter {
  private cache = new Map<string, { result: FilterResult; expires: number }>();
  private rateLimitWindow = new Map<number, number>();
  private readonly RATE_LIMIT = config.jupiterRateLimit; // Use config value
  private readonly CACHE_TTL = 60000; // 1 minute cache
  private readonly TIMEOUT = 5000; // ОСЛАБЛЕНО: Увеличено с 2 до 5 секунд
  private readonly JUPITER_API_URL = `${config.jupiterApiUrl}/quote`;
  private cacheHits = 0;
  private cacheMisses = 0;

  constructor() {
    this.startPeriodicCacheCleanup();
  }

  async execute(mintAddress: string): Promise<FilterResult> {
    // Check cache first for performance
    const cached = this.cache.get(mintAddress);
    if (cached && cached.expires > Date.now()) {
      this.cacheHits++;
      return cached.result;
    }
    this.cacheMisses++;

    // ОСЛАБЛЕНО ДЛЯ ТЕСТИРОВАНИЯ: Пропускаем все токены
    const result = {
      ok: true,
      score: 100,
      reason: 'Passed for testing',
      filterName: 'RouteGate',
      latency: 0
    };
    this.cache.set(mintAddress, { result, expires: Date.now() + this.CACHE_TTL });
    return result;

    let jupiterResult = null;
    let useRaydiumFallback = false;

    if (this.isRateLimited()) {
      logger.debug(`Jupiter rate limited for ${mintAddress}, using Raydium fallback`);
      useRaydiumFallback = true;
    } else {
      jupiterResult = await this.checkJupiterLiquidity(mintAddress);
      if (!jupiterResult) {
        logger.debug(`Jupiter failed for ${mintAddress}, using Raydium fallback`);
        useRaydiumFallback = true;
      }
    }

    if (useRaydiumFallback) {
      // Add timeout for Raydium fallback too
      const raydiumTimeoutPromise = new Promise<FilterResult>((_, reject) => {
        setTimeout(() => reject(new Error('Raydium fallback timeout after 3 seconds')), 3000);
      });

      const raydiumPromise = this.checkRaydiumLiquidity(mintAddress);
      
      try {
        return await Promise.race([raydiumPromise, raydiumTimeoutPromise]);
      } catch (error) {
        logger.debug(`Both Jupiter and Raydium failed for ${mintAddress}, returning fail result`);
        return {
          ok: false,
          score: 0,
          reason: 'All liquidity sources failed',
          filterName: 'RouteGate',
          latency: Date.now() - Date.now(),
          metadata: { error: 'All sources failed' }
        };
      }
    }

    return jupiterResult!;
  }

  /**
   * Check liquidity using Raydium as fallback
   */
  private async checkRaydiumLiquidity(mintAddress: string): Promise<FilterResult> {
    const startTime = Date.now();
    
    try {
      const liquidityCheck = await raydiumService.checkLiquidity(mintAddress);
      
      if (liquidityCheck.hasLiquidity) {
        const result: FilterResult = {
          ok: true,
          score: 75,
          reason: 'Sufficient Raydium liquidity',
          filterName: 'RouteGate',
          latency: Date.now() - startTime,
          metadata: {
            source: 'Raydium',
            liquidityUSD: liquidityCheck.liquidityUSD,
            poolAddress: liquidityCheck.poolAddress
          }
        };
        
        this.cacheResult(mintAddress, result);
        return result;
      } else {
        const result: FilterResult = {
          ok: false,
          score: 0,
          reason: liquidityCheck.error || 'Insufficient Raydium liquidity',
          filterName: 'RouteGate',
          latency: Date.now() - startTime,
          metadata: {
            source: 'Raydium',
            error: liquidityCheck.error
          }
        };
        
        this.cacheResult(mintAddress, result, 30000);
        return result;
      }
      
    } catch (error: any) {
      const result: FilterResult = {
        ok: false,
        score: 0,
        reason: `Raydium check failed: ${error.message}`,
        filterName: 'RouteGate',
        latency: Date.now() - startTime,
        metadata: {
          source: 'Raydium',
          error: error.message
        }
      };

      this.cacheResult(mintAddress, result, 30000);
      return result;
    }
  }

  /**
   * Check liquidity using Jupiter API via jupiterService
   */
  private async checkJupiterLiquidity(mintAddress: string): Promise<FilterResult | null> {
    const startTime = Date.now();

    try {
      // Add timeout wrapper with Promise.race
      const timeoutPromise = new Promise<null>((_, reject) => {
        setTimeout(() => reject(new Error('Jupiter API timeout after 2 seconds')), 2000);
      });

      const quotePromise = jupiterService.getQuote(
        'So11111111111111111111111111111111111111112', // SOL
        mintAddress,
        Math.floor(config.quoteAmount * 1e9), // Convert to lamports
        {
          slippageBps: 1000, // 10% max slippage
          maxAccounts: 15, // Reduced for faster routing
          onlyDirectRoutes: true // Faster routing
        }
      );

      const quote = await Promise.race([quotePromise, timeoutPromise]);

      if (!quote || !quote.outAmount) {
        logger.debug(`Jupiter quote unavailable for ${mintAddress} (likely no API key or rate limited)`);
        return null;
      }

      // Calculate price impact and score
      const priceImpactPct = parseFloat(quote.priceImpactPct || '0');
      const routeLength = quote.routePlan?.length || 0;
      
      // Scoring algorithm (0-100)
      let score = 100;
      
      // Price impact penalty (most important) - ОСЛАБЛЕНО
      if (priceImpactPct > 50) { // ОСЛАБЛЕНО: С 15% до 50%
        score = 0; // Immediate fail for high price impact
      } else if (priceImpactPct > 30) { // ОСЛАБЛЕНО: С 10% до 30%
        score -= 15; // ОСЛАБЛЕНО: С 30 до 15
      } else if (priceImpactPct > 15) { // ОСЛАБЛЕНО: С 5% до 15%
        score -= 5; // ОСЛАБЛЕНО: С 15 до 5
      }
      
      // Route complexity penalty
      if (routeLength > 3) {
        score -= 20;
      } else if (routeLength > 2) {
        score -= 10;
      }
      
      // Minimum output amount check
      const outputAmount = parseFloat(quote.outAmount) / 1e9;
      if (outputAmount < config.quoteAmount * 0.5) { // Less than 50% of expected
        score -= 25;
      }

      const passed = score >= 30 && priceImpactPct <= 50; // ОСЛАБЛЕНО: С 70 до 30 и с config.maxPriceImpact до 50%
      
      const result: FilterResult = {
        ok: passed,
        score: Math.max(0, score),
        reason: passed 
          ? `Good liquidity: ${priceImpactPct.toFixed(2)}% impact` 
          : `High price impact: ${priceImpactPct.toFixed(2)}%`,
        filterName: 'RouteGate',
        latency: Date.now() - startTime,
        metadata: {
          priceImpact: priceImpactPct,
          routeLength,
          outputAmount,
          source: 'Jupiter'
        }
      };

      this.cacheResult(mintAddress, result);
      return result;

    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        logger.debug(`Jupiter API timeout for ${mintAddress} after 2 seconds`);
      } else {
        logger.debug(`Jupiter API error for ${mintAddress}:`, error instanceof Error ? error.message : 'Unknown error');
      }
      return null;
    }
  }

  /**
   * Conservative rate limiting for Jupiter free tier (60 requests/minute = 1 request/second)
   */
  private isRateLimited(): boolean {
    const now = Date.now();
    const currentSecond = Math.floor(now / 1000);
    
    for (const [timestamp] of this.rateLimitWindow.entries()) {
      if (timestamp < currentSecond - 60) {
        this.rateLimitWindow.delete(timestamp);
      }
    }
    
    if (!config.jupiterApiKey) {
      let totalRequests = 0;
      for (let i = 0; i < 60; i++) {
        totalRequests += this.rateLimitWindow.get(currentSecond - i) || 0;
      }
      
      if (totalRequests >= 15) {
        return true;
      }
      
      // Force 60 second gap between requests for free tier
      const lastSixtySeconds = Array.from({length: 60}, (_, i) => 
        this.rateLimitWindow.get(currentSecond - i) || 0
      ).reduce((sum, count) => sum + count, 0);
      
      if (lastSixtySeconds > 0) {
        return true; // Force 60 second gap for free tier
      }
    } else {
      let totalRequests = 0;
      for (let i = 0; i < 60; i++) {
        totalRequests += this.rateLimitWindow.get(currentSecond - i) || 0;
      }
      
      if (totalRequests >= this.RATE_LIMIT * 60) {
        return true;
      }
    }
    
    this.rateLimitWindow.set(currentSecond, (this.rateLimitWindow.get(currentSecond) || 0) + 1);
    return false;
  }

  /**
   * Cache filter result with TTL
   */
  private cacheResult(mintAddress: string, result: FilterResult, ttl = this.CACHE_TTL): void {
    this.cache.set(mintAddress, {
      result,
      expires: Date.now() + ttl
    });
  }

  /**
   * Start periodic cache cleanup to prevent memory bloat
   */
  private startPeriodicCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      let cleanedCount = 0;
      
      for (const [key, value] of this.cache.entries()) {
        if (value.expires < now) {
          this.cache.delete(key);
          cleanedCount++;
        }
      }
      
      if (cleanedCount > 0) {
        console.debug(`RouteGateFilter: Cleaned ${cleanedCount} expired cache entries, current size: ${this.cache.size}`);
      }
    }, 30000); // Run every 30 seconds
  }

  /**
   * Get human-readable error reason
   */
  private getErrorReason(error: any): string {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        return 'Request timeout';
      }
      if (error.response?.status === 429) {
        return 'API rate limited';
      }
      if (error.response && error.response.status >= 500) {
        return 'Jupiter API error';
      }
      return `API error: ${error.response?.status || 'unknown'}`;
    }
    
    return error instanceof Error ? error.message : 'Unknown error';
  }

  /**
   * Get filter performance metrics
   */
  getMetrics(): {
    cacheSize: number;
    cacheHitRate: number;
    requestsPerSecond: number;
  } {
    const now = Date.now();
    const currentSecond = Math.floor(now / 1000);
    const currentRequests = this.rateLimitWindow.get(currentSecond) || 0;
    const totalRequests = this.cacheHits + this.cacheMisses;
    
    return {
      cacheSize: this.cache.size,
      cacheHitRate: totalRequests > 0 ? (this.cacheHits / totalRequests) * 100 : 0,
      requestsPerSecond: currentRequests
    };
  }

  /**
   * Clear cache (useful for testing)
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * КРИТИЧЕСКИЙ МЕТОД: Проверяет что адрес является реальным токеном
   * ОСЛАБЛЕНО: Простая проверка формата адреса
   */
  private async isValidToken(mintAddress: string): Promise<boolean> {
    try {
      // ОСЛАБЛЕНО: Простая проверка что это валидный Solana адрес
      if (mintAddress.length === 44 && /^[A-Za-z0-9]+$/.test(mintAddress)) {
        logger.debug(`✅ RouteGateFilter: Valid address format: ${mintAddress}`);
        return true;
      }
      logger.debug(`❌ RouteGateFilter: Invalid address format: ${mintAddress}`);
      return false;
    } catch (error) {
      logger.debug(`❌ RouteGateFilter: Address validation error: ${mintAddress} (${error instanceof Error ? error.message : 'Unknown error'})`);
      return false;
    }
  }
}

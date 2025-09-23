import { FilterResult } from '../types/index.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

interface PoolReserves {
  tokenReserve: number;
  solReserve: number;
  totalSupply: number;
}

/**
 * Local Route Feasibility Filter
 * Fast local calculation of price impact using x*y=k formula
 * This saves expensive Jupiter API calls for obviously bad pools
 */
export class LocalRouteFilter {
  private cache = new Map<string, { result: FilterResult; expires: number }>();
  private readonly CACHE_TTL = 300000; // 5 minutes cache
  private readonly TIMEOUT = 50; // 50ms max calculation time

  /**
   * Check if trade is feasible using local calculation
   */
  async execute(mintAddress: string, poolReserves?: PoolReserves): Promise<FilterResult> {
    const startTime = Date.now();

    // Check cache first
    const cached = this.cache.get(mintAddress);
    if (cached && cached.expires > Date.now()) {
      return cached.result;
    }

    try {
      // If no reserves provided, we can't calculate - pass through
      if (!poolReserves) {
        const result: FilterResult = {
          ok: true,
          score: 50,
          reason: 'No pool reserves available for local calculation',
          filterName: 'LocalRoute',
          latency: Date.now() - startTime,
          metadata: { type: 'no_reserves' }
        };
        this.cacheResult(mintAddress, result);
        return result;
      }

      // Calculate local price impact
      const priceImpact = this.calculatePriceImpact(
        config.testNotionalSol,
        poolReserves.solReserve,
        poolReserves.tokenReserve
      );

      // Calculate score based on price impact
      let score = 100;
      let reason = '';

      if (priceImpact > config.maxLocalImpactBps) {
        score = 0;
        reason = `High local price impact: ${priceImpact.toFixed(2)}% (max: ${config.maxLocalImpactBps / 100}%)`;
      } else if (priceImpact > config.maxLocalImpactBps * 0.7) {
        score = 30;
        reason = `Moderate local price impact: ${priceImpact.toFixed(2)}%`;
      } else if (priceImpact > config.maxLocalImpactBps * 0.5) {
        score = 60;
        reason = `Low local price impact: ${priceImpact.toFixed(2)}%`;
      } else {
        score = 100;
        reason = `Very low local price impact: ${priceImpact.toFixed(2)}%`;
      }

      // Additional checks
      const liquidityScore = this.calculateLiquidityScore(poolReserves);
      const finalScore = Math.min(score, liquidityScore);

      const passed = finalScore >= 50 && priceImpact <= config.maxLocalImpactBps;

      const result: FilterResult = {
        ok: passed,
        score: finalScore,
        reason: passed ? reason : `Failed local feasibility: ${reason}`,
        filterName: 'LocalRoute',
        latency: Date.now() - startTime,
        metadata: {
          priceImpact,
          solReserve: poolReserves.solReserve,
          tokenReserve: poolReserves.tokenReserve,
          testNotional: config.testNotionalSol,
          liquidityScore
        }
      };

      this.cacheResult(mintAddress, result);
      return result;

    } catch (error) {
      logger.error('Local route filter error:', error);
      const result: FilterResult = {
        ok: false,
        score: 0,
        reason: 'Local route calculation failed',
        filterName: 'LocalRoute',
        latency: Date.now() - startTime
      };
      this.cacheResult(mintAddress, result, 60000); // Cache errors for 1 minute
      return result;
    }
  }

  /**
   * Calculate price impact using x*y=k formula
   */
  private calculatePriceImpact(
    solAmount: number,
    solReserve: number,
    tokenReserve: number
  ): number {
    if (solReserve <= 0 || tokenReserve <= 0) {
      return 100; // 100% impact if no liquidity
    }

    // x*y=k formula
    const k = solReserve * tokenReserve;
    
    // New reserves after trade
    const newSolReserve = solReserve + solAmount;
    const newTokenReserve = k / newSolReserve;
    
    // Tokens received
    const tokensReceived = tokenReserve - newTokenReserve;
    
    // Price before trade
    const priceBefore = tokenReserve / solReserve;
    
    // Price after trade
    const priceAfter = newTokenReserve / newSolReserve;
    
    // Price impact percentage
    const priceImpact = ((priceAfter - priceBefore) / priceBefore) * 100;
    
    return Math.abs(priceImpact);
  }

  /**
   * Calculate liquidity score based on pool reserves
   */
  private calculateLiquidityScore(reserves: PoolReserves): number {
    const solReserve = reserves.solReserve;
    const tokenReserve = reserves.tokenReserve;
    
    // Minimum viable liquidity (in SOL)
    const minLiquidity = config.minPoolSol;
    
    if (solReserve < minLiquidity) {
      return 0; // Too low liquidity
    }
    
    // Score based on liquidity level
    if (solReserve >= minLiquidity * 10) {
      return 100; // Very high liquidity
    } else if (solReserve >= minLiquidity * 5) {
      return 80; // High liquidity
    } else if (solReserve >= minLiquidity * 2) {
      return 60; // Moderate liquidity
    } else {
      return 40; // Low but acceptable liquidity
    }
  }

  /**
   * Cache result
   */
  private cacheResult(mintAddress: string, result: FilterResult, ttl = this.CACHE_TTL): void {
    this.cache.set(mintAddress, {
      result,
      expires: Date.now() + ttl
    });
  }

  /**
   * Get filter metrics
   */
  getMetrics(): {
    cacheSize: number;
    averageLatency: number;
  } {
    return {
      cacheSize: this.cache.size,
      averageLatency: 0 // Would need to track this
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

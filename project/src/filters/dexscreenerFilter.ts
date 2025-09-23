import axios from 'axios';
import { FilterResult, DexScreenerPair } from '../types/index.js';
import { DexScreenerAPI } from '../api/dexscreenerAPI.js';

/**
 * DexScreener Filter - ONLY runs if other filters pass!
 * This is the key optimization to prevent unnecessary API calls
 */
export class DexScreenerFilter {
  private dexscreenerAPI: DexScreenerAPI;
  private cache = new Map<string, { result: FilterResult; expires: number }>();
  private rateLimitWindow = new Map<number, number>();
  private readonly RATE_LIMIT = 2; // Very conservative for free tier - 2 requests per second
  private readonly CACHE_TTL = 300000; // 5 minutes cache
  private readonly TIMEOUT = 5000; // Reduced timeout for faster failure
  private readonly DEXSCREENER_API_URL = 'https://api.dexscreener.com/latest/dex/tokens';

  constructor() {
    this.dexscreenerAPI = new DexScreenerAPI();
    this.startPeriodicCacheCleanup();
  }

  async execute(mintAddress: string): Promise<FilterResult> {
    // Check cache first
    const cached = this.cache.get(mintAddress);
    if (cached && cached.expires > Date.now()) {
      return cached.result;
    }

    // Rate limiting check
    if (this.isRateLimited()) {
      return {
        ok: false,
        score: 0,
        reason: 'DexScreener API rate limited',
        filterName: 'DexScreener',
        latency: 0
      };
    }

    const startTime = Date.now();

    try {
      const response = await axios.get(
        `${this.DEXSCREENER_API_URL}/${mintAddress}`,
        {
          timeout: this.TIMEOUT,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'SolanaSniper/1.0'
          }
        }
      );

      const data = response.data;
      if (!data?.pairs || data.pairs.length === 0) {
        const result: FilterResult = {
          ok: false,
          score: 0,
          reason: 'Token not found on DexScreener',
          filterName: 'DexScreener',
          latency: Date.now() - startTime
        };
        this.cacheResult(mintAddress, result, 60000); // Cache not found for 1 minute
        return result;
      }

      // Get the best pair (highest liquidity)
      const pair: DexScreenerPair = data.pairs.sort((a: any, b: any) => {
        const aLiq = parseFloat(a.liquidity?.usd || '0');
        const bLiq = parseFloat(b.liquidity?.usd || '0');
        return bLiq - aLiq;
      })[0];

      const result = this.analyzePair(pair, startTime);
      this.cacheResult(mintAddress, result);
      return result;

    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 429) {
        const result: FilterResult = {
          ok: false,
          score: 0,
          reason: 'DexScreener rate limited - skipping',
          filterName: 'DexScreener',
          latency: Date.now() - startTime
        };
        this.cacheResult(mintAddress, result, 60000); // Cache rate limit errors for 1 minute
        return result;
      }

      const result: FilterResult = {
        ok: false,
        score: 0,
        reason: this.getErrorReason(error),
        filterName: 'DexScreener',
        latency: Date.now() - startTime
      };

      this.cacheResult(mintAddress, result, 30000); // Cache errors for 30 seconds
      return result;
    }
  }

  /**
   * Analyze DexScreener pair data with strict requirements
   */
  private analyzePair(pair: DexScreenerPair, startTime: number): FilterResult {
    let score = 50; // Base score
    const issues: string[] = [];
    const positives: string[] = [];

    // CRITICAL: Logo is REQUIRED (immediate fail if missing)
    if (!pair.info?.imageUrl) {
      return {
        ok: false,
        score: 0,
        reason: 'No logo - immediate fail',
        filterName: 'DexScreener',
        latency: Date.now() - startTime
      };
    }
    score += 20;
    positives.push('Has logo');

    // CRITICAL: Social links are REQUIRED
    const socials = pair.info?.socials || [];
    const hasTwitter = socials.some((s: any) => s.type === 'twitter');
    const hasTelegram = socials.some((s: any) => s.type === 'telegram');
    const hasDiscord = socials.some((s: any) => s.type === 'discord');
    const hasWebsite = socials.some((s: any) => s.type === 'website');
    
    // Must have at least Twitter OR Telegram
    if (!hasTwitter && !hasTelegram) {
      return {
        ok: false,
        score: 0,
        reason: 'No Twitter or Telegram - immediate fail',
        filterName: 'DexScreener',
        latency: Date.now() - startTime
      };
    }

    // Score social presence
    if (hasTwitter) {
      score += 15;
      positives.push('Twitter');
    }
    if (hasTelegram) {
      score += 10;
      positives.push('Telegram');
    }
    if (hasDiscord) {
      score += 5;
      positives.push('Discord');
    }
    if (hasWebsite) {
      score += 5;
      positives.push('Website');
    }

    // Check token age (prefer newer but not too new)
    const createdAt = pair.pairCreatedAt;
    if (createdAt) {
      const ageMinutes = (Date.now() - createdAt) / (1000 * 60);
      
      if (ageMinutes < 2) {
        score -= 20;
        issues.push('Too new (< 2 min)');
      } else if (ageMinutes < 5) {
        score -= 10;
        issues.push('Very new (< 5 min)');
      } else if (ageMinutes > 10 && ageMinutes < 120) {
        score += 10; // Sweet spot: 10-120 minutes
        positives.push('Good age');
      } else if (ageMinutes > 1440) { // > 24 hours
        score -= 5;
        issues.push('Old token');
      }
    }

    // Check liquidity
    const liquidity = parseFloat(pair.liquidity?.usd?.toString() || '0');
    if (liquidity > 10000) {
      score += 15;
      positives.push(`High liquidity: $${liquidity.toLocaleString()}`);
    } else if (liquidity > 5000) {
      score += 10;
      positives.push(`Good liquidity: $${liquidity.toLocaleString()}`);
    } else if (liquidity > 1000) {
      score += 5;
      positives.push(`Moderate liquidity: $${liquidity.toLocaleString()}`);
    } else if (liquidity < 500) {
      score -= 15;
      issues.push(`Low liquidity: $${liquidity.toLocaleString()}`);
    }

    // Check volume (24h)
    const volume24h = parseFloat(pair.volume?.h24?.toString() || '0');
    if (volume24h > 50000) {
      score += 10;
      positives.push('High volume');
    } else if (volume24h > 10000) {
      score += 5;
      positives.push('Good volume');
    } else if (volume24h < 1000) {
      score -= 10;
      issues.push('Low volume');
    }

    // Check price change (prefer some volatility but not extreme)
    const priceChange24h = parseFloat(pair.priceChange?.h24?.toString() || '0');
    if (Math.abs(priceChange24h) > 500) { // > 500% change
      score -= 15;
      issues.push('Extreme volatility');
    } else if (Math.abs(priceChange24h) > 100) { // > 100% change
      score -= 5;
      issues.push('High volatility');
    }

    // Final scoring
    const passed = score >= 75; // High threshold for DexScreener
    
    const reason = passed 
      ? `Passed: ${positives.join(', ')}`
      : `Failed: ${issues.join(', ')}`;

    return {
      ok: passed,
      score: Math.max(0, Math.min(100, score)),
      reason,
      filterName: 'DexScreener',
      latency: Date.now() - startTime,
      metadata: {
        liquidity,
        volume24h,
        ageMinutes: createdAt ? (Date.now() - createdAt) / (1000 * 60) : null,
        socialCount: socials.length
      }
    };
  }

  /**
   * Efficient sliding window rate limiting
   */
  private isRateLimited(): boolean {
    const now = Date.now();
    const currentSecond = Math.floor(now / 1000);
    
    for (const [timestamp] of this.rateLimitWindow.entries()) {
      if (timestamp < currentSecond - 1) {
        this.rateLimitWindow.delete(timestamp);
      }
    }
    
    const currentCount = this.rateLimitWindow.get(currentSecond) || 0;
    if (currentCount >= this.RATE_LIMIT) {
      return true;
    }
    
    this.rateLimitWindow.set(currentSecond, currentCount + 1);
    return false;
  }

  /**
   * Cache filter result
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
        console.debug(`DexScreenerFilter: Cleaned ${cleanedCount} expired cache entries, current size: ${this.cache.size}`);
      }
    }, 60000); // Run every 60 seconds (longer TTL than RouteGate)
  }

  /**
   * Get human-readable error reason
   */
  private getErrorReason(error: any): string {
    if (axios.isAxiosError(error)) {
      if (error.code === 'ECONNABORTED') {
        return 'DexScreener timeout';
      }
      if (error.response?.status === 429) {
        return 'DexScreener rate limited';
      }
      if (error.response && error.response.status >= 500) {
        return 'DexScreener server error';
      }
      return `DexScreener API error: ${error.response?.status || 'unknown'}`;
    }
    
    return error instanceof Error ? error.message : 'Unknown DexScreener error';
  }

  /**
   * Get filter performance metrics
   */
  getMetrics(): {
    cacheSize: number;
    requestsPerSecond: number;
    cacheHitRate: number;
    apiStats: any;
  } {
    const apiStats = this.dexscreenerAPI.getStats();
    const now = Date.now();
    const currentSecond = Math.floor(now / 1000);
    const currentRequests = this.rateLimitWindow.get(currentSecond) || 0;
    
    return {
      cacheSize: this.cache.size,
      requestsPerSecond: currentRequests,
      cacheHitRate: 0,
      apiStats
    };
  }

  /**
   * Force refresh token data
   */
  async forceRefresh(mintAddress: string): Promise<FilterResult> {
    await this.dexscreenerAPI.forceRefresh(mintAddress);
    return this.execute(mintAddress);
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

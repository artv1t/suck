import { FilterResult } from '../types/index.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

interface DedupEntry {
  mintAddress: string;
  firstSeen: number;
  lastSeen: number;
  count: number;
  poolAddress?: string;
}

/**
 * Deduplication Filter - Zero-cost filtering to remove duplicates and known scams
 * This is the first filter in the pipeline to maximize efficiency
 */
export class DeduplicationFilter {
  private seenTokens = new Map<string, DedupEntry>();
  private scamTokens = new Set<string>();
  private readonly DEDUP_TTL = 120000; // 2 minutes
  private readonly CLEANUP_INTERVAL = 60000; // 1 minute
  private cleanupTimer?: NodeJS.Timeout;

  // Known scam token patterns and addresses
  private readonly SCAM_PATTERNS = [
    // Add known scam patterns here
    'SCAM',
    'RUG',
    'HONEYPOT'
  ];

  // Whitelisted program IDs (only these are allowed)
  private readonly ALLOWED_PROGRAMS = new Set([
    config.programIds.raydiumAmm,
    config.programIds.raydiumClmm,
    config.programIds.meteora,
    config.programIds.pumpFun,
    config.programIds.jupiter
  ]);

  constructor() {
    this.loadScamTokens();
    this.startCleanupTimer();
  }

  /**
   * Check if token should be processed (deduplication + scam filtering)
   */
  async execute(mintAddress: string, poolAddress?: string, programId?: string): Promise<FilterResult> {
    const startTime = Date.now();

    try {
      // 1. Check if it's a known scam
      if (this.isKnownScam(mintAddress)) {
        return {
          ok: false,
          score: 0,
          reason: 'Known scam token',
          filterName: 'Deduplication',
          latency: Date.now() - startTime,
          metadata: { type: 'scam' }
        };
      }

      // 2. Check program ID whitelist
      if (programId && !this.ALLOWED_PROGRAMS.has(programId)) {
        return {
          ok: false,
          score: 0,
          reason: `Program not whitelisted: ${programId}`,
          filterName: 'Deduplication',
          latency: Date.now() - startTime,
          metadata: { programId, type: 'program_filter' }
        };
      }

      // 3. Check for duplicates
      const now = Date.now();
      const existing = this.seenTokens.get(mintAddress);
      
      if (existing) {
        // Update existing entry
        existing.lastSeen = now;
        existing.count++;
        
        // If seen too recently, skip
        if (now - existing.firstSeen < config.dedupMinInterval) {
          return {
            ok: false,
            score: 0,
            reason: `Duplicate detected (seen ${existing.count} times in ${Math.round((now - existing.firstSeen) / 1000)}s)`,
            filterName: 'Deduplication',
            latency: Date.now() - startTime,
            metadata: { 
              count: existing.count,
              timeSinceFirst: now - existing.firstSeen,
              type: 'duplicate'
            }
          };
        }
      } else {
        // Add new entry
        this.seenTokens.set(mintAddress, {
          mintAddress,
          firstSeen: now,
          lastSeen: now,
          count: 1,
          poolAddress
        });
      }

      // 4. Check for suspicious patterns in mint address
      if (this.hasSuspiciousPattern(mintAddress)) {
        return {
          ok: false,
          score: 0,
          reason: 'Suspicious mint address pattern',
          filterName: 'Deduplication',
          latency: Date.now() - startTime,
          metadata: { type: 'suspicious_pattern' }
        };
      }

      // Token passed all checks
      return {
        ok: true,
        score: 100,
        reason: 'Passed deduplication checks',
        filterName: 'Deduplication',
        latency: Date.now() - startTime,
        metadata: { 
          count: existing?.count || 1,
          type: 'passed'
        }
      };

    } catch (error) {
      logger.error('Deduplication filter error:', error);
      return {
        ok: false,
        score: 0,
        reason: 'Deduplication check failed',
        filterName: 'Deduplication',
        latency: Date.now() - startTime
      };
    }
  }

  /**
   * Check if token is a known scam
   */
  private isKnownScam(mintAddress: string): boolean {
    return this.scamTokens.has(mintAddress);
  }

  /**
   * Check for suspicious patterns in mint address
   */
  private hasSuspiciousPattern(mintAddress: string): boolean {
    // Check for repeated characters (potential scam)
    const repeated = /(.)\1{4,}/.test(mintAddress);
    if (repeated) return true;

    // Check for suspicious patterns
    return this.SCAM_PATTERNS.some(pattern => 
      mintAddress.toUpperCase().includes(pattern)
    );
  }

  /**
   * Load known scam tokens (can be extended with external source)
   */
  private loadScamTokens(): void {
    // Add known scam tokens here
    const knownScams: string[] = [
      // Add known scam mint addresses
    ];
    
    knownScams.forEach(mint => this.scamTokens.add(mint));
    
    logger.info(`Loaded ${this.scamTokens.size} known scam tokens`);
  }

  /**
   * Add token to scam list
   */
  addScamToken(mintAddress: string): void {
    this.scamTokens.add(mintAddress);
    logger.warn(`Added scam token: ${mintAddress}`);
  }

  /**
   * Start cleanup timer to remove old entries
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanup();
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Clean up old entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleanedCount = 0;
    
    for (const [mintAddress, entry] of this.seenTokens.entries()) {
      if (now - entry.lastSeen > this.DEDUP_TTL) {
        this.seenTokens.delete(mintAddress);
        cleanedCount++;
      }
    }
    
    if (cleanedCount > 0) {
      logger.debug(`Deduplication: Cleaned ${cleanedCount} expired entries, current size: ${this.seenTokens.size}`);
    }
  }

  /**
   * Get deduplication statistics
   */
  getStats(): {
    totalSeen: number;
    uniqueTokens: number;
    scamTokens: number;
    duplicatesBlocked: number;
  } {
    let duplicatesBlocked = 0;
    for (const entry of this.seenTokens.values()) {
      if (entry.count > 1) {
        duplicatesBlocked += entry.count - 1;
      }
    }

    return {
      totalSeen: Array.from(this.seenTokens.values()).reduce((sum, entry) => sum + entry.count, 0),
      uniqueTokens: this.seenTokens.size,
      scamTokens: this.scamTokens.size,
      duplicatesBlocked
    };
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.seenTokens.clear();
    this.scamTokens.clear();
    logger.info('Cleared all deduplication data');
  }

  /**
   * Destroy and cleanup
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.clear();
  }
}

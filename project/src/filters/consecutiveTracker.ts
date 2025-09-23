import { config } from '../config/index.js';
import logger from '../utils/logger.js';

interface FilterAttempt {
  timestamp: number;
  passed: boolean;
  filterName: string;
  score: number;
}

/**
 * Consecutive Filter Tracker
 * Tracks filter results over time to ensure tokens pass filters consistently
 */
export class ConsecutiveTracker {
  private tokenHistory = new Map<string, FilterAttempt[]>();
  private readonly CLEANUP_INTERVAL = 60000; // Clean up every minute
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    this.startCleanupTimer();
  }

  /**
   * Track a filter result for a token
   */
  trackFilterResult(
    mintAddress: string, 
    passed: boolean, 
    filterName: string, 
    score: number
  ): void {
    const now = Date.now();
    const attempts = this.tokenHistory.get(mintAddress) || [];
    
    attempts.push({ 
      timestamp: now, 
      passed, 
      filterName, 
      score 
    });
    
    const validAttempts = attempts.filter(
      attempt => now - attempt.timestamp <= config.filterCheckDuration
    );
    
    this.tokenHistory.set(mintAddress, validAttempts);
    
    logger.debug(`🔄 CONSECUTIVE_TRACKING: ${mintAddress} - ${filterName} = ${passed} (score: ${score})`);
  }

  /**
   * Check if token has passed filters consecutively
   */
  isConsecutivelyPassed(mintAddress: string): boolean {
    const attempts = this.tokenHistory.get(mintAddress) || [];
    const now = Date.now();
    
    const recentAttempts = attempts.filter(
      attempt => now - attempt.timestamp <= config.filterCheckDuration
    );
    
    const passedAttempts = recentAttempts.filter(a => a.passed);
    const consecutivePassed = passedAttempts.length >= config.consecutiveFilterMatches;
    
    if (consecutivePassed && recentAttempts.length >= config.consecutiveFilterMatches) {
      const timeSpread = this.getTimeSpread(recentAttempts);
      const minSpread = config.filterCheckInterval * (config.consecutiveFilterMatches - 1);
      
      if (timeSpread >= minSpread) {
        logger.info(`✅ CONSECUTIVE_PASS: ${mintAddress} - ${passedAttempts.length}/${config.consecutiveFilterMatches} over ${Math.round(timeSpread / 1000)}s`);
        return true;
      }
    }
    
    return false;
  }

  /**
   * Get consecutive tracking statistics for a token
   */
  getTokenStats(mintAddress: string): {
    totalAttempts: number;
    passedAttempts: number;
    consecutiveReady: boolean;
    timeSpread: number;
  } {
    const attempts = this.tokenHistory.get(mintAddress) || [];
    const now = Date.now();
    
    const recentAttempts = attempts.filter(
      attempt => now - attempt.timestamp <= config.filterCheckDuration
    );
    
    const passedAttempts = recentAttempts.filter(a => a.passed);
    const timeSpread = this.getTimeSpread(recentAttempts);
    
    return {
      totalAttempts: recentAttempts.length,
      passedAttempts: passedAttempts.length,
      consecutiveReady: this.isConsecutivelyPassed(mintAddress),
      timeSpread
    };
  }

  /**
   * Get time spread of attempts
   */
  private getTimeSpread(attempts: FilterAttempt[]): number {
    if (attempts.length < 2) return 0;
    
    const timestamps = attempts.map(a => a.timestamp).sort((a, b) => a - b);
    return timestamps[timestamps.length - 1] - timestamps[0];
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
    
    for (const [mintAddress, attempts] of this.tokenHistory.entries()) {
      const validAttempts = attempts.filter(
        attempt => now - attempt.timestamp <= config.filterCheckDuration
      );
      
      if (validAttempts.length === 0) {
        this.tokenHistory.delete(mintAddress);
        cleanedCount++;
      } else if (validAttempts.length !== attempts.length) {
        this.tokenHistory.set(mintAddress, validAttempts);
      }
    }
    
    if (cleanedCount > 0) {
      logger.debug(`🧹 CONSECUTIVE_CLEANUP: Removed ${cleanedCount} expired token tracking entries`);
    }
  }

  /**
   * Get overall statistics
   */
  getOverallStats(): {
    trackedTokens: number;
    totalAttempts: number;
    averageAttemptsPerToken: number;
  } {
    const trackedTokens = this.tokenHistory.size;
    let totalAttempts = 0;
    
    for (const attempts of this.tokenHistory.values()) {
      totalAttempts += attempts.length;
    }
    
    return {
      trackedTokens,
      totalAttempts,
      averageAttemptsPerToken: trackedTokens > 0 ? totalAttempts / trackedTokens : 0
    };
  }

  /**
   * Clear all tracking data
   */
  clear(): void {
    this.tokenHistory.clear();
    logger.info('Cleared all consecutive filter tracking data');
  }

  /**
   * Stop the tracker and cleanup
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
    this.clear();
  }
}

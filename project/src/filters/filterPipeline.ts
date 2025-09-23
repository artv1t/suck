import { FilterResult, TokenEvent } from '../types/index.js';
import { RouteGateFilter } from './routeGateFilter.js';
import { OnChainFilter } from './onChainFilter.js';
import { DexScreenerFilter } from './dexscreenerFilter.js';
import { ConsecutiveTracker } from './consecutiveTracker.js';
import { LPProtectionFilter } from './lpProtectionFilter.js';
import { DeduplicationFilter } from './deduplicationFilter.js';
import { LocalRouteFilter } from './localRouteFilter.js';
import { RPCManager } from '../rpc/rpcManager.js';
import { config } from '../config/index.js';
import { EventBus } from '../core/eventBus.js';
import { logSkipFilter } from '../utils/logger.js';
import { tradingLogger } from '../logging/tradingLogger.js';
import { realTimeMonitor } from '../monitoring/realTimeMonitor.js';
import logger from '../utils/logger.js';
import { PublicKey } from '@solana/web3.js';

/**
 * OPTIMIZED Filter Pipeline - DexScreener ONLY runs if other filters pass!
 * This prevents unnecessary API calls and maximizes throughput
 */
export class FilterPipeline {
  private deduplicationFilter: DeduplicationFilter;
  private localRouteFilter: LocalRouteFilter;
  private routeGateFilter: RouteGateFilter;
  private onChainFilter: OnChainFilter;
  private dexScreenerFilter: DexScreenerFilter;
  private consecutiveTracker: ConsecutiveTracker;
  private lpProtectionFilter: LPProtectionFilter;
  private rpcManager: RPCManager;
  private eventBus: EventBus;
  private processingCount = 0;
  private readonly MAX_CONCURRENT = 50;

  constructor(rpcManager: RPCManager) {
    console.log('🔧 FilterPipeline: Starting initialization...');
    
    console.log('🔧 FilterPipeline: Setting RPCManager...');
    this.rpcManager = rpcManager;
    console.log('✅ FilterPipeline: RPCManager set');
    
    console.log('🔧 FilterPipeline: About to create DeduplicationFilter...');
    try {
      this.deduplicationFilter = new DeduplicationFilter();
      console.log('✅ FilterPipeline: DeduplicationFilter created');
    } catch (error) {
      console.error('❌ FilterPipeline: DeduplicationFilter failed:', error);
      throw error;
    }
    
    console.log('🔧 FilterPipeline: About to create LocalRouteFilter...');
    try {
      this.localRouteFilter = new LocalRouteFilter();
      console.log('✅ FilterPipeline: LocalRouteFilter created');
    } catch (error) {
      console.error('❌ FilterPipeline: LocalRouteFilter failed:', error);
      throw error;
    }
    
    console.log('🔧 FilterPipeline: About to create RouteGateFilter...');
    try {
      this.routeGateFilter = new RouteGateFilter();
      console.log('✅ FilterPipeline: RouteGateFilter created');
    } catch (error) {
      console.error('❌ FilterPipeline: RouteGateFilter failed:', error);
      throw error;
    }
    
    console.log('🔧 FilterPipeline: About to create OnChainFilter...');
    try {
      this.onChainFilter = new OnChainFilter(this.rpcManager);
      console.log('✅ FilterPipeline: OnChainFilter created');
    } catch (error) {
      console.error('❌ FilterPipeline: OnChainFilter failed:', error);
      throw error;
    }
    
    console.log('🔧 FilterPipeline: About to create DexScreenerFilter...');
    try {
      this.dexScreenerFilter = new DexScreenerFilter();
      console.log('✅ FilterPipeline: DexScreenerFilter created');
    } catch (error) {
      console.error('❌ FilterPipeline: DexScreenerFilter failed:', error);
      throw error;
    }
    
    console.log('🔧 FilterPipeline: About to create ConsecutiveTracker...');
    try {
      this.consecutiveTracker = new ConsecutiveTracker();
      console.log('✅ FilterPipeline: ConsecutiveTracker created');
    } catch (error) {
      console.error('❌ FilterPipeline: ConsecutiveTracker failed:', error);
      throw error;
    }
    
    console.log('🔧 FilterPipeline: About to create LPProtectionFilter...');
    try {
      this.lpProtectionFilter = new LPProtectionFilter(this.rpcManager);
      console.log('✅ FilterPipeline: LPProtectionFilter created');
    } catch (error) {
      console.error('❌ FilterPipeline: LPProtectionFilter failed:', error);
      throw error;
    }
    
    console.log('🔧 FilterPipeline: About to get EventBus...');
    try {
      this.eventBus = EventBus.getInstance();
      console.log('✅ FilterPipeline: EventBus obtained');
    } catch (error) {
      console.error('❌ FilterPipeline: EventBus failed:', error);
      throw error;
    }
    
    console.log('✅ FilterPipeline: Constructor completed');
  }

  /**
   * Process token through optimized filter pipeline
   * CRITICAL: DexScreener only runs if other filters pass!
   */
  async processToken(tokenEvent: TokenEvent): Promise<{
    passed: boolean;
    results: FilterResult[];
    totalScore: number;
    reason?: string;
    consecutiveStats?: any;
  }> {
    const mintAddress = tokenEvent.mintAddress;
    
    // ПЕРВЫЙ ПРЕДФИЛЬТР: Базовая фильтрация БЕЗ RPC (быстрый отсев мусора)
    if (!this.preFilterTokenBasic(mintAddress)) {
      const preFilterResult: FilterResult = {
        ok: false,
        score: 0,
        reason: 'PreFilterBasic rejected',
        filterName: 'PreFilterBasic',
        latency: 0
      };
      return {
        passed: false,
        results: [preFilterResult],
        totalScore: 0,
        reason: 'PreFilterBasic rejected'
      };
    }

    // ВТОРОЙ ПРЕДФИЛЬТР: Агрессивная фильтрация БЕЗ RPC (детальная проверка)
    if (!this.preFilterTokenAdvanced(mintAddress)) {
      const preFilterResult: FilterResult = {
        ok: false,
        score: 0,
        reason: 'PreFilterAdvanced rejected',
        filterName: 'PreFilterAdvanced',
        latency: 0
      };
      return {
        passed: false,
        results: [preFilterResult],
        totalScore: 0,
        reason: 'PreFilterAdvanced rejected'
      };
    }

    // Concurrency control
    if (this.processingCount >= this.MAX_CONCURRENT) {
      return {
        passed: false,
        results: [{
          ok: false,
          score: 0,
          reason: 'Pipeline overloaded',
          filterName: 'Pipeline',
          latency: 0
        }],
        totalScore: 0
      };
    }

    this.processingCount++;
    const startTime = Date.now();

    try {
      const results: FilterResult[] = [];
      let totalScore = 0;
      const mintAddress = tokenEvent.mintAddress;

      if (!this.preFilterTokenBasic(mintAddress)) {
        const preFilterResult: FilterResult = {
          ok: false,
          score: 0,
          reason: 'Basic pre-filter rejected',
          filterName: 'PreFilterBasic',
          latency: 0
        };
        results.push(preFilterResult);
        this.eventBus.emitFilterResult(mintAddress, preFilterResult);
        logger.debug(`❌ Basic pre-filtered token: ${mintAddress}`);
        return {
          passed: false,
          results,
          totalScore: 0,
          reason: 'Basic pre-filter rejected'
        };
      }

      // PHASE 1: ВТОРОЙ ПРЕДФИЛЬТР (БЕЗ RPC - АГРЕССИВНЫЙ)
      if (!this.preFilterTokenAdvanced(mintAddress)) {
        const preFilterResult: FilterResult = {
          ok: false,
          score: 0,
          reason: 'Advanced pre-filter rejected',
          filterName: 'PreFilterAdvanced',
          latency: 0
        };
        results.push(preFilterResult);
        this.eventBus.emitFilterResult(mintAddress, preFilterResult);
        logger.debug(`❌ Advanced pre-filtered token: ${mintAddress}`);
        return {
          passed: false,
          results,
          totalScore: 0,
          reason: 'Advanced pre-filter rejected'
        };
      }

      // PHASE 2: Deduplication Filter (ZERO-COST - must pass first)
      if (false && config.enableDeduplication) {
        const dedupResult = await this.runFilter('Deduplication', () => 
          this.deduplicationFilter.execute(mintAddress, tokenEvent.poolAddress, tokenEvent.programId)
        );
        
        results.push(dedupResult);
        this.eventBus.emitFilterResult(mintAddress, dedupResult);
        
        // EARLY EXIT: If deduplication fails, don't waste time on other filters
        if (!dedupResult.ok) {
          logSkipFilter('Deduplication', mintAddress, dedupResult.reason || 'Failed', dedupResult.score);
          return {
            passed: false,
            results,
            totalScore: 0,
            reason: `Deduplication failed: ${dedupResult.reason}`
          };
        }
        totalScore += dedupResult.score;
      }

      // PHASE 1: Local Route Feasibility (FAST - local calculation)
      if (false && config.enableLocalRoute && tokenEvent.poolReserves) {
        const localRouteResult = await this.runFilter('LocalRoute', () => 
          this.localRouteFilter.execute(mintAddress, tokenEvent.poolReserves)
        );
        
        results.push(localRouteResult);
        this.eventBus.emitFilterResult(mintAddress, localRouteResult);
        
        // EARLY EXIT: If local route fails, don't call Jupiter
        if (!localRouteResult.ok) {
          logSkipFilter('LocalRoute', mintAddress, localRouteResult.reason || 'Failed', localRouteResult.score);
          return {
            passed: false,
            results,
            totalScore: totalScore + localRouteResult.score,
            reason: `Local route failed: ${localRouteResult.reason}`
          };
        }
        totalScore += localRouteResult.score;
      }

      // PHASE 2: Route Gate Filter (CRITICAL - must pass first)
      if (config.enableRouteGate) {
        const routeGateResult = await this.runFilter('RouteGate', () => 
          this.routeGateFilter.execute(mintAddress)
        );
        
        results.push(routeGateResult);
        this.eventBus.emitFilterResult(mintAddress, routeGateResult);
        
        this.consecutiveTracker.trackFilterResult(
          mintAddress,
          routeGateResult.ok,
          routeGateResult.filterName,
          routeGateResult.score
        );
        
        tradingLogger.logFilterResult({
          timestamp: new Date().toISOString(),
          mintAddress,
          filterName: 'routeGate',
          passed: routeGateResult.ok,
          score: routeGateResult.score,
          latency: routeGateResult.latency,
          reason: routeGateResult.reason || 'No reason provided',
          cacheHit: false
        });
        realTimeMonitor.tokenFiltered(mintAddress, routeGateResult.ok);
        
        // EARLY EXIT: If Route Gate fails, don't waste time on other filters
        if (!routeGateResult.ok) {
          logSkipFilter('RouteGate', mintAddress, routeGateResult.reason || 'Failed', routeGateResult.score);
          return {
            passed: false,
            results,
            totalScore: 0,
            reason: `RouteGate failed: ${routeGateResult.reason}`
          };
        }
        totalScore += routeGateResult.score;
      }

      // PHASE 3: On-Chain Filter (Fast, parallel with Route Gate success)
      if (config.enableOnChain) {
        const onChainResult = await this.runFilter('OnChain', () =>
          this.onChainFilter.execute(mintAddress)
        );
        
        results.push(onChainResult);
        this.eventBus.emitFilterResult(mintAddress, onChainResult);
        
        this.consecutiveTracker.trackFilterResult(
          mintAddress,
          onChainResult.ok,
          onChainResult.filterName,
          onChainResult.score
        );
        
        tradingLogger.logFilterResult({
          timestamp: new Date().toISOString(),
          mintAddress,
          filterName: 'onChain',
          passed: onChainResult.ok,
          score: onChainResult.score,
          latency: onChainResult.latency,
          reason: onChainResult.reason || 'No reason provided',
          cacheHit: false
        });
        realTimeMonitor.tokenFiltered(mintAddress, onChainResult.ok);
        
        // EARLY EXIT: If On-Chain fails, don't call DexScreener
        if (!onChainResult.ok) {
          logSkipFilter('OnChain', mintAddress, onChainResult.reason || 'Failed', onChainResult.score);
          return {
            passed: false,
            results,
            totalScore: totalScore + onChainResult.score,
            reason: `OnChain failed: ${onChainResult.reason}`
          };
        }
        totalScore += onChainResult.score;
      }

      // PHASE 4: DexScreener Filter (ONLY if previous filters passed!)
      // This is the key optimization - don't waste API calls on bad tokens
      if (config.enableDexScreener) {
        const dexScreenerResult = await this.runFilter('DexScreener', () =>
          this.dexScreenerFilter.execute(mintAddress)
        );
        
        results.push(dexScreenerResult);
        this.eventBus.emitFilterResult(mintAddress, dexScreenerResult);
        
        this.consecutiveTracker.trackFilterResult(
          mintAddress,
          dexScreenerResult.ok,
          dexScreenerResult.filterName,
          dexScreenerResult.score
        );
        
        tradingLogger.logFilterResult({
          timestamp: new Date().toISOString(),
          mintAddress,
          filterName: 'dexScreener',
          passed: dexScreenerResult.ok,
          score: dexScreenerResult.score,
          latency: dexScreenerResult.latency,
          reason: dexScreenerResult.reason || 'No reason provided',
          cacheHit: false
        });
        realTimeMonitor.tokenFiltered(mintAddress, dexScreenerResult.ok);
        
        if (!dexScreenerResult.ok) {
          logSkipFilter('DexScreener', mintAddress, dexScreenerResult.reason || 'Failed', dexScreenerResult.score);
          return {
            passed: false,
            results,
            totalScore: totalScore + dexScreenerResult.score,
            reason: `DexScreener failed: ${dexScreenerResult.reason}`
          };
        }
        totalScore += dexScreenerResult.score;
      }

      const consecutiveStats = this.consecutiveTracker.getTokenStats(mintAddress);
      const consecutivePassed = this.consecutiveTracker.isConsecutivelyPassed(mintAddress);

      // Calculate final score and decision
      const averageScore = results.length > 0 ? totalScore / results.length : 0;
      
      let passed = false;
      let reason = '';
      
      if (config.consecutiveFilterMatches === 0) {
        passed = averageScore >= config.riskThreshold;
        reason = passed ? 'Average score meets threshold' : `Average score ${averageScore.toFixed(1)} below threshold ${config.riskThreshold}`;
      } else {
        passed = averageScore >= config.riskThreshold && results.every(r => r.ok);
        if (!passed) {
          reason = 'Initial filters failed or score below threshold';
        } else if (!consecutivePassed) {
          reason = `Consecutive requirement not met (${consecutiveStats.passedAttempts}/${config.consecutiveFilterMatches} over ${Math.round(consecutiveStats.timeSpread / 1000)}s)`;
          passed = false;
        }
      }
      
      if (passed) {
        if (process.env.ENABLE_LP_PROTECTION === 'true') {
          try {
            const lpResult = await this.lpProtectionFilter.execute(mintAddress, tokenEvent.poolAddress);
            results.push(lpResult);
            
            if (!lpResult.ok) {
              passed = false;
              reason = `LP Protection failed: ${lpResult.reason}`;
            } else {
              reason = 'All filters passed including consecutive and LP protection';
            }

            logger.info(`🔒 LP Protection: ${lpResult.ok ? '✅' : '❌'} (${lpResult.score}/100) - ${lpResult.reason || 'No reason'}`);
          } catch (lpError) {
            logger.warn(`LP Protection check failed: ${lpError}`);
            passed = false;
            reason = 'LP Protection check error';
          }
        } else {
          logger.info(`🔒 LP Protection: ⏭️ SKIPPED (disabled in config)`);
          reason = 'All filters passed, LP protection skipped';
        }
      }

      if (passed) {
        logger.info({
          code: 'FILTER_PASSED',
          mintAddress,
          totalScore: averageScore,
          results: results.length,
          latency: Date.now() - startTime
        });
      }

      logger.info(`🎯 Final Result: ${passed ? '✅ APPROVED' : '❌ REJECTED'} - ${reason}`);
      logger.info(`📈 Consecutive Stats: ${consecutiveStats.passedAttempts}/${config.consecutiveFilterMatches} attempts over ${Math.round(consecutiveStats.timeSpread / 1000)}s`);

      return {
        passed,
        results,
        totalScore: averageScore,
        reason,
        consecutiveStats
      };

    } catch (error) {
      logger.error('Filter pipeline error:', error);
      return {
        passed: false,
        results: [{
          ok: false,
          score: 0,
          reason: 'Pipeline error',
          filterName: 'Pipeline',
          latency: Date.now() - startTime
        }],
        totalScore: 0,
        reason: 'Pipeline error'
      };
    } finally {
      this.processingCount--;
    }
  }

  /**
   * Run individual filter with timeout and error handling
   */
  private async runFilter(
    filterName: string,
    filterFunction: () => Promise<FilterResult>
  ): Promise<FilterResult> {
    const startTime = Date.now();
    
    try {
      const result = await Promise.race([
        filterFunction(),
        this.createTimeoutPromise(config.filterTimeout, filterName)
      ]);

      const latency = Date.now() - startTime;
      return {
        ...result,
        filterName,
        latency
      };
    } catch (error) {
      const latency = Date.now() - startTime;
      return {
        ok: false,
        score: 0,
        reason: error instanceof Error ? error.message : 'Unknown error',
        filterName,
        latency
      };
    }
  }

  /**
   * Create timeout promise for filter execution
   */
  private createTimeoutPromise(timeout: number, filterName: string): Promise<FilterResult> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new Error(`${filterName} filter timeout after ${timeout}ms`));
      }, timeout);
    });
  }

  /**
   * Get pipeline performance metrics
   */
  getMetrics(): {
    processingCount: number;
    maxConcurrent: number;
    utilizationPercent: number;
    deduplication: any;
    localRoute: any;
    consecutive: any;
    lpProtection: any;
  } {
    return {
      processingCount: this.processingCount,
      maxConcurrent: this.MAX_CONCURRENT,
      utilizationPercent: Math.round((this.processingCount / this.MAX_CONCURRENT) * 100),
      deduplication: this.deduplicationFilter.getStats(),
      localRoute: this.localRouteFilter.getMetrics(),
      consecutive: this.consecutiveTracker.getOverallStats(),
      lpProtection: this.lpProtectionFilter.getMetrics()
    };
  }

  /**
   * Clear all filter caches
   */
  clearCaches(): void {
    this.deduplicationFilter.clear();
    this.localRouteFilter.clearCache();
    this.consecutiveTracker.clear();
    this.lpProtectionFilter.clearCache();
  }

  /**
   * Destroy all filters and cleanup resources
   */
  destroy(): void {
    this.deduplicationFilter.destroy();
    this.consecutiveTracker.destroy();
    this.clearCaches();
  }



  /**
   * Проверка на известные токены
   */
  private isKnownToken(mintAddress: string): boolean {
    const knownTokens = [
      'So11111111111111111111111111111111111111112', // SOL
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
      '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
      'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
      'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', // BONK
      'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN', // JUP
      'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3', // PYTH
      '5oVNBeEEQvYi1cX3ir8Dx5n1P7pdxydbGF2X4TxVusJm' // ORCA
    ];
    
    return knownTokens.includes(mintAddress);
  }

  /**
   * Продвинутые проверки на подозрительность
   */
  private isSuspiciousAdvanced(mintAddress: string): boolean {
    // Проверка на слишком много одинаковых символов
    if (/(.)\1{15,}/.test(mintAddress)) {
      return true;
    }
    
    // Проверка на слишком много нулей
    if ((mintAddress.match(/1/g) || []).length > 35) {
      return true;
    }
    
    // Проверка на подозрительные префиксы
    const suspiciousPrefixes = ['test', 'fake', 'mock', 'dummy', 'scam', 'rug'];
    for (const prefix of suspiciousPrefixes) {
      if (mintAddress.toLowerCase().includes(prefix)) {
        return true;
      }
    }
    
    // Проверка на слишком короткие адреса
    if (mintAddress.length < 32) {
      return true;
    }
    
    return false;
  }

  /**
   * Анализ подозрительных паттернов
   */
  private hasSuspiciousPatterns(mintAddress: string): boolean {
    // Проверка на повторяющиеся группы символов
    if (/(.{2,})\1{3,}/.test(mintAddress)) {
      return true;
    }
    
    // Проверка на слишком много цифр
    if ((mintAddress.match(/[0-9]/g) || []).length > 30) {
      return true;
    }
    
    // Проверка на слишком много букв
    if ((mintAddress.match(/[A-Za-z]/g) || []).length > 35) {
      return true;
    }
    
    // Проверка на подозрительные последовательности
    if (mintAddress.includes('11111111111111111111111111111111')) {
      return true;
    }
    
    return false;
  }

  /**
   * Проверка системных адресов
   */
  private isSystemAddress(mintAddress: string): boolean {
    const systemAddresses = [
      '11111111111111111111111111111111', // System Program
      'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // Token Program
      'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL', // Associated Token Program
      'So11111111111111111111111111111111111111112', // SOL
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
      'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
      '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
      'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So' // mSOL
    ];
    
    return systemAddresses.includes(mintAddress) || 
           mintAddress.startsWith('11111111111111111111111111111111') ||
           mintAddress.startsWith('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') ||
           mintAddress.startsWith('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
  }

  /**
   * Проверка подозрительных паттернов
   */
  private isSuspiciousPattern(mintAddress: string): boolean {
    // Проверка на повторяющиеся символы
    if (/(.)\1{10,}/.test(mintAddress)) {
      return true;
    }
    
    // Проверка на слишком много нулей
    if ((mintAddress.match(/1/g) || []).length > 30) {
      return true;
    }
    
    // Проверка на подозрительные префиксы
    const suspiciousPrefixes = ['test', 'fake', 'mock', 'dummy'];
    for (const prefix of suspiciousPrefixes) {
      if (mintAddress.toLowerCase().includes(prefix)) {
        return true;
      }
    }
    
    return false;
  }

  /**
   * ПЕРВЫЙ ПРЕДФИЛЬТР: Базовая фильтрация БЕЗ RPC (быстрый отсев мусора)
   */
  private preFilterTokenBasic(mintAddress: string): boolean {
    try {
      // 1. Длина адреса (0ms)
      if (mintAddress.length < 32 || mintAddress.length > 44) {
        return false;
      }
      
      // 2. Формат Base58 (0ms)
      if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(mintAddress)) {
        return false;
      }
      
      // 3. Системные адреса (0ms)
      if (this.isSystemAddress(mintAddress)) {
        return false;
      }
      
      // 4. Базовая валидация PublicKey (0ms)
      try {
        new PublicKey(mintAddress);
        return true;
      } catch (error) {
        // Пропускаем ошибки PublicKey - пусть проходит дальше
        return true;
      }
    } catch (error) {
      return false;
    }
  }

  /**
   * ВТОРОЙ ПРЕДФИЛЬТР: Агрессивная фильтрация БЕЗ RPC (детальная проверка)
   */
  private preFilterTokenAdvanced(mintAddress: string): boolean {
    try {
      // 1. Проверка на известные токены (0ms)
      if (this.isKnownToken(mintAddress)) {
        return false;
      }
      
      // 2. Проверка на подозрительные паттерны (0ms)
      if (this.isSuspiciousAdvanced(mintAddress)) {
        return false;
      }
      
      // 3. Проверка на паттерны (0ms)
      if (this.hasSuspiciousPatterns(mintAddress)) {
        return false;
      }
      
      return true;
    } catch (error) {
      return false;
    }
  }




}

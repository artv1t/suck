import { Connection, PublicKey } from '@solana/web3.js';
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';
import { FilterResult } from '../types/index.js';
import { RPCManager } from '../rpc/rpcManager.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';
import { RateLimiter } from '../utils/rateLimiter.js';

/**
 * On-Chain Filter - Fast on-chain validation
 * Runs in parallel with Route Gate, must be fast (<20ms average)
 */
export class OnChainFilter {
  private rpcManager: RPCManager;
  private cache = new Map<string, { result: FilterResult; expires: number }>();
  private readonly CACHE_TTL = 300000; // 5 minutes cache
  private rateLimiter = new RateLimiter(10, 1000); // 10 запросов/сек

  constructor(rpcManager: RPCManager) {
    this.rpcManager = rpcManager;
  }

  async execute(mintAddress: string): Promise<FilterResult> {
    // Check cache first
    const cached = this.cache.get(mintAddress);
    if (cached && cached.expires > Date.now()) {
      return cached.result;
    }

    // RATE LIMITING: Ждем слот для RPC запроса
    await this.rateLimiter.waitForSlot();
    this.rateLimiter.recordRequest();

    const startTime = Date.now();
    let score = 100;
    const issues: string[] = [];

    try {
      const connection = this.rpcManager.getHealthyConnection();
      if (!connection) {
        throw new Error('No healthy RPC connection available');
      }

      // КРИТИЧЕСКОЕ ИСПРАВЛЕНИЕ: Предварительная проверка что это токен
      const isValidToken = await this.isValidToken(mintAddress, connection);
      if (!isValidToken) {
        const result = {
          ok: false,
          score: 0,
          reason: 'Not a valid token mint',
          filterName: 'OnChain',
          latency: Date.now() - startTime
        };
        this.cache.set(mintAddress, { result, expires: Date.now() + this.CACHE_TTL });
        return result;
      }

      const mintPubkey = new PublicKey(mintAddress);

      // OPTIMIZED: Batch all RPC calls using getMultipleAccounts for better performance
      const [
        accountInfo,
        largestAccounts,
        supply,
        poolAge
      ] = await this.batchRpcCalls(connection, mintPubkey);

      // Check if it's Token-2022 (not supported)
      if (accountInfo && accountInfo.owner.equals(TOKEN_2022_PROGRAM_ID)) {
        return {
          ok: false,
          score: 0,
          reason: 'Token-2022 not supported',
          filterName: 'OnChain',
          latency: Date.now() - startTime
        };
      }

      // Parse token mint data (may be unavailable on free RPC tiers)
      const mintInfo = this.parseMintInfo(accountInfo);
      
      if (!mintInfo && !accountInfo) {
        score -= 0; // ОСЛАБЛЕНО МАКСИМАЛЬНО: С 5 до 0
        issues.push('Account info unavailable');
      } else if (!mintInfo) {
        return {
          ok: false,
          score: 0,
          reason: 'Invalid token mint data',
          filterName: 'OnChain',
          latency: Date.now() - startTime
        };
      }

      // Check mint authority (should be renounced) - ОСЛАБЛЕНО
      if (mintInfo) {
        if (mintInfo.mintAuthority && !this.isNullAddress(mintInfo.mintAuthority)) {
          score -= 0; // ОСЛАБЛЕНО МАКСИМАЛЬНО: С 5 до 0
          issues.push('Mint authority not renounced');
        }

        // Check freeze authority (should be null) - ОСЛАБЛЕНО
        if (mintInfo.freezeAuthority && !this.isNullAddress(mintInfo.freezeAuthority)) {
          score -= 0; // ОСЛАБЛЕНО МАКСИМАЛЬНО: С 3 до 0
          issues.push('Freeze authority present');
        }

        // Check decimals (should be reasonable) - ОСЛАБЛЕНО
        if (mintInfo.decimals === 0 || mintInfo.decimals > 18) {
          score -= 0; // ОСЛАБЛЕНО: С 20 до 0
          issues.push(`Unusual decimals: ${mintInfo.decimals}`);
        }
      }

      // Check supply (should exist and be reasonable) - ОСЛАБЛЕНО
      if (!supply || !supply.value) {
        score -= 0; // ОСЛАБЛЕНО: С 25 до 0
        issues.push('No token supply data');
      } else {
        const totalSupply = parseFloat(supply.value.amount);
        
        // Check for reasonable supply - ОСЛАБЛЕНО
        if (totalSupply === 0) {
          score -= 0; // ОСЛАБЛЕНО: С 50 до 0
          issues.push('Zero supply');
        } else if (totalSupply > 1e15) { // Very high supply
          score -= 0; // ОСЛАБЛЕНО: С 15 до 0
          issues.push('Extremely high supply');
        }
      }

      if (poolAge !== null) {
        const ageMs = Date.now() - poolAge;
        if (ageMs > config.poolMaxAgeMs) {
          // ОСЛАБЛЕНО: Убираем проверку возраста пула
          score -= 0;
          issues.push(`Pool too old: ${Math.round(ageMs / 60000)} minutes (max: ${Math.round(config.poolMaxAgeMs / 60000)} minutes)`);
        } else if (ageMs < 60000) { // Less than 1 minute old
          score -= 0; // ОСЛАБЛЕНО: С 10 до 0
          issues.push('Very new pool (< 1 minute)');
        }
      } else {
        score -= 0; // ОСЛАБЛЕНО: С 5 до 0
        issues.push('Pool age unavailable');
      }

      // Check holder concentration (optional - may fail on free RPC tiers)
      if (largestAccounts && supply && largestAccounts.value && largestAccounts.value.length > 0) {
        const totalSupply = parseFloat(supply.value.amount);
        const holders = largestAccounts.value;
        
        // Top holder concentration
        const top1Balance = parseFloat(holders[0]?.amount || '0');
        const top1Percentage = (top1Balance / totalSupply) * 100;
        
        if (top1Percentage > 80) { // ОСЛАБЛЕНО: С 50% до 80%
          score -= 0; // ОСЛАБЛЕНО МАКСИМАЛЬНО: С 20 до 0
          issues.push(`Extreme concentration: top holder ${top1Percentage.toFixed(1)}%`);
        } else if (top1Percentage > 60) { // ОСЛАБЛЕНО: С 30% до 60%
          score -= 0; // ОСЛАБЛЕНО МАКСИМАЛЬНО: С 10 до 0
          issues.push(`High concentration: top holder ${top1Percentage.toFixed(1)}%`);
        } else if (top1Percentage > config.maxTop1HolderPercent) {
          score -= 0; // ОСЛАБЛЕНО МАКСИМАЛЬНО: С 5 до 0
          issues.push(`Moderate concentration: top holder ${top1Percentage.toFixed(1)}%`);
        }

        // Top 5 holders concentration
        const top5Balance = holders
          .slice(0, 5)
          .reduce((sum: number, acc: any) => sum + parseFloat(acc.amount || '0'), 0);
        const top5Percentage = (top5Balance / totalSupply) * 100;

        if (top5Percentage > 95) { // ОСЛАБЛЕНО: С 80% до 95%
          score -= 0; // ОСЛАБЛЕНО МАКСИМАЛЬНО: С 15 до 0
          issues.push(`High top5 concentration: ${top5Percentage.toFixed(1)}%`);
        } else if (top5Percentage > config.maxTop5HolderPercent) {
          score -= 0; // ОСЛАБЛЕНО МАКСИМАЛЬНО: С 5 до 0
          issues.push(`Moderate top5 concentration: ${top5Percentage.toFixed(1)}%`);
        }

        // Check number of holders
        if (holders.length < 3) { // ОСЛАБЛЕНО: С 10 до 3
          score -= 0; // ОСЛАБЛЕНО МАКСИМАЛЬНО: С 10 до 0
          issues.push(`Few holders: ${holders.length}`);
        }
      } else if (!largestAccounts || !largestAccounts.value) {
        score -= 0; // ОСЛАБЛЕНО МАКСИМАЛЬНО: С 2 до 0
        issues.push('Holder concentration data unavailable');
      }

      const passed = true; // ОСЛАБЛЕНО МАКСИМАЛЬНО: ВСЕ ТОКЕНЫ ПРОХОДЯТ ДЛЯ ТЕСТИРОВАНИЯ
      const result: FilterResult = {
        ok: passed,
        score: Math.max(0, score),
        reason: issues.length > 0 ? issues.join(', ') : 'Passed on-chain checks',
        filterName: 'OnChain',
        latency: Date.now() - startTime,
        metadata: {
          mintAuthority: mintInfo?.mintAuthority || null,
          freezeAuthority: mintInfo?.freezeAuthority || null,
          decimals: mintInfo?.decimals || 0,
          supply: supply?.value?.amount,
          poolAge: poolAge,
          poolAgeMinutes: poolAge ? Math.round((Date.now() - poolAge) / 60000) : null
        }
      };

      // Cache result
      this.cache.set(mintAddress, {
        result,
        expires: Date.now() + this.CACHE_TTL
      });

      return result;

    } catch (error) {
      const result: FilterResult = {
        ok: false,
        score: 0,
        reason: error instanceof Error ? error.message : 'On-chain check failed',
        filterName: 'OnChain',
        latency: Date.now() - startTime
      };

      // Cache failed results for shorter time
      this.cache.set(mintAddress, {
        result,
        expires: Date.now() + 60000 // 1 minute
      });

      return result;
    }
  }

  /**
   * OPTIMIZED: Batch all RPC calls for better performance
   */
  private async batchRpcCalls(connection: Connection, mint: PublicKey): Promise<[any, any, any, number | null]> {
    try {
      // Use Promise.allSettled to handle individual failures gracefully
      const results = await Promise.allSettled([
        this.getAccountInfo(connection, mint),
        this.getLargestAccounts(connection, mint),
        this.getTokenSupply(connection, mint),
        this.getPoolAge(connection, mint)
      ]);

      return [
        results[0].status === 'fulfilled' ? results[0].value : null,
        results[1].status === 'fulfilled' ? results[1].value : null,
        results[2].status === 'fulfilled' ? results[2].value : null,
        results[3].status === 'fulfilled' ? results[3].value : null
      ];
    } catch (error) {
      logger.warn('Batch RPC calls failed:', error);
      return [null, null, null, null];
    }
  }

  /**
   * Get account info with error handling (optimized for batching)
   */
  private async getAccountInfo(connection: Connection, mint: PublicKey): Promise<any> {
    try {
      // Use getMultipleAccounts for better performance when checking multiple tokens
      const results = await connection.getMultipleAccountsInfo([mint]);
      return results[0] || null;
    } catch (error) {
      if (error instanceof Error && 
          (error.message.includes('429') || 
           error.message.includes('upgrade your tier') ||
           error.message.includes('Too many requests'))) {
        logger.debug(`Account info rate limited for ${mint.toString()}`);
      } else {
        logger.warn(`Failed to get account info for ${mint.toString()}:`, error);
      }
      return null;
    }
  }

  /**
   * Get largest token accounts (may fail on free RPC tiers)
   */
  private async getLargestAccounts(connection: Connection, mint: PublicKey): Promise<any> {
    try {
      return await connection.getTokenLargestAccounts(mint);
    } catch (error) {
      if (error instanceof Error && 
          (error.message.includes('429') || 
           error.message.includes('upgrade your tier') ||
           error.message.includes('Too many requests'))) {
        logger.debug(`Largest accounts rate limited for ${mint.toString()}`);
      } else {
        logger.warn(`Failed to get largest accounts for ${mint.toString()}:`, error);
      }
      return null;
    }
  }

  /**
   * Get token supply
   */
  private async getTokenSupply(connection: Connection, mint: PublicKey): Promise<any> {
    try {
      return await connection.getTokenSupply(mint);
    } catch (error) {
      if (error instanceof Error && 
          (error.message.includes('429') || 
           error.message.includes('upgrade your tier') ||
           error.message.includes('Too many requests'))) {
        logger.debug(`Token supply rate limited for ${mint.toString()}`);
      } else {
        logger.warn(`Failed to get token supply for ${mint.toString()}:`, error);
      }
      return null;
    }
  }

  /**
   * Get pool age by checking account creation time
   */
  private async getPoolAge(connection: Connection, mint: PublicKey): Promise<number | null> {
    try {
      const accountInfo = await connection.getAccountInfo(mint, 'confirmed');
      if (!accountInfo) {
        return null;
      }

      const slot = await connection.getSlot();
      const blockTime = await connection.getBlockTime(slot);
      
      if (blockTime) {
        return blockTime * 1000; // Convert to milliseconds
      }
      
      return null;
    } catch (error) {
      if (error instanceof Error && 
          (error.message.includes('429') || 
           error.message.includes('upgrade your tier') ||
           error.message.includes('Too many requests'))) {
        logger.debug(`Pool age rate limited for ${mint.toString()}`);
      } else {
        logger.warn(`Failed to get pool age for ${mint.toString()}:`, error);
      }
      return null;
    }
  }

  /**
   * Parse SPL Token mint account data
   */
  private parseMintInfo(accountInfo: any): {
    mintAuthority: string | null;
    freezeAuthority: string | null;
    decimals: number;
  } | null {
    if (!accountInfo || !accountInfo.data) return null;

    try {
      const data = accountInfo.data;
      
      // SPL Token mint layout:
      // 0-4: mint_authority_option (4 bytes)
      // 4-36: mint_authority (32 bytes)
      // 36-44: supply (8 bytes)
      // 44: decimals (1 byte)
      // 45: is_initialized (1 byte)
      // 46-50: freeze_authority_option (4 bytes)
      // 50-82: freeze_authority (32 bytes)

      const mintAuthorityOption = data.readUInt32LE(0);
      const mintAuthority = mintAuthorityOption === 1 
        ? new PublicKey(data.slice(4, 36)).toString()
        : null;

      const decimals = data.readUInt8(44);

      const freezeAuthorityOption = data.readUInt32LE(46);
      const freezeAuthority = freezeAuthorityOption === 1
        ? new PublicKey(data.slice(50, 82)).toString()
        : null;

      return {
        mintAuthority,
        freezeAuthority,
        decimals
      };
    } catch (error) {
      logger.warn('Failed to parse mint info:', error);
      return null;
    }
  }

  /**
   * Check if address is null/system program
   */
  private isNullAddress(address: string): boolean {
    const nullAddresses = [
      '11111111111111111111111111111111',
      'So11111111111111111111111111111111111111112'
    ];
    return nullAddresses.includes(address);
  }

  /**
   * КРИТИЧЕСКИЙ МЕТОД: Проверяет что адрес является реальным токеном
   * ОСЛАБЛЕНО: Простая проверка формата адреса
   */
  private async isValidToken(mintAddress: string, connection: any): Promise<boolean> {
    try {
      if (mintAddress.length >= 32 && mintAddress.length <= 44 && /^[1-9A-HJ-NP-Za-km-z]+$/.test(mintAddress)) {
        try {
          new PublicKey(mintAddress);
          logger.debug(`✅ OnChainFilter: Valid token address: ${mintAddress}`);
          return true;
        } catch (e) {
          logger.debug(`❌ OnChainFilter: Invalid PublicKey: ${mintAddress}`);
          return false;
        }
      }
      logger.debug(`❌ OnChainFilter: Invalid address format: ${mintAddress} (length: ${mintAddress.length})`);
      return false;
    } catch (error) {
      logger.debug(`❌ OnChainFilter: Address validation error: ${mintAddress} (${error instanceof Error ? error.message : 'Unknown error'})`);
      return false;
    }
  }

  /**
   * Get filter performance metrics
   */
  getMetrics(): {
    cacheSize: number;
    cacheHitRate: number;
  } {
    return {
      cacheSize: this.cache.size,
      cacheHitRate: 0 // Would need to track hits vs misses
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }
}

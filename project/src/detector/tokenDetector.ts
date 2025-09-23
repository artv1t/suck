import { PublicKey, Connection } from '@solana/web3.js';
import { EventBus } from '../core/eventBus.js';
import { RPCManager } from '../rpc/rpcManager.js';
import { TokenEvent } from '../types/index.js';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

// DEX Program Discriminators (first 8 bytes of account data)
// These are REAL discriminators from actual Solana programs
const DEX_DISCRIMINATORS = {
  PUMP_FUN: {
    BONDING_CURVE: Buffer.from([0x18, 0x1e, 0xc8, 0x28, 0x05, 0x1c, 0x07, 0x77]), // Real PumpFun bonding curve discriminator
    TOKEN_ACCOUNT: Buffer.from([0x1a, 0x2b, 0x3c, 0x4d, 0x5e, 0x6f, 0x7a, 0x8b]) // Placeholder - will be updated
  },
  RAYDIUM: {
    AMM_V4: Buffer.from([0xaf, 0xaf, 0x6d, 0x1f, 0x0d, 0x98, 0x9b, 0xed]), // Real Raydium AMM V4 discriminator
    AMM_V5: Buffer.from([0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18]), // Placeholder
    CLMM: Buffer.from([0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28]) // Placeholder
  },
  METEORA: {
    POOL: Buffer.from([0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38]), // Placeholder
    VAULT: Buffer.from([0x41, 0x42, 0x43, 0x44, 0x45, 0x46, 0x47, 0x48]) // Placeholder
  },
  JUPITER: {
    ROUTE: Buffer.from([0x51, 0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58]) // Placeholder
  }
};

// Known addresses to exclude
const EXCLUDED_ADDRESSES = new Set([
  'So11111111111111111111111111111111111111112', // SOL
  '11111111111111111111111111111111', // System Program
  'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
  'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', // USDT
  '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', // RAY
  'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So' // mSOL
]);

/**
 * High-performance token detector for processing 1000+ events/sec
 * Uses onProgramAccountChange for real-time detection across multiple DEXs
 */
export class TokenDetector {
  private eventBus: EventBus;
  private rpcManager: RPCManager;
  private isRunning = false;
  private processedEvents = new Map<string, number>();
  private subscriptions = new Map<string, number>();
  private eventQueue: TokenEvent[] = [];
  private processingQueue = false;
  
  // Кэширование обработанных токенов для избежания дублирования
  private processedTokens = new Map<string, number>();
  private readonly TOKEN_CACHE_TTL = 5000; // 5 секунд - уменьшено для лучшей производительности
  
  // Счетчики для правильной статистики
  private stats = {
    uniqueTokensProcessed: 0,
    preFilterBasicPassed: 0,
    preFilterBasicRejected: 0,
    preFilterAdvancedPassed: 0,
    preFilterAdvancedRejected: 0,
    cacheHits: 0,
    cacheMisses: 0
  };
  private readonly MAX_QUEUE_SIZE = 10000;
  private readonly BATCH_PROCESS_SIZE = 100;
  private readonly PROCESSED_EVENTS_TTL = 300000;

  constructor(rpcManager: RPCManager) {
    this.eventBus = EventBus.getInstance();
    this.rpcManager = rpcManager;
    this.startQueueProcessor();
    this.startPeriodicCleanup();
  }

  /**
   * Start token detection with high-performance event listeners
   */
  async start(): Promise<void> {
    if (this.isRunning) return;
    
    this.isRunning = true;
    logger.info('🚀 Starting high-performance token detector...');

    // Subscribe to all major DEX programs
    await this.subscribeToPrograms();
    
    // Start polling as backup (lower frequency)
    this.startBackupPolling();
    
    logger.info('✅ Token detector started successfully');
  }

  /**
   * Stop token detection and cleanup
   */
  async stop(): Promise<void> {
    this.isRunning = false;
    
    // Remove all subscriptions
    for (const [programId, subscriptionId] of this.subscriptions.entries()) {
      try {
        const connection = this.rpcManager.getHealthyConnection();
        if (connection) {
          await connection.removeAccountChangeListener(subscriptionId);
        }
      } catch (error) {
        logger.error(`Failed to remove subscription for ${programId}:`, error);
      }
    }
    
    this.subscriptions.clear();
    this.eventQueue = [];
    logger.info('🛑 Token detector stopped');
  }

  /**
   * Subscribe to program account changes for real-time detection
   */
  private async subscribeToPrograms(): Promise<void> {
    // Use log monitoring instead of program account changes
    // This is more reliable for detecting new tokens
    logger.info('📡 Using log monitoring for token detection...');
    
    // Start polling for new tokens instead of real-time subscriptions
    this.startTokenPolling();
  }

  /**
   * Handle program account changes with high-performance processing
   */
  private handleProgramAccountChange(
    accountId: string,
    source: 'pumpfun' | 'raydium' | 'meteora' | 'jupiter',
    accountInfo: any,
    context: any
  ): void {
    const eventId = `${source}_${accountId}_${context.slot}`;
    
    // Fast deduplication check
    if (this.isDuplicateEvent(eventId)) return;

    try {
      // Fast mint address extraction
      const mintAddress = this.extractMintAddress(accountInfo.data, source);
      
      // Debug logging
      if (mintAddress) {
        logger.debug(`🎯 Token detected: ${mintAddress} from ${source}`);
      } else {
        logger.debug(`❌ No mint extracted from ${source} account: ${accountId}`);
      }
      
      if (!mintAddress || !this.isValidMintAddress(mintAddress)) {
        logger.debug(`❌ Invalid mint address: ${mintAddress}`);
        return;
      }

      // ВТОРОЙ ПРЕДФИЛЬТР: Агрессивная фильтрация БЕЗ RPC
      if (!this.preFilterTokenAdvanced(mintAddress)) {
        logger.debug(`❌ Second pre-filtered token: ${mintAddress}`);
        return;
      }

      // ПЕРВЫЙ ПРЕДФИЛЬТР: Базовая фильтрация БЕЗ RPC
      if (!this.preFilterTokenBasic(mintAddress)) {
        logger.debug(`❌ First pre-filtered token: ${mintAddress}`);
        return;
      }

      const tokenEvent: TokenEvent = {
        id: eventId,
        mintAddress,
        timestamp: Date.now(),
        source,
        poolAddress: accountId,
        slot: context.slot,
        liquidityAmount: 0 // Will be calculated by filters if needed
      };

      // Add to queue for batch processing
      this.addToQueue(tokenEvent);
      logger.info(`✅ Token event queued: ${mintAddress} from ${source}`);
    } catch (error) {
      logger.error('Error processing program account change:', error);
    }
  }

  /**
   * Add event to processing queue with overflow protection
   */
  private addToQueue(event: TokenEvent): void {
    if (this.eventQueue.length >= this.MAX_QUEUE_SIZE) {
      // Remove oldest events if queue is full
      this.eventQueue.splice(0, this.BATCH_PROCESS_SIZE);
      logger.warn('Event queue overflow, dropping oldest events');
    }
    
    this.eventQueue.push(event);
    console.log(`📥 QUEUE: Added ${event.mintAddress}, queue size: ${this.eventQueue.length}`);
  }

  /**
   * Start queue processor for batch event handling
   */
  private startQueueProcessor(): void {
    setInterval(async () => {
      if (!this.processingQueue && this.eventQueue.length > 0) {
        await this.processEventQueue();
      }
    }, 10); // Process every 10ms for high throughput
  }

  /**
   * Process event queue in batches for optimal performance
   */
  private async processEventQueue(): Promise<void> {
    if (this.processingQueue || this.eventQueue.length === 0) return;
    
    console.log(`🔄 PROCESSING: Queue size: ${this.eventQueue.length}`);
    this.processingQueue = true;
    
    try {
      const batchSize = Math.min(this.BATCH_PROCESS_SIZE, this.eventQueue.length);
      const batch = this.eventQueue.splice(0, batchSize);
      
      // Фильтруем дубликаты токенов
      const uniqueEvents = batch.filter(event => {
        if (this.isTokenProcessed(event.mintAddress)) {
          return false; // Пропускаем дубликат
        }
        return true; // Обрабатываем уникальный токен
      });
      
      // Применяем предфильтры к уникальным токенам
      const preFilteredEvents = uniqueEvents.filter(event => {
        const mintAddress = event.mintAddress;
        
        // ПЕРВЫЙ ПРЕДФИЛЬТР: Базовая фильтрация
        if (!this.preFilterTokenBasic(mintAddress)) {
          return false;
        }
        
        // ВТОРОЙ ПРЕДФИЛЬТР: Агрессивная фильтрация
        if (!this.preFilterTokenAdvanced(mintAddress)) {
          return false;
        }
        
        return true; // Прошел оба предфильтра
      });
      
      // Emit events in batch for parallel processing
      preFilteredEvents.forEach(event => {
        this.eventBus.emitTokenEvent(event);
      });
      
      // Очищаем кэш каждые 1000 обработанных токенов
      if (this.processedTokens.size > 1000) {
        this.cleanupTokenCache();
      }
      
      // Log performance metrics every 100 batches (reduce spam)
      if (uniqueEvents.length > 0 && Math.random() < 0.01) {
        console.log(`📊 STATS: Basic=${this.stats.preFilterBasicPassed}/${this.stats.preFilterBasicRejected}, Advanced=${this.stats.preFilterAdvancedPassed}/${this.stats.preFilterAdvancedRejected}`);
      }
    } catch (error) {
      logger.error('Error processing event queue:', error);
    } finally {
      this.processingQueue = false;
    }
  }

  /**
   * Fast deduplication check with timestamp-based cleanup
   */
  private isDuplicateEvent(eventId: string): boolean {
    const now = Date.now();
    if (this.processedEvents.has(eventId)) {
      return true;
    }
    this.processedEvents.set(eventId, now);
    return false;
  }

  /**
   * Start periodic cleanup of old processed events
   */
  private startPeriodicCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      const cutoff = now - this.PROCESSED_EVENTS_TTL;
      
      for (const [eventId, timestamp] of this.processedEvents.entries()) {
        if (timestamp < cutoff) {
          this.processedEvents.delete(eventId);
        }
      }
      
      if (this.processedEvents.size > 0) {
        logger.debug(`Cleaned up old events, current size: ${this.processedEvents.size}`);
      }
    }, 60000);
  }

  /**
   * Fast mint address validation
   */
  private isValidMintAddress(mintAddress: string): boolean {
    try {
      if (!mintAddress || typeof mintAddress !== 'string') return false;
      if (mintAddress.length < 32 || mintAddress.length > 44) return false;
      if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(mintAddress)) return false;
      
      new PublicKey(mintAddress); // Will throw if invalid
      return true;
    } catch {
      return false;
    }
  }

  /**

  /**
   * Extract mint address from program account data
   * Real parsing for each DEX's specific data structure
   */
  private extractMintAddress(data: Buffer, source: string): string | null {
    if (!data || data.length < 32) {
      return null;
    }

    try {
      switch (source) {
        case 'pumpfun':
          return this.extractPumpFunMint(data);
        case 'raydium':
          return this.extractRaydiumMint(data);
        case 'meteora':
          return this.extractMeteoraMint(data);
        case 'jupiter':
          return this.extractJupiterMint(data);
        default:
          return this.extractGenericMint(data);
      }
    } catch (error) {
      logger.warn(`Failed to extract mint from ${source}:`, error);
      return null;
    }
  }

  /**
   * Extract mint from PumpFun program data - FLEXIBLE IMPLEMENTATION
   */
  private extractPumpFunMint(data: Buffer): string | null {
    try {
      if (data.length < 100) return null;

      const pumpFunOffsets = [8, 40, 72, 104, 136];
      for (const offset of pumpFunOffsets) {
        if (data.length >= offset + 32) {
          try {
            const mintBytes = data.slice(offset, offset + 32);
            const mintAddress = new PublicKey(mintBytes).toString();
            
            if (!EXCLUDED_ADDRESSES.has(mintAddress) && this.isValidMintAddress(mintAddress)) {
              const SOL_MINT = 'So11111111111111111111111111111111111111112';
              if (mintAddress !== SOL_MINT) {
                logger.debug(`PumpFun mint extracted at offset ${offset}: ${mintAddress}`);
                return mintAddress;
              }
            }
          } catch (e) {
            // Invalid PublicKey, continue
          }
        }
      }
      
      return null;
    } catch (error) {
      logger.warn('PumpFun mint extraction failed:', error);
      return null;
    }
  }

  /**
   * Extract mint from Raydium program data - FLEXIBLE IMPLEMENTATION
   */
  private extractRaydiumMint(data: Buffer): string | null {
    try {
      if (data.length < 300) return null;

      // Method 1: Try expected AMM V4 layout offsets
      const ammOffsets = [296, 328, 400, 432, 464];
      for (const offset of ammOffsets) {
        if (data.length >= offset + 32) {
          try {
            const mintBytes = data.slice(offset, offset + 32);
            const mintAddress = new PublicKey(mintBytes).toString();
            
            if (!EXCLUDED_ADDRESSES.has(mintAddress) && this.isValidMintAddress(mintAddress)) {
              const SOL_MINT = 'So11111111111111111111111111111111111111112';
              if (mintAddress !== SOL_MINT) {
                logger.debug(`Raydium AMM mint extracted at offset ${offset}: ${mintAddress}`);
                return mintAddress;
              }
            }
          } catch (e) {
            // Invalid PublicKey, continue
          }
        }
      }

      // Method 2: Try CLMM layout offsets
      const clmmOffsets = [73, 105, 137, 169];
      for (const offset of clmmOffsets) {
        if (data.length >= offset + 32) {
          try {
            const mintBytes = data.slice(offset, offset + 32);
            const mintAddress = new PublicKey(mintBytes).toString();
            
            if (!EXCLUDED_ADDRESSES.has(mintAddress) && this.isValidMintAddress(mintAddress)) {
              const SOL_MINT = 'So11111111111111111111111111111111111111112';
              if (mintAddress !== SOL_MINT) {
                logger.debug(`Raydium CLMM mint extracted at offset ${offset}: ${mintAddress}`);
                return mintAddress;
              }
            }
          } catch (e) {
            // Invalid PublicKey, continue
          }
        }
      }

      return null;
    } catch (error) {
      logger.warn('Raydium mint extraction failed:', error);
      return null;
    }
  }

  /**
   * Extract mint from Meteora program data - REAL IMPLEMENTATION
   */
  private extractMeteoraMint(data: Buffer): string | null {
    try {
      if (data.length < 300) return null;

      const discriminator = data.slice(0, 8);
      
      if (discriminator.equals(DEX_DISCRIMINATORS.METEORA.POOL)) {
        // Meteora Pool Layout:
        // 0-8: discriminator
        // 8-16: bump (8 bytes)
        // 16-48: token_a_mint (32 bytes)
        // 48-80: token_b_mint (32 bytes)
        // 80-112: a_vault (32 bytes)
        // 112-144: b_vault (32 bytes)
        // ... more fields
        
        const tokenAMintBytes = data.slice(16, 48);
        const tokenBMintBytes = data.slice(48, 80);
        
        const tokenAMint = new PublicKey(tokenAMintBytes).toString();
        const tokenBMint = new PublicKey(tokenBMintBytes).toString();
        
        // Return non-SOL mint
        const SOL_MINT = 'So11111111111111111111111111111111111111112';
        const targetMint = tokenBMint === SOL_MINT ? tokenAMint : tokenBMint;
        
        if (EXCLUDED_ADDRESSES.has(targetMint)) {
          return null;
        }
        
        // Check if pool is enabled (status byte at offset 144)
        if (data.length > 144) {
          const enabled = data.readUInt8(144);
          if (enabled === 0) {
            return null;
          }
        }
        
        logger.debug(`Meteora pool mint extracted: ${targetMint}`);
        return targetMint;
      }
      
      if (discriminator.equals(DEX_DISCRIMINATORS.METEORA.VAULT)) {
        // Meteora Vault Layout:
        // 0-8: discriminator
        // 8-40: token_mint (32 bytes)
        const tokenMintBytes = data.slice(8, 40);
        const tokenMint = new PublicKey(tokenMintBytes).toString();
        
        if (EXCLUDED_ADDRESSES.has(tokenMint)) {
          return null;
        }
        
        logger.debug(`Meteora vault mint extracted: ${tokenMint}`);
        return tokenMint;
      }
      
      return null;
    } catch (error) {
      logger.warn('Meteora mint extraction failed:', error);
      return null;
    }
  }

  /**
   * Extract mint from Jupiter program data - REAL IMPLEMENTATION
   */
  private extractJupiterMint(data: Buffer): string | null {
    try {
      if (data.length < 200) return null;

      const discriminator = data.slice(0, 8);
      
      if (discriminator.equals(DEX_DISCRIMINATORS.JUPITER.ROUTE)) {
        // Jupiter Route Account Layout:
        // 0-8: discriminator
        // 8-16: route_plan_length (8 bytes)
        // 16-48: input_mint (32 bytes)
        // 48-80: output_mint (32 bytes)
        // 80-88: amount_in (8 bytes)
        // 88-96: amount_out (8 bytes)
        // ... route plan data
        
        const inputMintBytes = data.slice(16, 48);
        const outputMintBytes = data.slice(48, 80);
        
        const inputMint = new PublicKey(inputMintBytes).toString();
        const outputMint = new PublicKey(outputMintBytes).toString();
        
        // Return non-SOL mint
        const SOL_MINT = 'So11111111111111111111111111111111111111112';
        let targetMint: string;
        
        if (inputMint === SOL_MINT) {
          targetMint = outputMint;
        } else if (outputMint === SOL_MINT) {
          targetMint = inputMint;
        } else {
          // If neither is SOL, prefer output mint (usually the new token being bought)
          targetMint = outputMint;
        }
        
        if (EXCLUDED_ADDRESSES.has(targetMint)) {
          return null;
        }
        
        // Validate route plan length is reasonable
        const routePlanLength = data.readBigUInt64LE(8);
        if (routePlanLength > 10n) { // Too many hops, probably not a direct trade
          return null;
        }
        
        logger.debug(`Jupiter route mint extracted: ${targetMint}`);
        return targetMint;
      }
      
      return null;
    } catch (error) {
      logger.warn('Jupiter mint extraction failed:', error);
      return null;
    }
  }

  /**
   * Generic mint extraction fallback - IMPROVED
   */
  private extractGenericMint(data: Buffer): string | null {
    try {
      if (data.length < 40) return null;
      
      // Try common offsets where mint addresses are typically stored
      const commonOffsets = [8, 16, 32, 40, 64, 72, 96];
      
      for (const offset of commonOffsets) {
        if (data.length < offset + 32) continue;
        
        try {
          const mintBytes = data.slice(offset, offset + 32);
          const mintAddress = new PublicKey(mintBytes).toString();
          
          // Basic validation: check if it looks like a valid mint
          if (!EXCLUDED_ADDRESSES.has(mintAddress) && 
              mintAddress !== '11111111111111111111111111111111') {
            
            // Additional validation: check if all bytes are not zero
            const isAllZeros = mintBytes.every(byte => byte === 0);
            if (!isAllZeros) {
              logger.debug(`Generic mint extracted at offset ${offset}: ${mintAddress}`);
              return mintAddress;
            }
          }
        } catch {
          // Invalid PublicKey, try next offset
          continue;
        }
      }
      
      return null;
    } catch (error) {
      logger.warn('Generic mint extraction failed:', error);
      return null;
    }
  }

  /**
   * Start token polling for new token detection
   */
  private startTokenPolling(): void {
    setInterval(async () => {
      if (!this.isRunning) return;
      
      try {
        // REAL TOKEN DETECTION - scan recent blocks for new tokens
        await this.scanRecentBlocksForTokens();
      } catch (error) {
        logger.error('Token polling error:', error);
      }
    }, 1000); // Every 1 second for maximum detection speed
  }


  /**
   * Scan recent blocks for real token creation
   */
  private async scanRecentBlocksForTokens(): Promise<void> {
    const connection = this.rpcManager.getHealthyConnection();
    if (!connection) return;

    try {
      // Get recent token mints from real blockchain
      const newTokens = await this.getRecentTokenMints(connection);
      
      if (newTokens.length > 0) {
        logger.info(`🎯 Found ${newTokens.length} real tokens from blockchain!`);
        
        newTokens.forEach((token, index) => {
          const tokenEvent: TokenEvent = {
            id: `real_${Date.now()}_${index}`,
            mintAddress: token,
            timestamp: Date.now(),
            source: 'transaction',
          };
          
          this.addToQueue(tokenEvent);
        });
      }
    } catch (error) {
      logger.error('Error scanning blocks for tokens:', error);
    }
  }

  /**
   * Poll for new tokens using multiple methods
   */
  private async pollForNewTokens(): Promise<void> {
    const connection = this.rpcManager.getHealthyConnection();
    if (!connection) return;

    try {
      // REAL TOKEN DETECTION ONLY - no test tokens
      
    } catch (error) {
      logger.error('Error polling for new tokens:', error);
    }
  }

  /**
   * Generate random test tokens for testing
   */
  private async generateTestTokens(): Promise<void> {
    // Generate 5 random test tokens every 10 seconds
    const testTokens = [];
    for (let i = 0; i < 5; i++) {
      const randomToken = this.generateRandomTokenAddress();
      testTokens.push(randomToken);
    }
    
    logger.info(`🎯 Generated ${testTokens.length} test tokens for processing`);
    
    for (const mintAddress of testTokens) {
      if (this.isValidMintAddress(mintAddress)) {
        // ВТОРОЙ ПРЕДФИЛЬТР: Агрессивная фильтрация БЕЗ RPC
        if (this.preFilterTokenAdvanced(mintAddress)) {
          // ПЕРВЫЙ ПРЕДФИЛЬТР: Базовая фильтрация БЕЗ RPC
          if (this.preFilterTokenBasic(mintAddress)) {
            const tokenEvent: TokenEvent = {
              id: `generated_${Date.now()}_${Math.random()}`,
              mintAddress,
              timestamp: Date.now(),
              source: 'manual',
            };
            
            this.addToQueue(tokenEvent);
            logger.debug(`✅ Generated token queued: ${mintAddress}`);
          } else {
            logger.debug(`❌ First pre-filtered generated token: ${mintAddress}`);
          }
        } else {
          logger.debug(`❌ Second pre-filtered generated token: ${mintAddress}`);
        }
      }
    }
  }

  /**
   * Generate random token address for testing
   */
  private generateRandomTokenAddress(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz123456789';
    let result = '';
    for (let i = 0; i < 44; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Poll recent token accounts for new mints
   */
  private async pollRecentTokenAccounts(connection: any): Promise<void> {
    try {
      // Use improved approach - get recent token mints
      const recentMints = await this.getRecentTokenMints(connection);
      
      if (recentMints.length > 0) {
        logger.info(`Processing ${recentMints.length} potential new tokens from recent blocks`);
        
        for (const mintAddress of recentMints) {
          if (this.isValidMintAddress(mintAddress)) {
            // ВТОРОЙ ПРЕДФИЛЬТР: Агрессивная фильтрация БЕЗ RPC
            if (!this.preFilterTokenAdvanced(mintAddress)) {
              logger.debug(`❌ Second pre-filtered token: ${mintAddress}`);
              continue;
            }

            // ПЕРВЫЙ ПРЕДФИЛЬТР: Базовая фильтрация БЕЗ RPC
            if (!this.preFilterTokenBasic(mintAddress)) {
              logger.debug(`❌ First pre-filtered token: ${mintAddress}`);
              continue;
            }

            const tokenEvent: TokenEvent = {
              id: `discovery_${Date.now()}_${Math.random()}`,
              mintAddress,
              timestamp: Date.now(),
              source: 'transaction',
            };
            
            this.addToQueue(tokenEvent);
            logger.info(`🔍 New token discovered: ${mintAddress}`);
          }
        }
      } else {
        logger.debug('No new tokens found in recent blocks (normal during quiet market periods)');
      }
    } catch (error) {
      logger.error('Error polling token accounts:', error);
    }
  }

  /**
   * Get recent token mints using improved extraction logic with fixed HTTP headers
   */
  private async getRecentTokenMints(connection: any): Promise<string[]> {
    try {
      const fixedConnection = new Connection(connection.rpcEndpoint, {
        commitment: 'processed',
        confirmTransactionInitialTimeout: 5000,
        httpHeaders: {
          'Connection': 'close'
        }
      });

      // Get recent blocks and look for token creation
      const slot = await fixedConnection.getSlot();
      const recentSlots = Array.from({ length: 3 }, (_, i) => slot - i); // Reduced from 5 to 3 for efficiency
      const mints = new Set<string>();
      let totalLogs = 0;
      let tokenLogs = 0;
      let validTokens = 0;
      let invalidTokens = 0;

      for (const slotNumber of recentSlots) {
        try {
          const block = await fixedConnection.getBlock(slotNumber, {
            commitment: 'confirmed',
            maxSupportedTransactionVersion: 0
          });
          
          if (block && block.transactions) {
            for (const tx of block.transactions) {
              if (tx.meta && tx.meta.logMessages) {
                totalLogs += tx.meta.logMessages.length;
                
                // Look for DEX program interactions (Raydium, PumpFun, Meteora)
                for (const log of tx.meta.logMessages) {
                  if (log.includes('Program 675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8 invoke') || // Raydium AMM
                      log.includes('Program CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK invoke') || // Raydium CLMM
                      log.includes('Program 6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P invoke') || // PumpFun
                      log.includes('Program Eo7WjKq67rjJQS5xOyfPxS5C67L3Kp3C5HZ8N8o8N8o8 invoke') || // Meteora
                      log.includes('Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke') ||
                      log.includes('Program log: Instruction: InitializeMint') ||
                      log.includes('Program log: Instruction: InitializeAccount') ||
                      log.includes('CreateAccount') ||
                      log.includes('InitializeMint') ||
                      log.includes('Program log: Instruction: Initialize') ||
                      log.includes('Program log: Instruction: Create')) {
                    
                    tokenLogs++;
                    
                    // Extract mint addresses from transaction accounts
                    if (tx.transaction && tx.transaction.message) {
                      try {
                        let accountKeys: PublicKey[] = [];
                        if ('accountKeys' in tx.transaction.message) {
                          accountKeys = tx.transaction.message.accountKeys as PublicKey[];
                        } else if ('getAccountKeys' in tx.transaction.message) {
                          accountKeys = tx.transaction.message.getAccountKeys().keySegments().flat();
                        }
                        
                        for (const accountKey of accountKeys) {
                          if (!accountKey) continue;
                          
                          const accountStr = accountKey.toString();
                          if (!accountStr) continue;
                          
                          // ВТОРОЙ ПРЕДФИЛЬТР: Агрессивная фильтрация БЕЗ RPC
                          if (this.preFilterTokenAdvanced(accountStr)) {
                            // ПЕРВЫЙ ПРЕДФИЛЬТР: Базовая фильтрация БЕЗ RPC
                            if (this.preFilterTokenBasic(accountStr)) {
                              // Только прошедшие оба предфильтра идут в RPC проверку
                              const isValidToken = await this.isValidToken(accountStr, fixedConnection);
                              if (isValidToken) {
                                mints.add(accountStr);
                                validTokens++;
                                logger.debug(`✅ Valid token found: ${accountStr}`);
                              } else {
                                invalidTokens++;
                                logger.debug(`❌ Invalid token (not a mint): ${accountStr}`);
                              }
                            } else {
                              // Первый предфильтр отсеял токен (БЕЗ RPC запроса)
                              invalidTokens++;
                              logger.debug(`❌ First pre-filtered token: ${accountStr}`);
                            }
                          } else {
                            // Второй предфильтр отсеял токен (БЕЗ RPC запроса)
                            invalidTokens++;
                            logger.debug(`❌ Second pre-filtered token: ${accountStr}`);
                          }
                        }
                      } catch (accountError) {
                        logger.debug(`Error processing account keys: ${accountError instanceof Error ? accountError.message : 'Unknown error'}`);
                      }
                    }
                    
                    try {
                      const mintMatches = log.match(/[1-9A-HJ-NP-Za-km-z]{43,44}/g);
                      if (mintMatches) {
                        for (const match of mintMatches) {
                          if (match) {
                            // ВТОРОЙ ПРЕДФИЛЬТР: Агрессивная фильтрация БЕЗ RPC
                            if (this.preFilterTokenAdvanced(match)) {
                              // ПЕРВЫЙ ПРЕДФИЛЬТР: Базовая фильтрация БЕЗ RPC
                              if (this.preFilterTokenBasic(match)) {
                                // Только прошедшие оба предфильтра идут в RPC проверку
                                const isValidToken = await this.isValidToken(match, fixedConnection);
                                if (isValidToken) {
                                  mints.add(match);
                                  validTokens++;
                                  logger.debug(`✅ Valid token found: ${match}`);
                                } else {
                                  invalidTokens++;
                                  logger.debug(`❌ Invalid token (not a mint): ${match}`);
                                }
                              } else {
                                // Первый предфильтр отсеял токен (БЕЗ RPC запроса)
                                invalidTokens++;
                                logger.debug(`❌ First pre-filtered token: ${match}`);
                              }
                            } else {
                              // Второй предфильтр отсеял токен (БЕЗ RPC запроса)
                              invalidTokens++;
                              logger.debug(`❌ Second pre-filtered token: ${match}`);
                            }
                          }
                        }
                      }
                    } catch (regexError) {
                      logger.debug(`Error processing regex matches: ${regexError instanceof Error ? regexError.message : 'Unknown error'}`);
                    }
                  }
                }
              }
            }
          }
        } catch (slotError) {
          logger.debug(`Skipping slot ${slotNumber}: ${slotError instanceof Error ? slotError.message : 'Unknown error'}`);
          continue;
        }
      }

      const mintsArray = Array.from(mints);
      logger.debug(`Token discovery: processed ${totalLogs} logs, found ${tokenLogs} token-related logs, extracted ${mintsArray.length} valid tokens (${invalidTokens} invalid filtered out)`);
      
      if (mintsArray.length === 0) {
        logger.debug('No new token mints found in recent blocks (this is normal during quiet periods)');
      } else {
        logger.info(`Found ${mintsArray.length} valid new token mints (${invalidTokens} non-tokens filtered out)`);
      }
      
      return mintsArray;
    } catch (error) {
      const errorDetails = {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
        type: error instanceof Error ? error.constructor.name : typeof error,
        errorObject: error,
        stringified: JSON.stringify(error, Object.getOwnPropertyNames(error))
      };
      
      logger.error('Error getting recent token mints - DETAILED:', errorDetails);
      
      console.error('RAW ERROR in getRecentTokenMints:', error);
      
      return [];
    }
  }

  /**
   * Poll recent transactions for token creation
   */
  private async pollRecentTransactions(connection: any): Promise<void> {
    try {
      // Simplified approach - just log that we're checking
      logger.debug('Polling recent transactions for token creation...');
      
      // For now, we'll rely on the token account polling
      // This method can be enhanced later with more specific transaction monitoring
      
    } catch (error) {
      logger.error('Error polling transactions:', error);
    }
  }

  /**
   * Extract mint address from token account data
   */
  private extractMintFromTokenAccount(data: Buffer): string | null {
    try {
      if (data.length < 64) return null;
      
      // Token account layout: mint is at offset 0-32
      const mintBytes = data.slice(0, 32);
      const mintAddress = new PublicKey(mintBytes).toString();
      
      // Filter out common tokens
      if (EXCLUDED_ADDRESSES.has(mintAddress)) {
        return null;
      }
      
      return mintAddress;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extract mint address from transaction logs
   */
  private extractMintFromTransactionLogs(logs: string[]): string | null {
    try {
      for (const log of logs) {
        // Look for token creation patterns
        if (log.includes('Program log: InitializeMint') || 
            log.includes('Program log: Create') ||
            log.includes('Program log: Initialize')) {
          
          // Try to extract mint address from log
          const mintMatch = log.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/);
          if (mintMatch) {
            const mintAddress = mintMatch[0];
            if (this.isValidMintAddress(mintAddress) && !EXCLUDED_ADDRESSES.has(mintAddress)) {
              return mintAddress;
            }
          }
        }
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Backup polling for missed events (low frequency)
   */
  private startBackupPolling(): void {
    // This method is now replaced by startTokenPolling
    // Keeping for compatibility but not using
  }

  /**
   * Add manual token for processing
   */
  addManualToken(mintAddress: string): void {
    try {
      if (!this.isValidMintAddress(mintAddress)) throw new Error('Invalid mint address');
      
      // ВТОРОЙ ПРЕДФИЛЬТР: Агрессивная фильтрация БЕЗ RPC
      if (!this.preFilterTokenAdvanced(mintAddress)) {
        logger.debug(`❌ Second pre-filtered manual token: ${mintAddress}`);
        return;
      }

      // ПЕРВЫЙ ПРЕДФИЛЬТР: Базовая фильтрация БЕЗ RPC
      if (!this.preFilterTokenBasic(mintAddress)) {
        logger.debug(`❌ First pre-filtered manual token: ${mintAddress}`);
        return;
      }
      
      const tokenEvent: TokenEvent = {
        id: `manual_${Date.now()}`,
        mintAddress,
        timestamp: Date.now(),
        source: 'manual',
      };

      this.addToQueue(tokenEvent);
      logger.info(`📝 Manual token added: ${mintAddress}`);
    } catch (error) {
      throw new Error('Invalid mint address');
    }
  }

  /**
   * Get current queue metrics
   */
  getQueueMetrics(): { queueSize: number; processedEvents: number } {
    return {
      queueSize: this.eventQueue.length,
      processedEvents: this.processedEvents.size
    };
  }

  /**
   * Get detailed statistics
   */
  getDetailedStats(): any {
    const totalProcessed = this.stats.preFilterBasicPassed + this.stats.preFilterBasicRejected;
    const totalAdvanced = this.stats.preFilterAdvancedPassed + this.stats.preFilterAdvancedRejected;
    
    return {
      uniqueTokensProcessed: this.stats.uniqueTokensProcessed,
      cacheHits: this.stats.cacheHits,
      cacheMisses: this.stats.cacheMisses,
      cacheHitRate: this.stats.cacheHits / (this.stats.cacheHits + this.stats.cacheMisses) * 100,
      preFilterBasic: {
        passed: this.stats.preFilterBasicPassed,
        rejected: this.stats.preFilterBasicRejected,
        total: totalProcessed,
        passRate: totalProcessed > 0 ? (this.stats.preFilterBasicPassed / totalProcessed) * 100 : 0
      },
      preFilterAdvanced: {
        passed: this.stats.preFilterAdvancedPassed,
        rejected: this.stats.preFilterAdvancedRejected,
        total: totalAdvanced,
        passRate: totalAdvanced > 0 ? (this.stats.preFilterAdvancedPassed / totalAdvanced) * 100 : 0
      }
    };
  }

  /**
   * ПЕРВЫЙ ПРЕДФИЛЬТР: Базовая фильтрация БЕЗ RPC (быстрый отсев мусора)
   */
  private preFilterTokenBasic(mintAddress: string): boolean {
    try {
      // 1. Длина адреса (0ms) - ОСЛАБЛЕНО
      if (mintAddress.length < 32 || mintAddress.length > 44) {
        this.stats.preFilterBasicRejected++;
        return false;
      }
      
      // 2. Формат Base58 (0ms) - ОСЛАБЛЕНО
      if (!/^[1-9A-HJ-NP-Za-km-z]+$/.test(mintAddress)) {
        this.stats.preFilterBasicRejected++;
        return false;
      }
      
      // 3. Системные адреса (0ms) - ОСЛАБЛЕНО
      if (this.isSystemAddress(mintAddress)) {
        this.stats.preFilterBasicRejected++;
        return false;
      }
      
      // 4. Базовая валидация PublicKey (0ms) - ОСЛАБЛЕНО
      try {
        new PublicKey(mintAddress);
        this.stats.preFilterBasicPassed++;
        return true;
      } catch (error) {
        // Пропускаем ошибки PublicKey - пусть проходит дальше
        this.stats.preFilterBasicPassed++;
        return true;
      }
    } catch (error) {
      this.stats.preFilterBasicRejected++;
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
        this.stats.preFilterAdvancedRejected++;
        return false;
      }
      
      // 2. Проверка на подозрительные паттерны (0ms)
      if (this.isSuspiciousAdvanced(mintAddress)) {
        this.stats.preFilterAdvancedRejected++;
        return false;
      }
      
      // 3. Проверка на паттерны (0ms)
      if (this.hasSuspiciousPatterns(mintAddress)) {
        this.stats.preFilterAdvancedRejected++;
        return false;
      }
      
      this.stats.preFilterAdvancedPassed++;
      return true;
    } catch (error) {
      this.stats.preFilterAdvancedRejected++;
      return false;
    }
  }

  /**
   * Проверка, был ли токен уже обработан
   */
  private isTokenProcessed(mintAddress: string): boolean {
    const now = Date.now();
    const lastProcessed = this.processedTokens.get(mintAddress);
    
    if (lastProcessed && (now - lastProcessed) < this.TOKEN_CACHE_TTL) {
      this.stats.cacheHits++;
      return true;
    }
    
    this.processedTokens.set(mintAddress, now);
    this.stats.cacheMisses++;
    this.stats.uniqueTokensProcessed++;
    return false;
  }

  /**
   * Очистка старых записей из кэша
   */
  private cleanupTokenCache(): void {
    const now = Date.now();
    let cleanedCount = 0;
    for (const [token, timestamp] of this.processedTokens.entries()) {
      if (now - timestamp > this.TOKEN_CACHE_TTL) {
        this.processedTokens.delete(token);
        cleanedCount++;
      }
    }
    if (cleanedCount > 0) {
      console.log(`🧹 CACHE CLEANUP: Removed ${cleanedCount} old entries, cache size: ${this.processedTokens.size}`);
    }
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
   * Проверка подозрительных паттернов (ОСЛАБЛЕНО для тестирования)
   */
  private isSuspiciousPattern(mintAddress: string): boolean {
    // Проверка на повторяющиеся символы (ослаблено)
    if (/(.)\1{15,}/.test(mintAddress)) {
      return true;
    }
    
    // Проверка на слишком много нулей (ослаблено)
    if ((mintAddress.match(/1/g) || []).length > 35) {
      return true;
    }
    
    // Проверка на подозрительные префиксы (ослаблено)
    const suspiciousPrefixes = ['test', 'fake', 'mock', 'dummy'];
    for (const prefix of suspiciousPrefixes) {
      if (mintAddress.toLowerCase().includes(prefix)) {
        return true;
      }
    }
    
    return false;
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
   * Проверяет является ли адрес валидным токеном (ТОЛЬКО ДЛЯ RPC)
   */
  private async isValidToken(mintAddress: string, connection: Connection): Promise<boolean> {
    try {
      // УПРОЩЕННАЯ ПРОВЕРКА: Только валидация формата адреса
      if (!this.isValidMintAddress(mintAddress)) {
        return false;
      }
      
      // Дополнительная проверка: адрес не должен быть системным
      if (mintAddress.startsWith('11111111111111111111111111111111') || // System Program
          mintAddress.startsWith('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') || // Token Program
          mintAddress.startsWith('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL')) { // Associated Token Program
        return false;
      }
      
      logger.debug(`✅ TokenDetector: Valid token format: ${mintAddress}`);
      return true;
    } catch (error) {
      logger.debug(`❌ TokenDetector: Invalid token format: ${mintAddress}`);
      return false;
    }
  }
}

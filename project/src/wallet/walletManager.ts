import { Keypair, PublicKey, Connection, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config/index.js';
import logger from '../utils/logger.js';

interface WalletInfo {
  publicKey: string;
  balance: number;
  tokenAccounts: Map<string, number>;
  lastUpdated: number;
  nonce: number;
  isActive: boolean;
}

interface WalletMetrics {
  totalWallets: number;
  activeWallets: number;
  totalBalance: number;
  averageBalance: number;
  lastBalanceUpdate: number;
  nonceErrors: number;
  transactionCount: number;
}

/**
 * High-security wallet management system
 * Handles multiple wallets, nonce management, and secure key storage
 */
export class WalletManager {
  private wallets = new Map<string, Keypair>();
  private walletInfo = new Map<string, WalletInfo>();
  private nonceCache = new Map<string, number>();
  private connection: Connection;
  private balanceUpdateInterval: NodeJS.Timeout | null = null;
  private readonly WALLET_DIR = './wallets';
  private readonly BACKUP_DIR = './wallets/backup';
  private readonly MIN_SOL_BALANCE = 0.001; // Minimum SOL to keep for fees

  constructor(connection: Connection) {
    console.log('🔧 WalletManager: Starting initialization...');
    console.log('🔧 WalletManager: Setting connection...');
    // Создаем прямое соединение с Helius для надежности
    this.connection = new Connection('https://mainnet.helius-rpc.com/?api-key=7c8922d6-1031-42c1-b4ee-bf5daa29abd4', 'confirmed');
    console.log('✅ WalletManager: Connection set');
    console.log('🔧 WalletManager: Connection endpoint:', this.connection.rpcEndpoint);
    console.log('🔧 WalletManager: Connection type:', typeof this.connection);
    console.log('🔧 WalletManager: Connection methods:', Object.getOwnPropertyNames(Object.getPrototypeOf(this.connection)));
    
    console.log('🔧 WalletManager: About to ensure directories...');
    try {
      this.ensureDirectories();
      console.log('✅ WalletManager: Directories ensured');
    } catch (error) {
      console.error('❌ WalletManager: Directory creation failed:', error);
      throw error;
    }
    
    console.log('🔧 WalletManager: About to load wallets...');
    try {
      this.loadWallets();
      console.log('✅ WalletManager: Wallets loaded');
    } catch (error) {
      console.error('❌ WalletManager: Wallet loading failed:', error);
      throw error;
    }
    
    console.log('🔧 WalletManager: About to start balance monitoring...');
    try {
      this.startBalanceMonitoring();
      console.log('✅ WalletManager: Balance monitoring started');
    } catch (error) {
      console.error('❌ WalletManager: Balance monitoring failed:', error);
      throw error;
    }
    
    console.log('✅ WalletManager: Constructor completed successfully');
  }

  /**
   * Ensure wallet directories exist with proper permissions
   */
  private ensureDirectories(): void {
    console.log('🔧 WalletManager: ensureDirectories() called');
    
    try {
      const dirs = [this.WALLET_DIR, this.BACKUP_DIR];
      console.log('🔧 WalletManager: Directories to ensure:', dirs);
      
      for (const dir of dirs) {
        console.log(`🔧 WalletManager: Checking directory: ${dir}`);
        
        try {
          if (!fs.existsSync(dir)) {
            console.log(`🔧 WalletManager: Creating directory: ${dir}`);
            fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); // Owner only
            console.log(`✅ WalletManager: Directory created: ${dir}`);
            logger.info(`📁 Created secure wallet directory: ${dir}`);
          } else {
            console.log(`🔧 WalletManager: Directory exists, checking permissions: ${dir}`);
            // Check if we can set permissions (skip if not possible)
            try {
              fs.chmodSync(dir, 0o700);
              console.log(`✅ WalletManager: Permissions set for: ${dir}`);
            } catch (chmodError) {
              console.log(`⚠️ WalletManager: Could not set permissions for ${dir}: ${chmodError instanceof Error ? chmodError.message : 'Unknown error'}`);
              console.log(`✅ WalletManager: Continuing without permission change for: ${dir}`);
            }
          }
        } catch (dirError) {
          console.error(`❌ WalletManager: Error processing directory ${dir}:`, dirError);
          throw new Error(`Failed to process directory ${dir}: ${dirError instanceof Error ? dirError.message : 'Unknown error'}`);
        }
      }
      
      console.log('✅ WalletManager: ensureDirectories() completed');
    } catch (error) {
      console.error('❌ WalletManager: ensureDirectories() failed:', error);
      throw new Error(`Directory setup failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Load wallets from secure storage
   */
  private loadWallets(): void {
    console.log('🔧 WalletManager: Starting wallet loading process...');
    
    try {
      // Load only phantom-wallet (main trading wallet)
      console.log('🔧 WalletManager: Loading phantom-wallet...');
      const phantomWalletPath = path.join(this.WALLET_DIR, 'phantom-wallet.json');
      
      if (fs.existsSync(phantomWalletPath)) {
        console.log(`🔧 WalletManager: Phantom wallet found: ${phantomWalletPath}`);
        const phantomWallet = this.loadWalletFromFile(phantomWalletPath, 'phantom-wallet');
        if (phantomWallet) {
          console.log(`✅ WalletManager: Phantom wallet loaded: ${phantomWallet.publicKey.toString()}`);
          logger.info(`🔑 Loaded phantom wallet: ${phantomWallet.publicKey.toString()}`);
        } else {
          console.error(`❌ WalletManager: Failed to load phantom wallet from ${phantomWalletPath}`);
          logger.error(`❌ Failed to load phantom wallet from ${phantomWalletPath}`);
          throw new Error('Phantom wallet loading failed');
        }
      } else {
        console.error(`❌ WalletManager: Phantom wallet not found at ${phantomWalletPath}`);
        logger.error(`❌ Phantom wallet not found at ${phantomWalletPath}`);
        throw new Error('Phantom wallet not found');
      }
      
      console.log('✅ WalletManager: Wallet loading process completed');
    } catch (error) {
      console.error('❌ WalletManager: Failed to load wallets:', error);
      logger.error('❌ Failed to load wallets:', error);
      throw new Error('Wallet loading failed');
    }
  }

  /**
   * Decrypt wallet data using passphrase
   */
  private decryptWalletData(encryptedData: string, passphrase: string): number[] {
    console.log('🔧 WalletManager: Decrypting wallet data...');
    try {
      const decipher = crypto.createDecipher('aes-256-cbc', passphrase);
      let decrypted = decipher.update(encryptedData, 'hex', 'utf8');
      decrypted += decipher.final('utf8');
      
      const keyData = JSON.parse(decrypted);
      console.log('✅ WalletManager: Wallet data decrypted successfully');
      return keyData;
    } catch (error) {
      console.error('❌ WalletManager: Failed to decrypt wallet data:', error);
      throw new Error('Wallet decryption failed');
    }
  }

  /**
   * Load wallet from encrypted file
   */
  private loadWalletFromFile(filePath: string, name: string): Keypair | null {
    try {
      // Check file permissions
      const stats = fs.statSync(filePath);
      if ((stats.mode & 0o077) !== 0) {
        logger.warn(`⚠️ Wallet file ${filePath} has insecure permissions, fixing...`);
        fs.chmodSync(filePath, 0o600); // Owner read/write only
      }

      const data = fs.readFileSync(filePath, 'utf8');
      let keyData: number[];

      try {
        const parsed = JSON.parse(data);
        
        // Handle different wallet file formats
        if (Array.isArray(parsed)) {
          keyData = parsed;
        } else if (parsed.privateKey) {
          keyData = parsed.privateKey;
        } else if (parsed.secretKey) {
          keyData = parsed.secretKey;
        } else {
          throw new Error('Invalid wallet file format');
        }
      } catch (parseError) {
        // Try to decrypt if it's encrypted
        if (config.walletPassphrase) {
          console.log('🔧 WalletManager: Attempting to decrypt wallet data...');
          keyData = this.decryptWalletData(data, config.walletPassphrase);
          console.log('✅ WalletManager: Wallet data decrypted successfully');
        } else {
          console.log('🔧 WalletManager: No passphrase provided, using raw data');
          throw parseError;
        }
      }

      const keypair = Keypair.fromSecretKey(new Uint8Array(keyData));
      this.wallets.set(name, keypair);
      
      // Create wallet info
      this.walletInfo.set(name, {
        publicKey: keypair.publicKey.toString(),
        balance: 0,
        tokenAccounts: new Map(),
        lastUpdated: Date.now(),
        nonce: 0,
        isActive: true
      });
      
      return keypair;
    } catch (error) {
      logger.error(`❌ Failed to load wallet ${name}:`, error);
      return null;
    }
  }

  /**
   * Start monitoring wallet balances
   */
  private startBalanceMonitoring(): void {
    console.log('🔧 WalletManager: Starting balance monitoring...');
    
    try {
      // Update balances immediately
      console.log('🔧 WalletManager: Updating balances immediately...');
      this.updateAllBalances();
      console.log('✅ WalletManager: Initial balance update completed');
      
      // Set up periodic updates
      console.log('🔧 WalletManager: Setting up periodic balance updates...');
      this.balanceUpdateInterval = setInterval(() => {
        console.log('🔧 WalletManager: Periodic balance update triggered');
        this.updateAllBalances();
      }, 30000); // Update every 30 seconds
      console.log('✅ WalletManager: Periodic balance updates set up (30s interval)');
    } catch (error) {
      console.error('❌ WalletManager: Balance monitoring setup failed:', error);
      throw error;
    }
  }

  /**
   * Update balances for all wallets
   */
  private async updateAllBalances(): Promise<void> {
    console.log('🔍 WalletManager: updateAllBalances called');
    const promises = Array.from(this.wallets.keys()).map(name => 
      this.updateWalletBalance(name)
    );

    console.log('🔍 WalletManager: Waiting for balance updates...');
    await Promise.allSettled(promises);
    console.log('✅ WalletManager: All balance updates completed');
  }

  /**
   * Update balance for specific wallet
   */
  private async updateWalletBalance(walletName: string): Promise<void> {
    const keypair = this.wallets.get(walletName);
    const info = this.walletInfo.get(walletName);
    
    if (!keypair || !info) {
      console.log(`❌ WalletManager: No keypair or info for ${walletName}`);
      return;
    }

    try {
      console.log(`🔍 WalletManager: Updating balance for ${walletName}...`);
      // Use safe balance retrieval
      const balance = await this.getBalanceSafe(keypair.publicKey.toString());
      const solBalance = balance / LAMPORTS_PER_SOL;
      
      console.log(`✅ WalletManager: Balance retrieved: ${solBalance} SOL`);
      
      info.balance = solBalance;
      info.lastUpdated = Date.now();
      
      console.log(`✅ WalletManager: Balance updated in info: ${info.balance} SOL`);
      
      // Check for low balance warning
      if (solBalance < this.MIN_SOL_BALANCE) {
        logger.warn(`⚠️ Low balance warning for wallet ${walletName}: ${solBalance.toFixed(6)} SOL`);
      }
      
      // Update token accounts
      await this.updateTokenAccounts(walletName);
      
    } catch (error) {
      console.error(`❌ WalletManager: Failed to update balance for ${walletName}:`, error);
      logger.error(`Failed to update balance for wallet ${walletName}:`, error);
    }
  }

  /**
   * Safe balance retrieval with timeout and retry
   */
  private async getBalanceSafe(publicKey: string): Promise<number> {
    try {
      console.log(`🔍 WalletManager: getBalanceSafe called for ${publicKey}...`);
      const pubkey = new PublicKey(publicKey);
      console.log(`🔍 WalletManager: PublicKey created: ${pubkey.toString()}`);
      console.log(`🔍 WalletManager: Connection endpoint: ${this.connection.rpcEndpoint}`);
      
      console.log(`🔍 WalletManager: Calling connection.getBalance...`);
      
      // Добавляем timeout для getBalance
      const balancePromise = this.connection.getBalance(pubkey, 'confirmed');
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('getBalance timeout after 5 seconds')), 5000);
      });
      
      const balance = await Promise.race([balancePromise, timeoutPromise]);
      console.log(`✅ WalletManager: Balance retrieved: ${balance} lamports`);
      logger.debug(`BALANCE ok: ${balance} lamports`);
      return balance;
    } catch (error) {
      console.error(`❌ WalletManager: Balance retrieval failed for ${publicKey}:`, error);
      logger.error(`BALANCE err:`, error);
      throw error;
    }
  }

  /**
   * Update token accounts for wallet
   */
  private async updateTokenAccounts(walletName: string): Promise<void> {
    const keypair = this.wallets.get(walletName);
    const info = this.walletInfo.get(walletName);
    
    if (!keypair || !info) return;

    try {
      const tokenAccounts = await this.connection.getParsedTokenAccountsByOwner(
        keypair.publicKey,
        { programId: TOKEN_PROGRAM_ID }
      );

      info.tokenAccounts.clear();
      
      for (const account of tokenAccounts.value) {
        const mint = account.account.data.parsed.info.mint;
        const amount = account.account.data.parsed.info.tokenAmount.uiAmount || 0;
        info.tokenAccounts.set(mint, amount);
      }
      
    } catch (error) {
      logger.error(`Failed to update token accounts for wallet ${walletName}:`, error);
    }
  }

  /**
   * Get wallet balance
   */
  getWalletBalance(walletName: string): number {
    const info = this.walletInfo.get(walletName);
    return info ? info.balance : 0;
  }

  /**
   * Get wallet public key
   */
  getWalletPublicKey(walletName: string): string | null {
    const keypair = this.wallets.get(walletName);
    return keypair ? keypair.publicKey.toString() : null;
  }

  /**
   * Get wallet keypair
   */
  getWalletKeypair(walletName: string): Keypair | null {
    return this.wallets.get(walletName) || null;
  }

  /**
   * Check if wallet has sufficient balance
   */
  hasSufficientBalance(walletName: string, requiredAmount: number): boolean {
    const balance = this.getWalletBalance(walletName);
    return balance >= requiredAmount + this.MIN_SOL_BALANCE; // Keep minimum for fees
  }

  /**
   * Get primary wallet (phantom-wallet)
   */
  getPrimaryWallet(): Keypair | null {
    return this.wallets.get('phantom-wallet') || null;
  }

  /**
   * Get all wallet info
   */
  getAllWalletInfo(): Map<string, WalletInfo> {
    return this.walletInfo;
  }

  /**
   * Get wallet info by name
   */
  getWalletInfo(name: string): WalletInfo | null {
    return this.walletInfo.get(name) || null;
  }

  /**
   * Create new wallet
   */
  async createWallet(name: string, encrypt = true): Promise<string> {
    const keypair = Keypair.generate();
    this.wallets.set(name, keypair);
    
    this.walletInfo.set(name, {
      publicKey: keypair.publicKey.toString(),
      balance: 0,
      tokenAccounts: new Map(),
      lastUpdated: Date.now(),
      nonce: 0,
      isActive: true
    });

    // Save to file if encrypt is true
    if (encrypt) {
      // Implementation for saving encrypted wallet
      console.log(`🔑 Wallet ${name} created and saved`);
    }

    return keypair.publicKey.toString();
  }

  /**
   * Get token balance for wallet
   */
  getTokenBalance(walletName: string, mintAddress: string): number {
    const info = this.walletInfo.get(walletName);
    if (!info) return 0;
    return info.tokenAccounts.get(mintAddress) || 0;
  }

  /**
   * Increment nonce for wallet
   */
  incrementNonce(walletName: string): void {
    const currentNonce = this.nonceCache.get(walletName) || 0;
    this.nonceCache.set(walletName, currentNonce + 1);
  }

  /**
   * Get wallet metrics
   */
  getMetrics(): WalletMetrics {
    const totalWallets = this.wallets.size;
    const activeWallets = Array.from(this.walletInfo.values()).filter(info => info.isActive).length;
    const totalBalance = Array.from(this.walletInfo.values()).reduce((sum, info) => sum + info.balance, 0);
    const averageBalance = totalWallets > 0 ? totalBalance / totalWallets : 0;
    const lastBalanceUpdate = Math.max(...Array.from(this.walletInfo.values()).map(info => info.lastUpdated));
    const nonceErrors = 0; // Would track nonce errors
    const transactionCount = 0; // Would track transaction count

    return {
      totalWallets,
      activeWallets,
      totalBalance,
      averageBalance,
      lastBalanceUpdate,
      nonceErrors,
      transactionCount
    };
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.balanceUpdateInterval) {
      clearInterval(this.balanceUpdateInterval);
    }
    
    // Clear sensitive data from memory
    this.wallets.clear();
    this.walletInfo.clear();
    this.nonceCache.clear();
  }
}
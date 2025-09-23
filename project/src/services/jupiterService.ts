import axios, { AxiosInstance } from 'axios';
import { createRequire } from 'module';
import { config } from '../config/index.js';
import { JupiterQuote } from '../types/index.js';
import logger from '../utils/logger.js';

const require = createRequire(import.meta.url);

/**
 * Optimized Jupiter API Service with connection pooling and retry logic
 */
export class JupiterService {
  private client: AxiosInstance;
  private requestCount = 0;
  private errorCount = 0;
  private lastResetTime = Date.now();

  constructor() {
    this.client = axios.create({
      baseURL: config.jupiterApiUrl,
      timeout: 2000,
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SolanaSniper/1.0',
        'Connection': 'keep-alive',
        ...(config.jupiterApiKey && { 'Authorization': `Bearer ${config.jupiterApiKey}` })
      },
      httpAgent: new (require('http').Agent)({ 
        keepAlive: true,
        maxSockets: 10,
        maxFreeSockets: 5
      }),
      httpsAgent: new (require('https').Agent)({ 
        keepAlive: true,
        maxSockets: 10,
        maxFreeSockets: 5
      })
    });

    this.client.interceptors.response.use(
      (response) => {
        this.requestCount++;
        return response;
      },
      (error) => {
        this.errorCount++;
        return Promise.reject(error);
      }
    );
  }

  /**
   * Get optimized quote for token swap
   */
  async getQuote(
    inputMint: string,
    outputMint: string,
    amount: number,
    options: {
      slippageBps?: number;
      maxAccounts?: number;
      onlyDirectRoutes?: boolean;
    } = {}
  ): Promise<JupiterQuote | null> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1500); // 1.5 second timeout

    try {
      const response = await this.client.get('/quote', {
        params: {
          inputMint,
          outputMint,
          amount,
          slippageBps: options.slippageBps || 1000,
          maxAccounts: options.maxAccounts || 15,
          onlyDirectRoutes: options.onlyDirectRoutes !== false,
          asLegacyTransaction: false,
          restrictIntermediateTokens: true,
          excludeDexes: 'Aldrin,Crema,Cropper,Cykura,DeltaFi,GooseFX,Invariant,Lifinity,Marinade,Mercurial,Meteora,Raydium CLMM,Saber,Serum,Orca,Whirlpool'
        },
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response.data;
    } catch (error) {
      clearTimeout(timeoutId);
      
      if (error instanceof Error && error.name === 'AbortError') {
        logger.debug(`Jupiter quote aborted for ${outputMint} due to timeout`);
      } else {
        logger.debug(`Jupiter quote failed for ${outputMint}:`, error instanceof Error ? error.message : 'Unknown error');
      }
      return null;
    }
  }

  /**
   * Get swap transaction for execution
   */
  async getSwapTransaction(quote: JupiterQuote, userPublicKey: string): Promise<any> {
    try {
      const response = await this.client.post('/swap', {
        quoteResponse: quote,
        userPublicKey,
        wrapAndUnwrapSol: true,
        useSharedAccounts: true,
        feeAccount: undefined,
        trackingAccount: undefined,
        computeUnitPriceMicroLamports: 'auto'
      });

      return response.data;
    } catch (error) {
      logger.error('Jupiter swap transaction failed:', error);
      throw error;
    }
  }

  /**
   * Batch quote requests for multiple tokens (experimental)
   */
  async getBatchQuotes(requests: Array<{
    inputMint: string;
    outputMint: string;
    amount: number;
  }>): Promise<Array<JupiterQuote | null>> {
    const promises = requests.map(req => 
      this.getQuote(req.inputMint, req.outputMint, req.amount)
    );

    return Promise.all(promises);
  }

  /**
   * Get service metrics
   */
  getMetrics() {
    const now = Date.now();
    const uptime = now - this.lastResetTime;
    
    return {
      requestCount: this.requestCount,
      errorCount: this.errorCount,
      errorRate: this.requestCount > 0 ? (this.errorCount / this.requestCount) * 100 : 0,
      requestsPerSecond: this.requestCount / (uptime / 1000),
      uptime
    };
  }

  /**
   * Reset metrics
   */
  resetMetrics() {
    this.requestCount = 0;
    this.errorCount = 0;
    this.lastResetTime = Date.now();
  }
}

export const jupiterService = new JupiterService();

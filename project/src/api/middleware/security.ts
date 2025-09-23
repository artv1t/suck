import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';
import logger from '../../utils/logger.js';

export interface SecureRequest extends Request {
  clientId?: string;
  apiKey?: string;
  rateLimitInfo?: {
    remaining: number;
    resetTime: number;
  };
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
}

interface ValidationResult {
  valid: boolean;
  threats: string[];
}

/**
 * Security middleware for API protection
 */
export class SecurityMiddleware {
  private rateLimiters = new Map<string, Map<string, number[]>>();
  private blockedIPs = new Set<string>();
  private apiKeys = new Set<string>();

  constructor() {
    // Add default API keys for testing
    this.apiKeys.add('test-api-key-123');
    this.apiKeys.add('admin-api-key-456');
  }

  /**
   * Rate limiting middleware
   */
  rateLimit(type: string = 'api') {
    return (req: SecureRequest, res: Response, next: NextFunction) => {
      const clientId = this.getClientId(req);
      const rateLimitResult = this.checkRateLimit(type, clientId);

      // Add rate limit headers
      res.set({
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': rateLimitResult.remaining.toString(),
        'X-RateLimit-Reset': new Date(rateLimitResult.resetTime).toISOString()
      });

      if (!rateLimitResult.allowed) {
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil((rateLimitResult.resetTime - Date.now()) / 1000)
        });
      }

      req.rateLimitInfo = {
        remaining: rateLimitResult.remaining,
        resetTime: rateLimitResult.resetTime
      };

      next();
    };
  }

  /**
   * Input validation middleware
   */
  validateInput() {
    return (req: SecureRequest, res: Response, next: NextFunction) => {
      const clientId = this.getClientId(req);
      
      // Validate request body
      if (req.body) {
        const validation = this.validateInputData(req.body);
        if (!validation.valid) {
          logger.warn(`🚨 Security threat detected from ${clientId}: ${validation.threats.join(', ')}`);
          return res.status(400).json({
            success: false,
            error: 'Invalid input detected',
            threats: validation.threats
          });
        }
      }

      // Validate query parameters
      if (req.query) {
        for (const [key, value] of Object.entries(req.query)) {
          const validation = this.validateInputData(value);
          if (!validation.valid) {
            logger.warn(`🚨 Security threat in query param ${key} from ${clientId}: ${validation.threats.join(', ')}`);
            return res.status(400).json({
              success: false,
              error: `Invalid query parameter: ${key}`,
              threats: validation.threats
            });
          }
        }
      }

      next();
    };
  }

  /**
   * API key authentication middleware
   */
  requireApiKey(requiredPermission?: string) {
    return (req: SecureRequest, res: Response, next: NextFunction) => {
      const apiKey = req.headers['x-api-key'] as string;
      
      if (!apiKey) {
        return res.status(401).json({
          success: false,
          error: 'API key required'
        });
      }

      if (!this.apiKeys.has(apiKey)) {
        return res.status(403).json({
          success: false,
          error: 'Invalid API key or insufficient permissions'
        });
      }

      req.apiKey = apiKey;
      next();
    };
  }

  /**
   * Block check middleware
   */
  checkBlocked() {
    return (req: SecureRequest, res: Response, next: NextFunction) => {
      const clientId = this.getClientId(req);
      
      if (this.blockedIPs.has(clientId)) {
        return res.status(403).json({
          success: false,
          error: 'Access blocked due to security violations'
        });
      }

      next();
    };
  }

  /**
   * Security headers middleware
   */
  securityHeaders() {
    return (req: Request, res: Response, next: NextFunction) => {
      // Security headers
      res.set({
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'X-XSS-Protection': '1; mode=block',
        'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
        'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'",
        'Referrer-Policy': 'strict-origin-when-cross-origin',
        'Permissions-Policy': 'geolocation=(), microphone=(), camera=()'
      });

      next();
    };
  }

  /**
   * Request logging middleware
   */
  requestLogging() {
    return (req: SecureRequest, res: Response, next: NextFunction) => {
      const clientId = this.getClientId(req);
      const startTime = Date.now();

      // Log request
      logger.info({
        type: 'api_request',
        method: req.method,
        path: req.path,
        clientId,
        userAgent: req.headers['user-agent'],
        timestamp: startTime
      });

      // Log response
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        logger.info({
          type: 'api_response',
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration,
          clientId,
          timestamp: Date.now()
        });
      });

      next();
    };
  }

  /**
   * Get client identifier (IP + User-Agent hash)
   */
  private getClientId(req: Request): string {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const userAgent = req.headers['user-agent'] || 'unknown';
    const combined = `${ip}:${userAgent}`;
    return crypto.createHash('md5').update(combined).digest('hex').substring(0, 16);
  }

  /**
   * Check rate limits
   */
  private checkRateLimit(type: string, clientId: string): RateLimitResult {
    const now = Date.now();
    const windowMs = 60000; // 1 minute
    const maxRequests = 100;
    
    if (!this.rateLimiters.has(type)) {
      this.rateLimiters.set(type, new Map());
    }
    
    const typeRateLimiter = this.rateLimiters.get(type)!;
    
    if (!typeRateLimiter.has(clientId)) {
      typeRateLimiter.set(clientId, []);
    }
    
    const requests = typeRateLimiter.get(clientId)!;
    const validRequests = requests.filter(time => now - time < windowMs);
    
    if (validRequests.length >= maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetTime: Math.min(...validRequests) + windowMs
      };
    }
    
    validRequests.push(now);
    typeRateLimiter.set(clientId, validRequests);
    
    return {
      allowed: true,
      remaining: maxRequests - validRequests.length,
      resetTime: now + windowMs
    };
  }

  /**
   * Validate input data
   */
  private validateInputData(input: any): ValidationResult {
    const threats: string[] = [];
    
    if (typeof input === 'string') {
      // Check for SQL injection patterns
      const sqlPatterns = [
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER)\b)/i,
        /(UNION|OR|AND)\s+\d+\s*=\s*\d+/i,
        /['"]\s*(OR|AND)\s*['"]\s*=\s*['"]?/i
      ];
      
      for (const pattern of sqlPatterns) {
        if (pattern.test(input)) {
          threats.push('SQL injection attempt');
          break;
        }
      }

      // Check for XSS patterns
      const xssPatterns = [
        /<script[^>]*>.*?<\/script>/i,
        /javascript:/i,
        /on\w+\s*=/i,
        /<iframe[^>]*>/i
      ];
      
      for (const pattern of xssPatterns) {
        if (pattern.test(input)) {
          threats.push('XSS attempt');
          break;
        }
      }

      // Check for path traversal
      if (input.includes('../') || input.includes('..\\')) {
        threats.push('Path traversal attempt');
      }

      // Check for command injection
      const cmdPatterns = [
        /[;&|`$()]/,
        /\b(rm|del|format|shutdown|reboot)\b/i
      ];
      
      for (const pattern of cmdPatterns) {
        if (pattern.test(input)) {
          threats.push('Command injection attempt');
          break;
        }
      }
    }

    return { valid: threats.length === 0, threats };
  }
}
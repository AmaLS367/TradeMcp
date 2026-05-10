import axios from 'axios';
import crypto from 'crypto';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate Binance API keys via a test request to /api/v3/account
 */
async function validateBinanceKeys(apiKey: string, apiSecret: string): Promise<ValidationResult> {
  try {
    const timestamp = Date.now();
    const recvWindow = 5000;
    
    // Request parameters
    const params = new URLSearchParams({
      timestamp: timestamp.toString(),
      recvWindow: recvWindow.toString(),
    });
    
    // Create HMAC signature
    const signature = crypto
      .createHmac('sha256', apiSecret)
      .update(params.toString())
      .digest('hex');
    
    // Build full URL with signature
    const url = `https://api.binance.com/api/v3/account?${params.toString()}&signature=${signature}`;
    
    const response = await axios.get(url, {
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
    
    // Check response structure (must have makerCommission, balances, etc.)
    if (response.data && typeof response.data === 'object') {
      const hasRequiredFields = 
        'makerCommission' in response.data &&
        'takerCommission' in response.data &&
        'balances' in response.data &&
        Array.isArray(response.data.balances);
      
      if (hasRequiredFields) {
        return { valid: true };
      } else {
        return { valid: false, error: 'Unexpected response structure from Binance' };
      }
    }
    
    return { valid: false, error: 'Invalid response from Binance' };
  } catch (error: any) {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      
      // Binance-specific errors
      if (status === 401) {
        if (data?.code === -2015) {
          return { valid: false, error: 'Invalid API key or secret' };
        }
        if (data?.code === -2014) {
          return { valid: false, error: 'API key not activated or expired' };
        }
        if (data?.code === -2008) {
          return { valid: false, error: 'Invalid request signature' };
        }
        return { valid: false, error: 'Authorization error (401)' };
      }
      
      if (status === 403) {
        if (data?.code === -2011) {
          return { valid: false, error: 'API key does not exist' };
        }
        return { valid: false, error: 'Access denied (possible IP restriction)' };
      }
      
      if (status === 429) {
        return { valid: false, error: 'Binance rate limit exceeded' };
      }
      
      return { valid: false, error: `Binance error: ${data?.msg || status}` };
    }
    
    if (error.code === 'ECONNABORTED') {
      return { valid: false, error: 'Binance connection timeout' };
    }
    
    return { valid: false, error: `Network error: ${error.message}` };
  }
}

/**
 * Validate Bybit API keys via a test request to /v5/account/wallet-balance
 */
async function validateBybitKeys(apiKey: string, apiSecret: string): Promise<ValidationResult> {
  try {
    const timestamp = Date.now();
    const recvWindow = 5000;
    
    // Parameters for the signature string
    const params = {
      category: 'UNIFIED',
      accountType: 'UNIFIED',
    };
    
    // String to sign: timestamp + apiKey + recvWindow + queryString
    const queryString = new URLSearchParams(params).toString();
    const signStr = `${timestamp}${apiKey}${recvWindow}${queryString}`;
    
    // Create HMAC signature
    const signature = crypto
      .createHmac('sha256', apiSecret)
      .update(signStr)
      .digest('hex');
    
    const url = 'https://api.bybit.com/v5/account/wallet-balance';
    
    const response = await axios.get(url, {
      params: {
        ...params,
      },
      headers: {
        'X-BAPI-API-KEY': apiKey,
        'X-BAPI-SIGN': signature,
        'X-BAPI-SIGN-TYPE': '2',
        'X-BAPI-TIMESTAMP': timestamp.toString(),
        'X-BAPI-RECV-WINDOW': recvWindow.toString(),
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
    
    // Check Bybit response structure
    if (response.data && response.data.retCode === 0) {
      if (response.data.result && Array.isArray(response.data.result.list)) {
        return { valid: true };
      }
      return { valid: false, error: 'Unexpected response structure from Bybit' };
    }
    
    // If retCode !== 0, it's an error
    const retMsg = response.data?.retMsg || 'Unknown error';
    return { valid: false, error: `Bybit: ${retMsg}` };
  } catch (error: any) {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      
      // Bybit-specific errors
      if (data?.retCode === 10003) {
        return { valid: false, error: 'Invalid API key, key does not exist' };
      }
      if (data?.retCode === 10006) {
        return { valid: false, error: 'Invalid request signature' };
      }
      if (data?.retCode === 10001) {
        return { valid: false, error: 'Invalid request parameters' };
      }
      if (data?.retCode === 10017) {
        return { valid: false, error: 'Request rejected due to rate limit' };
      }
      
      const retMsg = data?.retMsg || data?.message || status;
      return { valid: false, error: `Bybit error: ${retMsg}` };
    }
    
    if (error.code === 'ECONNABORTED') {
      return { valid: false, error: 'Bybit connection timeout' };
    }
    
    return { valid: false, error: `Network error: ${error.message}` };
  }
}

/**
 * Main exchange key validation entry point
 */
export async function validateExchangeKeys(
  exchange: 'binance' | 'bybit',
  apiKey: string,
  apiSecret: string
): Promise<ValidationResult> {
  // Basic format validation
  if (!apiKey || !apiSecret) {
    return { valid: false, error: 'API key and secret cannot be empty' };
  }
  
  if (apiKey.length < 10 || apiSecret.length < 10) {
    return { valid: false, error: 'API key or secret is too short' };
  }
  
  // Basic allowed-characters check
  const validCharsRegex = /^[a-zA-Z0-9\-_]+$/;
  if (!validCharsRegex.test(apiKey) || !validCharsRegex.test(apiSecret)) {
    return { valid: false, error: 'API key or secret contains invalid characters' };
  }
  
  // Functional validation via exchange API call
  if (exchange === 'binance') {
    return validateBinanceKeys(apiKey, apiSecret);
  } else if (exchange === 'bybit') {
    return validateBybitKeys(apiKey, apiSecret);
  }
  
  return { valid: false, error: 'Unsupported exchange' };
}

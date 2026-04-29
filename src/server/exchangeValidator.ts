import axios from 'axios';
import crypto from 'crypto';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Валидация API ключей Binance через тестовый запрос к /api/v3/account
 */
async function validateBinanceKeys(apiKey: string, apiSecret: string): Promise<ValidationResult> {
  try {
    const timestamp = Date.now();
    const recvWindow = 5000;
    
    // Параметры запроса
    const params = new URLSearchParams({
      timestamp: timestamp.toString(),
      recvWindow: recvWindow.toString(),
    });
    
    // Создаем подпись
    const signature = crypto
      .createHmac('sha256', apiSecret)
      .update(params.toString())
      .digest('hex');
    
    // Формируем полный URL с подписью
    const url = `https://api.binance.com/api/v3/account?${params.toString()}&signature=${signature}`;
    
    const response = await axios.get(url, {
      headers: {
        'X-MBX-APIKEY': apiKey,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });
    
    // Проверяем структуру ответа (должны быть поля makerCommission, balances и т.д.)
    if (response.data && typeof response.data === 'object') {
      const hasRequiredFields = 
        'makerCommission' in response.data &&
        'takerCommission' in response.data &&
        'balances' in response.data &&
        Array.isArray(response.data.balances);
      
      if (hasRequiredFields) {
        return { valid: true };
      } else {
        return { valid: false, error: 'Неожиданная структура ответа от Binance' };
      }
    }
    
    return { valid: false, error: 'Некорректный ответ от Binance' };
  } catch (error: any) {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      
      // Специфические ошибки Binance
      if (status === 401) {
        if (data?.code === -2015) {
          return { valid: false, error: 'Неверный API ключ или секрет' };
        }
        if (data?.code === -2014) {
          return { valid: false, error: 'API ключ не активирован или истёк' };
        }
        if (data?.code === -2008) {
          return { valid: false, error: 'Неверная подпись запроса' };
        }
        return { valid: false, error: 'Ошибка авторизации (401)' };
      }
      
      if (status === 403) {
        if (data?.code === -2011) {
          return { valid: false, error: 'API ключ не существует' };
        }
        return { valid: false, error: 'Доступ запрещён (возможно, ограничение по IP)' };
      }
      
      if (status === 429) {
        return { valid: false, error: 'Превышен лимит запросов к Binance' };
      }
      
      return { valid: false, error: `Ошибка Binance: ${data?.msg || status}` };
    }
    
    if (error.code === 'ECONNABORTED') {
      return { valid: false, error: 'Таймаут соединения с Binance' };
    }
    
    return { valid: false, error: `Ошибка сети: ${error.message}` };
  }
}

/**
 * Валидация API ключей Bybit через тестовый запрос к /v5/account/wallet-balance
 */
async function validateBybitKeys(apiKey: string, apiSecret: string): Promise<ValidationResult> {
  try {
    const timestamp = Date.now();
    const recvWindow = 5000;
    
    // Параметры для строки подписи
    const params = {
      category: 'UNIFIED',
      accountType: 'UNIFIED',
    };
    
    // Строка для подписи: timestamp + apiKey + recvWindow + queryString
    const queryString = new URLSearchParams(params).toString();
    const signStr = `${timestamp}${apiKey}${recvWindow}${queryString}`;
    
    // Создаем подпись
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
    
    // Проверяем структуру ответа Bybit
    if (response.data && response.data.retCode === 0) {
      if (response.data.result && Array.isArray(response.data.result.list)) {
        return { valid: true };
      }
      return { valid: false, error: 'Неожиданная структура ответа от Bybit' };
    }
    
    // Если retCode !== 0, значит ошибка
    const retMsg = response.data?.retMsg || 'Неизвестная ошибка';
    return { valid: false, error: `Bybit: ${retMsg}` };
  } catch (error: any) {
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      
      // Специфические ошибки Bybit
      if (data?.retCode === 10003) {
        return { valid: false, error: 'Неверный API ключ, ключ не существует' };
      }
      if (data?.retCode === 10006) {
        return { valid: false, error: 'Неверная подпись запроса' };
      }
      if (data?.retCode === 10001) {
        return { valid: false, error: 'Параметры запроса неверны' };
      }
      if (data?.retCode === 10017) {
        return { valid: false, error: 'Запрос отклонён из-за лимита скорости' };
      }
      
      const retMsg = data?.retMsg || data?.message || status;
      return { valid: false, error: `Ошибка Bybit: ${retMsg}` };
    }
    
    if (error.code === 'ECONNABORTED') {
      return { valid: false, error: 'Таймаут соединения с Bybit' };
    }
    
    return { valid: false, error: `Ошибка сети: ${error.message}` };
  }
}

/**
 * Основная функция валидации ключей
 */
export async function validateExchangeKeys(
  exchange: 'binance' | 'bybit',
  apiKey: string,
  apiSecret: string
): Promise<ValidationResult> {
  // Минимальная форматная проверка
  if (!apiKey || !apiSecret) {
    return { valid: false, error: 'API ключ и секрет не могут быть пустыми' };
  }
  
  if (apiKey.length < 10 || apiSecret.length < 10) {
    return { valid: false, error: 'API ключ или секрет слишком короткие' };
  }
  
  // Проверка на допустимые символы (базовая)
  const validCharsRegex = /^[a-zA-Z0-9\-_]+$/;
  if (!validCharsRegex.test(apiKey) || !validCharsRegex.test(apiSecret)) {
    return { valid: false, error: 'API ключ или секрет содержат недопустимые символы' };
  }
  
  // Функциональная валидация через запрос к бирже
  if (exchange === 'binance') {
    return validateBinanceKeys(apiKey, apiSecret);
  } else if (exchange === 'bybit') {
    return validateBybitKeys(apiKey, apiSecret);
  }
  
  return { valid: false, error: 'Неподдерживаемая биржа' };
}

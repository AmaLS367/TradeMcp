export const TRADEMCP_DOCS_TOOL_NAME = 'get_trademcp_research_guide' as const;

export function getTradeMcpResearchGuide(topic: unknown) {
  const normalizedTopic = typeof topic === 'string' ? topic.trim().toLowerCase() : 'overview';
  const commonRules = [
    'Do not hallucinate unavailable metrics. If revenue, staking, holder concentration, unlocks, or usage data is unavailable through connected tools, say exactly that and mark it as a data gap.',
    'Prefer hard data over narrative. On-chain, exchange order book, CoinGecko, GitHub, Messari, and protocol/financial data outrank news sentiment when scoring.',
    'Never analyze a cryptoasset in isolation. Compare valuation, liquidity, usage, or revenue metrics against the nearest competitor when the data is available.',
    'Separate protocol quality from token value capture. A strong network can still have weak token economics.',
    'Do not use create_trade_proposal unless the user explicitly asks to stage a trade for human approval.',
  ];

  const guides: Record<string, unknown> = {
    overview: {
      purpose: 'Use this guide before choosing TradeMCP tools for crypto research.',
      availableToolGroups: {
        docs: [TRADEMCP_DOCS_TOOL_NAME],
        marketData: [
          'get_crypto_prices',
          'get_crypto_markets',
          'get_crypto_market_chart',
          'get_binance_ticker',
          'get_binance_order_book',
          'get_binance_klines',
          'get_binance_24h_stats',
          'coingecko_public__*',
          'crypto_com__*',
        ],
        fundamentals: [
          'ask_messari_research',
          'get_messari_timeseries_catalog',
          'get_messari_timeseries',
          'dune__*',
        ],
        discoveryAndNews: ['search', 'fetch', 'get_crypto_news', 'search_newsapi_articles', 'get_newsapi_top_headlines', 'get_newsapi_sources'],
        rawExchange: ['list_exchange_methods', 'call_exchange_method'],
        execution: ['create_trade_proposal'],
      },
      rules: commonRules,
      userIntentToTool: {
        'current price': 'get_crypto_prices or get_binance_ticker — CoinGecko for reference, Binance for exchange-specific',
        'market ranking / top coins': 'get_crypto_markets',
        'historical chart / price over time': 'get_crypto_market_chart',
        'trending coins': 'get_crypto_trending',
        'order book / liquidity / spread': 'get_binance_order_book',
        '24h market activity': 'get_binance_24h_stats',
        'OHLCV / candles / technical analysis': 'get_binance_klines',
        'crypto news / sentiment': 'get_crypto_news for CryptoPanic sentiment or search_newsapi_articles/get_newsapi_top_headlines for broader publisher coverage',
        'fundamental research / tokenomics': 'ask_messari_research then get_messari_timeseries',
        'forex quote / FX price': 'get_fx_quote',
        'forex chart / FX candles': 'get_fx_candles',
        'technical indicator (SMA/RSI/MACD)': 'get_technical_indicator',
        'search assets / discovery': 'search',
        'fetch URL / read web page': 'fetch',
        'exchange balance / portfolio': 'get_account_summary',
        'place a trade': 'create_trade_proposal — never execute directly, always create a proposal',
        'raw exchange API call': 'list_exchange_methods to discover, then call_exchange_method',
        'observability / tool usage stats': 'get_observability_metrics',
        'alerts / failures / auth problems': 'get_observability_alerts',
      },
    },
    fundamental_crypto: {
      role: 'Expert crypto fundamental analyst and quant researcher. Determine protocol value and token value capture using hard data first.',
      workflow: [
        'Identify the asset: ticker, CoinGecko ID, exchange symbol, protocol category, and closest competitors.',
        'Collect valuation and tokenomics: market cap, FDV, circulating supply, max supply, unlock/vesting risk when available, inflation/burn mechanics when available.',
        'Collect liquidity: Binance ticker, 24h stats, spread, order book depth, and market volume. Report whether the asset is liquid enough for larger capital.',
        'Collect value capture: protocol fees, revenue, cash flow, staking, buyback/burn, utility, security budget, and token demand sinks. If unavailable, state the gap.',
        'Collect adoption and moat: integrations, active users/wallets, transaction/message volume, GitHub/dev activity, network effects, and competitor threat.',
        'Collect external risks: recent news/events, regulatory risk, treasury/governance, holder concentration, unlocks, and concentration flows when available.',
        'Compare against a peer such as LINK vs PYTH/API3/BAND, L1 vs L1, DEX vs DEX, or lending protocol vs lending protocol.',
      ],
      recommendedToolsInOrder: [
        'search for asset discovery when ID/symbol is ambiguous',
        'get_crypto_markets or coingecko_public__ tools for market cap, FDV, volume, and supply',
        'get_binance_24h_stats plus get_binance_order_book for liquidity and spread',
        'ask_messari_research and get_messari_timeseries* for research and structured historical metrics when the user has access',
        'get_crypto_news or NewsAPI tools for news/events; use as lower-priority context, not score driver',
        'fetch for protocol docs, public reports, or source URLs when structured tools do not expose a metric',
      ],
      outputFormat: {
        thesis: 'One sentence: buy, hold, or sell in fundamental-analysis context.',
        bullCase: 'Three strongest upside drivers.',
        bearCase: 'Three critical risks or failure modes.',
        scores: ['Token economics: 1-10', 'Technology: 1-10', 'Market adoption: 1-10'],
        verdict: 'Final conclusion plus the exact metrics to monitor next.',
        dataGaps: 'List missing metrics explicitly.',
      },
      rules: commonRules,
    },
    symbol_normalization: {
      purpose: 'Guide for converting symbol formats between providers. AI agents commonly confuse CoinGecko IDs, Binance symbols, and FX pairs.',
      providerFormats: {
        coingecko: { format: 'lowercase slug (hyphens for spaces)', examples: ['bitcoin', 'ethereum', 'avalanche-2', 'matic-network', 'solana'], tools: ['get_crypto_prices', 'get_crypto_markets', 'get_crypto_market_chart'] },
        binance: { format: 'BASE/QUOTE', examples: ['BTC/USDT', 'ETH/USDT', 'SOL/USDT'], tools: ['get_binance_ticker', 'get_binance_order_book', 'get_binance_klines', 'get_binance_24h_stats', 'call_exchange_method'] },
        fx: { format: 'FIAT/FIAT', examples: ['EUR/USD', 'GBP/JPY', 'AUD/CAD'], tools: ['get_fx_quote', 'get_fx_candles', 'get_technical_indicator'] },
        ticker: { format: 'UPPERCASE 2-10 chars', examples: ['BTC', 'ETH', 'SOL', 'XRP'], tools: [] },
      },
      commonMistakes: [
        'Passing "BTC" (ticker) to CoinGecko tools that expect "bitcoin" (CoinGecko ID) — always use lowercase full names for CoinGecko.',
        'Passing "bitcoin" (CoinGecko ID) to Binance tools that expect "BTC/USDT" (exchange symbol) — always use BASE/QUOTE format for Binance.',
        'Passing "ETH/USDT" (Binance format) to FX tools that expect fiat pairs like "EUR/USD".',
        'For FX pairs, only use fiat currencies: EUR, GBP, JPY, CHF, AUD, NZD, CAD as the base.',
      ],
      rules: [
        'When a user says "BTC price", use get_binance_ticker with "BTC/USDT" for exchange price OR get_crypto_prices with ["bitcoin"] for CoinGecko price — do not mix formats.',
        'When a user mentions a symbol without specifying the format, ask: "Which provider? CoinGecko, Binance, or FX?"',
        'Symbol format is determined by the tool, not by user preference. Read each tool\'s description to know which format it expects.',
      ],
    },
    technical_crypto: {
      role: 'Crypto technical analyst and market microstructure researcher. Analyze trend, momentum, volatility, volume, and liquidity without pretending TA is fundamentals.',
      workflow: [
        'Normalize the requested exchange symbol, usually TICKER/USDT for Binance unless the user specifies another market.',
        'Fetch current ticker and 24h stats for last price, high/low, change, and quote volume.',
        'Fetch candles for the requested timeframe and one higher timeframe. If no timeframe is specified, use 1h and 1d as defaults.',
        'Use order book data for spread, near-touch depth, and obvious liquidity walls.',
        'Use raw CCXT only when built-in Binance helpers cannot answer the question, and prefer public read-only methods for research.',
        'State invalidation levels, key support/resistance, trend regime, volatility context, and liquidity caveats.',
      ],
      recommendedToolsInOrder: [
        'get_binance_ticker',
        'get_binance_24h_stats',
        'get_binance_klines',
        'get_binance_order_book',
        'list_exchange_methods and call_exchange_method only for missing public CCXT data',
      ],
      outputFormat: {
        marketState: 'Trend, momentum, volatility, and liquidity summary.',
        levels: 'Support, resistance, invalidation, and possible trigger levels.',
        scenarios: 'Bullish and bearish scenarios with evidence.',
        riskNotes: 'Spread/depth/slippage and timeframe limitations.',
      },
      rules: [
        'Do not infer fundamentals from price action.',
        'Do not provide certainty from indicators. Tie every claim to observed price, volume, candle, or order book data.',
        'If candle history is too short for the requested timeframe, say so.',
      ],
    },
  };

  return guides[normalizedTopic] || guides.overview;
}

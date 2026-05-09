import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, CallToolRequestSchema, type Tool } from "@modelcontextprotocol/sdk/types.js";
import admin from 'firebase-admin';
import { logger } from './logger.js';
import { getFxCandles, getFxQuote, getTechnicalIndicator, SUPPORTED_TWELVE_INDICATORS } from './marketData.js';
import {
    CRYPTO_ANALYSIS_MCP_TOOL_NAMES,
    askMessariResearch,
    getBinance24hStats,
    getBinanceKlines,
    getBinanceOrderBook,
    getBinanceTicker,
    getCoinGeckoMarketChart,
    getCoinGeckoMarkets,
    getCoinGeckoPrices,
    getCoinGeckoTrending,
    getCryptoPanicNews,
    getMessariTimeseries,
    getMessariTimeseriesCatalog,
} from './cryptoAnalysis.js';
import {
    callMarketplaceTool,
    isMcpMarketplaceServerId,
    listMarketplaceToolsForServerIds,
    marketplaceErrorMessage,
    parseMarketplaceToolName,
    trimMarketplaceToolResult,
    type McpMarketplaceServerId,
} from './mcpMarketplace.js';
import { db } from './mcpFirebase.js';
import { TRADEMCP_DOCS_TOOL_NAME, getTradeMcpResearchGuide } from './tradeMcpResearchGuide.js';
import { MARKET_DATA_MCP_TOOL_NAMES, RAW_EXCHANGE_MCP_TOOL_NAMES, isMarketplaceToolAllowed, shouldIncludeTool } from './mcpToolPolicy.js';
import {
    assertMethodCallable,
    collectExchangeMethods,
    createExchange,
    isSupportedProvider,
    safeJson,
    trimToolText,
} from './mcpExchange.js';
import {
    getCoinGeckoCredentials,
    getCryptoPanicCredentials,
    getMarketDataCredentials,
    getMarketplaceMcpCredentials,
    getMessariCredentials,
} from './mcpCredentials.js';

const MAX_TOOL_RESPONSE_CHARS = 60_000;
async function getEnabledMarketplaceServerIds(userId: string | null): Promise<McpMarketplaceServerId[]> {
    if (!userId) {
        return [];
    }

    const snap = await db.collection(`users/${userId}/mcp_server_connections`)
        .where('isEnabled', '==', true)
        .get();

    return snap.docs
        .map((doc) => doc.id)
        .filter(isMcpMarketplaceServerId);
}

async function isMarketplaceServerEnabled(userId: string | null, serverId: McpMarketplaceServerId) {
    if (!userId) {
        return false;
    }

    const doc = await db.doc(`users/${userId}/mcp_server_connections/${serverId}`).get();
    return doc.exists && doc.data()?.isEnabled === true;
}

export function createMcpServer(userId: string | null, profile?: string) {
    const server = new Server({
        name: "TradeMCPServer",
        version: "1.1.0"
    }, {
        capabilities: {
            tools: {}
        },
        instructions: "Trade MCP exposes market data, crypto research, exchange account reads, human-approved trade proposal tools, and raw Binance/Bybit CCXT API access for the authenticated dashboard user. Before deep crypto fundamental or technical analysis, call get_trademcp_research_guide to choose the correct tool sequence and source-priority rules. list_exchange_methods and call_exchange_method are available in every client profile and can call public, private, trading, transfer, and raw endpoint methods when the user's exchange connection has permissions."
    });

    server.setRequestHandler(ListToolsRequestSchema, async () => {
        const allTools: Tool[] = [
                {
                    name: TRADEMCP_DOCS_TOOL_NAME,
                    description: "Use this first when the user asks for crypto fundamental analysis, technical analysis, investment memo, token research, protocol research, or asks which TradeMCP tools to use. Returns TradeMCP's internal research playbooks, source-priority rules, anti-hallucination constraints, output formats, and recommended tool order for FA/TA. This is documentation only and does not fetch market data.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            topic: {
                                type: "string",
                                enum: ["overview", "fundamental_crypto", "technical_crypto"],
                                description: "Guide topic. Use fundamental_crypto for FA/token/protocol memos, technical_crypto for TA/chart/liquidity analysis, overview for tool routing."
                            }
                        }
                    },
                    annotations: {
                        readOnlyHint: true,
                    },
                },
                {
                    name: "get_account_summary",
                    description: "Use this when the user asks for connected exchange balances, portfolio holdings, or account exposure. Returns read-only balances from the user's active Binance/Bybit exchange connections. Do not use for public market prices or trade execution.",
                    inputSchema: {
                        type: "object",
                        properties: {},
                    },
                    annotations: {
                        readOnlyHint: true,
                    },
                },
                {
                    name: "create_trade_proposal",
                    description: "Use this only when the user explicitly asks to prepare or stage a Binance/Bybit trade. It creates a pending proposal for human approval in the Trade MCP dashboard and never executes the order directly. Do not use for market analysis, price checks, or immediate execution.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            provider: { type: "string", description: "Exchange where the proposal should be reviewed.", enum: ["binance", "bybit"] },
                            symbol: { type: "string", description: "Exchange market symbol, for example BTC/USDT. Use the exact pair the user requested." },
                            side: { type: "string", description: "Trade direction requested by the user.", enum: ["buy", "sell"] },
                            orderType: { type: "string", description: "Order type for the proposed order. Limit orders require price.", enum: ["market", "limit"] },
                            quantity: { type: "number", description: "Order quantity in base asset units, for example BTC amount for BTC/USDT." },
                            price: { type: "number", description: "Limit price in quote currency. Required only for limit orders." },
                            rationale: { type: "string", description: "Short user-facing reason for the proposal, including key market context or risk note." }
                        },
                        required: ["provider", "symbol", "side", "orderType", "quantity", "rationale"]
                    },
                },
                {
                    name: "list_exchange_methods",
                    description: "Use this to discover all callable public CCXT methods exposed by the Binance or Bybit instance before making a raw exchange call. This includes unified methods and raw public/private/trading/transfer endpoint methods available to the user's API key.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            provider: { type: "string", description: "Exchange implementation to inspect.", enum: ["binance", "bybit"] },
                            filter: { type: "string", description: "Optional case-insensitive substring filter, for example order, private, fetch, transfer, ticker." },
                            includeHas: { type: "boolean", description: "Include the exchange.has capability map." },
                            options: { type: "object", description: "Optional CCXT exchange constructor options." }
                        },
                        required: ["provider"]
                    },
                    annotations: {
                        readOnlyHint: true,
                    },
                },
                {
                    name: "call_exchange_method",
                    description: "Call any public callable CCXT method on Binance or Bybit, including public, private, trading, transfer, and raw endpoint methods. The call uses the authenticated user's active exchange connection and whatever permissions that API key has.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            provider: { type: "string", enum: ["binance", "bybit"] },
                            method: { type: "string", description: "Exact CCXT method name, for example fetchTicker, fetchOpenOrders, privateGetAccount, privatePostOrder, or another method returned by list_exchange_methods." },
                            args: {
                                type: "array",
                                description: "Positional arguments passed directly to the CCXT method.",
                                items: {}
                            },
                            params: {
                                type: "object",
                                description: "Convenience object used as the only argument when args is omitted."
                            },
                            options: { type: "object", description: "Optional CCXT exchange constructor options, for example defaultType." }
                        },
                        required: ["provider", "method"]
                    },
                },
                {
                    name: MARKET_DATA_MCP_TOOL_NAMES[0],
                    description: "Use this when the user asks for a current FX quote, spot rate, bid/ask, or conversion rate for a forex pair. Uses the user's connected OANDA/Twelve Data provider credentials. Do not use for crypto prices.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            symbol: { type: "string", description: "Forex pair, for example EUR/USD, EUR_USD, or EURUSD." },
                            provider: { type: "string", enum: ["auto", "oanda", "twelve"], description: "Provider preference. Use auto unless the user names OANDA or Twelve Data." }
                        },
                        required: ["symbol"]
                    },
                    annotations: {
                        readOnlyHint: true,
                    },
                },
                {
                    name: MARKET_DATA_MCP_TOOL_NAMES[1],
                    description: "Use this when the user asks for historical FX candles, OHLC data, or a forex chart. Uses the user's connected OANDA/Twelve Data provider credentials. Do not use for crypto OHLCV.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            symbol: { type: "string", description: "Forex pair, for example EUR/USD, EUR_USD, or EURUSD." },
                            provider: { type: "string", enum: ["auto", "oanda", "twelve"], description: "Market-data provider. Defaults to oanda." },
                            granularity: { type: "string", description: "OANDA-style candle granularity, for example M1, M5, H1, H4, D." },
                            interval: { type: "string", description: "Twelve-style interval or generic interval, for example 1min, 5min, 1h, 1day." },
                            count: { type: "number", description: "Maximum number of candles to return. Defaults to 100, capped at 5000." },
                            from: { type: "string", description: "Optional start time/date accepted by the selected provider." },
                            to: { type: "string", description: "Optional end time/date accepted by the selected provider." }
                        },
                        required: ["symbol"]
                    },
                    annotations: {
                        readOnlyHint: true,
                    },
                },
                {
                    name: MARKET_DATA_MCP_TOOL_NAMES[2],
                    description: "Use this when the user asks for a forex technical indicator such as SMA, EMA, RSI, MACD, Bollinger Bands, ATR, ADX, or stochastic. Uses the user's Twelve Data credentials and is for FX pairs only.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            symbol: { type: "string", description: "Forex pair, for example EUR/USD, EUR_USD, or EURUSD." },
                            indicator: { type: "string", enum: [...SUPPORTED_TWELVE_INDICATORS] },
                            interval: { type: "string", description: "Twelve Data interval, for example 1min, 5min, 1h, 1day." },
                            time_period: { type: "number", description: "Optional indicator period where supported, for example 14." },
                            series_type: { type: "string", description: "Optional price series type where supported, for example close." },
                            outputsize: { type: "number", description: "Optional number of values to return, capped at 5000." }
                        },
                        required: ["symbol", "indicator", "interval"]
                    },
                    annotations: {
                        readOnlyHint: true,
                    },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[0],
                    description: "Use this when the user asks for current crypto spot prices across one or more CoinGecko coin IDs. Uses the user's CoinGecko BYOK API key from Market Data Providers. For public CoinGecko MCP docs/search, use coingecko_public__ tools instead.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            ids: { type: "array", items: { type: "string" }, description: "CoinGecko coin IDs, for example bitcoin or ethereum. Do not pass exchange symbols like BTC/USDT." },
                            vs_currencies: { type: "array", items: { type: "string" }, description: "Quote currencies such as usd, eur, or btc. Defaults to usd." },
                            include_market_cap: { type: "boolean", description: "Include market capitalization fields when useful for ranking or valuation." },
                            include_24hr_vol: { type: "boolean", description: "Include 24 hour volume fields when user asks about liquidity or activity." },
                            include_24hr_change: { type: "boolean", description: "Include 24 hour percent change fields when user asks about recent performance." }
                        },
                        required: ["ids"]
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[1],
                    description: "Use this when the user asks for crypto market rankings, top coins, market caps, volume, or category-level market snapshots. Uses the user's CoinGecko BYOK API key. Do not use for a single exchange order book.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            vs_currency: { type: "string", description: "Quote currency, defaults to usd." },
                            category: { type: "string" },
                            ids: { type: "string", description: "Optional comma-separated CoinGecko IDs." },
                            order: { type: "string" },
                            per_page: { type: "number" },
                            page: { type: "number" }
                        }
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[2],
                    description: "Use this when the user asks for historical CoinGecko price, market cap, or volume chart data for a coin ID. Uses the user's CoinGecko BYOK API key. Do not use exchange symbols; pass CoinGecko IDs like bitcoin.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            id: { type: "string", description: "CoinGecko coin ID, for example bitcoin." },
                            vs_currency: { type: "string" },
                            days: { type: "number" },
                            interval: { type: "string" }
                        },
                        required: ["id"]
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[3],
                    description: "Use this when the user asks what crypto assets are trending on CoinGecko right now. Uses the user's CoinGecko BYOK API key. Do not use for personalized portfolio holdings.",
                    inputSchema: { type: "object", properties: {} },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[4],
                    description: "Use this when the user asks for the current public Binance ticker or last price for an exchange symbol. Does not require user Binance keys. Prefer this over CoinGecko when the user specifically asks about Binance market data.",
                    inputSchema: {
                        type: "object",
                        properties: { symbol: { type: "string", description: "Binance exchange symbol, for example BTC/USDT. Use slash format." } },
                        required: ["symbol"]
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[5],
                    description: "Use this when the user asks for Binance bid/ask depth, order book, spread, or liquidity at price levels. Public read-only data; no Binance API key required. Do not use for account open orders.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            symbol: { type: "string", description: "Binance exchange symbol, for example BTC/USDT." },
                            limit: { type: "number", description: "Requested depth limit. Keep small for summaries; capped at 5000." }
                        },
                        required: ["symbol"]
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[6],
                    description: "Use this when the user asks for Binance historical candles, OHLCV, or chart data for a crypto pair. Public read-only data; no Binance API key required. Prefer this for exchange-specific technical analysis.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            symbol: { type: "string", description: "Binance exchange symbol, for example BTC/USDT." },
                            interval: { type: "string", description: "Binance timeframe, for example 1m, 5m, 1h, 1d." },
                            limit: { type: "number", description: "Candle count, capped at 1000." }
                        },
                        required: ["symbol"]
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[7],
                    description: "Use this when the user asks for Binance 24h change, volume, high/low, or market activity for one symbol or all symbols. Public read-only data; no Binance API key required.",
                    inputSchema: {
                        type: "object",
                        properties: { symbol: { type: "string", description: "Optional exchange symbol, for example BTC/USDT." } }
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[8],
                    description: "Use this when the user asks for recent crypto news, sentiment-filtered news, or headlines for specific currencies. Uses the user's CryptoPanic BYOK API key. Do not use for price data or Messari research reports.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            currencies: { type: "array", items: { type: "string" }, description: "Currency tickers such as BTC, ETH, SOL. Leave empty for broad crypto news." },
                            kind: { type: "string", description: "Content type to return.", enum: ["news", "media"] },
                            filter: { type: "string", description: "CryptoPanic filter such as hot, bullish, bearish, important, rising." },
                            regions: { type: "array", items: { type: "string" } },
                            num_pages: { type: "number" },
                            public: { type: "boolean" },
                            search: { type: "string" }
                        }
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[9],
                    description: "Use this when the user asks an open-ended crypto research question that benefits from Messari analysis, fundamentals, protocols, sectors, or reports. Uses the user's Messari BYOK API key and may be limited by the user's Messari plan. Do not use for simple spot prices.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            question: { type: "string", description: "Clear natural-language research question. Include asset/protocol, timeframe, and the decision context when known." },
                            verbosity: { type: "string", description: "Optional response depth requested from Messari, for example brief or detailed." },
                            response_format: { type: "string", description: "Optional desired format, for example summary, bullets, or JSON if supported by the plan." }
                        },
                        required: ["question"]
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[10],
                    description: "Use this to discover which Messari timeseries datasets are available before requesting a specific timeseries. Uses the user's Messari BYOK API key and access depends on the user's plan.",
                    inputSchema: { type: "object", properties: {} },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: CRYPTO_ANALYSIS_MCP_TOOL_NAMES[11],
                    description: "Use this when the user asks for structured Messari historical metrics for an asset, market, exchange, or network and you already know the dataset slug. If unsure which dataset slug to use, call get_messari_timeseries_catalog first.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            entityType: { type: "string", enum: ["assets", "markets", "exchanges", "networks"] },
                            entityIdentifier: { type: "string", description: "Messari entity identifier, for example an asset slug or symbol supported by Messari." },
                            datasetSlug: { type: "string", description: "Exact dataset slug from get_messari_timeseries_catalog." },
                            start: { type: "string", description: "Optional ISO date/time start boundary." },
                            end: { type: "string", description: "Optional ISO date/time end boundary." },
                            granularity: { type: "string", description: "Optional candle/metric granularity supported by the dataset." }
                        },
                        required: ["entityType", "entityIdentifier", "datasetSlug"]
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: "search",
                    description: "Use this to search across crypto assets, news headlines, and research by keyword. Returns unified results from CoinGecko (assets), CryptoPanic (news), and Messari (research). Good for discovery when the user does not specify a tool. Supports type filter: assets, news, research, or all.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "Search keyword, e.g. ethereum, DeFi, layer 2." },
                            type: { type: "string", enum: ["all", "assets", "news", "research"], description: "Scope of search. Defaults to all." }
                        },
                        required: ["query"]
                    },
                    annotations: { readOnlyHint: true },
                },
                {
                    name: "fetch",
                    description: "Use this to fetch content from a public HTTPS URL and return it as text. Useful for reading documentation pages, API responses, or news articles by URL. Only HTTPS URLs are allowed. Returns the first 8000 characters of the response body.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            url: { type: "string", description: "A public HTTPS URL to fetch." }
                        },
                        required: ["url"]
                    },
                    annotations: { readOnlyHint: true },
                },
            ];

        const tools = allTools.filter((t) => shouldIncludeTool(t.name, profile));

        try {
            const marketplaceTools = await listMarketplaceToolsForServerIds(
                await getEnabledMarketplaceServerIds(userId),
                undefined,
                (serverId) => getMarketplaceMcpCredentials(userId, serverId),
            );
            tools.push(...marketplaceTools.filter((t) => isMarketplaceToolAllowed(t.name, profile)));
        } catch (err) {
            logger.warn({ err, userId }, 'Failed to list enabled marketplace MCP tools');
        }

        return { tools };
    });

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
        const { name, arguments: args } = request.params;
        const marketplaceTool = parseMarketplaceToolName(name);

        if (marketplaceTool) {
            if (!await isMarketplaceServerEnabled(userId, marketplaceTool.serverId)) {
                return {
                    content: [{
                        type: "text",
                        text: `MCP marketplace server "${marketplaceTool.serverId}" is not connected. Enable it in the MCP Market panel first.`
                    }],
                    isError: true,
                };
            }

            try {
                const result = await callMarketplaceTool(
                    marketplaceTool.serverId,
                    marketplaceTool.upstreamToolName,
                    (args || {}) as Record<string, unknown>,
                    undefined,
                    await getMarketplaceMcpCredentials(userId, marketplaceTool.serverId),
                );
                return trimMarketplaceToolResult(result, MAX_TOOL_RESPONSE_CHARS) as any;
            } catch (err) {
                return {
                    content: [{
                        type: "text",
                        text: marketplaceErrorMessage(err),
                    }],
                    isError: true,
                };
            }
        }

        if (name === TRADEMCP_DOCS_TOOL_NAME) {
            return {
                content: [{
                    type: "text",
                    text: safeJson(getTradeMcpResearchGuide(args?.topic))
                }]
            };
        }

        if (name === "get_account_summary") {
            if (!userId) {
                return {
                    content: [{
                        type: "text",
                        text: "Trade MCP is connected. No dashboard user is bound to this public MCP endpoint yet, so account balances are unavailable."
                    }]
                };
            }

            const connectionsSnap = await db.collection(`users/${userId}/exchange_connections`).where('isActive', '==', true).get();
            if (connectionsSnap.empty) {
                return { content: [{ type: "text", text: "No active exchange connections found." }]};
            }
            
            const balances: any = {};
            for (const doc of connectionsSnap.docs) {
                const data = doc.data();
                if (data.provider === 'binance' || data.provider === 'bybit') {
                    try {
                           const exchange = await createExchange(data.provider, userId);
                           const balance = await exchange.fetchBalance();
                           balances[data.provider] = balance.total;
                    } catch (err: any) {
                       balances[data.provider] = { error: err.message };
                    }
                }
            }
            return { content: [{ type: "text", text: JSON.stringify(balances, null, 2) }] };
        }

        if (name === "create_trade_proposal") {
            if (!userId) {
                return {
                    content: [{
                        type: "text",
                        text: "Trade MCP is connected, but no dashboard user is bound to this public MCP endpoint. Trade proposals cannot be created until DEFAULT_MCP_USER_ID is configured on the server."
                    }]
                };
            }

            const proposalRef = db.collection(`users/${userId}/trade_proposals`).doc();
            await proposalRef.set({
                ...args,
                status: 'pending_approval',
                createdAt: admin.firestore.FieldValue.serverTimestamp()
            });
            return { content: [{ type: "text", text: `Proposal created with ID: ${proposalRef.id}. It is pending human approval in the Trade MCP dashboard.` }] };
        }

        if (name === "list_exchange_methods") {
            const provider = args?.provider;
            if (!isSupportedProvider(provider)) {
                throw new Error('provider must be binance or bybit');
            }

            const exchange = await createExchange(provider, userId, (args?.options as Record<string, unknown>) || {});
            const filter = typeof args?.filter === 'string' ? args.filter.toLowerCase() : '';
            const methods = collectExchangeMethods(exchange).filter(method => (
                filter ? method.toLowerCase().includes(filter) : true
            ));
            const payload: Record<string, unknown> = {
                provider,
                methodCount: methods.length,
                methods,
            };

            if (args?.includeHas === true) {
                payload.has = exchange.has;
            }

            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(payload))
                }]
            };
        }

        if (name === "call_exchange_method") {
            const provider = args?.provider;
            if (!isSupportedProvider(provider)) {
                throw new Error('provider must be binance or bybit');
            }

            const exchange = await createExchange(provider, userId, (args?.options as Record<string, unknown>) || {});
            assertMethodCallable(exchange, args?.method);

            const callArgs = Array.isArray(args?.args)
                ? args.args
                : args?.params && typeof args.params === 'object'
                    ? [args.params]
                    : [];
            const result = await exchange[args.method](...callArgs);

            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson({
                        provider,
                        method: args.method,
                        result,
                    }))
                }]
            };
        }

        if (name === MARKET_DATA_MCP_TOOL_NAMES[0]) {
            const result = await getFxQuote((args || {}) as any, await getMarketDataCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === MARKET_DATA_MCP_TOOL_NAMES[1]) {
            const result = await getFxCandles((args || {}) as any, await getMarketDataCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === MARKET_DATA_MCP_TOOL_NAMES[2]) {
            const result = await getTechnicalIndicator((args || {}) as any, await getMarketDataCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[0]) {
            const result = await getCoinGeckoPrices((args || {}) as any, await getCoinGeckoCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[1]) {
            const result = await getCoinGeckoMarkets((args || {}) as any, await getCoinGeckoCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[2]) {
            const result = await getCoinGeckoMarketChart((args || {}) as any, await getCoinGeckoCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[3]) {
            const result = await getCoinGeckoTrending(await getCoinGeckoCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[4]) {
            const exchange = await createExchange('binance', null);
            const result = await getBinanceTicker(exchange, (args || {}) as any);
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[5]) {
            const exchange = await createExchange('binance', null);
            const result = await getBinanceOrderBook(exchange, (args || {}) as any);
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[6]) {
            const exchange = await createExchange('binance', null);
            const result = await getBinanceKlines(exchange, (args || {}) as any);
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[7]) {
            const exchange = await createExchange('binance', null);
            const result = await getBinance24hStats(exchange, (args || {}) as any);
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[8]) {
            const result = await getCryptoPanicNews((args || {}) as any, await getCryptoPanicCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[9]) {
            const result = await askMessariResearch((args || {}) as any, await getMessariCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[10]) {
            const result = await getMessariTimeseriesCatalog(await getMessariCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === CRYPTO_ANALYSIS_MCP_TOOL_NAMES[11]) {
            const result = await getMessariTimeseries((args || {}) as any, await getMessariCredentials(userId));
            return {
                content: [{
                    type: "text",
                    text: trimToolText(safeJson(result))
                }]
            };
        }

        if (name === "search") {
            const query = typeof args?.query === 'string' ? args.query : '';
            const type = typeof args?.type === 'string' ? args.type : 'all';
            if (!query.trim()) throw new Error('query is required');

            const results: Record<string, unknown> = {};

            if (type === 'all' || type === 'assets') {
                try {
                    const r = await import('axios').then(({ default: axios }) =>
                        axios.get('https://api.coingecko.com/api/v3/search', { params: { query } })
                    );
                    results.assets = {
                        coins: (r.data.coins || []).slice(0, 10),
                        nfts: (r.data.nfts || []).slice(0, 5),
                    };
                } catch (err: any) {
                    results.assets = { error: err.message };
                }
            }

            if (type === 'all' || type === 'news') {
                try {
                    const credentials = await getCryptoPanicCredentials(userId).catch(() => null);
                    if (credentials) {
                        const news = await getCryptoPanicNews({ search: query, num_pages: 1, public: true }, credentials);
                        results.news = news;
                    } else {
                        results.news = { error: 'CryptoPanic not configured — add key in Data Providers' };
                    }
                } catch (err: any) {
                    results.news = { error: err.message };
                }
            }

            if (type === 'all' || type === 'research') {
                try {
                    const credentials = await getMessariCredentials(userId).catch(() => null);
                    if (credentials) {
                        const research = await askMessariResearch({ question: query }, credentials);
                        results.research = research;
                    } else {
                        results.research = { error: 'Messari not configured — add key in Data Providers' };
                    }
                } catch (err: any) {
                    results.research = { error: err.message };
                }
            }

            return { content: [{ type: "text", text: trimToolText(safeJson(results)) }] };
        }

        if (name === "fetch") {
            const url = typeof args?.url === 'string' ? args.url.trim() : '';
            if (!url) throw new Error('url is required');
            if (!url.startsWith('https://')) throw new Error('Only HTTPS URLs are supported');
            const { default: axios } = await import('axios');
            const response = await axios.get(url, {
                responseType: 'text',
                headers: { Accept: 'text/html,application/json,text/plain,*/*' },
                timeout: 15_000,
                maxContentLength: 500_000,
            });
            const text: string = typeof response.data === 'string' ? response.data : JSON.stringify(response.data);
            return {
                content: [{
                    type: "text",
                    text: trimToolText(text),
                }]
            };
        }

        throw new Error(`Unknown tool: ${name}`);
    });

    return server;
}


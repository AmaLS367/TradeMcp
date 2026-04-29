import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import ccxt from 'ccxt';
import firebaseConfig from '../../firebase-applet-config.json';

if (!admin.apps.length) {
    admin.initializeApp({
        projectId: firebaseConfig.projectId,
    });
}

const db = getFirestore(admin.app(), firebaseConfig.firestoreDatabaseId);

// We will keep a map of transport by session ID
const transports = new Map<string, SSEServerTransport>();

export const mcpRouter = express.Router();

mcpRouter.get('/sse', async (req, res) => {
    // Basic auth via token in query
    const token = req.query.token as string;
    if (!token) {
        res.status(401).send('Missing token');
        return;
    }

    try {
        const decodedToken = await admin.auth().verifyIdToken(token);
        const userId = decodedToken.uid;
        
        const transport = new SSEServerTransport("/api/mcp/messages", res);
        
        const server = new Server({
            name: "TradeMCPServer",
            version: "1.0.0"
        }, {
            capabilities: {
                tools: {}
            }
        });

        // Setup tools
        server.setRequestHandler(ListToolsRequestSchema, async () => {
            return {
                tools: [
                    {
                        name: "get_account_summary",
                        description: "Get user account summary and balances from the connected exchanges.",
                        inputSchema: {
                            type: "object",
                            properties: {},
                        }
                    },
                    {
                        name: "create_trade_proposal",
                        description: "Create a new trade proposal for the user to review.",
                        inputSchema: {
                            type: "object",
                            properties: {
                                provider: { type: "string", description: "Exchange provider (binance, bybit)" },
                                symbol: { type: "string" },
                                side: { type: "string", enum: ["buy", "sell"] },
                                orderType: { type: "string", enum: ["market", "limit"] },
                                quantity: { type: "number" },
                                price: { type: "number" },
                                rationale: { type: "string", description: "Reason for this trade" }
                            },
                            required: ["provider", "symbol", "side", "orderType", "quantity", "rationale"]
                        }
                    }
                ]
            };
        });

        server.setRequestHandler(CallToolRequestSchema, async (request) => {
            const { name, arguments: args } = request.params;

            if (name === "get_account_summary") {
                // Fetch user's Exchange connections
                const connectionsSnap = await db.collection(`users/${userId}/exchange_connections`).where('isActive', '==', true).get();
                if (connectionsSnap.empty) {
                    return { content: [{ type: "text", text: "No active exchange connections found." }]};
                }
                
                const balances: any = {};
                for (const doc of connectionsSnap.docs) {
                    const data = doc.data();
                    // Setup CCXT
                    if (data.provider === 'binance' || data.provider === 'bybit') {
                        try {
                           const exchangeClass = (ccxt as any)[data.provider];
                           const exchange = new exchangeClass({
                               apiKey: data.apiKeyEncrypted, // Simplified for MVP (in prod, decrypt!)
                               secret: data.apiSecretEncrypted,
                           });
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
                const proposalRef = db.collection(`users/${userId}/trade_proposals`).doc();
                await proposalRef.set({
                    ...args,
                    status: 'pending_approval',
                    createdAt: admin.firestore.FieldValue.serverTimestamp()
                });
                return { content: [{ type: "text", text: `Proposal created with ID: ${proposalRef.id}` }] };
            }

            throw new Error(`Unknown tool: ${name}`);
        });

        await server.connect(transport);
        transports.set(transport.sessionId, transport);
        
        res.on('close', () => {
             transports.delete(transport.sessionId);
        });

    } catch (err: any) {
        console.error("MCP auth error:", err);
        res.status(401).send('Invalid token');
    }
});

mcpRouter.post('/messages', async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports.get(sessionId);
    if (!transport) {
        res.status(404).send('Session not found');
        return;
    }
    await transport.handlePostMessage(req, res);
});

// --- Execution Engine ---
// Listen to all trade proposals across all users
db.collectionGroup('trade_proposals')
    .where('status', '==', 'approved')
    .onSnapshot(async (snapshot) => {
        for (const change of snapshot.docChanges()) {
            if (change.type === 'added' || change.type === 'modified') {
                const doc = change.doc;
                const data = doc.data();
                const userId = doc.ref.parent.parent?.id;
                
                if (!userId) continue;

                try {
                    // Fetch the user's exchange connection
                    const connRef = db.collection(`users/${userId}/exchange_connections`)
                                        .where('provider', '==', data.provider)
                                        .where('isActive', '==', true)
                                        .limit(1);
                    const connSnap = await connRef.get();
                    
                    if (connSnap.empty) {
                        throw new Error(`Active connection for ${data.provider} not found`);
                    }
                    
                    const connData = connSnap.docs[0].data();
                    
                    // CCXT Execution
                    const exchangeClass = (ccxt as any)[data.provider];
                    const exchange = new exchangeClass({
                        apiKey: connData.apiKeyEncrypted,
                        secret: connData.apiSecretEncrypted,
                    });

                    // Execute trade
                    let order;
                    if (data.orderType === 'market') {
                        order = await exchange.createMarketOrder(data.symbol, data.side, data.quantity);
                    } else if (data.orderType === 'limit' && data.price) {
                        order = await exchange.createLimitOrder(data.symbol, data.side, data.quantity, data.price);
                    } else {
                        throw new Error('Invalid order type or missing price');
                    }

                    // Update Proposal
                    await doc.ref.update({
                        status: 'executed',
                        executionResult: JSON.stringify(order),
                        executionHash: order.id,
                        executedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                    // Audit Log
                    await db.collection(`users/${userId}/audit_logs`).add({
                        eventType: 'trade_executed',
                        source: 'execution_engine',
                        payload: JSON.stringify(order),
                        createdAt: admin.firestore.FieldValue.serverTimestamp()
                    });

                } catch (err: any) {
                    console.error("Execution error:", err);
                    await doc.ref.update({
                        status: 'failed',
                        executionResult: err.message,
                        executedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                }
            }
        }
    }, err => {
        console.error("Execution engine listener error", err);
    });



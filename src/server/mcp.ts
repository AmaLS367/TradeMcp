import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { ListToolsRequestSchema, CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import ccxt from 'ccxt';
import crypto from 'crypto';
import firebaseConfig from '../../firebase-applet-config.json';

// --- Encryption Helpers ---
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || "";
const ALGORITHM = 'aes-256-gcm';

if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string. Generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
}

function encrypt(text: string) {
    if (!ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY not set");
    const iv = crypto.randomBytes(12);
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

function decrypt(ciphertext: string) {
    if (!ENCRYPTION_KEY) throw new Error("ENCRYPTION_KEY not set");
    const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':');
    if (!ivHex || !authTagHex || !encryptedHex) throw new Error("Invalid ciphertext format");
    
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const key = Buffer.from(ENCRYPTION_KEY, 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
}

// --- Firebase Initialization ---
if (!admin.apps.length) {
    const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    admin.initializeApp({
        credential: serviceAccountKey
            ? admin.credential.cert(JSON.parse(serviceAccountKey))
            : admin.credential.applicationDefault(),
        projectId: firebaseConfig.projectId,
    });
}

const db = getFirestore(admin.app(), firebaseConfig.firestoreDatabaseId);

// We will keep a map of transport by session ID
const transports = new Map<string, SSEServerTransport>();

export const mcpRouter = express.Router();

// Middleware to verify Firebase ID Token
async function verifyAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).send('Unauthorized');
    }
    const idToken = authHeader.split('Bearer ')[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        (req as any).userId = decodedToken.uid;
        next();
    } catch (error) {
        res.status(401).send('Unauthorized');
    }
}

// --- API Endpoints ---

// Create connection
mcpRouter.post('/connections', verifyAuth, async (req, res) => {
    const { provider, apiKey, apiSecret } = req.body;
    const userId = (req as any).userId;

    if (!provider || !apiKey || !apiSecret) {
        return res.status(400).send('Missing required fields');
    }

    try {
        const apiKeyEncrypted = encrypt(apiKey);
        const apiSecretEncrypted = encrypt(apiSecret);
        const apiKeyPreview = `${apiKey.slice(0, 8)}...`;

        const docRef = db.collection(`users/${userId}/exchange_connections`).doc();
        await docRef.set({
            provider,
            apiKeyEncrypted,
            apiSecretEncrypted,
            apiKeyPreview,
            isActive: true,
            createdAt: admin.firestore.FieldValue.serverTimestamp()
        });

        res.json({ success: true, id: docRef.id });
    } catch (err: any) {
        console.error("Error creating connection:", err);
        res.status(500).send(err.message);
    }
});

// Delete connection
mcpRouter.delete('/connections/:id', verifyAuth, async (req, res) => {
    const { id } = req.params;
    const userId = (req as any).userId;

    try {
        await db.doc(`users/${userId}/exchange_connections/${id}`).delete();
        res.json({ success: true });
    } catch (err: any) {
        res.status(500).send(err.message);
    }
});

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
                           const apiKey = decrypt(data.apiKeyEncrypted);
                           const apiSecret = decrypt(data.apiSecretEncrypted);
                           
                           const exchange = new exchangeClass({
                               apiKey,
                               secret: apiSecret,
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
                    await doc.ref.update({
                        status: 'executing',
                        executionStartedAt: admin.firestore.FieldValue.serverTimestamp(),
                    });
                } catch (claimErr: any) {
                    console.error("Failed to claim proposal, skipping:", claimErr);
                    continue;
                }

                try {
                    const connRef = db.collection(`users/${userId}/exchange_connections`)
                                        .where('provider', '==', data.provider)
                                        .where('isActive', '==', true)
                                        .limit(1);
                    const connSnap = await connRef.get();

                    if (connSnap.empty) {
                        throw new Error(`Active connection for ${data.provider} not found`);
                    }

                    const connData = connSnap.docs[0].data();
                    const exchangeClass = (ccxt as any)[data.provider];
                    const exchange = new exchangeClass({
                        apiKey: decrypt(connData.apiKeyEncrypted),
                        secret: decrypt(connData.apiSecretEncrypted),
                    });

                    let order;
                    if (data.orderType === 'market') {
                        order = await exchange.createMarketOrder(data.symbol, data.side, data.quantity);
                    } else if (data.orderType === 'limit' && data.price) {
                        order = await exchange.createLimitOrder(data.symbol, data.side, data.quantity, data.price);
                    } else {
                        throw new Error('Invalid order type or missing price');
                    }

                    await doc.ref.update({
                        status: 'executed',
                        executionResult: JSON.stringify(order),
                        executionHash: order.id,
                        executedAt: admin.firestore.FieldValue.serverTimestamp()
                    });

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

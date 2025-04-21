import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import axios from "axios";
import dotenv from "dotenv";
import { simulateTransaction } from "./utils";
import { logger } from "./logger";
const { HttpsProxyAgent } = require('https-proxy-agent');
dotenv.config();

const proxyUrl = process.env.PROXY_URL;
const agent = new HttpsProxyAgent(proxyUrl);

export interface SwapInfo {
    ammKey: string;
    label: string;
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    feeAmount: string;
    feeMint: string;
}

export interface RoutePlan {
    swapInfo: SwapInfo;
    percent: number;
}

export interface QuoteResponse {
    inputMint: string;
    inAmount: string;
    outputMint: string;
    outAmount: string;
    otherAmountThreshold: string;
    swapMode: string;
    slippageBps: number;
    platformFee: string | null;
    priceImpactPct: string;
    routePlan: RoutePlan[];
    scoreReport: string | null;
    contextSlot: number;
    timeTaken: number;
    swapUsdValue: string;
    simplerRouteUsed: boolean;
}

export const getQuote = async (inputMint: string, outputMint: string, amount: number, slippageBps: number, restrictIntermediateTokens: boolean): Promise<QuoteResponse> => {

    const quoteResponse = await axios.get(
        'https://api.jup.ag/swap/v1/quote', {
        params: {
            inputMint,
            outputMint,
            amount,
            slippageBps,
            restrictIntermediateTokens
        },
        httpAgent: agent,
        httpsAgent: agent
    });

    return quoteResponse.data;
}

export const performSwap = async (connection: Connection, payer: Keypair, inputMint: string, outputMint: string, amount: number, slippageBps: number): Promise<string | undefined> => {

    const quoteResponse = await getQuote(inputMint.toString(), outputMint.toString(), Number(amount), slippageBps, false);
    if (!quoteResponse) {
        logger.error("Failed to get quote");
        return undefined;
    }

    const swapResponse = await buildSwapTransaction(quoteResponse, payer.publicKey.toBase58());
    if (!swapResponse) {
        logger.error("Failed to perform swap");
        return undefined;
    }

    const transactionBase64 = swapResponse.swapTransaction
    const transaction = VersionedTransaction.deserialize(Buffer.from(transactionBase64, 'base64'));
    transaction.sign([payer]);

    const isSimulationSuccess = await simulateTransaction(connection, transaction);
    if (!isSimulationSuccess) {
        logger.error("Failed to simulate transaction");
        return undefined;
    }

    const signature = await connection.sendRawTransaction(transaction.serialize(), {
        maxRetries: 2,
        skipPreflight: true
    });
    logger.info(`Sending transaction ${signature} with amount ${amount} from ${payer.publicKey.toBase58()} to swap ${inputMint} to ${outputMint}`);

    return signature
}

export const buildSwapTransaction = async (quoteResponse: QuoteResponse, walletAddress: string) => {
    try {
        const response = await axios.post(
            'https://api.jup.ag/swap/v1/swap',
            {
                quoteResponse,
                userPublicKey: walletAddress,
                // ADDITIONAL PARAMETERS TO OPTIMIZE FOR TRANSACTION LANDING
                dynamicComputeUnitLimit: true,
                dynamicSlippage: true,
                prioritizationFeeLamports: {
                    priorityLevelWithMaxLamports: {
                        maxLamports: 1000000,
                        priorityLevel: "veryHigh"
                    }
                }
            },
            {
                headers: {
                    'Content-Type': 'application/json',
                },
                httpAgent: agent,
                httpsAgent: agent
            }
        );

        return response.data;
    } catch (error) {
        logger.error('Error performing swap:', error);
        throw error;
    }
}

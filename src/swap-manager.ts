// SwapManager.ts
import { Keypair, VersionedTransaction } from "@solana/web3.js";
import { buildSwapTransaction, getQuote } from "./jupiterSwap";
import { logger } from './logger';

export class SwapManager {
    /**
     * Create a swap transaction
     */
    async createSwapTransaction(
        inputMint: string,
        outputMint: string,
        amount: number,
        slippage: number,
        wallet: Keypair
    ): Promise<VersionedTransaction | null> {
        try {
            // Get quote from Jupiter
            const quoteResponse = await this.getSwapQuote(
                inputMint,
                outputMint,
                amount,
                slippage
            );

            if (!quoteResponse) {
                logger.error("Failed to get quote");
                return null;
            }

            // Build swap transaction
            const swapResponse = await this.buildTransactionFromQuote(
                quoteResponse,
                wallet.publicKey.toBase58()
            );

            if (!swapResponse) {
                logger.error("Failed to build swap transaction");
                return null;
            }

            // Deserialize and sign transaction
            const transaction = this.deserializeAndSignTransaction(
                swapResponse.swapTransaction,
                wallet
            );

            return transaction;
        } catch (error) {
            logger.error("Error creating swap transaction:", error);
            return null;
        }
    }

    /**
     * Get swap quote from Jupiter
     */
    private async getSwapQuote(
        inputMint: string,
        outputMint: string,
        amount: number,
        slippage: number
    ): Promise<any | null> {
        try {
            return await getQuote(
                inputMint,
                outputMint,
                amount,
                slippage,
                false
            );
        } catch (error) {
            logger.error("Error getting quote:", error);
            return null;
        }
    }

    /**
     * Build transaction from quote
     */
    private async buildTransactionFromQuote(
        quoteResponse: any,
        walletAddress: string
    ): Promise<any | null> {
        try {
            return await buildSwapTransaction(quoteResponse, walletAddress);
        } catch (error) {
            logger.error("Error building swap transaction:", error);
            return null;
        }
    }

    /**
     * Deserialize and sign transaction
     */
    private deserializeAndSignTransaction(
        transactionBase64: string,
        wallet: Keypair
    ): VersionedTransaction {
        const transaction = VersionedTransaction.deserialize(
            Buffer.from(transactionBase64, 'base64')
        );

        transaction.sign([wallet]);
        return transaction;
    }
}
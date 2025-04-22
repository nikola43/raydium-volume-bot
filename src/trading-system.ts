// TradingSystem.ts
import { Commitment, Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getMint } from '@solana/spl-token';
import bs58 from "bs58";
import {
    JITO_KEYPAIR,
    BASE_MINT,
    DELAY_BETWEEN_TRADES,
    DISTRIBUTE_BEFORE_TRADE,
    DISTRIBUTION_AMOUNT,
    FEE_PAYER_KEYPAIR,
    GENERATE_WALLETS,
    NUMBER_OF_WALLETS,
    QUOTE_MINT,
    RPC_URL,
    SIMULTANEOUS_TRADES,
    SLIPPAGE,
    TRADE_MAX_AMOUNT_PERCENTAGE,
    TRADE_MIN_AMOUNT_PERCENTAGE,
    COMMITMENT
} from "./constants";
import { JitoClient } from './jito-client';



import { logger } from './logger';
import { parseUnits, sleep, chunkArray, simulateTransaction, confirmTransaction } from "./utils";
import { WalletManager } from "./wallet-manager";
import { SwapManager } from "./swap-manager";

// Maximum number of transactions allowed in a single bundle
const MAX_TX_PER_BUNDLE = 20;

export class TradingSystem {
    private connection: Connection;
    private feePayer: Keypair;
    private jitoClient: JitoClient;
    private walletManager: WalletManager;
    private swapManager: SwapManager;
    private direction: boolean = true; // true = buy, false = sell

    constructor() {
        this.connection = new Connection(RPC_URL, COMMITMENT as Commitment);
        this.feePayer = Keypair.fromSecretKey(bs58.decode(FEE_PAYER_KEYPAIR));
        this.jitoClient = new JitoClient(
            JITO_KEYPAIR,
            'frankfurt.mainnet.block-engine.jito.wtf',
            this.connection
        );
        this.walletManager = new WalletManager();
        this.swapManager = new SwapManager();

        console.log("Fee Payer Public Key:", this.feePayer.publicKey.toBase58());
    }

    async initialize(): Promise<void> {
        logger.info("Initializing trading system...");
        this.logConfig();

        if (GENERATE_WALLETS) {
            await this.walletManager.generateAndSaveWallets(NUMBER_OF_WALLETS);
        }

        const wallets = this.walletManager.loadWallets();
        if (!wallets || wallets.length === 0) {
            throw new Error("No wallets found");
        }

        if (wallets.length < SIMULTANEOUS_TRADES) {
            throw new Error(`Not enough wallets to perform trades. Need ${SIMULTANEOUS_TRADES}, have ${wallets.length}`);
        }

        if (DISTRIBUTE_BEFORE_TRADE) {
            // await this.walletManager.distributeSol(
            //     this.feePayer,
            //     wallets,
            //     parseUnits(DISTRIBUTION_AMOUNT, 9),
            //     this.connection
            // );
        }

        await this.walletManager.prepareTokenAccounts(wallets, BASE_MINT, this.connection);

        logger.info("Trading system initialized successfully");
    }

    async startTradingLoop(): Promise<void> {
        logger.info("Starting trading loop...");

        const wallets = this.walletManager.loadWallets();

        while (true) {
            try {
                await this.executeTradingCycle(wallets);

                // Flip direction for next cycle
                this.direction = !this.direction;

                logger.info(`Waiting ${DELAY_BETWEEN_TRADES} seconds for next trade cycle...\n`);
                await sleep(DELAY_BETWEEN_TRADES * 1000);
            } catch (error) {
                logger.error("Error in trading cycle:", error);
                logger.info("Continuing with next cycle...");

                this.direction = !this.direction;
                await sleep(DELAY_BETWEEN_TRADES * 1000);
            }
        }
    }

    private async executeTradingCycle(wallets: Keypair[]): Promise<void> {
        const inputMint = this.direction ? QUOTE_MINT : BASE_MINT;
        const outputMint = this.direction ? BASE_MINT : QUOTE_MINT;

        const inputMintInfo = await getMint(this.connection, new PublicKey(inputMint));
        const inputMintDecimals = inputMintInfo.decimals;

        const tradingWallets = this.walletManager.getRandomWallets(SIMULTANEOUS_TRADES, wallets);

        // Prepare all transactions
        const transactions = await this.prepareAllTransactions(
            tradingWallets,
            inputMint,
            outputMint,
            inputMintDecimals
        );

        if (transactions.length === 0) {
            logger.error("No transactions prepared for this cycle");
            return;
        }

        // Validate transactions through simulation
        const validTransactions = await this.validateTransactions(transactions);
        if (validTransactions.length === 0) {
            logger.error("No valid transactions to process");
            return;
        }

        await this.processBundles(validTransactions);
    }

    private async prepareAllTransactions(
        wallets: Keypair[],
        inputMint: string,
        outputMint: string,
        inputMintDecimals: number
    ): Promise<VersionedTransaction[]> {
        const transactions: VersionedTransaction[] = [];

        for (const wallet of wallets) {
            try {
                const tx = await this.prepareSwapTransaction(
                    wallet,
                    inputMint,
                    outputMint,
                    inputMintDecimals
                );

                if (tx) {
                    transactions.push(tx);
                }
            } catch (error) {
                logger.error(`Error preparing transaction for wallet ${wallet.publicKey.toBase58()}:`, error);
            }
        }

        // Add Jito tip transaction
        try {
            const jitoTx = await this.jitoClient.buildTipTransaction(this.feePayer);
            if (jitoTx) {
                jitoTx.sign([this.feePayer]);
                transactions.push(jitoTx);
                logger.info("Jito tip transaction added");
            } else {
                logger.error("Failed to build Jito tip transaction");
            }
        } catch (error) {
            logger.error("Error adding Jito tip transaction:", error);
        }

        logger.info(`Total transactions prepared: ${transactions.length}`);
        return transactions;
    }

    private async prepareSwapTransaction(
        keypair: Keypair,
        inputMint: string,
        outputMint: string,
        inputMintDecimals: number
    ): Promise<VersionedTransaction | null> {
        const publicKeyString = keypair.publicKey.toBase58();

        // Calculate trade amount
        const { tradeAmount, parsedTradeAmount } = await this.calculateTradeAmount(
            keypair,
            inputMint,
            inputMintDecimals
        );

        if (tradeAmount === 0) {
            logger.info(`Skipping wallet ${publicKeyString} due to insufficient balance`);
            return null;
        }

        logger.info(`Preparing swap with wallet: ${publicKeyString}`);
        logger.info(`Input mint: ${inputMint}`);
        logger.info(`Output mint: ${outputMint}`);
        logger.info(`Direction: ${this.direction ? "buy" : "sell"}`);
        logger.info(`Amount to swap: ${tradeAmount}`);

        const transaction = await this.swapManager.createSwapTransaction(
            inputMint,
            outputMint,
            parsedTradeAmount,
            SLIPPAGE,
            keypair
        );

        if (!transaction) {
            logger.error(`Failed to create swap transaction for wallet ${publicKeyString}`);
            return null;
        }

        logger.info("Transaction prepared successfully");
        return transaction;
    }

    private async calculateTradeAmount(
        keypair: Keypair,
        inputMint: string,
        inputMintDecimals: number
    ): Promise<{ tradeAmount: number, parsedTradeAmount: number }> {
        let tradeAmount = 0;
        let parsedTradeAmount = 0;

        if (this.direction) {
            // Buy direction - use SOL
            const solBalance = await this.connection.getBalance(keypair.publicKey);
            const solBalanceInSol = solBalance / 10 ** 9;
            const percentage = this.getRandomTradePercentage();
            tradeAmount = solBalanceInSol * percentage / 100;
            parsedTradeAmount = parseUnits(tradeAmount, inputMintDecimals);
        } else {
            // Sell direction - use token
            const tokenBalance = await this.walletManager.getTokenBalance(
                this.connection,
                inputMint,
                keypair
            );
            const percentage = this.getRandomTradePercentage();
            tradeAmount = Number((tokenBalance * percentage / 100));
            parsedTradeAmount = parseUnits(tradeAmount, inputMintDecimals);
        }

        return { tradeAmount, parsedTradeAmount };
    }

    private getRandomTradePercentage(): number {
        return Math.floor(Math.random() *
            (TRADE_MAX_AMOUNT_PERCENTAGE - TRADE_MIN_AMOUNT_PERCENTAGE + 1)) +
            TRADE_MIN_AMOUNT_PERCENTAGE;
    }

    private async validateTransactions(
        transactions: VersionedTransaction[]
    ): Promise<VersionedTransaction[]> {
        const validTransactions: VersionedTransaction[] = [];

        for (let i = 0; i < transactions.length; i++) {
            try {
                const isValid = await simulateTransaction(this.connection, transactions[i]);
                if (isValid) {
                    validTransactions.push(transactions[i]);
                } else {
                    logger.error(`Transaction ${i} simulation failed`);
                }
            } catch (error) {
                logger.error(`Error simulating transaction ${i}:`, error);
            }
        }

        logger.info(`Validated ${validTransactions.length} of ${transactions.length} transactions`);
        return validTransactions;
    }

    private async processBundles(transactions: VersionedTransaction[]): Promise<void> {
        // Split transactions into chunks for bundling
        const transactionChunks = chunkArray(transactions, MAX_TX_PER_BUNDLE);
        logger.info(`Processing ${transactions.length} transactions in ${transactionChunks.length} bundles`);

        for (let chunkIndex = 0; chunkIndex < transactionChunks.length; chunkIndex++) {
            const chunk = transactionChunks[chunkIndex];
            logger.info(`Processing bundle ${chunkIndex + 1} of ${transactionChunks.length} with ${chunk.length} transactions`);

            const bundleResult = await this.jitoClient.sendBundle(chunk);
            if (!bundleResult) {
                logger.error(`Failed to send bundle ${chunkIndex + 1}`);
                continue;
            }

            logger.info(`Bundle ${chunkIndex + 1} sent with result:`, bundleResult);

            logger.info(`Confirming transactions for bundle ${chunkIndex + 1}...`);
            await this.confirmTransactions(chunk);
        }
    }

    private async confirmTransactions(transactions: VersionedTransaction[]): Promise<void> {
        for (let i = 0; i < transactions.length; i++) {
            try {
                const signature = bs58.encode(transactions[i].signatures[0]);
                const confirmed = await confirmTransaction(this.connection, signature);

                if (confirmed) {
                    logger.info(`Transaction confirmed: ${signature}`);
                } else {
                    logger.error(`Failed to confirm transaction: ${signature}`);
                }
            } catch (error) {
                logger.error(`Error confirming transaction ${i}:`, error);
            }
        }
    }

    private logConfig(): void {
        logger.info({
            RPC_URL,
            FEE_PAYER_KEYPAIR: FEE_PAYER_KEYPAIR.substring(0, 10) + '...',
            DISTRIBUTE_BEFORE_TRADE,
            GENERATE_WALLETS,
            NUMBER_OF_WALLETS,
            DELAY_BETWEEN_TRADES,
            DISTRIBUTION_AMOUNT,
            TRADE_MIN_AMOUNT_PERCENTAGE,
            TRADE_MAX_AMOUNT_PERCENTAGE,
            SIMULTANEOUS_TRADES,
            QUOTE_MINT,
            BASE_MINT
        });
        logger.info("\n");
    }
}
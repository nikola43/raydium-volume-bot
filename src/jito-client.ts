import { Keypair, SystemProgram, TransactionMessage, VersionedTransaction, Connection, PublicKey, TransactionInstruction } from '@solana/web3.js';
import {
    SearcherClient,
    SearcherClientError,
    searcherClient as jitoSearcherClient,
} from 'jito-ts/dist/sdk/block-engine/searcher.js';
import { Bundle as JitoBundle } from "jito-ts/dist/sdk/block-engine/types.js";
import axios from 'axios';
import bs58 from "bs58";
import { Result } from 'jito-ts/dist/sdk/block-engine/utils';
import BN from 'bn.js';
import { logger } from './logger';

/**
 * Interface for Jito tip floor data
 */
interface JitoTipFloor {
    time: string;
    landed_tips_25th_percentile: number;
    landed_tips_50th_percentile: number;
    landed_tips_75th_percentile: number;
    landed_tips_95th_percentile: number;
    landed_tips_99th_percentile: number;
    ema_landed_tips_50th_percentile: number;
}

/**
 * JitoClient class for interacting with Jito services
 */
export class JitoClient {
    private readonly keypair: Keypair;
    private readonly blockEngineUrl: string;
    private readonly connection: Connection;
    private searcherClient: SearcherClient | null = null;

    /**
     * Create a new JitoClient
     * 
     * @param keypairBase58 Base58 encoded keypair string
     * @param blockEngineUrl URL for Jito block engine
     * @param connection Solana connection instance
     */
    constructor(
        keypairBase58: string,
        blockEngineUrl: string = 'frankfurt.mainnet.block-engine.jito.wtf',
        connection: Connection
    ) {
        this.keypair = Keypair.fromSecretKey(bs58.decode(keypairBase58));
        this.blockEngineUrl = blockEngineUrl;
        this.connection = connection;
    }

    /**
     * Initialize the searcher client
     * @private
     */
    private initSearcherClient(): SearcherClient {
        if (!this.searcherClient) {
            this.searcherClient = jitoSearcherClient(this.blockEngineUrl)
            // this.searcherClient = jitoSearcherClient(this.blockEngineUrl, this.keypair, {
            //     'grpc.keepalive_timeout_ms': 4000,
            // });

        }
        return this.searcherClient;
    }

    /**
     * Get the current Jito tip floor data
     * 
     * @returns Promise with tip floor data or null if error
     */
    static async getJitoTipFloor(): Promise<JitoTipFloor | null> {
        try {
            const response = await axios.get<JitoTipFloor[]>('https://bundles.jito.wtf/api/v1/bundles/tip_floor');
            const data = response.data;

            if (data && Array.isArray(data) && data.length > 0) {
                return data[0];
            } else {
                throw new Error('Invalid or empty response from API');
            }
        } catch (error) {
            console.error('Error fetching Jito tip floor data:', error);
            return null;
        }
    }

    /**
     * Get a random tip account from Jito
     * 
     * @returns Promise with tip account address or null if error
     */
    static async getRandomTipAccount(): Promise<string | null> {
        let testnetAccounts = [
            "AzfhMPcx3qjbvCK3UUy868qmc5L451W341cpFqdL3EBe"
        ]
        return testnetAccounts[Math.floor(Math.random() * testnetAccounts.length)];


        try {
            const response = await axios.post(
                'https://mainnet.block-engine.jito.wtf/api/v1/bundles',
                {
                    jsonrpc: '2.0',
                    id: 1,
                    method: 'getTipAccounts',
                    params: []
                },
                {
                    headers: { 'Content-Type': 'application/json' }
                }
            );

            const accounts = response.data.result;

            if (accounts && accounts.length > 0) {
                return accounts[Math.floor(Math.random() * accounts.length)];
            } else {
                throw new Error('No tip accounts returned from API');
            }
        } catch (error) {
            console.error('Error fetching Jito tip accounts:', error);
            return null;
        }
    }

    /**
     * Send a bundle of transactions to Jito block engine
     * 
     * @param bundledTxns Array of versioned transactions to bundle
     * @returns Promise with bundle result or undefined if error
     */
    async sendBundle(bundledTxns: VersionedTransaction[]): Promise<string | undefined> {
        try {
            const searcherClient = this.initSearcherClient();
            logger.info("Sending bundle to Jito block engine...");
            const bundle = new JitoBundle(bundledTxns, bundledTxns.length);
            const bundleResult = await searcherClient.sendBundle(bundle);
            if (!bundleResult.ok) {
                console.error("Error sending bundle:", bundleResult.error);
                return undefined;
            }
            return bundleResult.value;
        } catch (error) {
            const err = error as any;
            console.error("Error sending bundle:", err.message);
            return undefined;
        }
    }

    /**
     * Fetch address lookup table accounts
     * 
     * @param addressLookupTableAddresses Array of address lookup table addresses
     * @returns Promise with array of address lookup table accounts
     * @private
     */
    private async fetchAddressLookupTableAccounts(addressLookupTableAddresses: any) {
        const addressLookupTableAccounts = [];

        for (const addressLookupTableAddress of addressLookupTableAddresses) {
            try {
                const addressLookupTableAccount = await this.connection.getAddressLookupTable(
                    addressLookupTableAddress.accountKey
                );

                if (addressLookupTableAccount.value) {
                    addressLookupTableAccounts.push(addressLookupTableAccount.value);
                }
            } catch (error) {
                logger.error(`Error fetching address lookup table: ${error}`);
            }
        }

        return addressLookupTableAccounts;
    }

    /**
     * Add a tip to a transaction
     * 
     * @param signer Keypair for signing the transaction
     * @param transaction Transaction to add tip to
     * @returns Promise with new transaction or undefined if error
     */
    async addTipToTransaction(signer: Keypair, transaction: VersionedTransaction): Promise<VersionedTransaction | undefined> {
        try {
            // Get the latest blockhash
            const { blockhash } = await this.connection.getLatestBlockhash("finalized");

            // Get Jito tip account and amount
            const tipAcct = await JitoClient.getRandomTipAccount();
            if (!tipAcct) {
                logger.error("Failed to get tip account");
                return undefined;
            }

            const jitoTips = await JitoClient.getJitoTipFloor();
            if (!jitoTips) {
                logger.error("Failed to get tip amount");
                return undefined;
            }

            const tipAmountLamports = Math.floor(jitoTips.landed_tips_95th_percentile * Math.pow(10, 9));
            const jitoTipAmount = new BN(tipAmountLamports.toString());

            const tipInstruction = SystemProgram.transfer({
                fromPubkey: signer.publicKey,
                toPubkey: new PublicKey(tipAcct),
                lamports: jitoTipAmount.toNumber(),
            });

            const message = transaction.message;
            const addressLookupTableAccounts = await this.fetchAddressLookupTableAccounts(
                message.addressTableLookups
            );

            const originalInstructions = TransactionMessage.decompile(message, {
                addressLookupTableAccounts
            }).instructions;

            const newTransactionMessage = new TransactionMessage({
                payerKey: signer.publicKey,
                recentBlockhash: blockhash,
                instructions: [...originalInstructions, tipInstruction]
            }).compileToV0Message(addressLookupTableAccounts);

            const newTransaction = new VersionedTransaction(newTransactionMessage);
            newTransaction.sign([signer]);

            return newTransaction;
        } catch (error) {
            console.error('Error adding tip to transaction:', error);
            return undefined;
        }
    }

    async buildTipTransaction(signer: Keypair): Promise<VersionedTransaction | undefined> {
        try {
            // Get the latest blockhash
            const { blockhash } = await this.connection.getLatestBlockhash("finalized");

            // Get Jito tip account and amount
            const tipAcct = await JitoClient.getRandomTipAccount();
            if (!tipAcct) {
                logger.error("Failed to get tip account");
                return undefined;
            }

            const jitoTips = await JitoClient.getJitoTipFloor();
            if (!jitoTips) {
                logger.error("Failed to get tip amount");
                return undefined;
            }

            const tipAmountLamports = Math.floor(jitoTips.landed_tips_95th_percentile * Math.pow(10, 9));
            const jitoTipAmount = new BN(tipAmountLamports.toString());

            const tipInstruction = SystemProgram.transfer({
                fromPubkey: signer.publicKey,
                toPubkey: new PublicKey(tipAcct),
                lamports: jitoTipAmount.toNumber(),
            });

            const message = new TransactionMessage({
                payerKey: signer.publicKey,
                recentBlockhash: blockhash,
                instructions: [tipInstruction]
            }).compileToV0Message();

            const newTransaction = new VersionedTransaction(message);
            newTransaction.sign([signer]);

            return newTransaction;
        } catch (error) {
            console.error('Error adding tip to transaction:', error);
            return undefined;
        }
    }

    static async buildTipInstruction(signer: Keypair): Promise<TransactionInstruction | undefined> {
        try {
            // Get Jito tip account and amount
            const tipAcct = await JitoClient.getRandomTipAccount();
            if (!tipAcct) {
                logger.error("Failed to get tip account");
                return undefined;
            }

            const jitoTips = await JitoClient.getJitoTipFloor();
            if (!jitoTips) {
                logger.error("Failed to get tip amount");
                return undefined;
            }

            const tipAmountLamports = Math.floor(jitoTips.landed_tips_95th_percentile * Math.pow(10, 9));
            const jitoTipAmount = new BN(tipAmountLamports.toString());

            return SystemProgram.transfer({
                fromPubkey: signer.publicKey,
                toPubkey: new PublicKey(tipAcct),
                lamports: jitoTipAmount.toNumber(),
            });

        } catch (error) {
            console.error('Error adding tip to transaction:', error);
            return undefined;
        }
    }
}
import { getMint } from '@solana/spl-token';
import {
    Connection,
    Keypair,
    PublicKey,
    SystemProgram,
    TransactionInstruction,
    VersionedTransaction,
    MessageV0,
    TransactionMessage,
    AddressLookupTableAccount
} from "@solana/web3.js";
import bs58 from "bs58";
import dotenv from "dotenv";
import {
    BASE_MINT,
    DELAY_BETWEEN_TRADES,
    DISTRIBUTE_BEFORE_TRADE,
    DISTRIBUTION_AMOUNT,
    FEE_PAYER_KEYPAIR,
    GENERATE_WALLETS,
    JITO_BLOCK_ENGINE_URL,
    JITO_KEYPAIR,
    NUMBER_OF_WALLETS,
    PROXY_URL,
    QUOTE_MINT,
    RPC_URL,
    SIMULTANEOUS_TRADES,
    SLIPPAGE,
    TRADE_MAX_AMOUNT_PERCENTAGE,
    TRADE_MIN_AMOUNT_PERCENTAGE
} from "./constants";
import { buildSwapTransaction, getQuote, performSwap } from "./jupiterSwap";
import {
    checkIfTokenATAExists,
    confirmTransaction,
    createWSolAndTokenAtas,
    distributeSol,
    getRandomWallets,
    getTokenBalance,
    parseUnits,
    simulateTransaction,
    sleep
} from "./utils";
import { logger } from './logger';
import { BN, Wallet } from '@coral-xyz/anchor';
import { WalletManager } from './wallet-manager';
import { JitoClient } from './jito-client';
dotenv.config();



// Here's a cleaner approach than trying to extract instructions from MessageV0
// We'll create a new transaction with our tip instruction and the original transaction

const main = async () => {
    const feePayer = Keypair.fromSecretKey(bs58.decode(FEE_PAYER_KEYPAIR));
    console.log("Fee Payer Public Key:", feePayer.publicKey.toBase58());
    const connection = new Connection(RPC_URL);

    const walletManager = new WalletManager();
    const wallets = walletManager.loadWallets();

    const jitoClient = new JitoClient(JITO_KEYPAIR, JITO_BLOCK_ENGINE_URL, connection);

    const distributionAmount = parseUnits(DISTRIBUTION_AMOUNT, 9);
    await walletManager.distributeSol(
        feePayer,
        wallets,
        distributionAmount,
        connection,
        jitoClient
    );
};



main().then(() => {
    logger.info('Done');
}).catch((err) => {
    logger.error(err);
});
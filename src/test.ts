import { getMint } from '@solana/spl-token';
import {
    Connection,
    Keypair,
} from "@solana/web3.js";
import bs58 from "bs58";
import dotenv from "dotenv";
import {
    DISTRIBUTION_AMOUNT,
    FEE_PAYER_KEYPAIR,
    JITO_BLOCK_ENGINE_URL,
    JITO_KEYPAIR,
    RPC_URL,
} from "./constants";
import {
    parseUnits,
} from "./utils";
import { logger } from './logger';
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
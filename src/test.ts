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
import { generateWallets, loadWalletsFromFile, saveWalletsToFile } from "./wallets";
import { logger } from './logger';
import { addTipToTransaction, getJitoTipFloor, getRandomTipAccount, sendBundle } from './jito';
import { BN, Wallet } from '@coral-xyz/anchor';
dotenv.config();



// Here's a cleaner approach than trying to extract instructions from MessageV0
// We'll create a new transaction with our tip instruction and the original transaction

const main = async () => {
    const feePayer = Keypair.fromSecretKey(bs58.decode(FEE_PAYER_KEYPAIR));
    const connection = new Connection(RPC_URL);

    const quoteMint = QUOTE_MINT;
    const baseMint = BASE_MINT;
    const amount = 100000;

    // Get quote for swap
    const quoteResponse = await getQuote(quoteMint.toString(), baseMint.toString(), Number(amount), 50, false);
    if (!quoteResponse) {
        logger.error("Failed to get quote");
        return undefined;
    }

    // Build swap transaction
    const swapResponse = await buildSwapTransaction(quoteResponse, feePayer.publicKey.toBase58());
    if (!swapResponse) {
        logger.error("Failed to perform swap");
        return undefined;
    }



    // Create the tip instruction


    // Get the transaction from Jupiter API
    const transactionBase64 = swapResponse.swapTransaction;

    // There are two approaches we can use:

    // APPROACH 1: Modify the transaction by adding our instruction
    try {
        // Deserialize the transaction from base64
        
        const swapTransaction = VersionedTransaction.deserialize(Buffer.from(transactionBase64, 'base64'));
        const newTransaction = await addTipToTransaction(feePayer, swapTransaction, connection);
        if (!newTransaction) {
            logger.error("Failed to add tip to transaction");
            return undefined;
        }
        const signature = bs58.encode(newTransaction.signatures[0]);
        console.log(signature);

        // 6. Simulate the transaction
        const isSimulationSuccess = await simulateTransaction(connection, newTransaction);
        if (!isSimulationSuccess) {
            logger.error("Failed to simulate transaction");
            return undefined;
        }

        if (isSimulationSuccess) {
            logger.info('Transaction simulation was successful)');
            const bundleResult = await sendBundle([newTransaction]);
            console.log(bundleResult);

            const isTxConfirmed = await confirmTransaction(connection, signature);
            console.log(isTxConfirmed);
        }

        return undefined;
    } catch (error) {
        logger.error(`Error modifying transaction: ${error}`);

        // APPROACH 2: Use the Jupiter API to include the tip instruction
        // This would require modifying your buildSwapTransaction function to accept additional instructions

        return undefined;
    }
};



main().then(() => {
    logger.info('Done');
}).catch((err) => {
    logger.error(err);
});
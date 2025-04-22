import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, NATIVE_MINT, createAssociatedTokenAccountIdempotentInstruction } from "@solana/spl-token";
import { Connection, Keypair, PublicKey, SystemProgram, TransactionInstruction, TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import { logger } from "./logger";
import { JitoClient } from "./jito-client";
import { COMMITMENT, MAX_TX_SIZE } from "./constants";
import { bs58 } from "@coral-xyz/anchor/dist/cjs/utils/bytes";

export const checkIfTokenATAExists = async (keypair: Keypair, mint: string, connection: Connection): Promise<boolean> => {
    const tokenATA = await getAssociatedTokenAddress(new PublicKey(mint), keypair.publicKey);
    const tokenAccount = await connection.getAccountInfo(tokenATA);
    if (!tokenAccount) {
        logger.info(`Token account not found for keypair ${keypair.publicKey.toString()}`);
        return false;
    } else {
        return true;
    }
}

// Extracted function for creating a versioned transaction from instructions
export const createVersionedTransaction = async (
    payer: Keypair,
    instructions: TransactionInstruction[],
    connection: Connection
): Promise<VersionedTransaction | null> => {
    try {
        const latestBlockhash = await connection.getLatestBlockhash(COMMITMENT);
        const messageV0 = new TransactionMessage({
            payerKey: payer.publicKey,
            recentBlockhash: latestBlockhash.blockhash,
            instructions
        }).compileToV0Message();

        const transaction = new VersionedTransaction(messageV0);
        const serializedMsg = transaction.serialize();

        console.log("Txn size:", serializedMsg.length);
        if (serializedMsg.length > MAX_TX_SIZE) {
            logger.error("Transaction size exceeds 1232 bytes");
            return null;
        }

        transaction.sign([payer]);
        return transaction;
    } catch (error) {
        logger.error("Error creating transaction:", error);
        return null;
    }
}

// Extracted function for simulating transactions
export const simulateTransactions = async (
    transactions: VersionedTransaction[],
    connection: Connection
): Promise<boolean> => {
    const simulationPromises = transactions.map(async (transaction) => {
        const simulationResult = await connection.simulateTransaction(transaction, { commitment: COMMITMENT });
        const simulationSuccess = !simulationResult.value.err;
        if (simulationResult.value.err) {
            logger.error(`Simulation error for transaction: ${JSON.stringify(simulationResult.value.err)}`);
        }
        return simulationSuccess;
    });

    const simulationResults = await Promise.all(simulationPromises);
    const failedTransactions = simulationResults.filter((result) => !result);

    if (failedTransactions.length > 0) {
        logger.error(`Simulation failed for ${failedTransactions.length} transactions`);
        return false;
    }

    return true;
}

// Extracted function for processing a bundle of transactions
export const processBundleTransactions = async (
    transactions: VersionedTransaction[],
    connection: Connection,
    jitoClient: JitoClient
): Promise<boolean> => {
    // Simulate transactions
    const simulationSuccess = await simulateTransactions(transactions, connection);
    if (!simulationSuccess) {
        return false;
    }
    logger.info("All transactions simulated successfully, sending bundle...");

    // // Send bundle
    // const bundleId = await jitoClient.sendBundle(transactions);
    // if (!bundleId) {
    //     logger.error("Failed to send bundle");
    //     return false;
    // }
    // logger.info(`Bundle sent successfully with ID: ${bundleId}`);

    // // Confirm transactions
    // for (const transaction of transactions) {
    //     const signature = bs58.encode(transaction.signatures[0]);
    //     const isConfirmed = await confirmTransaction(connection, signature);
    //     if (!isConfirmed) {
    //         logger.error(`Transaction ${signature} failed to confirm`);
    //     } else {
    //         logger.info(`Transaction ${signature} confirmed successfully`);
    //     }
    // }

    return true;
}

// Extracted function for processing instructions in chunks
export const processInstructionsInChunks = async (
    payer: Keypair,
    instructions: TransactionInstruction[],
    chunkSize: number,
    connection: Connection,
    jitoClient: JitoClient
): Promise<boolean> => {
    const bundleTxns: VersionedTransaction[] = [];
    const ixsChunks = chunkArray(instructions, chunkSize);

    // Create transactions for each chunk
    for (const ixsChunk of ixsChunks) {
        const transaction = await createVersionedTransaction(payer, ixsChunk, connection);
        if (!transaction) {
            return false;
        }
        bundleTxns.push(transaction);
    }

    // Process the bundle
    return await processBundleTransactions(bundleTxns, connection, jitoClient);
}

export const createTokenAta = async (
    payer: Keypair,
    wallets: Keypair[],
    mint: string,
    connection: Connection,
    jitoClient: JitoClient
) => {
    const ixs: TransactionInstruction[] = [];
    const chunkSize = 12; // Max 12 DO NOT EXCEED THIS

    // Collect instructions for creating token accounts
    for (const wallet of wallets) {
        const tokenATA = await getAssociatedTokenAddress(new PublicKey(mint), wallet.publicKey);
        const tokenAccount = await connection.getAccountInfo(tokenATA);
        if (!tokenAccount) {
            logger.info(`Creating token account for keypair ${wallet.publicKey.toString()}`);
            // Add instruction to create the token account
            const createAtaIx = createAssociatedTokenAccountInstruction(
                payer.publicKey,
                tokenATA,
                wallet.publicKey,
                new PublicKey(mint),
            );
            ixs.push(createAtaIx);
            await sleep(500); // not spam RPC
        } else {
            logger.info(`Token account already exists for keypair ${wallet.publicKey.toString()}`);
            await sleep(500); // not spam RPC
        }
    }

    if (ixs.length === 0) {
        logger.info("No new token accounts created");
        return;
    }

    // Add tip instruction
    const tipIx = await JitoClient.buildTipInstruction(payer);
    if (!tipIx) {
        logger.error("Failed to build tip instruction");
        return;
    }
    ixs.push(tipIx);

    // Process the instructions
    await processInstructionsInChunks(payer, ixs, chunkSize, connection, jitoClient);
}

export const createWSOLAta = async (
    payer: Keypair,
    wallets: Keypair[],
    connection: Connection,
    jitoClient: JitoClient
) => {
    const ixs: TransactionInstruction[] = [];
    const chunkSize = 12; // Max 12 DO NOT EXCEED THIS

    // Collect instructions for creating token accounts
    for (const wallet of wallets) {
        const tokenATA = await getAssociatedTokenAddress(NATIVE_MINT, wallet.publicKey);
        const tokenAccount = await connection.getAccountInfo(tokenATA);
        if (!tokenAccount) {
            logger.info(`Creating WSOL token account for keypair ${wallet.publicKey.toString()}`);
            // Add instruction to create the token account
            const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
                payer.publicKey,
                tokenATA,
                wallet.publicKey,
                NATIVE_MINT
            );
            ixs.push(createAtaIx);
            await sleep(500); // not spam RPC
        } else {
            logger.info(`Token WSOL account already exists for keypair ${wallet.publicKey.toString()}`);
            await sleep(500); // not spam RPC
        }
    }

    if (ixs.length === 0) {
        logger.info("No new token accounts created");
        return;
    }

    // Add tip instruction
    const tipIx = await JitoClient.buildTipInstruction(payer);
    if (!tipIx) {
        logger.error("Failed to build tip instruction");
        return;
    }
    ixs.push(tipIx);

    // Process the instructions
    await processInstructionsInChunks(payer, ixs, chunkSize, connection, jitoClient);
}

export const distributeSol = async (
    payer: Keypair,
    wallets: Keypair[],
    amount: number,
    connection: Connection,
    jitoClient: JitoClient
) => {
    const ixs: TransactionInstruction[] = [];
    const chunkSize = 21; // Max 21 instructions per transaction DO NOT EXCEED THIS

    // Collect instructions for transferring SOL
    for (const wallet of wallets) {
        ixs.push(
            SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: wallet.publicKey,
                lamports: amount,
            }));
    }

    if (ixs.length === 0) {
        logger.info("No new token accounts created");
        return;
    }

    // Add tip instruction
    const tipIx = await JitoClient.buildTipInstruction(payer);
    if (!tipIx) {
        logger.error("Failed to build tip instruction");
        return;
    }
    ixs.push(tipIx);

    // Process the instructions
    await processInstructionsInChunks(payer, ixs, chunkSize, connection, jitoClient);
}

export const confirmTransaction = async (connection: Connection, signature: string): Promise<boolean> => {
    let retries = 0;
    const maxRetries = 5;
    let isConfirmed = false;

    while (retries < maxRetries) {
        retries++;

        logger.info(`Attempt ${retries} to confirm transaction ${signature}`);
        // Fetch the latest blockhash and last valid block height
        const latestBlockhash = await connection.getLatestBlockhash(COMMITMENT);

        // Confirm the transaction using the new method signature
        const confirmation = await connection.confirmTransaction(
            {
                signature,
                blockhash: latestBlockhash.blockhash,
                lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
            },
            COMMITMENT
        );

        if (!confirmation.value.err) {
            isConfirmed = true;
            break;
        }
    }

    return isConfirmed;
}

export const getRandomWallets = (num: number, wallets: Keypair[]): Keypair[] => {
    const swapPairs: Keypair[] = [];

    while (swapPairs.length < num) {
        const wallet = wallets[Math.floor(Math.random() * wallets.length)];

        if (swapPairs.find((pair) => pair.publicKey.toBase58() == wallet.publicKey.toBase58())) {
            continue;
        }
        swapPairs.push(wallet);
    }
    return swapPairs;
}

export const getTokenBalance = async (connection: Connection, mintAddress: string, keypair: Keypair) => {
    const ownerPubKey = keypair.publicKey;

    const response = await connection.getParsedTokenAccountsByOwner(ownerPubKey, {
        mint: new PublicKey(mintAddress),
    });

    let tokenBalance = 0;
    for (const account of response.value) {
        const amount = account.account.data.parsed.info.tokenAmount.uiAmount;
        tokenBalance += amount;
    }

    return tokenBalance;
}

// convert amount to units
export const formatUnits = (amount: number, decimals: number): number => {
    return Number((amount / Math.pow(10, decimals)).toFixed(0));
}

// convert units to amount
export const parseUnits = (units: number, decimals: number): number => {
    return Number((units * Math.pow(10, decimals)).toFixed(0));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const chunkArray = <T>(array: T[], size: number): T[][] => {
    return Array.from({ length: Math.ceil(array.length / size) }, (v, i) => array.slice(i * size, i * size + size));
}
import { getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, NATIVE_MINT } from "@solana/spl-token";
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

export const createTokenAta = async (payer: Keypair, wallets: Keypair[], mint: string, connection: Connection, jitoClient: JitoClient) => {

    const ixs: TransactionInstruction[] = [];
    const chunkSize = 12; // Max 12 DO NOT EXCEED THIS

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
            await sleep(500);
        } else {
            logger.info(`Token account already exists for keypair ${wallet.publicKey.toString()}`);
        }
    }

    const tipIx = await JitoClient.buildTipInstruction(payer);
    if (!tipIx) {
        logger.error("Failed to build tip instruction");
        return;
    }
    ixs.push(tipIx);

    const bundleTxns: VersionedTransaction[] = [];
    const ixsChunks = chunkArray(ixs, chunkSize);

    for (const ixsChunk of ixsChunks) {
        try {
            const latestBlockhash = await connection.getLatestBlockhash(COMMITMENT);
            const messageV0 = new TransactionMessage({
                payerKey: payer.publicKey,
                recentBlockhash: latestBlockhash.blockhash,
                instructions: ixsChunk
            }).compileToV0Message();

            const transaction = new VersionedTransaction(messageV0);
            const serializedMsg = transaction.serialize();

            console.log("Txn size:", serializedMsg.length);
            if (serializedMsg.length > MAX_TX_SIZE) {
                logger.error("Transaction size exceeds 1232 bytes");
                return;
            }

            transaction.sign([payer]);
            bundleTxns.push(transaction);
        } catch (error) {
            logger.error("Error creating transaction:", error);
            return;
        }
    }

    const simulationPromises = bundleTxns.map(async (transaction) => {
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
        return;
    }

    const bundleId = await jitoClient.sendBundle(bundleTxns);
    if (!bundleId) {
        logger.error("Failed to send bundle");
        return;
    }
    logger.info(`Bundle sent successfully with ID: ${bundleId}`);

    for (const transaction of bundleTxns) {
        const signature = bs58.encode(transaction.signatures[0]);
        const isConfirmed = await confirmTransaction(connection, signature);
        if (!isConfirmed) {
            logger.error(`Transaction ${signature} failed to confirm`);
        } else {
            logger.info(`Transaction ${signature} confirmed successfully`);
        }
    }


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


export const distributeSol = async (payer: Keypair, wallets: Keypair[], amount: number, connection: Connection, jitoClient: JitoClient) => {
    const transferIxs: TransactionInstruction[] = [];
    const chunkSize = 21; // Max 21 instructions per transaction DO NOT EXCEED THIS

    for (const wallet of wallets) {
        transferIxs.push(
            SystemProgram.transfer({
                fromPubkey: payer.publicKey,
                toPubkey: wallet.publicKey,
                lamports: amount,
            }));
    }

    const tipIx = await JitoClient.buildTipInstruction(payer);
    if (!tipIx) {
        logger.error("Failed to build tip instruction");
        return;
    }
    transferIxs.push(tipIx);

    const bundleTxns: VersionedTransaction[] = [];
    const ixsChunks = chunkArray(transferIxs, chunkSize);

    for (const ixsChunk of ixsChunks) {
        try {
            const latestBlockhash = await connection.getLatestBlockhash(COMMITMENT);
            const messageV0 = new TransactionMessage({
                payerKey: payer.publicKey,
                recentBlockhash: latestBlockhash.blockhash,
                instructions: ixsChunk
            }).compileToV0Message();

            const transaction = new VersionedTransaction(messageV0);
            const serializedMsg = transaction.serialize();

            console.log("Txn size:", serializedMsg.length);
            if (serializedMsg.length > MAX_TX_SIZE) {
                logger.error("Transaction size exceeds 1232 bytes");
                return;
            }

            transaction.sign([payer]);
            bundleTxns.push(transaction);
        } catch (error) {
            logger.error("Error creating transaction:", error);
            return;
        }
    }

    const simulationPromises = bundleTxns.map(async (transaction) => {
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
        return;
    }

    const bundleId = await jitoClient.sendBundle(bundleTxns);
    if (!bundleId) {
        logger.error("Failed to send bundle");
        return;
    }
    logger.info(`Bundle sent successfully with ID: ${bundleId}`);

    for (const transaction of bundleTxns) {
        const signature = bs58.encode(transaction.signatures[0]);
        const isConfirmed = await confirmTransaction(connection, signature);
        if (!isConfirmed) {
            logger.error(`Transaction ${signature} failed to confirm`);
        } else {
            logger.info(`Transaction ${signature} confirmed successfully`);
        }
    }
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
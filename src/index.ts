import { getMint } from '@solana/spl-token';
import { Connection, Keypair, PublicKey, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import dotenv from "dotenv";
import { BASE_MINT, DELAY_BETWEEN_TRADES, DISTRIBUTE_BEFORE_TRADE, DISTRIBUTION_AMOUNT, FEE_PAYER_KEYPAIR, GENERATE_WALLETS, NUMBER_OF_WALLETS, PROXY_URL, QUOTE_MINT, RPC_URL, SIMULTANEOUS_TRADES, SLIPPAGE, TRADE_MAX_AMOUNT_PERCENTAGE, TRADE_MIN_AMOUNT_PERCENTAGE } from "./constants";
import { buildSwapTransaction, getQuote, performSwap } from "./jupiterSwap";
import { checkIfTokenATAExists, chunkArray, confirmTransaction, createWSolAndTokenAtas, distributeSol, getRandomWallets, getTokenBalance, parseUnits, simulateTransaction, sleep } from "./utils";
import { generateWallets, loadWalletsFromFile, saveWalletsToFile } from "./wallets";
import { logger } from './logger';
import { addTipToTransaction, sendBundle } from './jito';
dotenv.config();

// Maximum number of transactions allowed in a single bundle
const MAX_TX_PER_BUNDLE = 20;

const main = async () => {

    if (GENERATE_WALLETS) {
        logger.info("Generating wallets");
        const wallets = generateWallets(NUMBER_OF_WALLETS);
        saveWalletsToFile(wallets);
    }

    const feePayer = Keypair.fromSecretKey(bs58.decode(FEE_PAYER_KEYPAIR));
    const connection = new Connection(RPC_URL);

    const restoredWallets = loadWalletsFromFile();

    const quoteMint = QUOTE_MINT
    const baseMint = BASE_MINT
    const numberSimultaneousSwaps = SIMULTANEOUS_TRADES;
    let direction = true; // true buy, false sell
    const minPercent = TRADE_MIN_AMOUNT_PERCENTAGE;
    const maxPercent = TRADE_MAX_AMOUNT_PERCENTAGE;
    const distributionAmount = DISTRIBUTION_AMOUNT * 10 ** 9;

    if (!restoredWallets || restoredWallets.length === 0) {
        logger.error("No wallets found");
        return;
    }

    if (restoredWallets.length < numberSimultaneousSwaps) {
        logger.error("Not enough wallets to perform the trades");
        return;
    }

    logger.info({
        RPC_URL,
        FEE_PAYER_KEYPAIR,
        PROXY_URL,
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
    })
    logger.info("\n");


    if (DISTRIBUTE_BEFORE_TRADE) {
        await distributeSol(feePayer, restoredWallets, distributionAmount, connection);
    }

    await createWSolAndTokenAtas(restoredWallets, baseMint, connection);

    let numberOfValidAtas = 0;

    while (numberOfValidAtas < restoredWallets.length) {
        const validAta = await checkIfTokenATAExists(restoredWallets[numberOfValidAtas], baseMint, connection);
        if (validAta) {
            numberOfValidAtas++;
        }
    }

    while (true) {
        const inputMint = direction ? quoteMint : baseMint;
        const outputMint = direction ? baseMint : quoteMint;
        const inputMintInfo = await getMint(connection, new PublicKey(inputMint));
        const inputMintDecimals = inputMintInfo.decimals;
        const wallets = getRandomWallets(numberSimultaneousSwaps, restoredWallets);
        const transactions: VersionedTransaction[] = [];

        // Prepare all transactions first
        for (let i = 0; i < wallets.length; i++) {
            const keypair = wallets[i];
            let solBalance: number;
            let tokenBalance: number;
            let tradeAmount = 0;
            let parsedTradeAmount = 0;

            solBalance = await connection.getBalance(keypair.publicKey);
            tokenBalance = await getTokenBalance(connection, inputMint, keypair);

            if (direction) {
                const solBalanceInSol = solBalance / 10 ** 9;
                tradeAmount = solBalanceInSol * (Math.floor(Math.random() * (maxPercent - minPercent + 1)) + minPercent) / 100;
                parsedTradeAmount = parseUnits(tradeAmount, inputMintDecimals);
            } else {
                tradeAmount = Number((tokenBalance * (Math.floor(Math.random() * (maxPercent - minPercent + 1)) + minPercent) / 100));
                parsedTradeAmount = parseUnits(tradeAmount, inputMintDecimals);
            }

            if (tradeAmount === 0) {
                logger.info(`Skipping wallet ${keypair.publicKey.toBase58()} due to insufficient balance`);
                continue;
            }

            try {
                logger.info(`Preparing swap with wallet: ${keypair.publicKey.toBase58()}`);
                logger.info(`Input mint: ${inputMint}`);
                logger.info(`Output mint: ${outputMint}`);
                logger.info(`Direction: ${direction ? "buy" : "sell"}`);
                logger.info(`Amount to swap: ${tradeAmount}`);

                const quoteResponse = await getQuote(inputMint.toString(), outputMint.toString(), parsedTradeAmount, SLIPPAGE, false);
                if (!quoteResponse) {
                    logger.error("Failed to get quote");
                    continue;
                }

                const swapResponse = await buildSwapTransaction(quoteResponse, keypair.publicKey.toBase58());
                if (!swapResponse) {
                    logger.error("Failed to perform swap");
                    continue;
                }

                const transactionBase64 = swapResponse.swapTransaction
                const transaction = VersionedTransaction.deserialize(Buffer.from(transactionBase64, 'base64'));

                const newTransaction = await addTipToTransaction(feePayer, transaction, connection);
                if (!newTransaction) {
                    logger.error("Failed to add tip to transaction");
                    continue;
                }
                newTransaction.sign([keypair, feePayer]); // Both signers
                transactions.push(newTransaction);
                logger.info("\n");
            } catch (error) {
                logger.error("Error during swap preparation:", error);
            }
        }

        // Simulate all transactions first
        let validTransactions: VersionedTransaction[] = [];
        for (let i = 0; i < transactions.length; i++) {
            const transaction = transactions[i];
            try {
                const isSimulationSuccess = await simulateTransaction(connection, transaction);
                if (isSimulationSuccess) {
                    validTransactions.push(transaction);
                } else {
                    logger.error(`Failed to simulate transaction ${i}`);
                }
            } catch (error) {
                logger.error(`Error during simulation of transaction ${i}:`, error);
            }
        }

        if (validTransactions.length === 0) {
            logger.error("No valid transactions to process");
            direction = !direction;
            logger.info(`Waiting ${DELAY_BETWEEN_TRADES} seconds for next trade...\n`);
            await sleep(DELAY_BETWEEN_TRADES * 1000);
            continue;
        }

        // Split transactions into chunks of MAX_TX_PER_BUNDLE
        const transactionChunks = chunkArray(validTransactions, MAX_TX_PER_BUNDLE);
        logger.info(`Processing ${validTransactions.length} transactions in ${transactionChunks.length} bundles`);

        // Process each chunk as a separate bundle
        for (let chunkIndex = 0; chunkIndex < transactionChunks.length; chunkIndex++) {
            const chunk = transactionChunks[chunkIndex];
            logger.info(`Processing bundle ${chunkIndex + 1} of ${transactionChunks.length} with ${chunk.length} transactions`);

            const bundleResult = await sendBundle(chunk);
            if (!bundleResult) {
                logger.error(`Failed to send bundle ${chunkIndex + 1}`);
                continue;
            }

            logger.info(`Bundle ${chunkIndex + 1} result:`, bundleResult);

            logger.info(`Waiting for confirmations for bundle ${chunkIndex + 1}...`);
            for (let i = 0; i < chunk.length; i++) {
                try {
                    const signature = bs58.encode(chunk[i].signatures[0]);
                    const confirmed = await confirmTransaction(connection, signature);
                    if (!confirmed) {
                        logger.error(`Failed to confirm transaction ${i} in bundle ${chunkIndex + 1}`);
                    } else {
                        logger.info(`Transaction confirmed: ${signature}`);
                    }
                } catch (error) {
                    logger.error(`Error during confirmation of transaction ${i} in bundle ${chunkIndex + 1}:`, error);
                }
            }

            // Add a small delay between bundles if there are more to process
            if (chunkIndex < transactionChunks.length - 1) {
                // logger.info(`Waiting 5 seconds before sending next bundle...`);
                // await sleep(5000);
            }
        }

        direction = !direction;
        logger.info(`Waiting ${DELAY_BETWEEN_TRADES} seconds for next trade...\n`);
        await sleep(DELAY_BETWEEN_TRADES * 1000);
    }
}

main().then(() => {
    logger.info('done');
}).catch((err) => {
    logger.error(err);
});
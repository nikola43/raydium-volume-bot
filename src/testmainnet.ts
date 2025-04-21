import bs58 from "bs58";
import dotenv from "dotenv";
import express, { Request, Response } from "express";
import { getQuote, performSwap } from "./jupiterSwap";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, Transaction, TransactionInstruction, TransactionMessage, VersionedTransaction, sendAndConfirmTransaction } from "@solana/web3.js"
import { createAssociatedTokenAccount, createAssociatedTokenAccountInstruction, createTransferInstruction, getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { simulateTransaction } from "./utils";
//const { Token, TOKEN_PROGRAM_ID } = require("@solana/spl-token");


const cors = require('cors');
dotenv.config();

const createATA = async (connection: Connection, keypair: Keypair, mintAddress: string) => {
    const instructions: TransactionInstruction[] = [];
    const tokenATA = await getAssociatedTokenAddress(new PublicKey(mintAddress), keypair.publicKey);
    if (!tokenATA) {
        // Add instruction to create the token account
        console.log(`Creating token account for keypair ${keypair.publicKey.toString()}`);
        const createAtaIx = createAssociatedTokenAccountInstruction(
            keypair.publicKey,
            tokenATA,
            keypair.publicKey,
            new PublicKey(mintAddress),
        );
        instructions.push(createAtaIx);
    }
    if (instructions.length === 0) {
        console.log(`Token account ${tokenATA.toString()} for keypair ${keypair.publicKey.toString()} exists`);
        return;
    }

    const latestBlockhash = await connection.getLatestBlockhash("finalized");
    // Create a TransactionMessage
    const messageV0 = new TransactionMessage({
        payerKey: keypair.publicKey,
        recentBlockhash: latestBlockhash.blockhash,
        instructions: instructions
    }).compileToV0Message();

    // Create a VersionedTransaction
    const transaction = new VersionedTransaction(messageV0);
    // Sign the transaction
    transaction.sign([keypair]);

    const simulationSuccess = await simulateTransaction(connection, transaction);
    if (!simulationSuccess) {
        // logger.error("Failed to simulate transaction");
        console.error("Failed to simulate transaction");
        return false;
    }
}

const main = async () => {

    const FEE_PAYER_KEYPAIR = process.env.FEE_PAYER_KEYPAIR;
    if (!FEE_PAYER_KEYPAIR) {
        throw new Error('FEE_PAYER_KEY is required');
    }

    const payer = Keypair.fromSecretKey(bs58.decode(FEE_PAYER_KEYPAIR));

    // Connect to local forked validator
    const connection = new Connection("http://localhost:8899", "confirmed");

    // Step 1 - Airdrop to Payer
    const signature = await connection.requestAirdrop(payer.publicKey, 1 * LAMPORTS_PER_SOL);

    // Fetch the latest blockhash and last valid block height
    const latestBlockhash = await connection.getLatestBlockhash();

    // Confirm the transaction using the new method signature
    const confirmation = await connection.confirmTransaction(
        {
            signature,
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
        },
        "confirmed" // Optional commitment level
    );

    console.log(`Airdrop confirmed with signature: ${signature}`);
    console.log("confirmation", confirmation);

}



main().then(() => {
    console.log('done');
}).catch((err) => {
    console.error(err);
});
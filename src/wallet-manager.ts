// WalletManager.ts
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { logger } from './logger';
import { checkIfTokenATAExists, createWSolAndTokenAtas, distributeSol, getTokenBalance } from "./utils";
import bs58 from "bs58";
import fs from "fs";
import { JitoClient } from "./jito-client";

export class WalletManager {
    /**
     * Generate and save wallets to file
     */
    async generateAndSaveWallets(count: number): Promise<Keypair[]> {
        logger.info(`Generating ${count} wallets`);
        const wallets = this.generateWallets(count);
        this.saveWalletsToFile(wallets);
        return wallets;
    }

    /**
     * Load wallets from file
     */
    loadWallets(): Keypair[] {
        const wallets = this.loadWalletsFromFile();
        if (!wallets || wallets.length === 0) {
            throw new Error("No wallets loaded from file");
        }
        logger.info(`Loaded ${wallets.length} wallets from file`);
        return wallets;
    }

    /**
     * Get random subset of wallets
     */
    getRandomWallets(count: number, wallets: Keypair[]): Keypair[] {
        const shuffled = [...wallets].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, count);
    }

    /**
     * Distribute SOL to wallets
     */
    async distributeSol(
        feePayer: Keypair,
        wallets: Keypair[],
        amount: number,
        connection: Connection,
        jitoClient: JitoClient
    ): Promise<void> {
        logger.info(`Distributing SOL to ${wallets.length} wallets`);
        await distributeSol(feePayer, wallets, amount, connection, jitoClient );
        logger.info(`SOL distribution complete`);
    }

    /**
     * Prepare token accounts for all wallets
     */
    async prepareTokenAccounts(
        wallets: Keypair[],
        tokenMint: string,
        connection: Connection
    ): Promise<void> {
        logger.info(`Creating token accounts for ${wallets.length} wallets`);
        await createWSolAndTokenAtas(wallets, tokenMint, connection);

        logger.info(`Verifying token accounts...`);
        let numberOfValidAtas = 0;
        while (numberOfValidAtas < wallets.length) {
            const validAta = await checkIfTokenATAExists(
                wallets[numberOfValidAtas],
                tokenMint,
                connection
            );

            if (validAta) {
                numberOfValidAtas++;
            }
        }
        logger.info(`All token accounts verified`);
    }

    /**
     * Get token balance for a wallet
     */
    async getTokenBalance(
        connection: Connection,
        tokenMint: string,
        wallet: Keypair
    ): Promise<number> {
        return getTokenBalance(connection, tokenMint, wallet);
    }

    /**
     * Get associated token address for a wallet
     */
    async getTokenAddress(
        tokenMint: string,
        wallet: Keypair
    ): Promise<PublicKey> {
        return getAssociatedTokenAddress(
            new PublicKey(tokenMint),
            wallet.publicKey
        );
    }

    /**
     * Save list of keypairs
     */
    private generateWallets = (numOfWallets: number): Keypair[] => {
        const wallets: Keypair[] = [];
        for (let i = 0; i < numOfWallets; i++) {
            const keypair = Keypair.generate();
            wallets.push(keypair);
        }
        return wallets;
    }

    private saveWalletsToFile = (wallets: Keypair[]): void => {

        wallets.forEach((wallet, index) => {
            const privateKey = bs58.encode(wallet.secretKey);
            const walletFile = `wallets/wallet-${index + 1}.json`;

            // check if the directory exists
            if (!fs.existsSync('wallets')) {
                fs.mkdirSync('wallets');
            }

            // check if the file exists
            if (fs.existsSync(walletFile)) {
                logger.warn(`Wallet file ${walletFile} already exists. Skipping...`);
                return;
            }

            logger.info(`Generating new wallet ${index + 1}: ${wallet.publicKey.toBase58()}`);


            const walletData = {
                index: index + 1,
                publicKey: wallet.publicKey.toBase58(),
                privateKey,
            }
            fs.writeFileSync(walletFile, JSON.stringify(walletData, null, 2));
        });
    }

    private getWalletFromPrivateKey = (privateKey: string): Keypair => {
        try {
            const decodedKey = bs58.decode(privateKey);
            return Keypair.fromSecretKey(decodedKey);
        } catch (error) {
            logger.error("Error creating keypair:", error);
            throw new Error("Invalid private key");
        }
    }



    private loadWalletsFromFile = (): Keypair[] => {
        const wallets: Keypair[] = [];
        let index = 1;
        while (true) {
            const walletFile = `wallets/wallet-${index}.json`;
            if (!fs.existsSync(walletFile)) {
                break;
            }
            const walletData = JSON.parse(fs.readFileSync(walletFile, 'utf-8'));
            const privateKey = bs58.decode(walletData.privateKey);
            const publicKey = walletData.publicKey;
            const keypair = Keypair.fromSecretKey(privateKey);
            if (keypair.publicKey.toBase58() !== publicKey) {
                throw new Error(`Public key mismatch for wallet ${index}`);
            }
            wallets.push(keypair);
            index++;
        }
        return wallets;
    }
}
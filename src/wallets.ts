import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import fs from "fs";
import { logger } from "./logger";

export const getWalletFromPrivateKey = (privateKey: string): Keypair => {
    try {
        const decodedKey = bs58.decode(privateKey);
        return Keypair.fromSecretKey(decodedKey);
    } catch (error) {
        logger.error("Error creating keypair:", error);
        throw new Error("Invalid private key");
    }
}

export const generateWallets = (numOfWallets: number): Keypair[] => {
    const wallets: Keypair[] = [];
    for (let i = 0; i < numOfWallets; i++) {
        const keypair = Keypair.generate();
        logger.info(`Wallet ${i + 1}: ${keypair.publicKey.toBase58()}`);
        wallets.push(keypair);
    }
    return wallets;
}

export const saveWalletsToFile = (wallets: Keypair[]): void => {

    wallets.forEach((wallet, index) => {
        const privateKey = bs58.encode(wallet.secretKey);
        const walletFile = `wallets/wallet-${index + 1}.json`;

        // check if the directory exists
        if (!fs.existsSync('wallets')) {
            fs.mkdirSync('wallets');
        }

        // check if the file exists
        if (fs.existsSync(walletFile)) {
            throw new Error(`Wallet file ${walletFile} already exists`);
        }

        const walletData = {
            index: index + 1,
            publicKey: wallet.publicKey.toBase58(),
            privateKey,
        }
        fs.writeFileSync(walletFile, JSON.stringify(walletData, null, 2));
    });
}

export const loadWalletsFromFile = (): Keypair[] => {
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
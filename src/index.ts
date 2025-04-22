// Main entry point: index.ts
import dotenv from "dotenv";

import { logger } from './logger';
import { TradingSystem } from "./trading-system";

dotenv.config();

async function main() {
    try {
        const tradingSystem = new TradingSystem();
        await tradingSystem.initialize();
        await tradingSystem.startTradingLoop();
    } catch (err) {
        logger.error('Fatal error in trading system:', err);
        process.exit(1);
    }
}

main().catch((err) => {
    logger.error('Uncaught exception:', err);
    process.exit(1);
});
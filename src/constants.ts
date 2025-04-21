import { Logger } from 'pino';
import { logger } from './logger';
import dotenv from "dotenv";
dotenv.config();

const retrieveEnvVariable = (variableName: string, logger: Logger) => {
    const variable = process.env[variableName] || '';
    if (!variable) {
        logger.error(`${variableName} is not set`);
        process.exit(1);
    }
    return variable;
};

export const RPC_URL = retrieveEnvVariable('RPC_URL', logger);
export const FEE_PAYER_KEYPAIR = retrieveEnvVariable('FEE_PAYER_KEYPAIR', logger);
export const PROXY_URL = retrieveEnvVariable('PROXY_URL', logger);
export const DISTRIBUTE_BEFORE_TRADE = retrieveEnvVariable('DISTRIBUTE_BEFORE_TRADE', logger) === 'true';
export const GENERATE_WALLETS = retrieveEnvVariable('GENERATE_WALLETS', logger) === 'true';
export const NUMBER_OF_WALLETS = Number(retrieveEnvVariable('NUMBER_OF_WALLETS', logger));
export const DISTRIBUTION_AMOUNT = Number(retrieveEnvVariable('DISTRIBUTION_AMOUNT', logger));
export const DELAY_BETWEEN_TRADES = Number(retrieveEnvVariable('DELAY_BETWEEN_TRADES', logger));
export const SLIPPAGE = Number(retrieveEnvVariable('SLIPPAGE', logger));
export const TRADE_MIN_AMOUNT_PERCENTAGE = Number(retrieveEnvVariable('TRADE_MIN_AMOUNT_PERCENTAGE', logger));
export const TRADE_MAX_AMOUNT_PERCENTAGE = Number(retrieveEnvVariable('TRADE_MAX_AMOUNT_PERCENTAGE', logger));
export const SIMULTANEOUS_TRADES = Number(retrieveEnvVariable('SIMULTANEOUS_TRADES', logger));
export const QUOTE_MINT = retrieveEnvVariable('QUOTE_MINT', logger);
export const BASE_MINT = retrieveEnvVariable('BASE_MINT', logger);
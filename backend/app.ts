import express from "express";
import {createClient, WatchError} from "redis";
import {json} from "body-parser";

const DEFAULT_BALANCE = 100;
const DEFAULT_RETRIES = 3;
const DEFAULT_RETRY_TIMEOUT = 300;

interface ChargeResult {
	isAuthorized: boolean;
	remainingBalance: number;
	charges: number;
}

async function connect(): Promise<ReturnType<typeof createClient>> {
	const url = `redis://${process.env.REDIS_HOST ?? "localhost"}:${process.env.REDIS_PORT ?? "6379"}`;
	console.log(`Using redis URL ${url}`);
	const client = createClient({url});
	await client.connect();
	return client;
}

async function reset(account: string): Promise<void> {
	const client = await connect();
	try {
		await client.set(`${account}/balance`, DEFAULT_BALANCE);
	} finally {
		await client.disconnect();
	}
}

async function charge(account: string, charges: number, retries: number = DEFAULT_RETRIES): Promise<ChargeResult> {
	const client = await connect();
	try {
		const balanceKey = `${account}/balance`;

		for (let attempt = 0; attempt < retries; attempt++) {
			try {
				// Watch the balance key for changes
				await client.watch(balanceKey);

				const balance = parseInt((await client.get(balanceKey)) ?? "0");

				if (balance >= charges) {
					const multi = client.multi();
					multi.decrBy(balanceKey, charges);
					const results = await multi.exec();

					if (results) {
						const remainingBalance = parseInt(results[0]?.toString() ?? "");
						return {isAuthorized: true, remainingBalance, charges};
					}
				}

				// If the transaction fails, retry
				await client.unwatch();
			} catch (error) {
				if (error instanceof WatchError) {
					console.warn(`WatchError detected, retrying... (${attempt + 1}/${retries})`);
					await new Promise(resolve => setTimeout(resolve, DEFAULT_RETRY_TIMEOUT));
					continue; // Retry the transaction
				}
				throw error; // Rethrow if it's not a WatchError
			}
		}

		const currentBalance = parseInt((await client.get(balanceKey)) ?? "0");
		return {isAuthorized: false, remainingBalance: currentBalance, charges: 0};
	} finally {
		await client.disconnect();
	}
}

export function buildApp(): express.Application {
	const app = express();
	app.use(json());
	app.post("/reset", async (req, res) => {
		try {
			const account = req.body.account ?? "account";
			await reset(account);
			console.log(`Successfully reset account ${account}`);
			res.sendStatus(204);
		} catch (e) {
			console.error("Error while resetting account", e);
			res.status(500).json({error: String(e)});
		}
	});
	app.post("/charge", async (req, res) => {
		try {
			const account = req.body.account ?? "account";
			const result = await charge(account, req.body.charges ?? 10);
			console.log(`Successfully charged account ${account}`);
			res.status(200).json(result);
		} catch (e) {
			console.error("Error while charging account", e);
			res.status(500).json({error: String(e)});
		}
	});
	return app;
}

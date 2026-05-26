#!/usr/bin/env node
import { loadEnvFile } from "../server/load-env.js";
import { runCryptoBoxRangeCatalogScan } from "../server/box-range/crypto-scan-runner.js";

loadEnvFile();
const r = await runCryptoBoxRangeCatalogScan();
console.log(r);
process.exit(r.ok ? 0 : 1);

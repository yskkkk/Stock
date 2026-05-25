import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @returns {string} server/.data 또는 STOCK_DATA_DIR */
export function resolveServerDataDir() {
  const override = String(process.env.STOCK_DATA_DIR ?? "").trim();
  if (override) return path.resolve(override);
  return path.join(__dirname, ".data");
}

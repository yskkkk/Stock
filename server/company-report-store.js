/**
 * 기업 심층 보고서 저장소 — server/.data/company-reports.json
 */
import { randomUUID } from "crypto";
import {
  dataFilePath,
  readJsonStoreSync,
  writeJsonStoreSync,
} from "./store-json.js";

const FILE = "company-reports.json";
const MAX_REPORTS = 200;

/**
 * @typedef {{
 *   id: string;
 *   symbol: string;
 *   name: string;
 *   market: "kr" | "us";
 *   title: string;
 *   summary: string;
 *   body: string;
 *   toc: string[];
 *   sources: string[];
 *   status: "ready" | "failed";
 *   error?: string | null;
 *   createdAt: number;
 *   updatedAt: number;
 *   engine?: string;
 * }} CompanyReport
 */

function emptyStore() {
  return {
    updatedAt: 0,
    reports: /** @type {CompanyReport[]} */ ([]),
  };
}

/** @param {unknown} raw */
function normalizeStore(raw) {
  if (!raw || typeof raw !== "object") return emptyStore();
  const reports = Array.isArray(
    /** @type {{ reports?: unknown }} */ (raw).reports,
  )
    ? /** @type {CompanyReport[]} */ (
        /** @type {{ reports: CompanyReport[] }} */ (raw).reports
      )
    : [];
  return {
    updatedAt: Number(/** @type {{ updatedAt?: number }} */ (raw).updatedAt) || 0,
    reports,
  };
}

export function loadCompanyReportStore() {
  return readJsonStoreSync(FILE, normalizeStore, emptyStore);
}

/** @param {{ updatedAt: number; reports: CompanyReport[] }} store */
function saveStore(store) {
  store.updatedAt = Date.now();
  writeJsonStoreSync(FILE, store);
}

/**
 * @param {{ limit?: number; symbol?: string }} [opts]
 */
export function listCompanyReports(opts = {}) {
  const store = loadCompanyReportStore();
  const lim = Math.min(200, Math.max(1, Number(opts.limit) || 80));
  const sym = String(opts.symbol ?? "")
    .trim()
    .toUpperCase();
  let rows = [...store.reports].sort((a, b) => b.createdAt - a.createdAt);
  if (sym) rows = rows.filter((r) => r.symbol === sym);
  return {
    updatedAt: store.updatedAt,
    reports: rows.slice(0, lim).map((r) => ({
      id: r.id,
      symbol: r.symbol,
      name: r.name,
      market: r.market,
      title: r.title,
      summary: r.summary,
      toc: r.toc,
      sources: r.sources,
      status: r.status,
      error: r.error ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      engine: r.engine,
      bodyChars: String(r.body || "").length,
    })),
  };
}

/** @param {string} id */
export function getCompanyReport(id) {
  const store = loadCompanyReportStore();
  const row = store.reports.find((r) => r.id === String(id || "").trim());
  return row ?? null;
}

/**
 * @param {Omit<CompanyReport, "id" | "createdAt" | "updatedAt"> & { id?: string }} partial
 */
export function upsertCompanyReport(partial) {
  const store = loadCompanyReportStore();
  const now = Date.now();
  const id = String(partial.id || randomUUID());
  const existing = store.reports.findIndex((r) => r.id === id);
  /** @type {CompanyReport} */
  const row = {
    id,
    symbol: String(partial.symbol || "").toUpperCase(),
    name: String(partial.name || partial.symbol || ""),
    market: partial.market === "kr" ? "kr" : "us",
    title: String(partial.title || "").slice(0, 200),
    summary: String(partial.summary || "").slice(0, 800),
    body: String(partial.body || ""),
    toc: Array.isArray(partial.toc) ? partial.toc.map(String).slice(0, 40) : [],
    sources: Array.isArray(partial.sources)
      ? partial.sources.map(String).slice(0, 40)
      : [],
    status: partial.status === "failed" ? "failed" : "ready",
    error: partial.error ? String(partial.error).slice(0, 500) : null,
    createdAt: existing >= 0 ? store.reports[existing].createdAt : now,
    updatedAt: now,
    engine: partial.engine ? String(partial.engine).slice(0, 64) : undefined,
  };
  if (existing >= 0) store.reports[existing] = row;
  else store.reports.unshift(row);
  store.reports.sort((a, b) => b.createdAt - a.createdAt);
  if (store.reports.length > MAX_REPORTS) {
    store.reports = store.reports.slice(0, MAX_REPORTS);
  }
  saveStore(store);
  return row;
}

/** @param {string} id */
export function deleteCompanyReport(id) {
  const store = loadCompanyReportStore();
  const before = store.reports.length;
  store.reports = store.reports.filter((r) => r.id !== String(id || "").trim());
  if (store.reports.length === before) return false;
  saveStore(store);
  return true;
}

export function companyReportsStorePath() {
  return dataFilePath(FILE);
}

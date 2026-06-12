import { describe, expect, it, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  getUiFeaturesAdminSnapshot,
  getUiFeaturesPublicSnapshot,
  resolveUiFeatureEnabled,
  setUiFeatureEnabled,
} from "./ui-feature-toggles.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.join(__dirname, ".data", "ui-feature-toggles.json");

describe("ui-feature-toggles", () => {
  let hadStore = false;
  let backup = "";

  beforeEach(() => {
    if (fs.existsSync(STORE_FILE)) {
      hadStore = true;
      backup = fs.readFileSync(STORE_FILE, "utf8");
      fs.unlinkSync(STORE_FILE);
    }
  });

  afterEach(() => {
    if (fs.existsSync(STORE_FILE)) fs.unlinkSync(STORE_FILE);
    if (hadStore) {
      fs.writeFileSync(STORE_FILE, backup, "utf8");
    }
  });

  it("uses catalog default when no override", () => {
    expect(resolveUiFeatureEnabled("profitModelButton")).toBe(false);
    expect(resolveUiFeatureEnabled("themeModeToggle")).toBe(true);
  });

  it("persists admin override and clears when back to default", () => {
    setUiFeatureEnabled("profitModelButton", true);
    expect(resolveUiFeatureEnabled("profitModelButton")).toBe(true);
    setUiFeatureEnabled("profitModelButton", false);
    expect(resolveUiFeatureEnabled("profitModelButton")).toBe(false);
    const admin = getUiFeaturesAdminSnapshot();
    expect(admin.items.find((x) => x.id === "profitModelButton")?.hasOverride).toBe(
      false,
    );
  });

  it("returns public and admin snapshots", () => {
    setUiFeatureEnabled("chartDrawRay", false);
    const pub = getUiFeaturesPublicSnapshot();
    expect(pub.features.chartDrawRay).toBe(false);
    const admin = getUiFeaturesAdminSnapshot();
    const row = admin.items.find((x) => x.id === "chartDrawRay");
    expect(row?.enabled).toBe(false);
    expect(row?.hasOverride).toBe(true);
  });
});

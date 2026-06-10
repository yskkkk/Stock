import assert from "node:assert/strict";
import test from "node:test";
import { parseNaverPureBuyQuant } from "./kr-investor-flow.js";

test("parseNaverPureBuyQuant parses signed comma quantities", () => {
  assert.equal(parseNaverPureBuyQuant("-3,840,270"), -3840270);
  assert.equal(parseNaverPureBuyQuant("+6,424,717"), 6424717);
  assert.equal(parseNaverPureBuyQuant("0"), 0);
  assert.equal(parseNaverPureBuyQuant(""), null);
});

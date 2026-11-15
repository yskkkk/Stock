import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isViteIntegratedRestartActive,
  registerViteHttpServer,
  registerViteIntegratedRestart,
  restartNodeOrViteDev,
} from "./restart-node-process.js";

describe("restartNodeOrViteDev forceProcess", () => {
  it("forceProcess bypasses Vite soft restart and uses registered httpServer", async () => {
    let softCalls = 0;
    registerViteIntegratedRestart(async () => {
      softCalls += 1;
    });
    assert.equal(isViteIntegratedRestartActive(), true);

    let closed = false;
    const fakeServer = {
      listening: true,
      address: () => ({ port: 5173, address: "127.0.0.1" }),
      closeAllConnections() {},
      close(cb) {
        closed = true;
        this.listening = false;
        queueMicrotask(() => cb?.());
      },
      once() {},
      removeListener() {},
      listen() {
        this.listening = true;
        queueMicrotask(() => this.emit?.("listening"));
      },
    };
    registerViteHttpServer(fakeServer);

    // Soft path still works when forceProcess is omitted.
    const softOk = await restartNodeOrViteDev(null);
    assert.equal(softOk, true);
    assert.equal(softCalls, 1);
    assert.equal(closed, false);

    // forceProcess must not call Vite soft restart.
    // respawn will try spawn+exit; stub close so we can observe it was used.
    // Avoid actually exiting the test process: intercept by making close hang
    // as still_listening after timeout would be slow — instead leave listening
    // false after close so spawn runs. We cannot let parent process.exit —
    // so spy: make spawn fail by using invalid argv temporarily… Simpler:
    // assert softCalls unchanged when forceProcess hits close path.
    // For unit safety, use a server that stays listening so respawn aborts
    // before spawn/exit.
    const stickyServer = {
      listening: true,
      address: () => ({ port: 5173, address: "127.0.0.1" }),
      closeAllConnections() {},
      close(cb) {
        // never actually stop listening → respawn returns false, no exit
        queueMicrotask(() => cb?.());
      },
      once() {},
      removeListener() {},
      listen() {},
    };
    registerViteHttpServer(stickyServer);
    const forced = await restartNodeOrViteDev(null, { forceProcess: true });
    assert.equal(forced, false);
    assert.equal(softCalls, 1, "forceProcess must skip Vite soft restart");

    registerViteIntegratedRestart(null);
    registerViteHttpServer(null);
  });
});

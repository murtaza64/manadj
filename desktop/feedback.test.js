const { test } = require("node:test");
const assert = require("node:assert/strict");
const { registerFeedbackCapture } = require("./feedback");

function setup(targetUrl = "http://localhost:5173") {
  let handler;
  const image = {
    isEmpty: () => false,
    getSize: () => ({ width: 3200, height: 2000 }),
    resize: (size) => { assert.ok(size.width <= 1600); return image; },
    toDataURL: () => "data:image/png;base64,ZmFrZQ==",
  };
  const webContents = {
    mainFrame: { url: targetUrl },
    isDestroyed: () => false,
    getURL: () => webContents.mainFrame.url,
    capturePage: async () => image,
  };
  const dispose = registerFeedbackCapture({
    targetUrl, webContents,
    ipcMain: {
      handle: (_name, fn) => { handler = fn; },
      removeHandler: () => { handler = null; },
    },
  });
  const event = { sender: webContents, senderFrame: webContents.mainFrame };
  return { call: (e = event) => handler(e), webContents, event, image, dispose };
}

test("captures and bounds only the app image", async () => {
  const f = setup();
  assert.match(await f.call(), /^data:image\/png;base64,/);
  f.dispose();
  assert.throws(() => f.call());
});

test("denies remote targets, other windows, and even same-origin iframes", async () => {
  await assert.rejects(setup("https://example.com").call(), /restricted/);
  const f = setup();
  await assert.rejects(f.call({ ...f.event, sender: {} }), /restricted/);
  await assert.rejects(f.call({ ...f.event, senderFrame: { url: "http://localhost:5173" } }), /restricted/);
  f.webContents.mainFrame.url = "http://localhost:5174";
  await assert.rejects(f.call(), /navigated/);
});

test("rechecks navigation after capture and releases its in-flight guard", async () => {
  const f = setup();
  let finish;
  f.webContents.capturePage = () => new Promise((resolve) => { finish = resolve; });
  const first = f.call();
  await assert.rejects(f.call(), /in progress/);
  f.webContents.mainFrame.url = "https://example.com";
  finish(f.image);
  await assert.rejects(first, /navigated/);
  f.webContents.mainFrame.url = "http://localhost:5173";
  f.webContents.capturePage = async () => f.image;
  assert.match(await f.call(), /^data:image\/png/);
});

test("rejects empty and oversized captures", async () => {
  const f = setup();
  f.image.isEmpty = () => true;
  await assert.rejects(f.call(), /unavailable/);
  f.image.isEmpty = () => false;
  f.image.toDataURL = () => "data:image/png;base64," + "A".repeat(4 * 1024 * 1024);
  await assert.rejects(f.call(), /limit/);
});

import assert from "node:assert/strict";
import test from "node:test";

async function render(pathname = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${pathname}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${pathname}`, { headers: { accept: "text/html" } }), {
    ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
  }, { waitUntil() {}, passThroughOnException() {} });
}

for (const [pathname, expected] of [
  ["/", /四步完成一次可复现评测/],
  ["/models", /连接参评模型/],
  ["/run", /正在恢复本机评测工作区/],
  ["/leaderboard", /正在载入本机评测报告/],
]) {
  test(`server-renders ${pathname}`, async () => {
    const response = await render(pathname);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
    const html = await response.text();
    assert.match(html, /Decision Bench/);
    assert.match(html, expected);
    assert.doesNotMatch(html, /俄罗斯方块|Tetris|开始对决/);
    assert.doesNotMatch(html, /apiKey_[a-zA-Z0-9]+/);
  });
}

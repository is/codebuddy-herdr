import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import net from "node:net";
import test from "node:test";

const reporter = fileURLToPath(new URL("../bin/herdr-report.js", import.meta.url));

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "codebuddy-herdr-test-"));
  const socketPath = join(directory, "herdr.sock");
  const requests = [];
  const server = net.createServer((socket) => {
    let raw = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      raw += chunk;
      const newline = raw.indexOf("\n");
      if (newline < 0) return;
      requests.push({ raw: raw.slice(0, newline), request: JSON.parse(raw.slice(0, newline)) });
      socket.end('{"ok":true}\n');
    });
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  });

  return {
    directory,
    requests,
    env: {
      HERDR_ENV: "1",
      HERDR_PANE_ID: "pane:test",
      HERDR_SOCKET_PATH: socketPath,
      TMPDIR: directory,
    },
    async close() {
      await new Promise((resolve) => server.close(resolve));
      await rm(directory, { recursive: true, force: true });
    },
  };
}

function invoke(hook, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [reporter], {
      env: { ...process.env, ...env },
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`reporter exited ${code}: ${stderr}`));
    });
    child.stdin.end(JSON.stringify(hook));
  });
}

async function waitForRequests(requests, count) {
  const deadline = Date.now() + 1_000;
  while (requests.length < count && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(requests.length, count, "expected Herdr request(s)");
}

test("SessionStart reports idle with a valid resume command", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  await invoke({ hook_event_name: "SessionStart", session_id: "session-1", transcript_path: "/tmp/chat.jsonl" }, f.env);
  await waitForRequests(f.requests, 1);
  const { method, params } = f.requests[0].request;
  assert.equal(method, "pane.report_agent");
  assert.deepEqual(params, {
    pane_id: "pane:test",
    source: "codebuddy",
    agent: "CodeBuddy",
    state: "idle",
    agent_session_id: "session-1",
    resume_argv: ["codebuddy", "--resume", "session-1"],
    agent_session_path: "/tmp/chat.jsonl",
    seq: params.seq,
  });
  assert.match(f.requests[0].raw, /"seq":\d+/);
});

test("state and release hook mappings match the Herdr protocol", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  await invoke({ hook_event_name: "UserPromptSubmit" }, f.env);
  await invoke({ hook_event_name: "PreToolUse" }, f.env);
  await invoke({ hook_event_name: "Stop" }, f.env);
  await invoke({ hook_event_name: "Notification", notification_type: "PermissionPrompt", message: "Allow write?" }, f.env);
  await invoke({ hook_event_name: "SessionEnd" }, f.env);
  await waitForRequests(f.requests, 5);

  assert.deepEqual(
    f.requests.map(({ request }) => [request.method, request.params.state, request.params.message]),
    [
      ["pane.report_agent", "working", undefined],
      ["pane.report_agent", "working", undefined],
      ["pane.report_agent", "idle", undefined],
      ["pane.report_agent", "blocked", "Allow write?"],
      ["pane.release_agent", undefined, undefined],
    ],
  );
});

test("PostToolUse clears a prior blocked Notification", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  await invoke({ hook_event_name: "Notification", notification_type: "PermissionPrompt", message: "Allow write?" }, f.env);
  await invoke({ hook_event_name: "PostToolUse" }, f.env);
  await waitForRequests(f.requests, 2);
  assert.deepEqual(
    f.requests.map(({ request }) => [request.method, request.params.state, request.params.message]),
    [
      ["pane.report_agent", "blocked", "Allow write?"],
      ["pane.report_agent", "working", undefined],
    ],
  );
});

test("idle_prompt Notification reports idle, not blocked", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  await invoke({ hook_event_name: "Notification", notification_type: "idle_prompt", message: "CodeBuddy is waiting for your input" }, f.env);
  await waitForRequests(f.requests, 1);
  const { method, params } = f.requests[0].request;
  assert.equal(method, "pane.report_agent");
  assert.equal(params.state, "idle");
  assert.equal(params.message, undefined);
});

test("irrelevant notifications and processes outside Herdr are no-ops", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  await invoke({ hook_event_name: "Notification", notification_type: "info" }, f.env);
  await invoke({ hook_event_name: "PreToolUse" }, { ...f.env, HERDR_ENV: "0" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(f.requests.length, 0);
});

test("concurrent reports have strictly increasing persisted sequences", async (t) => {
  const f = await fixture();
  t.after(() => f.close());
  await Promise.all(Array.from({ length: 4 }, () => invoke({ hook_event_name: "PreToolUse" }, f.env)));
  await waitForRequests(f.requests, 4);
  const sequences = f.requests.map(({ raw }) => BigInt(raw.match(/"seq":(\d+)/)[1]));
  assert.equal(new Set(sequences).size, sequences.length);
  assert.deepEqual([...sequences].sort((a, b) => (a < b ? -1 : 1)), sequences);
});

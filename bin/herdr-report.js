#!/usr/bin/env node
/**
 * Report CodeBuddy hook events to Herdr's local socket API.
 *
 * This file is compiled to bin/herdr-report.js before publishing.  Keeping the
 * runnable JavaScript in the package means hooks do not need ts-node or tsx.
 */
import { closeSync, fsyncSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import net from "node:net";
const SOURCE = "herdr:codebuddy";
const AGENT = "CodeBuddy";
const RESUME_BIN = "codebuddy";
const SOCKET_TIMEOUT_MS = 500;
const REPORTER_PATH = fileURLToPath(import.meta.url);
function counterPath() {
    const pane = process.env.HERDR_PANE_ID ?? "none";
    // Pane IDs normally only contain ':' as punctuation.  Keeping the filename
    // conservative also ensures an unexpected ID cannot escape TMPDIR.
    const safePane = pane.replace(/[^A-Za-z0-9._-]/g, "_");
    return join(process.env.TMPDIR || tmpdir(), `herdr-codebuddy-seq-${safePane}`);
}
function lockedNextSeq(base, path) {
    try {
        const lastText = readFileSync(path, "utf8").trim();
        const last = /^\d+$/.test(lastText) ? BigInt(lastText) : 0n;
        const next = base > last ? base : last + 1n;
        const descriptor = openSync(path, "r+");
        try {
            writeFileSync(descriptor, next.toString(), "utf8");
            fsyncSync(descriptor);
        }
        finally {
            closeSync(descriptor);
        }
        return next;
    }
    catch {
        return undefined;
    }
}
/**
 * Node core has no flock API.  Run the same program under the platform's
 * flock utility, which holds an fcntl advisory lock on the counter file while
 * the inner process reads and writes it.  A failed/timed-out lock returns no
 * sequence, causing the hook to be safely dropped rather than risking an
 * out-of-order report.
 */
function nextSeq() {
    // Date.now supplies the wall-clock nanosecond base; the monotonic clock's
    // sub-millisecond part avoids most same-millisecond collisions. The locked
    // persisted counter handles the remaining cases and clock rollback.
    const base = BigInt(Date.now()) * 1000000n + (process.hrtime.bigint() % 1000000n);
    const path = counterPath();
    try {
        const result = spawnSync("flock", ["-x", "-w", "0.45", path, process.execPath, REPORTER_PATH, "--locked-next-seq", base.toString(), path], { encoding: "utf8", timeout: SOCKET_TIMEOUT_MS });
        if (result.status !== 0 || result.error)
            return undefined;
        const output = result.stdout.trim();
        return /^\d+$/.test(output) ? BigInt(output) : undefined;
    }
    catch {
        return undefined;
    }
}
function asString(value) {
    return typeof value === "string" ? value : "";
}
async function readHook() {
    try {
        let raw = "";
        for await (const chunk of process.stdin)
            raw += String(chunk);
        if (!raw.trim())
            return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : {};
    }
    catch {
        return {};
    }
}
function requestJson(method, params) {
    // JSON.stringify cannot encode bigint. Serialize seq separately so it stays
    // a JSON number (not a rounded JS Number or a string).
    const { seq, ...otherParams } = params;
    const paramsWithoutSeq = JSON.stringify(otherParams);
    const paramsJson = `${paramsWithoutSeq.slice(0, -1)},"seq":${seq.toString()}}`;
    return `${JSON.stringify({
        id: `${SOURCE}:${Date.now()}:${process.pid}`,
        method,
    }).slice(0, -1)},"params":${paramsJson}}\n`;
}
async function send(method, params) {
    const socketPath = process.env.HERDR_SOCKET_PATH;
    if (!socketPath)
        return;
    const payload = requestJson(method, params);
    await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled)
                return;
            settled = true;
            client.destroy();
            resolve();
        };
        const client = net.createConnection({ path: socketPath });
        client.setTimeout(SOCKET_TIMEOUT_MS, finish);
        client.once("error", finish);
        // Herdr sends a small acknowledgement. Waiting for it (or EOF) avoids
        // resetting the connection while the server is still writing the reply.
        client.once("data", finish);
        client.once("end", finish);
        client.once("close", finish);
        client.once("connect", () => client.end(payload));
    });
}
async function reportState(pane, state, message) {
    const seq = nextSeq();
    if (seq === undefined)
        return;
    await send("pane.report_agent", {
        pane_id: pane,
        source: SOURCE,
        agent: AGENT,
        state,
        seq,
        ...(message ? { message } : {}),
    });
}
async function main() {
    if (process.argv[2] === "--locked-next-seq") {
        const base = process.argv[3];
        const path = process.argv[4];
        if (!base || !path || !/^\d+$/.test(base))
            process.exitCode = 1;
        else {
            const seq = lockedNextSeq(BigInt(base), path);
            if (seq === undefined)
                process.exitCode = 1;
            else
                process.stdout.write(`${seq.toString()}\n`);
        }
        return;
    }
    if (process.env.HERDR_ENV !== "1")
        return;
    const pane = process.env.HERDR_PANE_ID;
    if (!pane)
        return;
    const hook = await readHook();
    const event = asString(hook.hook_event_name);
    if (event === "SessionStart") {
        const seq = nextSeq();
        if (seq === undefined)
            return;
        const sessionId = asString(hook.session_id);
        const transcript = asString(hook.transcript_path);
        await send("pane.report_agent", {
            pane_id: pane,
            source: SOURCE,
            agent: AGENT,
            state: "idle",
            seq,
            ...(sessionId
                ? { agent_session_id: sessionId, resume_argv: [RESUME_BIN, "--resume", sessionId] }
                : {}),
            ...(transcript ? { agent_session_path: transcript } : {}),
        });
        return;
    }
    if (event === "UserPromptSubmit" || event === "PreToolUse" || event === "PostToolUse") {
        await reportState(pane, "working");
        return;
    }
    if (event === "Stop") {
        await reportState(pane, "idle");
        return;
    }
    if (event === "Notification") {
        const notificationType = asString(hook.notification_type).toLowerCase();
        if (notificationType === "idle_prompt") {
            // idle_prompt means the agent finished and awaits the user's next input;
            // it is not blocked. Report idle, else the "prompt" substring below would
            // misclassify a finished turn as blocked (a sticky wrong state).
            await reportState(pane, "idle");
        }
        else if (/(permission|prompt|decision)/.test(notificationType)) {
            await reportState(pane, "blocked", asString(hook.message) || "needs input");
        }
        return;
    }
    if (event === "SessionEnd") {
        const seq = nextSeq();
        if (seq === undefined)
            return;
        await send("pane.release_agent", { pane_id: pane, source: SOURCE, agent: AGENT, seq });
    }
}
main().catch(() => {
    // Hook failures must never affect a CodeBuddy session.
});

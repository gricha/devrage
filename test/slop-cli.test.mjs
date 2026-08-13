import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import Database from "better-sqlite3";

const execFileAsync = promisify(execFile);
const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cliPath = join(repoRoot, "dist", "cli.js");
const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

test("slop scans OpenCode assistant prose and ignores user prose", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-slop-opencode-"));
  const dataHome = join(root, "data");
  const dbPath = join(dataHome, "opencode", "opencode.db");

  await mkdir(dirname(dbPath), { recursive: true });
  createOpenCodeSlopFixture(dbPath);

  const slopOutput = stripAnsi(
    await runCli(["slop", "--agent", "opencode"], {
      HOME: root,
      XDG_DATA_HOME: dataHome,
    }),
  );

  assert.match(slopOutput, /devrage slop/);
  assert.match(slopOutput, /assistant messages\s+2/);
  assert.match(slopOutput, /slop hits\s+3/);
  assert.match(slopOutput, /messages with slop\s+1\s+\(50\.0%\)/);
  assert.match(slopOutput, /you're absolutely right\s+1/);
  assert.match(slopOutput, /load-bearing\s+1/);
  assert.match(slopOutput, /it's not X, it's Y\s+1/);
  assert.doesNotMatch(slopOutput, /delve\s+1/);

  const scanOutput = stripAnsi(
    await runCli(["scan", "--agent", "opencode"], {
      HOME: root,
      XDG_DATA_HOME: dataHome,
    }),
  );
  assert.match(scanOutput, /messages scanned\s+1/);
  assert.match(scanOutput, /total swears\s+1/);
});

test("slop reads Claude assistant content once", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-slop-claude-"));
  const sessionPath = join(root, ".claude", "projects", "fixture", "session.jsonl");
  const assistant = {
    type: "assistant",
    uuid: "assistant-row-1",
    timestamp: "2026-08-01T00:00:01.000Z",
    message: {
      id: "message-1",
      role: "assistant",
      content: [{ type: "text", text: "Here is the honest take: this is load-bearing." }],
    },
  };

  await mkdir(dirname(sessionPath), { recursive: true });
  await writeFile(
    sessionPath,
    [
      JSON.stringify({
        type: "user",
        timestamp: "2026-08-01T00:00:00.000Z",
        message: { role: "user", content: "Please delve into it." },
      }),
      JSON.stringify(assistant),
      JSON.stringify(assistant),
    ].join("\n"),
  );

  const output = stripAnsi(await runCli(["slop", "--agent", "claude"], { HOME: root }));

  assert.match(output, /assistant messages\s+1/);
  assert.match(output, /slop hits\s+2/);
  assert.match(output, /honest take\s+1/);
  assert.match(output, /load-bearing\s+1/);
});

test("slop reads Codex output_text instead of user input_text", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-slop-codex-"));
  const sessionPath = join(root, ".codex", "sessions", "2026", "08", "01", "rollout.jsonl");

  await mkdir(dirname(sessionPath), { recursive: true });
  await writeFile(
    sessionPath,
    [
      codexMessage("user", "input_text", "This user says tapestry."),
      codexMessage("assistant", "output_text", "That is a real gap. I overcomplicated it."),
    ].join("\n"),
  );

  const output = stripAnsi(await runCli(["slop", "--agent", "codex"], { HOME: root }));

  assert.match(output, /assistant messages\s+1/);
  assert.match(output, /slop hits\s+2/);
  assert.match(output, /real gap\s+1/);
  assert.match(output, /I overcomplicated it\s+1/);
  assert.doesNotMatch(output, /tapestry\s+1/);
});

test("slop reads Cursor assistant bubbles and skips user bubbles", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-slop-cursor-"));
  const configHome = join(root, "config");
  const dbPath = join(configHome, "Cursor", "User", "globalStorage", "state.vscdb");

  await mkdir(dirname(dbPath), { recursive: true });
  createCursorSlopFixture(dbPath);

  const output = stripAnsi(
    await runCli(["slop", "--agent", "cursor"], {
      APPDATA: join(root, "appdata"),
      HOME: root,
      XDG_CONFIG_HOME: configHome,
    }),
  );

  assert.match(output, /assistant messages\s+1/);
  assert.match(output, /slop hits\s+1/);
  assert.match(output, /key insight\s+1/);
  assert.doesNotMatch(output, /delve\s+1/);
});

test("slop reads assistant roles from Amp, Cline, Pi, T3 Code, and Zed", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-slop-roles-"));
  const dataHome = join(root, "data");
  const configHome = join(root, "config");
  const appData = join(root, "appdata");
  const t3Home = join(root, "t3");

  await writeAmpSlopFixture(dataHome);
  await writeClineSlopFixture(root, configHome, appData);
  await writePiSlopFixture(root);
  await writeT3SlopFixture(t3Home);
  await writeZedSlopFixture(root, dataHome);

  const cases = [
    ["amp", { HOME: root, XDG_DATA_HOME: dataHome }],
    ["cline", { APPDATA: appData, HOME: root, XDG_CONFIG_HOME: configHome }],
    ["pi", { HOME: root }],
    ["t3code", { HOME: root, T3CODE_HOME: t3Home }],
    ["zed", { HOME: root, XDG_DATA_HOME: dataHome }],
  ];

  for (const [agent, env] of cases) {
    const output = stripAnsi(await runCli(["slop", "--agent", agent], env));
    assert.match(output, /assistant messages\s+1/, agent);
    assert.match(output, /slop hits\s+1/, agent);
    assert.match(output, /load-bearing\s+1/, agent);
    assert.doesNotMatch(output, /delve\s+1/, agent);
  }
});

test("slop help is registered as a first-class command", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-slop-help-"));
  const output = stripAnsi(await runCli(["slop", "--help"], { HOME: root }));

  assert.match(output, /devrage slop — scan coding-agent responses for AI-isms/);
});

async function runCli(args, env) {
  const result = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: { ...process.env, ...env },
  });
  return result.stdout;
}

function createOpenCodeSlopFixture(dbPath) {
  const timestamp = Date.parse("2026-08-01T00:00:00.000Z");
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE message (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        time_created INTEGER,
        time_updated INTEGER,
        data TEXT
      );
      CREATE TABLE part (
        id TEXT PRIMARY KEY,
        message_id TEXT,
        session_id TEXT,
        time_created INTEGER,
        time_updated INTEGER,
        data TEXT
      );
    `);
    const insertMessage = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)");
    const insertPart = db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)");

    insertMessage.run(
      "user-1",
      "session-1",
      timestamp,
      timestamp,
      JSON.stringify({ role: "user" }),
    );
    insertPart.run(
      "part-user-1",
      "user-1",
      "session-1",
      timestamp,
      timestamp,
      JSON.stringify({ type: "text", text: "Please delve into this fucking bug." }),
    );

    insertMessage.run(
      "assistant-1",
      "session-1",
      timestamp + 1,
      timestamp + 1,
      JSON.stringify({ role: "assistant" }),
    );
    insertPart.run(
      "part-assistant-1",
      "assistant-1",
      "session-1",
      timestamp + 1,
      timestamp + 1,
      JSON.stringify({
        type: "text",
        text: "You're absolutely right. This is load-bearing. It's not a patch, it's a statement.",
      }),
    );

    insertMessage.run(
      "assistant-2",
      "session-1",
      timestamp + 2,
      timestamp + 2,
      JSON.stringify({ role: "assistant" }),
    );
    insertPart.run(
      "part-assistant-2",
      "assistant-2",
      "session-1",
      timestamp + 2,
      timestamp + 2,
      JSON.stringify({ type: "text", text: "Updated the parser and added regression tests." }),
    );
  } finally {
    db.close();
  }
}

function codexMessage(role, contentType, text) {
  return JSON.stringify({
    timestamp: "2026-08-01T00:00:00.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role,
      content: [{ type: contentType, text }],
    },
  });
}

function createCursorSlopFixture(dbPath) {
  const db = new Database(dbPath);
  try {
    db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)");
    db.prepare("INSERT INTO cursorDiskKV VALUES (?, ?)").run(
      "bubbleId:composer-1:user-1",
      JSON.stringify({ type: 1, text: "Please delve into this.", createdAt: "2026-08-01" }),
    );
    db.prepare("INSERT INTO cursorDiskKV VALUES (?, ?)").run(
      "bubbleId:composer-1:assistant-1",
      JSON.stringify({ type: 2, text: "That is the key insight.", createdAt: "2026-08-01" }),
    );
  } finally {
    db.close();
  }
}

async function writeAmpSlopFixture(dataHome) {
  const threadPath = join(dataHome, "amp", "threads", "thread-1.json");
  await mkdir(dirname(threadPath), { recursive: true });
  await writeFile(
    threadPath,
    JSON.stringify({
      messages: [
        { role: "user", content: "Please delve into this." },
        { role: "assistant", content: "This is load-bearing." },
      ],
    }),
  );
}

async function writeClineSlopFixture(root, configHome, appData) {
  let storageRoot;
  if (process.platform === "darwin") {
    storageRoot = join(root, "Library", "Application Support", "Code", "User", "globalStorage");
  } else if (process.platform === "linux") {
    storageRoot = join(configHome, "Code", "User", "globalStorage");
  } else {
    storageRoot = join(appData, "Code", "User", "globalStorage");
  }

  const historyPath = join(
    storageRoot,
    "saoudrizwan.claude-dev",
    "tasks",
    "task-1",
    "api_conversation_history.json",
  );
  await mkdir(dirname(historyPath), { recursive: true });
  await writeFile(
    historyPath,
    JSON.stringify([
      { role: "user", content: "Please delve into this." },
      { role: "assistant", content: "This is load-bearing." },
    ]),
  );
}

async function writePiSlopFixture(root) {
  const sessionPath = join(root, ".pi", "agent", "sessions", "fixture", "session.jsonl");
  await mkdir(dirname(sessionPath), { recursive: true });
  await writeFile(
    sessionPath,
    [
      JSON.stringify({ type: "session", cwd: "/fixture" }),
      JSON.stringify({ type: "message", message: { role: "user", content: "Please delve." } }),
      JSON.stringify({
        type: "message",
        message: { role: "assistant", content: "This is load-bearing." },
      }),
    ].join("\n"),
  );
}

async function writeT3SlopFixture(t3Home) {
  const dbPath = join(t3Home, "userdata", "state.sqlite");
  await mkdir(dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE projection_thread_messages (
        message_id TEXT PRIMARY KEY,
        thread_id TEXT,
        role TEXT,
        text TEXT,
        created_at TEXT
      )
    `);
    const insert = db.prepare("INSERT INTO projection_thread_messages VALUES (?, ?, ?, ?, ?)");
    insert.run("user-1", "thread-1", "user", "Please delve.", "2026-08-01T00:00:00Z");
    insert.run(
      "assistant-1",
      "thread-1",
      "assistant",
      "This is load-bearing.",
      "2026-08-01T00:00:01Z",
    );
  } finally {
    db.close();
  }
}

async function writeZedSlopFixture(root, dataHome) {
  const dbDir =
    process.platform === "darwin"
      ? join(root, "Library", "Application Support", "Zed", "db")
      : join(dataHome, "zed", "db");
  const dbPath = join(dbDir, "0-test.db");
  await mkdir(dbDir, { recursive: true });
  const db = new Database(dbPath);
  try {
    db.exec("CREATE TABLE messages (role TEXT, content TEXT)");
    db.prepare("INSERT INTO messages VALUES (?, ?)").run("user", "Please delve.");
    db.prepare("INSERT INTO messages VALUES (?, ?)").run("assistant", "This is load-bearing.");
  } finally {
    db.close();
  }
}

function stripAnsi(value) {
  return value.replace(ANSI_PATTERN, "").replace(/\r/g, "");
}

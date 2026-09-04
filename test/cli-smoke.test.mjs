import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
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
const HAS_NODE_SQLITE = await hasNodeSqlite();

test("OpenCode cost uses cached models.dev pricing", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-opencode-"));
  const dataHome = join(root, "data");
  const cacheHome = join(root, "cache");
  const dbPath = join(dataHome, "opencode", "opencode.db");

  await mkdir(dirname(dbPath), { recursive: true });
  await writePricingCache(cacheHome);
  createOpenCodeFixture(dbPath);

  const output = stripAnsi(
    await runCli(["cost", "--agent", "opencode", "--since", "2026-06-01"], {
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
      XDG_DATA_HOME: dataHome,
    }),
  );

  assert.match(output, /devrage cost/);
  assert.match(output, /gpt-5\.5\s+\$35\.00/);
  assert.doesNotMatch(output, /billed/i);
});

test(
  "OpenCode cost works with Node native SQLite",
  { skip: !HAS_NODE_SQLITE },
  async () => {
    const root = await mkdtemp(join(tmpdir(), "devrage-opencode-node-sqlite-"));
    const dataHome = join(root, "data");
    const cacheHome = join(root, "cache");
    const dbPath = join(dataHome, "opencode", "opencode.db");

    await mkdir(dirname(dbPath), { recursive: true });
    await writePricingCache(cacheHome);
    createOpenCodeFixture(dbPath);

    const result = await runCliResult(["cost", "--agent", "opencode", "--since", "2026-06-01"], {
      DEVRAGE_SQLITE_DRIVER: "node",
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
      XDG_DATA_HOME: dataHome,
    });
    const output = stripAnsi(result.stdout);

    assert.match(output, /opencode\s+\$35\.00\s+1 req/);
    assert.match(output, /gpt-5\.5\s+\$35\.00/);
    assert.doesNotMatch(result.stderr, /ExperimentalWarning/);
    assert.doesNotMatch(result.stderr, /SQLite support not available/);
  },
);

test("OpenCode cost works with better-sqlite3 fallback", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-opencode-better-sqlite3-"));
  const dataHome = join(root, "data");
  const cacheHome = join(root, "cache");
  const dbPath = join(dataHome, "opencode", "opencode.db");

  await mkdir(dirname(dbPath), { recursive: true });
  await writePricingCache(cacheHome);
  createOpenCodeFixture(dbPath);

  const output = stripAnsi(
    await runCli(["cost", "--agent", "opencode", "--since", "2026-06-01"], {
      DEVRAGE_SQLITE_DRIVER: "better-sqlite3",
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
      XDG_DATA_HOME: dataHome,
    }),
  );

  assert.match(output, /opencode\s+\$35\.00\s+1 req/);
  assert.match(output, /gpt-5\.5\s+\$35\.00/);
});

test("cost command renders only the cost dashboard", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-cost-"));
  const dataHome = join(root, "data");
  const cacheHome = join(root, "cache");
  const dbPath = join(dataHome, "opencode", "opencode.db");

  await mkdir(dirname(dbPath), { recursive: true });
  await writePricingCache(cacheHome);
  createOpenCodeFixture(dbPath);

  const output = stripAnsi(
    await runCli(["cost", "--agent", "opencode", "--since", "2026-06-01"], {
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
      XDG_DATA_HOME: dataHome,
    }),
  );

  assert.match(output, /devrage cost/);
  assert.match(output, /\$35\.00/);
  assert.match(output, /1 req/);
  assert.match(output, /^  total$/m);
  assert.match(output, /models/);
  assert.match(output, /agents/);
  assert.match(output, /Report: file:\/\//);
  assert.match(output, /gpt-5\.5\s+\$35\.00/);
  assert.ok(output.indexOf("total") < output.indexOf("agents"));
  assert.ok(output.indexOf("agents") < output.indexOf("models"));
  assert.ok(output.indexOf("models") < output.indexOf("Report:"));
  assert.doesNotMatch(output, /daily/);
  assert.doesNotMatch(output, /estimated API-equivalent cost/);
  assert.doesNotMatch(output, /cost dashboard/);
  assert.doesNotMatch(output, /agent cost/);
  assert.doesNotMatch(output, /messages scanned/);
  assert.doesNotMatch(output, /total swears/);
  assert.doesNotMatch(output, /billed/i);
  assert.doesNotMatch(output, /agent language/);
  assert.doesNotMatch(output, /top words/);

  const report = await readReport(output);
  assert.match(report, /devrage cost report/);
  assert.match(report, /gpt-5\.5/);
  assert.match(report, /Daily/);
  assert.match(report, /bar-column/);
  assert.match(report, /column-fill/);
  assert.match(report, /data-tooltip/);
  assert.match(report, /id="tooltip"/);
  assert.doesNotMatch(report, /billed/i);
  assert.doesNotMatch(report, /bar-row/);
  assert.ok(report.indexOf("<h2>Agents</h2>") < report.indexOf("<h2>Models</h2>"));
  assert.ok(report.indexOf("<h2>Models</h2>") < report.indexOf("<h2>Daily</h2>"));
});

test("cost command has a cost-specific empty state", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-cost-empty-"));
  const cacheHome = join(root, "cache");

  await writePricingCache(cacheHome);

  const output = stripAnsi(
    await runCli(["cost", "--agent", "cursor"], {
      APPDATA: join(root, "appdata"),
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_DATA_HOME: join(root, "data"),
    }),
  );

  assert.match(output, /devrage cost/);
  assert.match(output, /cursor/);
  assert.match(output, /no local usage found/);
  assert.doesNotMatch(output, /devrage report/);
  assert.doesNotMatch(output, /messages scanned/);
  assert.doesNotMatch(output, /total swears/);
  assert.doesNotMatch(output, /squeaky clean/);
});

test("cost command works when flags come before the subcommand", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-cost-before-flags-"));
  const cacheHome = join(root, "cache");

  await writePricingCache(cacheHome);

  const output = stripAnsi(
    await runCli(["--agent", "cursor", "cost"], {
      APPDATA: join(root, "appdata"),
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
      XDG_CONFIG_HOME: join(root, "config"),
      XDG_DATA_HOME: join(root, "data"),
    }),
  );

  assert.match(output, /devrage cost/);
  assert.match(output, /cursor/);
  assert.match(output, /no local usage found/);
  assert.doesNotMatch(output, /devrage report/);
  assert.doesNotMatch(output, /messages scanned/);
  assert.doesNotMatch(output, /squeaky clean/);
});

test("cost command caps terminal models to top 10", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-cost-model-cap-"));
  const dataHome = join(root, "data");
  const cacheHome = join(root, "cache");
  const dbPath = join(dataHome, "opencode", "opencode.db");
  const modelPricing = Object.fromEntries(
    Array.from({ length: 11 }, (_, index) => [
      `model-${String(index + 1).padStart(2, "0")}`,
      { cost: { input: 0, output: 1 } },
    ]),
  );

  await mkdir(dirname(dbPath), { recursive: true });
  await writePricingCache(cacheHome, modelPricing);
  createOpenCodeMultiModelFixture(dbPath);

  const output = stripAnsi(
    await runCli(["cost", "--agent", "opencode", "--since", "2026-06-01"], {
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
      XDG_DATA_HOME: dataHome,
    }),
  );

  assert.match(output, /model-10/);
  assert.doesNotMatch(output, /model-11/);

  const report = await readReport(output);
  assert.match(report, /model-11/);
});

test("cost range shortcuts default days to one day", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-cost-day-"));
  const dataHome = join(root, "data");
  const cacheHome = join(root, "cache");
  const dbPath = join(dataHome, "opencode", "opencode.db");

  await mkdir(dirname(dbPath), { recursive: true });
  await writePricingCache(cacheHome);
  createOpenCodeFixture(dbPath, Date.now());

  const dayOutput = stripAnsi(
    await runCli(["cost", "--agent", "opencode", "--day"], {
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
      XDG_DATA_HOME: dataHome,
    }),
  );
  const daysOutput = stripAnsi(
    await runCli(["cost", "--days", "--agent", "opencode"], {
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
      XDG_DATA_HOME: dataHome,
    }),
  );

  assert.match(dayOutput, /last 1 day/);
  assert.match(dayOutput, /\$35\.00/);
  assert.match(daysOutput, /last 1 day/);
  assert.match(daysOutput, /\$35\.00/);
});

test("cost range shortcuts accept explicit days", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-cost-days-"));
  const dataHome = join(root, "data");
  const cacheHome = join(root, "cache");
  const dbPath = join(dataHome, "opencode", "opencode.db");

  await mkdir(dirname(dbPath), { recursive: true });
  await writePricingCache(cacheHome);
  createOpenCodeFixture(dbPath, Date.now());

  const output = stripAnsi(
    await runCli(["cost", "--agent", "opencode", "--days", "3"], {
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
      XDG_DATA_HOME: dataHome,
    }),
  );

  assert.match(output, /last 3 days/);
  assert.match(output, /\$35\.00/);
});

test("cost range shortcuts include week and month", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-cost-week-month-"));
  const dataHome = join(root, "data");
  const cacheHome = join(root, "cache");
  const dbPath = join(dataHome, "opencode", "opencode.db");

  await mkdir(dirname(dbPath), { recursive: true });
  await writePricingCache(cacheHome);
  createOpenCodeFixture(dbPath, Date.now());

  const weekOutput = stripAnsi(
    await runCli(["cost", "--agent", "opencode", "--week"], {
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
      XDG_DATA_HOME: dataHome,
    }),
  );
  const monthOutput = stripAnsi(
    await runCli(["cost", "--agent", "opencode", "--month"], {
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
      XDG_DATA_HOME: dataHome,
    }),
  );

  assert.match(weekOutput, /last 7 days/);
  assert.match(weekOutput, /\$35\.00/);
  assert.match(monthOutput, /last 30 days/);
  assert.match(monthOutput, /\$35\.00/);
});

test("cost display floors dollar amounts to cents", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-cost-floor-"));
  const dataHome = join(root, "data");
  const cacheHome = join(root, "cache");
  const dbPath = join(dataHome, "opencode", "opencode.db");

  await mkdir(dirname(dbPath), { recursive: true });
  await writePricingCache(cacheHome);
  createOpenCodeFixture(dbPath, Date.now(), 1_000_333);

  const output = stripAnsi(
    await runCli(["cost", "--agent", "opencode", "--day"], {
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
      XDG_DATA_HOME: dataHome,
    }),
  );

  assert.match(output, /\$35\.00/);
  assert.doesNotMatch(output, /\$35\.01/);
});

test("Claude cost uses assistant usage once per streamed request", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-claude-"));
  const cacheHome = join(root, "cache");
  const sessionPath = join(root, ".claude", "projects", "fixture", "session.jsonl");

  await mkdir(dirname(sessionPath), { recursive: true });
  await writePricingCache(cacheHome);
  await writeFile(
    sessionPath,
    `${claudeUserLine()}\n${claudeAssistantLine()}\n${claudeAssistantLine()}\n`,
  );

  const output = stripAnsi(
    await runCli(["cost", "--agent", "claude"], {
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
    }),
  );

  assert.match(output, /claude\s+\$36\.75\s+1 req/);
  assert.match(output, /claude-opus-4-7\s+\$36\.75/);
});

test("Codex cost uses last token usage and skips non-billable updates", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-codex-"));
  const cacheHome = join(root, "cache");
  const sessionPath = join(root, ".codex", "sessions", "2026", "06", "02", "rollout-fixture.jsonl");

  await mkdir(dirname(sessionPath), { recursive: true });
  await writePricingCache(cacheHome);
  const actualUsage = codexUsage();
  const inflatedTotal = codexUsage({
    input_tokens: 11_100_000,
    cached_input_tokens: 10_100_000,
    total_tokens: 12_100_000,
  });
  const lines = [
    codexTurnContextLine(),
    codexUserLine(),
    codexTokenLine({ total: inflatedTotal, last: actualUsage }),
    codexTokenLine({ total: inflatedTotal, last: actualUsage }),
    codexTokenLine({
      timestamp: "2026-06-02T00:00:03.000Z",
      total: { total_tokens: 12_300_000 },
      last: { total_tokens: 200_000 },
    }),
  ];
  await writeFile(sessionPath, `${lines.join("\n")}\n`);

  const output = stripAnsi(
    await runCli(["cost", "--agent", "codex"], {
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
    }),
  );

  assert.match(output, /codex\s+\$35\.05\s+1 req/);
  assert.match(output, /gpt-5\.5\s+\$35\.05/);
});

test("Codex cost includes archived sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-codex-archived-"));
  const cacheHome = join(root, "cache");
  const sessionPath = join(
    root,
    ".codex",
    "archived_sessions",
    "rollout-2026-06-02T00-00-00-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl",
  );

  await mkdir(dirname(sessionPath), { recursive: true });
  await writePricingCache(cacheHome);
  await writeFile(
    sessionPath,
    `${[codexTurnContextLine(), codexUserLine(), codexTokenLine()].join("\n")}\n`,
  );

  const output = stripAnsi(
    await runCli(["cost", "--agent", "codex"], {
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
    }),
  );

  assert.match(output, /codex\s+\$35\.05\s+1 req/);
  assert.match(output, /gpt-5\.5\s+\$35\.05/);
});

test("Codex cost dedupes duplicate rollout files with the same session id", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-codex-rollbacks-"));
  const cacheHome = join(root, "cache");
  const sessionDir = join(root, ".codex", "sessions", "2026", "06", "02");
  const firstPath = join(
    sessionDir,
    "rollout-2026-06-02T00-00-00-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa.jsonl",
  );
  const secondPath = join(
    root,
    ".codex",
    "archived_sessions",
    "rollout-2026-06-02T00-00-03-bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb.jsonl",
  );
  const sessionId = "11111111-1111-1111-1111-111111111111";
  const lines = [
    codexSessionMetaLine(sessionId),
    codexTurnContextLine(),
    codexUserLine(),
    codexTokenLine(),
  ];

  await mkdir(sessionDir, { recursive: true });
  await writePricingCache(cacheHome);
  await writeFile(firstPath, `${lines.join("\n")}\n`);
  await mkdir(dirname(secondPath), { recursive: true });
  await writeFile(secondPath, `${lines.join("\n")}\n`);

  const output = stripAnsi(
    await runCli(["cost", "--agent", "codex"], {
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
    }),
  );

  assert.match(output, /codex\s+\$35\.05\s+1 req/);
  assert.match(output, /gpt-5\.5\s+\$35\.05/);
  assert.doesNotMatch(output, /\$70\.10/);
  assert.doesNotMatch(output, /2 req/);
});

test("Codex cost skips parent usage replayed into subagent rollouts", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-codex-subagent-replay-"));
  const cacheHome = join(root, "cache");
  const sessionPath = join(
    root,
    ".codex",
    "sessions",
    "2026",
    "07",
    "21",
    "rollout-2026-07-21T03-38-56-019f82c1-550e-72f1-b4db-2971ca228cdd.jsonl",
  );
  const childSessionId = "019f82c1-550e-72f1-b4db-2971ca228cdd";
  const parentSessionId = "019f61aa-3eb2-7b11-a7bb-a53ca33339ba";
  const replayedUsage = codexUsage({ input_tokens: 1_200_000, total_tokens: 2_200_000 });
  const lines = [
    codexSessionMetaLine(childSessionId, {
      timestamp: "2026-07-21T03:38:56.193Z",
      threadSource: "subagent",
      parentSessionId,
    }),
    codexSessionMetaLine(parentSessionId, {
      timestamp: "2026-07-21T03:38:56.193Z",
      threadSource: "user",
    }),
    codexTurnContextLine({ timestamp: "2026-07-21T03:38:56.194Z" }),
    codexTokenLine({ timestamp: "2026-07-21T03:38:56.195Z" }),
    codexTaskStartedLine(
      "019f61aa-f912-7400-aba6-28d67b8b739d",
      "2026-07-21T03:38:56.196Z",
      1_784_050_022,
    ),
    codexTokenLine({
      timestamp: "2026-07-21T03:38:56.197Z",
      total: replayedUsage,
      last: replayedUsage,
    }),
    codexTaskStartedLine(
      "019f82c1-5561-7843-aec5-c6d84dcebc38",
      "2026-07-21T03:38:56.228Z",
      1_784_605_136,
    ),
    codexTurnContextLine({ timestamp: "2026-07-21T03:38:56.900Z" }),
    codexTokenLine({ timestamp: "2026-07-21T03:39:05.657Z" }),
  ];

  await mkdir(dirname(sessionPath), { recursive: true });
  await writePricingCache(cacheHome);
  await writeFile(sessionPath, `${lines.join("\n")}\n`);

  const output = stripAnsi(
    await runCli(["cost", "--agent", "codex"], {
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
    }),
  );

  assert.match(output, /codex\s+\$35\.05\s+1 req/);
  assert.match(output, /gpt-5\.5\s+\$35\.05/);
  assert.doesNotMatch(output, /3 req/);
});

test("Codex cost falls back to cumulative totals without last usage", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-codex-legacy-"));
  const cacheHome = join(root, "cache");
  const sessionPath = join(root, ".codex", "sessions", "2026", "06", "02", "rollout-fixture.jsonl");

  await mkdir(dirname(sessionPath), { recursive: true });
  await writePricingCache(cacheHome);
  await writeFile(
    sessionPath,
    `${[
      codexTurnContextLine(),
      codexUserLine(),
      codexTokenLine({ last: null }),
      codexTokenLine({ last: null }),
    ].join("\n")}\n`,
  );

  const output = stripAnsi(
    await runCli(["cost", "--agent", "codex"], {
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
    }),
  );

  assert.match(output, /codex\s+\$35\.05\s+1 req/);
  assert.match(output, /gpt-5\.5\s+\$35\.05/);
});

test("Amp cost reads nested usage ledger entries", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-amp-"));
  const dataHome = join(root, "data");
  const cacheHome = join(root, "cache");
  const threadPath = join(dataHome, "amp", "threads", "thread.json");

  await mkdir(dirname(threadPath), { recursive: true });
  await writePricingCache(cacheHome);
  await writeFile(threadPath, JSON.stringify(ampThreadFixture()));

  const output = stripAnsi(
    await runCli(["cost", "--agent", "amp"], {
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
      XDG_DATA_HOME: dataHome,
    }),
  );

  assert.match(output, /amp\s+\$35\.00\s+1 req/);
  assert.match(output, /gpt-5\.5\s+\$35\.00/);
});

test("Pi cost reads assistant usage from local sessions", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-pi-"));
  const cacheHome = join(root, "cache");
  const sessionPath = join(root, ".pi", "agent", "sessions", "--fixture--", "session.jsonl");

  await mkdir(dirname(sessionPath), { recursive: true });
  await writePricingCache(cacheHome);
  await writeFile(sessionPath, piSessionFixture(Date.now()));

  const output = stripAnsi(
    await runCli(["cost", "--agent", "pi", "--day"], {
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
    }),
  );

  assert.match(output, /pi\s+\$35\.00\s+1 req/);
  assert.match(output, /gpt-5\.5\s+\$35\.00/);
});

test("Cursor scans user prompts and skips assistant-only state", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-cursor-"));
  const configHome = join(root, "config");
  const appData = join(root, "AppData", "Roaming");
  const cursorDirs = cursorUserDirs(root, configHome, appData);
  const statePath = join(
    cursorDirs.mac,
    "workspaceStorage",
    "ws",
    "state.vscdb",
  );

  await mkdir(dirname(statePath), { recursive: true });
  createCursorFixture(statePath);

  const output = stripAnsi(
    await runCli(["scan", "--agent", "cursor"], {
      APPDATA: appData,
      HOME: root,
      XDG_CONFIG_HOME: configHome,
    }),
  );

  assert.match(output, /messages scanned\s+3/);
  assert.match(output, /total swears\s+3/);
  assert.match(output, /fuck\s+1/);
  assert.match(output, /crap\s+2/);
  assert.doesNotMatch(output, /shit\s+1/);
});

test("Cursor discovers macOS, Linux, and Windows storage roots", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-cursor-roots-"));
  const configHome = join(root, "config");
  const appData = join(root, "AppData", "Roaming");
  const cursorDirs = cursorUserDirs(root, configHome, appData);

  for (const [platform, userDir] of Object.entries(cursorDirs)) {
    const statePath = join(userDir, "globalStorage", "state.vscdb");
    await mkdir(dirname(statePath), { recursive: true });
    createCursorPromptFixture(statePath, `${platform} fuck`);
  }

  const output = stripAnsi(
    await runCli(["scan", "--agent", "cursor"], {
      APPDATA: appData,
      HOME: root,
      XDG_CONFIG_HOME: configHome,
    }),
  );

  assert.match(output, /messages scanned\s+3/);
  assert.match(output, /total swears\s+3/);
  assert.match(output, /fuck\s+3/);
});

test("Cursor cost reads modern bubble token usage when present", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-cursor-cost-"));
  const cacheHome = join(root, "cache");
  const configHome = join(root, "config");
  const appData = join(root, "AppData", "Roaming");
  const cursorDirs = cursorUserDirs(root, configHome, appData);
  const statePath = join(cursorDirs.linux, "globalStorage", "state.vscdb");

  await mkdir(dirname(statePath), { recursive: true });
  await writePricingCache(cacheHome);
  createCursorCostFixture(statePath);

  const output = stripAnsi(
    await runCli(["cost", "--agent", "cursor", "--since", "2026-06-01"], {
      APPDATA: appData,
      HOME: root,
      XDG_CACHE_HOME: cacheHome,
      XDG_CONFIG_HOME: configHome,
    }),
  );

  assert.match(output, /cursor\s+\$35\.00\s+1 req/);
  assert.match(output, /gpt-5\.5\s+\$35\.00/);
});

test("Zed scans SQLite agent thread messages", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-zed-sqlite-"));
  const dataHome = join(root, "data");
  const dbDir =
    process.platform === "darwin"
      ? join(root, "Library", "Application Support", "Zed", "db")
      : join(dataHome, "zed", "db");
  const dbPath = join(dbDir, "0-test.db");

  await mkdir(dbDir, { recursive: true });
  createZedSqliteFixture(dbPath);

  const output = stripAnsi(
    await runCli(["scan", "--agent", "zed"], {
      HOME: root,
      XDG_DATA_HOME: dataHome,
    }),
  );

  assert.match(output, /messages scanned\s+1/);
  assert.match(output, /total swears\s+1/);
  assert.match(output, /fuck\s+1/);
});

test("Zed skips SQLite DBs without double-closing native handles", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-zed-sqlite-skip-"));
  const dataHome = join(root, "data");
  const dbDir =
    process.platform === "darwin"
      ? join(root, "Library", "Application Support", "Zed", "db")
      : join(dataHome, "zed", "db");
  const dbPath = join(dbDir, "0-test.db");

  await mkdir(dbDir, { recursive: true });
  createZedSqliteFixture(dbPath, { includeRole: false });

  const output = stripAnsi(
    await runCli(["scan", "--agent", "zed"], {
      DEVRAGE_SQLITE_DRIVER: "node",
      HOME: root,
      XDG_DATA_HOME: dataHome,
    }),
  );

  assert.match(output, /messages scanned\s+0/);
});

test("T3 Code scans projected messages and dedupes usage snapshots", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-t3code-"));
  const cacheHome = join(root, "cache");
  const t3Home = join(root, "t3home");
  const dbPath = join(t3Home, "userdata", "state.sqlite");

  await mkdir(dirname(dbPath), { recursive: true });
  await writePricingCache(cacheHome);
  createT3CodeFixture(dbPath);

  const scanOutput = stripAnsi(
    await runCli(["scan", "--agent", "t3code", "--since", "2026-06-01"], {
      HOME: root,
      T3CODE_HOME: t3Home,
    }),
  );

  assert.match(scanOutput, /messages scanned\s+1/);
  assert.match(scanOutput, /total swears\s+2/);
  assert.match(scanOutput, /fuck\s+1/);
  assert.match(scanOutput, /crap\s+1/);

  const costOutput = stripAnsi(
    await runCli(["cost", "--agent", "t3code", "--since", "2026-06-01"], {
      HOME: root,
      T3CODE_HOME: t3Home,
      XDG_CACHE_HOME: cacheHome,
    }),
  );

  assert.match(costOutput, /t3code\s+\$35\.05\s+1 req/);
  assert.match(costOutput, /gpt-5\.5\s+\$35\.05/);
  assert.doesNotMatch(costOutput, /2 req/);
  assert.doesNotMatch(costOutput, /\$70\.10/);
});

test("T3 Code cost maps Claude Code sessions to Anthropic pricing", async () => {
  const root = await mkdtemp(join(tmpdir(), "devrage-t3code-claude-"));
  const cacheHome = join(root, "cache");
  const t3Home = join(root, "t3home");
  const dbPath = join(t3Home, "userdata", "state.sqlite");

  await mkdir(dirname(dbPath), { recursive: true });
  await writePricingCache(cacheHome, {}, { "claude-fixture": { cost: { input: 1, output: 2 } } });
  createT3CodeFixture(dbPath, {
    providerName: "claudeAgent",
    instanceId: "claudeAgent",
    model: "claude-fixture",
    usage: {
      inputTokens: 1_000_000,
      cachedInputTokens: 0,
      outputTokens: 1_000_000,
      reasoningOutputTokens: 0,
    },
  });

  const output = stripAnsi(
    await runCli(["cost", "--agent", "t3code", "--since", "2026-06-01"], {
      HOME: root,
      T3CODE_HOME: t3Home,
      XDG_CACHE_HOME: cacheHome,
    }),
  );

  assert.match(output, /t3code\s+\$3\.00\s+1 req/);
  assert.match(output, /claude-fixture\s+\$3\.00/);
});

async function runCli(args, env) {
  const result = await runCliResult(args, env);
  return result.stdout;
}

async function runCliResult(args, env) {
  const childEnv = { ...process.env, ...env };
  if (!Object.hasOwn(env, "DEVRAGE_SQLITE_DRIVER")) {
    delete childEnv.DEVRAGE_SQLITE_DRIVER;
  }

  const result = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: childEnv,
  });
  return result;
}

async function hasNodeSqlite() {
  const originalEmitWarning = process.emitWarning;
  process.emitWarning = (warning, ...args) => {
    const message = typeof warning === "string" ? warning : warning.message;
    const type = typeof args[0] === "string" ? args[0] : undefined;
    if (
      message === "SQLite is an experimental feature and might change at any time" &&
      type === "ExperimentalWarning"
    ) {
      return;
    }

    originalEmitWarning(warning, ...args);
  };

  try {
    const sqlite = await import("node:sqlite");
    return typeof sqlite.DatabaseSync === "function";
  } catch {
    return false;
  } finally {
    process.emitWarning = originalEmitWarning;
  }
}

async function readReport(output) {
  const match = output.match(/Report:\s+(file:\/\/\S+)/);
  assert.ok(match, "expected report file URL in cost output");
  assert.match(
    match[1],
    /cost-report-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.html$/,
  );
  return readFile(fileURLToPath(match[1]), "utf-8");
}

async function writePricingCache(cacheHome, extraOpenAiModels = {}, extraAnthropicModels = {}) {
  const cacheDir = join(cacheHome, "devrage");
  await mkdir(cacheDir, { recursive: true });
  await writeFile(
    join(cacheDir, "models.dev.json"),
    `${JSON.stringify({
      source: "models.dev",
      fetchedAt: new Date().toISOString(),
      schemaVersion: 1,
      catalog: {
        openai: {
          models: {
            "gpt-5.5": { cost: { input: 5, output: 30, cache_read: 0.5 } },
            ...extraOpenAiModels,
          },
        },
        anthropic: {
          models: {
            "claude-opus-4-7": {
              cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
            },
            ...extraAnthropicModels,
          },
        },
      },
    })}\n`,
  );
}

function claudeUserLine() {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content: "hello" },
    timestamp: "2026-06-02T00:00:00.000Z",
  });
}

function claudeAssistantLine() {
  return JSON.stringify({
    type: "assistant",
    requestId: "req-1",
    timestamp: "2026-06-02T00:00:01.000Z",
    message: {
      id: "msg-1",
      role: "assistant",
      model: "claude-opus-4-7",
      usage: {
        input_tokens: 1_000_000,
        cache_creation_input_tokens: 1_000_000,
        cache_read_input_tokens: 1_000_000,
        output_tokens: 1_000_000,
      },
    },
  });
}

function codexTurnContextLine(options = {}) {
  return JSON.stringify({
    timestamp: options.timestamp ?? "2026-06-02T00:00:00.000Z",
    type: "turn_context",
    payload: { model: "gpt-5.5" },
  });
}

function codexSessionMetaLine(id, options = {}) {
  const timestamp = options.timestamp ?? "2026-06-02T00:00:00.000Z";
  return JSON.stringify({
    timestamp,
    type: "session_meta",
    payload: {
      id,
      timestamp,
      cwd: "/fixture",
      originator: "codex-tui",
      cli_version: "0.120.0",
      source: "cli",
      model_provider: "openai",
      ...(options.threadSource ? { thread_source: options.threadSource } : {}),
      ...(options.parentSessionId
        ? {
            session_id: options.parentSessionId,
            forked_from_id: options.parentSessionId,
            parent_thread_id: options.parentSessionId,
          }
        : {}),
    },
  });
}

function codexTaskStartedLine(turnId, timestamp, startedAt) {
  return JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: {
      type: "task_started",
      turn_id: turnId,
      started_at: startedAt,
    },
  });
}

function codexUserLine() {
  return JSON.stringify({
    timestamp: "2026-06-02T00:00:01.000Z",
    type: "response_item",
    payload: {
      type: "message",
      role: "user",
      content: [{ type: "input_text", text: "hello" }],
    },
  });
}

function codexUsage(overrides = {}) {
  return {
    input_tokens: 1_100_000,
    cached_input_tokens: 100_000,
    output_tokens: 1_000_000,
    reasoning_output_tokens: 500_000,
    total_tokens: 2_100_000,
    ...overrides,
  };
}

function codexTokenLine(options = {}) {
  const timestamp = options.timestamp ?? "2026-06-02T00:00:02.000Z";
  const total = Object.hasOwn(options, "total") ? options.total : codexUsage();
  const last = Object.hasOwn(options, "last") ? options.last : codexUsage();
  const info = {};

  if (total !== null) {
    info.total_token_usage = total;
  }
  if (last !== null) {
    info.last_token_usage = last;
  }

  return JSON.stringify({
    timestamp,
    type: "event_msg",
    payload: {
      type: "token_count",
      info,
    },
  });
}

function ampThreadFixture() {
  return {
    messages: [{ role: "user", content: "hello", timestamp: "2026-06-02T00:00:00.000Z" }],
    usageLedger: {
      entries: [
        {
          provider: "openai",
          model: "gpt-5.5",
          timestamp: "2026-06-02T00:00:01.000Z",
          usage: {
            inputTokens: 1_000_000,
            outputTokens: 1_000_000,
          },
        },
      ],
    },
  };
}

function piSessionFixture(timestamp) {
  const iso = new Date(timestamp).toISOString();
  return `${JSON.stringify({
    type: "session",
    id: "session-1",
    timestamp: iso,
    cwd: "/fixture",
  })}\n${JSON.stringify({
    type: "message",
    id: "user-1",
    parentId: null,
    timestamp: iso,
    message: {
      role: "user",
      content: "hello",
      timestamp,
    },
  })}\n${JSON.stringify({
    type: "message",
    id: "assistant-1",
    parentId: "user-1",
    timestamp: iso,
    message: {
      role: "assistant",
      provider: "openrouter",
      model: "auto",
      responseModel: "openai/gpt-5.5",
      content: [{ type: "text", text: "done" }],
      timestamp,
      usage: {
        input: 1_000_000,
        output: 1_000_000,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2_000_000,
        cost: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          total: 0,
        },
      },
    },
  })}\n`;
}

function createOpenCodeFixture(
  dbPath,
  timestamp = Date.parse("2026-06-02T00:00:00.000Z"),
  outputTokens = 1_000_000,
) {
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

    db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run(
      "user-1",
      "session-1",
      timestamp,
      timestamp,
      JSON.stringify({ role: "user" }),
    );
    db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?, ?)").run(
      "part-1",
      "user-1",
      "session-1",
      timestamp,
      timestamp,
      JSON.stringify({ type: "text", text: "please fix this" }),
    );
    db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)").run(
      "assistant-1",
      "session-1",
      timestamp,
      timestamp,
      JSON.stringify({
        role: "assistant",
        providerID: "openai",
        modelID: "gpt-5.5",
        cost: 0,
        tokens: { input: 1_000_000, output: outputTokens, cache: { read: 0, write: 0 } },
      }),
    );
  } finally {
    db.close();
  }
}

function createOpenCodeMultiModelFixture(
  dbPath,
  timestamp = Date.parse("2026-06-02T00:00:00.000Z"),
) {
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
    `);

    const insertMessage = db.prepare("INSERT INTO message VALUES (?, ?, ?, ?, ?)");
    for (let index = 0; index < 11; index++) {
      const rank = index + 1;
      insertMessage.run(
        `assistant-${rank}`,
        "session-1",
        timestamp + index,
        timestamp + index,
        JSON.stringify({
          role: "assistant",
          providerID: "openai",
          modelID: `model-${String(rank).padStart(2, "0")}`,
          cost: 0,
          tokens: { input: 0, output: 12_000_000 - rank * 1_000_000 },
        }),
      );
    }
  } finally {
    db.close();
  }
}

function cursorUserDirs(home, configHome, appData) {
  return {
    mac: join(home, "Library", "Application Support", "Cursor", "User"),
    linux: join(configHome, "Cursor", "User"),
    windows: join(appData, "Cursor", "User"),
  };
}

function createCursorFixture(dbPath) {
  const db = new Database(dbPath);
  try {
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
    db.exec("CREATE TABLE cursorDiskKV (key TEXT PRIMARY KEY, value BLOB)");
    db.prepare("INSERT INTO ItemTable VALUES (?, ?)").run(
      "composer.composerData",
      JSON.stringify({
        composerId: "composer-1",
        messages: [
          { role: "user", content: "this is crap", timestamp: "2026-06-02T00:00:00.000Z" },
          { role: "assistant", content: "assistant says shit" },
        ],
      }),
    );
    db.prepare("INSERT INTO ItemTable VALUES (?, ?)").run(
      "aiService.prompts",
      JSON.stringify("please fix this fuck"),
    );
    db.prepare("INSERT INTO cursorDiskKV VALUES (?, ?)").run(
      "composerData:composer-1",
      JSON.stringify({
        composerId: "composer-1",
        modelConfig: { modelName: "gpt-5.5" },
      }),
    );
    db.prepare("INSERT INTO cursorDiskKV VALUES (?, ?)").run(
      "bubbleId:composer-1:user-1",
      JSON.stringify({
        type: 1,
        bubbleId: "user-1",
        text: "modern cursor crap",
        createdAt: "2026-06-02T00:00:02.000Z",
        tokenCount: { inputTokens: 0, outputTokens: 0 },
      }),
    );
    db.prepare("INSERT INTO cursorDiskKV VALUES (?, ?)").run(
      "bubbleId:composer-1:assistant-1",
      JSON.stringify({
        type: 2,
        bubbleId: "assistant-1",
        text: "assistant says shit",
        createdAt: "2026-06-02T00:00:03.000Z",
        tokenCount: { inputTokens: 0, outputTokens: 0 },
      }),
    );
  } finally {
    db.close();
  }
}

function createCursorPromptFixture(dbPath, text) {
  const db = new Database(dbPath);
  try {
    db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB)");
    db.prepare("INSERT INTO ItemTable VALUES (?, ?)").run(
      "aiService.prompts",
      JSON.stringify(text),
    );
  } finally {
    db.close();
  }
}

function createCursorCostFixture(dbPath) {
  const db = new Database(dbPath);
  try {
    db.exec("CREATE TABLE cursorDiskKV (key TEXT, value BLOB)");
    db.prepare("INSERT INTO cursorDiskKV VALUES (?, ?)").run(
      null,
      JSON.stringify({ ignored: true }),
    );
    db.prepare("INSERT INTO cursorDiskKV VALUES (?, ?)").run(
      "composerData:composer-1",
      JSON.stringify({
        composerId: "composer-1",
        modelConfig: { modelName: "gpt-5.5" },
      }),
    );
    db.prepare("INSERT INTO cursorDiskKV VALUES (?, ?)").run(
      "bubbleId:composer-1:assistant-1",
      JSON.stringify({
        type: 2,
        bubbleId: "assistant-1",
        text: "done",
        createdAt: "2026-06-02T00:00:03.000Z",
        tokenCount: { inputTokens: 1_000_000, outputTokens: 1_000_000 },
      }),
    );
  } finally {
    db.close();
  }
}

function createZedSqliteFixture(dbPath, options = {}) {
  const db = new Database(dbPath);
  try {
    if (options.includeRole === false) {
      db.exec("CREATE TABLE messages (content TEXT)");
      db.prepare("INSERT INTO messages VALUES (?)").run("please fix this fuck");
      return;
    }

    db.exec("CREATE TABLE messages (role TEXT, content TEXT)");
    db.prepare("INSERT INTO messages VALUES (?, ?)").run("user", "please fix this fuck");
  } finally {
    db.close();
  }
}

function createT3CodeFixture(dbPath, options = {}) {
  const model = options.model ?? "gpt-5.5";
  const providerName = options.providerName ?? "codex";
  const instanceId = options.instanceId ?? providerName;
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE projection_thread_messages (
        message_id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        turn_id TEXT,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        is_streaming INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE projection_threads (
        thread_id TEXT PRIMARY KEY,
        model_selection_json TEXT
      );
      CREATE TABLE projection_thread_sessions (
        thread_id TEXT PRIMARY KEY,
        provider_name TEXT
      );
      CREATE TABLE orchestration_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id TEXT NOT NULL UNIQUE,
        aggregate_kind TEXT NOT NULL,
        stream_id TEXT NOT NULL,
        stream_version INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        command_id TEXT,
        causation_event_id TEXT,
        correlation_id TEXT,
        actor_kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        metadata_json TEXT NOT NULL
      );
    `);

    db.prepare("INSERT INTO projection_thread_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run(
      "message-1",
      "thread-1",
      null,
      "user",
      "please fix this fuck crap",
      0,
      "2026-06-02T00:00:00.000Z",
      "2026-06-02T00:00:00.000Z",
    );
    db.prepare("INSERT INTO projection_threads VALUES (?, ?)").run(
      "thread-1",
      JSON.stringify({ instanceId, model }),
    );
    db.prepare("INSERT INTO projection_thread_sessions VALUES (?, ?)").run("thread-1", providerName);

    const insertEvent = db.prepare(`
      INSERT INTO orchestration_events (
        event_id,
        aggregate_kind,
        stream_id,
        stream_version,
        event_type,
        occurred_at,
        command_id,
        causation_event_id,
        correlation_id,
        actor_kind,
        payload_json,
        metadata_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const payload = t3UsagePayload("usage-1", options.usage);
    insertEvent.run(
      "event-usage-1",
      "thread",
      "thread-1",
      0,
      "thread.activity-appended",
      "2026-06-02T00:00:01.000Z",
      null,
      null,
      null,
      "provider",
      JSON.stringify(payload),
      "{}",
    );
    insertEvent.run(
      "event-usage-duplicate",
      "thread",
      "thread-1",
      1,
      "thread.activity-appended",
      "2026-06-02T00:00:02.000Z",
      null,
      null,
      null,
      "provider",
      JSON.stringify(t3UsagePayload("usage-duplicate", options.usage)),
      "{}",
    );
  } finally {
    db.close();
  }
}

function t3UsagePayload(activityId, usage = {}, options = {}) {
  const inputTokens = usage.inputTokens ?? 1_100_000;
  const cachedInputTokens = usage.cachedInputTokens ?? 100_000;
  const outputTokens = usage.outputTokens ?? 1_000_000;
  const reasoningOutputTokens = usage.reasoningOutputTokens ?? 0;
  const usedTokens = inputTokens + outputTokens;
  const turnId = options.turnId ?? "turn-1";
  return {
    threadId: "thread-1",
    activity: {
      id: activityId,
      createdAt: "2026-06-02T00:00:01.000Z",
      tone: "info",
      kind: "context-window.updated",
      summary: "Context window updated",
      turnId,
      payload: {
        usedTokens,
        totalProcessedTokens: usedTokens,
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningOutputTokens,
        lastUsedTokens: usedTokens,
        lastInputTokens: inputTokens,
        lastCachedInputTokens: cachedInputTokens,
        lastOutputTokens: outputTokens,
        lastReasoningOutputTokens: reasoningOutputTokens,
        compactsAutomatically: true,
      },
    },
  };
}

function stripAnsi(value) {
  return value.replace(ANSI_PATTERN, "").replace(/\r/g, "");
}

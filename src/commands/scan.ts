import { allAdapters, createAdapter } from "../adapters/index";
import { detect } from "../detector/index";

// ANSI color helpers — no dependencies needed
const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

const SPINNER_MESSAGES = [
  "Tallying the damage",
  "Reviewing your outbursts",
  "Judging your vocabulary",
  "Computing your shame",
  "Cataloging the profanity",
  "Measuring your frustration",
  "Assessing the verbal carnage",
  "Quantifying your displeasure",
  "Auditing your language",
  "Tabulating regrets",
];

function createSpinner() {
  let messageIdx = 0;
  let dotCount = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  return {
    start() {
      messageIdx = Math.floor(Math.random() * SPINNER_MESSAGES.length);
      timer = setInterval(() => {
        dotCount = (dotCount + 1) % 4;
        const msg = SPINNER_MESSAGES[messageIdx % SPINNER_MESSAGES.length];
        const dots = ".".repeat(dotCount || 1);
        process.stdout.write(
          `\r  ${c.dim}${msg}${dots}${c.reset}   `,
        );
      }, 300);
    },
    update() {
      messageIdx++;
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      process.stdout.write("\r" + " ".repeat(60) + "\r");
    },
  };
}

interface ScanOptions {
  agent?: string;
  since?: Date;
}

function parseArgs(args: string[]): ScanOptions {
  const options: ScanOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--agent" || arg === "-a") {
      options.agent = args[++i];
    } else if (arg === "--since" || arg === "-s") {
      const val = args[++i];
      if (val) {
        options.since = new Date(val);
        if (isNaN(options.since.getTime())) {
          console.error(`invalid date: ${val}`);
          process.exit(1);
        }
      }
    } else if (arg === "--help" || arg === "-h") {
      console.log(`devrage scan — scan sessions for profanity

Options:
  --agent, -a <name>   Scan only a specific agent (claude, codex, opencode, amp, cline, zed, pi)
  --since, -s <date>   Only scan messages after this date (ISO 8601)
  --help, -h           Show this help`);
      process.exit(0);
    }
  }

  return options;
}

export async function scan(args: string[]): Promise<void> {
  const options = parseArgs(args);

  const adapters = options.agent
    ? [createAdapter(options.agent)]
    : allAdapters();

  const spinner = createSpinner();
  spinner.start();

  const groupTally: Record<string, number> = {};
  const variantTally: Record<string, Record<string, number>> = {};

  let totalMessages = 0;
  let totalSwears = 0;
  const perAgent: Record<string, { messages: number; swears: number }> = {};

  for (const adapter of adapters) {
    let agentMessages = 0;
    let agentSwears = 0;
    spinner.update();

    for await (const message of adapter.messages({ since: options.since })) {
      totalMessages++;
      agentMessages++;

      const result = detect(message.text);
      if (result.count > 0) {
        totalSwears += result.count;
        agentSwears += result.count;

        for (const match of result.matches) {
          groupTally[match.group] = (groupTally[match.group] ?? 0) + 1;

          const variants = (variantTally[match.group] ??= {});
          variants[match.word] = (variants[match.word] ?? 0) + 1;
        }
      }
    }

    if (agentMessages > 0) {
      perAgent[adapter.name] = { messages: agentMessages, swears: agentSwears };
    }
  }

  spinner.stop();

  // Report
  console.log("");
  console.log(`  ${c.bold}${c.red}devrage${c.reset} ${c.dim}report${c.reset}`);
  console.log(`  ${c.dim}${"─".repeat(30)}${c.reset}`);
  console.log("");
  console.log(`  ${c.dim}messages scanned${c.reset}  ${c.bold}${totalMessages}${c.reset}`);
  console.log(`  ${c.dim}total swears${c.reset}      ${c.bold}${c.red}${totalSwears}${c.reset}`);

  const activeAgents = Object.entries(perAgent);
  if (activeAgents.length > 1) {
    console.log("");
    console.log(`  ${c.bold}by agent${c.reset}`);
    for (const [name, stats] of activeAgents) {
      const rate = ((stats.swears / stats.messages) * 100).toFixed(1);
      console.log(
        `    ${c.cyan}${name.padEnd(10)}${c.reset} ${c.bold}${String(stats.swears).padStart(4)}${c.reset} ${c.dim}in ${stats.messages} messages (${rate}%)${c.reset}`,
      );
    }
  }

  if (totalSwears > 0) {
    const sorted = Object.entries(groupTally).sort(([, a], [, b]) => b - a);
    console.log("");
    console.log(`  ${c.bold}top words${c.reset}`);
    for (const [group, count] of sorted.slice(0, 10)) {
      const variants = variantTally[group] ?? {};
      const variantList = Object.entries(variants)
        .sort(([, a], [, b]) => b - a)
        .filter(([v]) => v !== group)
        .slice(0, 15)
        .map(([v, cnt]) => `${c.dim}${v}${c.reset} ${cnt}`)
        .join(`${c.dim},${c.reset} `);
      const suffix = variantList ? ` ${c.dim}(${c.reset}${variantList}${c.dim})${c.reset}` : "";
      console.log(
        `    ${c.yellow}${group.padEnd(12)}${c.reset} ${c.bold}${String(count).padStart(4)}${c.reset}${suffix}`,
      );
    }
  }

  console.log("");
  if (totalSwears === 0) {
    console.log(`  ${c.green}squeaky clean! not a single swear found.${c.reset}`);
    console.log("");
  }
}



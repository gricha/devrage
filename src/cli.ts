import { cost, scan, slop } from "./commands/scan";

const COMMANDS: Record<string, (args: string[]) => Promise<void>> = {
  cost,
  scan,
  slop,
};

const OPTIONS_WITH_VALUES = new Set(["--agent", "-a", "--since", "-s"]);

interface ParsedCommand {
  handler: (args: string[]) => Promise<void>;
  args: string[];
}

function usage(): void {
  console.log(`devrage — measure rage, cost, and AI slop in coding-agent sessions

Usage:
  devrage <command> [options]

Commands:
  cost          Show API-equivalent coding agent cost
  scan          Scan sessions for profanity
  slop          Scan agent responses for common AI-isms

Options:
  --help, -h    Show this help message
  --version     Show version

Examples:
  devrage cost
  devrage scan
  devrage slop
  devrage scan --agent claude
  devrage slop --agent codex
  devrage scan --since 2025-01-01`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "--help" || command === "-h") {
    usage();
    process.exit(0);
  }

  if (command === "--version") {
    console.log("0.6.3");
    process.exit(0);
  }

  // If no command is present, default to scan for the original no-subcommand UX.
  const parsed = parseCommand(args);
  if (parsed) {
    await parsed.handler(parsed.args);
  } else {
    // Pass all args through to scan (covers both no-arg and unknown-arg cases)
    await scan(args);
  }
}

function parseCommand(args: string[]): ParsedCommand | null {
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg) {
      continue;
    }

    const handler = COMMANDS[arg];
    if (handler) {
      return {
        handler,
        args: [...args.slice(0, index), ...args.slice(index + 1)],
      };
    }

    if (OPTIONS_WITH_VALUES.has(arg) && index + 1 < args.length) {
      index++;
    }
  }

  return null;
}

main().catch((err: unknown) => {
  console.error(err);
  process.exit(1);
});

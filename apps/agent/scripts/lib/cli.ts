// Tiny subcommand dispatcher shared by the scripts/ CLIs (corpus, …).
//
// Each command module exports a `Command`: name, one-line summary, its
// options (for generated help), and a run(argv) that receives only the args
// after the command name. The dispatcher handles `--help`/`-h` at both
// levels so every option is discoverable without reading source.

export interface CliOption {
  /** e.g. `--strict` or `--mode auto|fts|vector|hybrid` */
  flag: string;
  desc: string;
}

export interface Command {
  name: string;
  summary: string;
  /** Args shown after the command name in usage, e.g. `"query"` */
  usage?: string;
  options?: CliOption[];
  run(argv: string[]): Promise<void>;
}

interface Cli {
  /** How the user invokes this from the repo root, e.g. `npm run corpus --` */
  bin: string;
  description: string;
  commands: Command[];
}

function printCliHelp(cli: Cli): void {
  console.log(`${cli.description}\n`);
  console.log(`usage: ${cli.bin} <command> [options]\n`);
  console.log("commands:");
  const width = Math.max(...cli.commands.map((c) => c.name.length));
  for (const c of cli.commands) {
    console.log(`  ${c.name.padEnd(width)}  ${c.summary}`);
  }
  console.log(`\nRun \`${cli.bin} <command> --help\` for that command's options.`);
}

function printCommandHelp(cli: Cli, cmd: Command): void {
  console.log(`${cmd.summary}\n`);
  console.log(`usage: ${cli.bin} ${cmd.name}${cmd.usage ? ` ${cmd.usage}` : ""}${cmd.options?.length ? " [options]" : ""}`);
  if (cmd.options?.length) {
    console.log("\noptions:");
    const width = Math.max(...cmd.options.map((o) => o.flag.length));
    for (const o of cmd.options) {
      console.log(`  ${o.flag.padEnd(width)}  ${o.desc}`);
    }
  }
}

export async function runCli(cli: Cli): Promise<void> {
  const [name, ...rest] = process.argv.slice(2);

  if (!name || name === "help" || name === "--help" || name === "-h") {
    printCliHelp(cli);
    return;
  }

  const cmd = cli.commands.find((c) => c.name === name);
  if (!cmd) {
    console.error(`unknown command: ${name}\n`);
    printCliHelp(cli);
    process.exit(1);
  }

  if (rest.includes("--help") || rest.includes("-h")) {
    printCommandHelp(cli, cmd);
    return;
  }

  try {
    await cmd.run(rest);
  } catch (err) {
    const msg =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null
          ? JSON.stringify(err)
          : String(err);
    console.error(`[${cli.bin.replace(/^npm run /, "").replace(" --", "")} ${cmd.name}] failed: ${msg}`);
    process.exit(1);
  }
}

#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const agents = {
  claude: {
    name: "Claude",
    command: "claude",
    versionArgs: ["--version"],
    usage: "Dentro Claude: /usage",
  },
  codex: {
    name: "Codex",
    command: "codex",
    versionArgs: ["--version"],
    usage: "Dentro Codex: /status",
  },
  gemini: {
    name: "Gemini",
    command: "gemini",
    versionArgs: ["--version"],
    usage: "Dentro Gemini: /stats model",
  },
  copilot: {
    name: "Copilot",
    command: "copilot",
    versionArgs: ["--version"],
    usage: "Dentro Copilot: /usage",
  },
};

function run(command, args = []) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function installed(agent) {
  const result = run("which", [agent.command]);
  return !!result;
}

function version(agent) {
  if (!installed(agent)) return "non installato";
  return run(agent.command, agent.versionArgs) || "versione non disponibile";
}

function statusIcon(agent) {
  return installed(agent) ? "🟢" : "🔴";
}

function printStatus() {
  console.log("");
  console.log("╔════════════════════════════════════════════════════════════════╗");
  console.log("║                     GYMIN · AI HUB                             ║");
  console.log("╠════════════╦══════════════════════╦════════════╦═══════════════╣");
  console.log("║ AGENTE     ║ VERSIONE             ║ STATO      ║ QUOTA/USAGE   ║");
  console.log("╠════════════╬══════════════════════╬════════════╬═══════════════╣");

  for (const agent of Object.values(agents)) {
    const v = version(agent).replace(/\n/g, " ").slice(0, 20);
    const state = installed(agent) ? "DISPONIBILE" : "ASSENTE";
    const usage = installed(agent) ? agent.usage : "-";

    console.log(
      `║ ${agent.name.padEnd(10)} ║ ${v.padEnd(20)} ║ ${statusIcon(agent)} ${state.padEnd(8)} ║ ${usage.padEnd(13)} ║`
    );
  }

  console.log("╚════════════╩══════════════════════╩════════════╩═══════════════╝");
  console.log("");
  console.log("NOTA: il dashboard non inventa quote.");
  console.log("Mostra i comandi ufficiali per leggere l'utilizzo live di ciascun agente.");
  console.log("");
}

function launch(name) {
  const agent = agents[name];

  if (!agent) {
    console.error(`Agente sconosciuto: ${name}`);
    console.error(`Disponibili: ${Object.keys(agents).join(", ")}`);
    process.exit(1);
  }

  if (!installed(agent)) {
    console.error(`${agent.name} non è installato.`);
    process.exit(1);
  }

  console.log(`\nAvvio ${agent.name}...\n`);

  const child = process.spawn(agent.command, process.argv.slice(3), {
    stdio: "inherit",
    shell: false,
  });

  child.on("exit", code => {
    process.exit(code ?? 0);
  });
}

const command = process.argv[2] || "status";

if (command === "status") {
  printStatus();
} else if (agents[command]) {
  launch(command);
} else if (command === "help" || command === "--help" || command === "-h") {
  console.log(`
GYMIN AI HUB

Comandi:

  npm run ai -- status       Mostra lo stato dei 4 agenti
  npm run ai -- claude       Avvia Claude Code
  npm run ai -- codex        Avvia Codex CLI
  npm run ai -- gemini       Avvia Gemini CLI
  npm run ai -- copilot      Avvia GitHub Copilot CLI

Esempi:

  npm run ai -- status
  npm run ai -- claude
  npm run ai -- codex
  npm run ai -- gemini
  npm run ai -- copilot
`);
} else {
  console.error(`Comando sconosciuto: ${command}`);
  console.error("Usa: npm run ai -- help");
  process.exit(1);
}

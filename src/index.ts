import { loadConfig } from "./config";
import { runBot } from "./bot";

async function main(): Promise<void> {
  const config = loadConfig();
  await runBot(config);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});


/**
 * One-shot laptop roster import, for running from a shell inside the
 * container (sprint 002 "laptop accounts" T003):
 *
 *   npm run import:laptop-roster -- --group "Botball 26"
 *
 * Uses the same service the admin endpoint uses, with a null actor. Prints
 * the ImportReport as JSON and exits 1 when any entry errored, 2 when the
 * roster is not configured or the import could not start.
 */

import '../env.js';
import { initPrisma } from '../services/prisma.js';
import { ServiceRegistry } from '../services/service.registry.js';
import { DEFAULT_IMPORT_GROUP_NAME } from '../services/laptop/laptop-roster-import.service.js';

function parseArgs(argv: string[]): { groupName: string } {
  let groupName = DEFAULT_IMPORT_GROUP_NAME;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--group' || arg === '-g') {
      const value = argv[i + 1];
      if (!value) {
        console.error('--group requires a value');
        process.exit(2);
      }
      groupName = value;
      i++;
    } else if (arg.startsWith('--group=')) {
      groupName = arg.slice('--group='.length);
    } else if (arg === '--help' || arg === '-h') {
      console.log('Usage: npm run import:laptop-roster -- [--group "Botball 26"]');
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      process.exit(2);
    }
  }
  if (!groupName.trim()) {
    console.error('--group must not be blank');
    process.exit(2);
  }
  return { groupName: groupName.trim() };
}

async function main(): Promise<number> {
  const { groupName } = parseArgs(process.argv.slice(2));
  await initPrisma();
  const registry = ServiceRegistry.create('SYSTEM');

  console.error(`Importing laptop roster into group "${groupName}"...`);
  const report = await registry.laptopRosterImport.importAll(null, { groupName });

  console.log(JSON.stringify(report, null, 2));
  console.error(
    `created ${report.created}, matched ${report.matched}, skipped ${report.skipped}, errors ${report.errors}`,
  );
  return report.errors > 0 ? 1 : 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(2);
  });

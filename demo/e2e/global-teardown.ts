// Playwright global teardown (#121): runs demo reset after the suite, pass or
// fail, so the stack is back in the seeded state. The suite confirms the cart,
// adds a grocery item and completes chores, so without this the next demo
// would start from the test's leftovers.
//
// demo verify sets BUTLER_DEMO_CLI to the script it was run as (demo.sh or
// demo.ps1). Run by hand (npx playwright test in demo/e2e), the default is the
// platform's script next to this folder.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

export default async function globalTeardown(): Promise<void> {
  const cli =
    process.env.BUTLER_DEMO_CLI ?? path.resolve(__dirname, '..', process.platform === 'win32' ? 'demo.ps1' : 'demo.sh');
  const [command, args] = cli.toLowerCase().endsWith('.ps1')
    ? ['pwsh', ['-NoProfile', '-File', cli, 'reset']]
    : ['bash', [cli, 'reset']];

  console.log('Resetting the demo stack (demo reset) ...');
  const result = spawnSync(command, args, { stdio: 'inherit', env: process.env });
  if (result.error || result.status !== 0) {
    throw new Error('demo reset failed after the browser suite. Run demo reset by hand.');
  }
}

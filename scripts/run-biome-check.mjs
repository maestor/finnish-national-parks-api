import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const biomeBinary =
  process.env.BIOME_BINARY ??
  (process.platform === 'win32' ? 'node_modules/.bin/biome.cmd' : 'node_modules/.bin/biome');

const result = spawnSync(
  biomeBinary,
  ['check', '--error-on-warnings', '--reporter=json', ...args],
  {
    cwd: process.cwd(),
    encoding: 'utf8'
  }
);

if (result.stdout) {
  process.stdout.write(result.stdout);
}

if (result.stderr) {
  process.stderr.write(result.stderr);
}

if (result.error) {
  throw result.error;
}

const parseReport = (stdout) => {
  const jsonStart = stdout.indexOf('{');

  if (jsonStart === -1) {
    return null;
  }

  try {
    return JSON.parse(stdout.slice(jsonStart));
  } catch {
    return null;
  }
};

const report = parseReport(result.stdout ?? '');

if (!report?.summary) {
  process.stderr.write('Failed to parse Biome diagnostics output.\n');
  process.exit(result.status ?? 1);
}

if (report.summary.infos > 0) {
  process.stderr.write(
    'Biome emitted info-level diagnostics. Treating them as a failed lint gate.\n'
  );
  process.exit(1);
}

process.exit(result.status ?? 0);

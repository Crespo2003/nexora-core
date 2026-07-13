import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

const trackedFiles = git(['ls-files', '--cached', '--others', '--exclude-standard']).split(/\r?\n/).filter(Boolean);
const forbiddenTracked = [
  /(^|\/)(node_modules|\.next|dist|build|out|local-uploads|uploaded-documents|test-documents)(\/|$)/,
  /\.(zip|rar|7z|tmp)$/i,
  /(^|\/)(Thumbs\.db|\.DS_Store)$/i,
  /(^|\/)\.env(\.|$)/
];

const unwanted = trackedFiles.filter((file) => forbiddenTracked.some((pattern) => pattern.test(file)));
assert.deepEqual(unwanted, [], `Forbidden files are tracked:\n${unwanted.join('\n')}`);

const sourceFiles = trackedFiles.filter((file) =>
  file !== 'scripts/premerge-lint.mjs' &&
  /^(app|lib|scripts|supabase)\//.test(file) &&
  /\.(ts|tsx|js|mjs|sql)$/.test(file)
);

const debugPattern = new RegExp(
  String.raw`\b(` + 'debug' + 'ger|' + 'console' + String.raw`\.(log|debug|trace))\b|TO` + 'DO|FIX' + 'ME'
);
const debugHits = sourceFiles.flatMap((file) => {
  return read(file)
    .split(/\r?\n/)
    .map((line, index) => ({ file, line, index: index + 1 }))
    .filter(({ line }) => debugPattern.test(line))
    .map(({ file: hitFile, line, index }) => `${hitFile}:${index}: ${line.trim()}`);
});
assert.deepEqual(debugHits, [], `Debug or unfinished markers found:\n${debugHits.join('\n')}`);

const secretPattern = new RegExp(
  [
    String.raw`service[_-]?` + 'role',
    'supabase_' + 'service',
    String.raw`jwt[_-]?` + 'secret',
    String.raw`password\s*=`,
    'pass' + 'wd',
    String.raw`secret\s*=`,
    String.raw`token\s*=`,
    String.raw`bearer\s+[a-z0-9._-]+`,
    String.raw`eyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.`
  ].join('|'),
  'i'
);
const secretHits = sourceFiles.flatMap((file) => {
  return read(file)
    .split(/\r?\n/)
    .map((line, index) => ({ file, line, index: index + 1 }))
    .filter(({ line }) => secretPattern.test(line))
    .map(({ file: hitFile, line, index }) => `${hitFile}:${index}: ${line.trim()}`);
});
assert.deepEqual(secretHits, [], `Secret-looking strings found:\n${secretHits.join('\n')}`);

const gitignore = read('.gitignore');
for (const required of [
  'node_modules/',
  '.next/',
  'dist/',
  'out/',
  'build/',
  '*.zip',
  '*.rar',
  '*.7z',
  '*.tmp',
  'Thumbs.db',
  '.DS_Store',
  'uploaded-documents/',
  'local-uploads/',
  'test-documents/',
  '.env',
  '.env.*',
  '!.env.example'
]) {
  assert.ok(gitignore.includes(required), `.gitignore is missing ${required}`);
}

process.stdout.write('Pre-merge lint checks passed.\n');

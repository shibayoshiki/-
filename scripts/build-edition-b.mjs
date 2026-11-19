import { readFileSync, writeFileSync } from 'node:fs';

const source = new URL('../index.html', import.meta.url);
const target = new URL('../b.html', import.meta.url);
const editionA = readFileSync(source, 'utf8');
const editionB = '<!-- Generated from index.html by scripts/build-edition-b.mjs. -->\n' +
  editionA.replace('data-edition="A"', 'data-edition="B"')
    .replace('<title>教員マッチングアプリ（試作）</title>', '<title>教員マッチングアプリ B版（試作）</title>');

if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8') !== editionB) {
    console.error('b.html is out of date. Run node scripts/build-edition-b.mjs.');
    process.exitCode = 1;
  }
} else {
  writeFileSync(target, editionB);
}

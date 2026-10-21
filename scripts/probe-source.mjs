// Static text probe for explicitly selected shipped source. Does not execute it.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const [path, mode, query, length = '2000'] = process.argv.slice(2);
const bytes = readFileSync(path);
const source = bytes.toString('utf8');
console.log(JSON.stringify({ path, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length }));
if (mode === 'range') {
  const start = Number(query), size = Number(length);
  console.log(JSON.stringify({ start, end: start + size, text: source.slice(start, start + size) }, null, 2));
} else if (mode === 'search') {
  const re = new RegExp(query, 'g');
  let match, count = 0;
  while ((match = re.exec(source)) && count++ < 50) {
    console.log(JSON.stringify({ start: Math.max(0, match.index - 200), match: match.index, text: source.slice(Math.max(0, match.index - 200), match.index + Number(length)) }));
    if (!match[0].length) re.lastIndex++;
  }
} else throw new Error('Usage: probe-source.mjs PATH range START LENGTH | search REGEX CONTEXT');

// Read-only ASAR inventory/excerpts. Never imports or executes application code.
import { openSync, readSync, closeSync } from 'node:fs';
const path = process.argv[2];
const selected = process.argv[3];
const pattern = process.argv[4];
const fd = openSync(path, 'r');
try {
  const prefix = Buffer.alloc(16);
  readSync(fd, prefix, 0, 16, 0);
  const headerSize = prefix.readUInt32LE(4);
  const jsonSize = prefix.readUInt32LE(12);
  const header = Buffer.alloc(jsonSize);
  readSync(fd, header, 0, jsonSize, 16);
  const tree = JSON.parse(header.toString());
  const files = [];
  function walk(node, name = '') {
    for (const [key, value] of Object.entries(node.files || {})) {
      const p = name ? name + '/' + key : key;
      if (value.files) walk(value, p);
      else files.push({ path: p, ...value });
    }
  }
  walk(tree);
  if (!selected) {
    console.log(JSON.stringify(files.filter(f => !f.path.includes('node_modules/')).map(({path,size,unpacked}) => ({path,size,unpacked})), null, 2));
  } else {
    const file = files.find(f => f.path === selected);
    if (!file || file.unpacked || file.link) throw new Error('No packed regular file: ' + selected);
    const data = Buffer.alloc(file.size);
    readSync(fd, data, 0, file.size, 8 + headerSize + Number(file.offset));
    const source = data.toString();
    if (!pattern) console.log(source);
    else {
      const re = new RegExp(pattern, 'gi');
      let match; let count = 0;
      while ((match = re.exec(source)) && count++ < 80) {
        console.log(JSON.stringify({ file: selected, offset: match.index, excerpt: source.slice(Math.max(0, match.index - 250), match.index + 650) }));
      }
    }
  }
} finally { closeSync(fd); }

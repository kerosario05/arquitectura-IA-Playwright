const fs = require('fs');
const content = fs.readFileSync('src/discovery/case-discovery.ts', 'utf8');
const lines = content.split('\n');

let count = 0;
for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
  const line = lines[lineNum - 1];
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = i + 1 < line.length ? line[i + 1] : '';

    if (ch === '"' || ch === "'") {
      const startCh = ch;
      i++;
      while (i < line.length) {
        if (line[i] === '\\') { i += 2; continue; }
        if (line[i] === startCh) break;
        i++;
      }
      continue;
    }
    if (ch === '`') {
      i++;
      let depth = 0;
      while (i < line.length) {
        if (line[i] === '\\') { i += 2; continue; }
        if (line[i] === '`') break;
        if (line[i] === '$' && line[i + 1] === '{') { depth++; i += 2; continue; }
        if (line[i] === '}' && depth > 0) { depth--; i++; continue; }
        i++;
      }
      continue;
    }
    if (ch === '/' && next === '/') break;
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < line.length - 1) {
        if (line[i] === '*' && line[i + 1] === '/') { i += 2; break; }
        i++;
      }
      continue;
    }

    if (ch === '{') count++;
    else if (ch === '}') count--;
  }
}
console.log('Final count: ' + count);

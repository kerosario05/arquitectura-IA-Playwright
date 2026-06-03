const fs = require('fs');
const content = fs.readFileSync('src/discovery/case-discovery.ts', 'utf8');
const lines = content.split('\n');

let count = 0;
const stack = [];
let inLineComment = false, inBlockComment = false, inString = false, inTemplate = false;
let stringChar = '';
let templateDepth = 0;

for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
  const line = lines[lineNum - 1];
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = i + 1 < line.length ? line[i + 1] : '';

    if (inLineComment) continue;
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i++; }
      continue;
    }
    if (inString) {
      if (ch === '\\') { i++; continue; }
      if (ch === stringChar) inString = false;
      continue;
    }
    if (inTemplate) {
      if (ch === '\\') { i++; continue; }
      if (ch === '`') { inTemplate = false; continue; }
      if (ch === '$' && next === '{') {
        templateDepth++;
        stack.push({ line: lineNum, type: 'template' });
        i++;
        continue;
      }
      if (ch === '}' && templateDepth > 0) {
        templateDepth--;
        if (stack.length && stack[stack.length - 1].type === 'template') stack.pop();
        continue;
      }
      continue;
    }

    if (ch === '/' && next === '/') { inLineComment = true; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue; }
    if (ch === '`') { inTemplate = true; continue; }

    if (ch === '{') {
      count++;
      stack.push({ line: lineNum, col: i + 1, snippet: line.trim().substring(0, 50) });
    } else if (ch === '}') {
      count--;
      if (stack.length) stack.pop();
    }
  }
  inLineComment = false;
}

console.log('Final count: ' + count);
console.log('Open stack:');
for (const e of stack) {
  console.log('  Line ' + e.line + ' col ' + e.col + ': ' + e.snippet);
}

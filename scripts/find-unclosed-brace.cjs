const fs = require('fs');
const content = fs.readFileSync('src/discovery/case-discovery.ts', 'utf8');
const lines = content.split('\n');

let count = 0;
let inString = false;
let stringChar = '';
let inLineComment = false;
let inBlockComment = false;
let inTemplate = false;
let templateExprDepth = 0;
const stack = [];

for (let lineNum = 1; lineNum <= lines.length; lineNum++) {
  const line = lines[lineNum - 1];
  let i = 0;
  while (i < line.length) {
    const ch = line[i];
    const next = i + 1 < line.length ? line[i + 1] : '';

    if (inLineComment) { i++; continue; }
    if (inBlockComment) {
      if (ch === '*' && next === '/') { inBlockComment = false; i += 2; continue; }
      i++; continue;
    }
    if (inString) {
      if (ch === String.fromCharCode(92)) { i += 2; continue; }
      if (ch === stringChar) { inString = false; }
      i++; continue;
    }
    if (inTemplate) {
      if (ch === String.fromCharCode(92)) { i += 2; continue; }
      if (ch === '`') { inTemplate = false; i++; continue; }
      if (ch === '$' && next === '{') {
        templateExprDepth++;
        stack.push({ line: lineNum, type: 'templateExpr' });
        i += 2; continue;
      }
      if (ch === '}' && templateExprDepth > 0) {
        templateExprDepth--;
        if (stack.length > 0 && stack[stack.length - 1].type === 'templateExpr') stack.pop();
        i++; continue;
      }
      i++; continue;
    }

    if (ch === '/' && next === '/') { inLineComment = true; i += 2; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i += 2; continue; }
    if (ch === '"' || ch === "'") { inString = true; stringChar = ch; i++; continue; }
    if (ch === '`') { inTemplate = true; i++; continue; }

    if (ch === '{') {
      count++;
      stack.push({ line: lineNum, col: i + 1, snippet: line.trim().substring(0, 60) });
    } else if (ch === '}') {
      count--;
      if (stack.length > 0) {
        const popped = stack.pop();
        if (count < 0) {
          console.log('NEGATIVE at line ' + lineNum);
          console.log('  Current: ' + line.trim());
          console.log('  Prev open: line ' + popped.line + ' ' + popped.snippet);
          process.exit(1);
        }
      } else {
        console.log('UNEXPECTED CLOSE at line ' + lineNum + ': ' + line.trim());
        process.exit(1);
      }
    }
    i++;
  }
  inLineComment = false;
}
console.log('Final count: ' + count);
console.log('Open stack:');
for (const entry of stack) {
  console.log('  Line ' + entry.line + ' col ' + entry.col + ': ' + entry.snippet);
}

const fs = require('fs');
const path = require('path');

const filePath = 'src/discovery/case-discovery.ts';
const content = fs.readFileSync(filePath, 'utf8');
const lines = content.split('\n');

function countBraces(text) {
  let count = 0;
  let inString = false, stringChar = '';
  let inTemplate = false, templateDepth = 0;
  let inBlockComment = false, inLineComment = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = i + 1 < text.length ? text[i + 1] : '';

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      continue;
    }
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
      if (ch === '$' && next === '{') { templateDepth++; i++; continue; }
      if (ch === '}' && templateDepth > 0) { templateDepth--; continue; }
      continue;
    }

    if (ch === '/' && next === '/') { inLineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { inBlockComment = true; i++; continue; }
    if (ch === '"' || ch === "'") { inString = true; stringChar = ch; continue; }
    if (ch === '`') { inTemplate = true; continue; }

    if (ch === '{') count++;
    else if (ch === '}') count--;
  }
  return count;
}

// Find the problematic section by binary search
// The file has an extra { somewhere which creates +1 balance
// If we remove a problematic section, the balance should change

const totalLines = lines.length;
const sectionSize = Math.ceil(totalLines / 10);

// Try removing each section and check if the count changes from +1 to 0
const originalCount = countBraces(content);
console.log('Original count: ' + originalCount);

for (let section = 0; section < 10; section++) {
  const start = section * sectionSize + 1;
  const end = Math.min((section + 1) * sectionSize, totalLines);

  // Replace the section with a simple balanced replacement
  const before = lines.slice(0, start - 1).join('\n');
  const after = lines.slice(end).join('\n');
  const replacement = '{\n// SECTION ' + section + ' REPLACED\n}'; // balanced: { ... }
  const modified = before + '\n' + replacement + '\n' + after;

  const result = countBraces(modified);
  if (result < originalCount) {
    console.log('Section ' + section + ' (lines ' + start + '-' + end + '): count changed from ' + originalCount + ' to ' + result);
  }
}

// Now let's also try to find the EXACT line
let runningCount = 0;
let inString2 = false, stringChar2 = '';
let inTemplate2 = false, templateDepth2 = 0;
let inBlockComment2 = false, inLineComment2 = false;

for (let lineNum = 1; lineNum <= totalLines; lineNum++) {
  const line = lines[lineNum - 1];
  let lineOpens = 0, lineCloses = 0;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = i + 1 < line.length ? line[i + 1] : '';

    if (inLineComment2) break;
    if (inBlockComment2) {
      if (ch === '*' && next === '/') { inBlockComment2 = false; i++; }
      continue;
    }
    if (inString2) {
      if (ch === '\\') { i++; continue; }
      if (ch === stringChar2) inString2 = false;
      continue;
    }
    if (inTemplate2) {
      if (ch === '\\') { i++; continue; }
      if (ch === '`') { inTemplate2 = false; continue; }
      if (ch === '$' && next === '{') { templateDepth2++; i++; continue; }
      if (ch === '}' && templateDepth2 > 0) { templateDepth2--; continue; }
      continue;
    }

    if (ch === '/' && next === '/') { inLineComment2 = true; break; }
    if (ch === '/' && next === '*') { inBlockComment2 = true; i++; continue; }
    if (ch === '"' || ch === "'") { inString2 = true; stringChar2 = ch; continue; }
    if (ch === '`') { inTemplate2 = true; continue; }

    if (ch === '{') { lineOpens++; }
    else if (ch === '}') { lineCloses++; }
  }
  inLineComment2 = false;
  runningCount += lineOpens - lineCloses;

  if (lineOpens > 0 || lineCloses > 0) {
    const net = lineOpens - lineCloses;
    const marker = net > 0 ? 'OPEN+' + net : net < 0 ? 'CLOSE' + net : 'NEUTRAL';
    console.log('Line ' + lineNum + ': net=' + (net >= 0 ? '+' + net : net) + ' bal=' + runningCount + ' [' + marker + '] ' + line.trim().substring(0, 70));
  }
}

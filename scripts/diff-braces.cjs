const fs = require('fs');
const content = fs.readFileSync('src/discovery/case-discovery.ts', 'utf8');
const lines = content.split('\n');

// Get diff to original
const { execSync } = require('child_process');
const diffOutput = execSync('git diff src/discovery/case-discovery.ts', { encoding: 'utf8' });

// Count { and } in added lines (+ prefix)
let addedOpens = 0, addedCloses = 0;
let removedOpens = 0, removedCloses = 0;

for (const line of diffOutput.split('\n')) {
  if (line.startsWith('+') && !line.startsWith('+++')) {
    for (const ch of line.substring(1)) {
      if (ch === '{') addedOpens++;
      else if (ch === '}') addedCloses++;
    }
  } else if (line.startsWith('-') && !line.startsWith('---')) {
    for (const ch of line.substring(1)) {
      if (ch === '{') removedOpens++;
      else if (ch === '}') removedCloses++;
    }
  }
}

console.log(`Added: ${addedOpens} { and ${addedCloses} }`);
console.log(`Removed: ${removedOpens} { and ${removedCloses} }`);
console.log(`Net: ${addedOpens - removedOpens} { and ${addedCloses - removedCloses} }`);
console.log(`Balance: ${(addedOpens - removedOpens) - (addedCloses - removedCloses)}`);

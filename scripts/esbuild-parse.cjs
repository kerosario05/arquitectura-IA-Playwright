const esbuild = require('esbuild');
const fs = require('fs');

esbuild.transform(fs.readFileSync('src/discovery/case-discovery.ts', 'utf8'), {
  loader: 'ts',
  sourcefile: 'case-discovery.ts'
}).then(result => {
  console.log('OK: ' + result.code.length + ' bytes');
}).catch(err => {
  console.log('ERROR: ' + err.message);
  if (err.errors) {
    for (const e of err.errors) {
      console.log('  ' + e.text + ' at line ' + e.location.line + ' col ' + e.location.column);
    }
  }
});

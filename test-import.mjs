#!/usr/bin/env node
import('./src/discovery/case-discovery.ts').then(() => {
  console.log('Import successful');
}).catch(err => {
  console.error('Import failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});

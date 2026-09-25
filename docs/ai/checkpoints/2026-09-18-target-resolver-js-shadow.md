# Target resolver JS shadow checkpoint

- Physical job: `e367a223-b3c2-4d2e-afc2-8b5f8f036be0`
- Observed error: `TypeError: recordedLocatorFactory is not a function`
- Root cause: stale `src/discovery/target-resolver.js` shadowed authoritative `target-resolver.ts` in the Playwright child runtime.
- Fix: stale JS sibling eliminado.
- Code status: **CODE GREEN**
- Physical status: **PHYSICAL PENDING**

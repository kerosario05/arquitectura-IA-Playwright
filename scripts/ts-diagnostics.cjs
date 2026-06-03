const ts = require('typescript');
const fs = require('fs');

const source = fs.readFileSync('src/discovery/case-discovery.ts', 'utf8');

// Use the TypeScript parser to get diagnostics
const compilerHost = {
  getSourceFile: (fileName) => {
    if (fileName === 'case-discovery.ts') {
      return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
    }
    return undefined;
  },
  getDefaultLibFileName: () => 'lib.d.ts',
  writeFile: () => {},
  getCurrentDirectory: () => '.',
  getCanonicalFileName: (f) => f,
  useCaseSensitiveFileNames: () => true,
  getNewLine: () => '\n',
  fileExists: (f) => f === 'case-discovery.ts',
  readFile: (f) => f === 'case-discovery.ts' ? source : undefined
};

const program = ts.createProgram(['case-discovery.ts'], {
  noEmit: true,
  target: ts.ScriptTarget.Latest,
  module: ts.ModuleKind.CommonJS,
  strict: true
}, compilerHost);

const diagnostics = ts.getPreEmitDiagnostics(program);
for (const d of diagnostics) {
  if (d.file) {
    const pos = d.file.getLineAndCharacterOfPosition(d.start);
    console.log(`Error at line ${pos.line + 1}, col ${pos.character + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
  } else {
    console.log(`Error: ${ts.flattenDiagnosticMessageText(d.messageText, '\n')}`);
  }
}

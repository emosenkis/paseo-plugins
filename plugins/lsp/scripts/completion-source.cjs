const { readFileSync, writeFileSync } = require('node:fs');
const source = readFileSync(require.resolve('@codemirror/autocomplete'), 'utf8');
writeFileSync(require('node:path').join(__dirname, '../client/completion-source.js'), `export default ${JSON.stringify(source)};\n`);

import * as path from 'path';
import { generateContext } from './context-engine';

const rootDir = path.resolve(__dirname, '..');
const entryPoint = 'apps/web/client/src/app/page.tsx';
const outputPath = 'context.txt';

console.log('Generating context...');
const context = generateContext(rootDir, entryPoint, outputPath);
console.log(`Context successfully generated and written to: ${path.join(rootDir, outputPath)}\n`);

console.log('--- Printing generated context structure + code ---');

// For the test, we print the whole thing, but maybe we truncate the directory list if it's too massive,
// or just print it as the user requested "print the structure + code of page.tsx"
const splitIndex = context.indexOf('=========================================');
const structurePart = context.substring(0, splitIndex).trim();
const codePart = context.substring(splitIndex).trim();

const lines = structurePart.split('\n');
if (lines.length > 50) {
    console.log(lines.slice(0, 25).join('\n'));
    console.log(`\n... [${lines.length - 50} more paths truncated for preview] ...\n`);
    console.log(lines.slice(-25).join('\n'));
} else {
    console.log(structurePart);
}

console.log('\n' + codePart);

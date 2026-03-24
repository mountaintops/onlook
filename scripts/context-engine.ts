import * as fs from 'fs';
import * as path from 'path';

const EXCLUDED_DIRS = new Set([
    'node_modules',
    '.git',
    '.next',
    'dist',
    '.sst',
    'build',
    'coverage',
    '.turbo',
    '.vscode',
    '.prettierignore'
]);

/**
 * Generates a flattened directory tree, stripping all metadata.
 */
export function getDirectoryTree(dir: string, baseDir: string = dir): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);
        if (stat && stat.isDirectory()) {
            if (!EXCLUDED_DIRS.has(file)) {
                results = results.concat(getDirectoryTree(fullPath, baseDir));
            }
        } else {
            // Ignore some common unhelpful heavy files if necessary, like .DS_Store
            if (file !== '.DS_Store' && !file.endsWith('.log')) {
                results.push(path.relative(baseDir, fullPath));
            }
        }
    }
    return results.sort();
}

/**
 * Generates the context payload and writes it to context.txt in the root.
 */
export function generateContext(rootDir: string, entryPoint: string, outputPath: string) {
    const tree = getDirectoryTree(rootDir);
    const entryPointPath = path.join(rootDir, entryPoint);
    
    let entryPointContent = '';
    if (fs.existsSync(entryPointPath)) {
        entryPointContent = fs.readFileSync(entryPointPath, 'utf8');
    } else {
        entryPointContent = `// File not found: ${entryPoint}`;
    }

    let context = 'Project Directory Structure:\n';
    context += tree.map(file => `${file}`).join('\n');
    context += '\n\n=========================================\n\n';

    // Format the entry point EXACTLY like Onlook's editable file format
    context += `I have added these files to the chat so you can go ahead and edit them\n`;
    context += `<file>\n`;
    context += `<path>${entryPoint}</path>\n`;
    const ext = path.extname(entryPoint).substring(1) || 'tsx';
    context += `\`\`\`${ext}\n`;
    context += entryPointContent;
    context += `\n\`\`\`\n`;
    context += `</file>\n`;

    fs.writeFileSync(path.join(rootDir, outputPath), context, 'utf8');
    return context;
}

import { describe, expect, test } from 'bun:test';
import {
    parseDependencies,
    parseAllDependencies,
    addDependency,
    removeDependency,
} from '../DependencyPolyfill';

describe('DependencyPolyfill', () => {
    describe('parseDependencies', () => {
        test('extracts dependencies from valid package.json', () => {
            const content = JSON.stringify({
                name: 'test',
                dependencies: { react: '^18.2.0', lodash: '4.17.21' },
            });
            const deps = parseDependencies(content);
            expect(deps).toEqual({ react: '^18.2.0', lodash: '4.17.21' });
        });

        test('returns empty object for missing dependencies', () => {
            const content = JSON.stringify({ name: 'test' });
            const deps = parseDependencies(content);
            expect(deps).toEqual({});
        });

        test('returns empty object for invalid JSON', () => {
            const deps = parseDependencies('not json');
            expect(deps).toEqual({});
        });
    });

    describe('parseAllDependencies', () => {
        test('extracts both dependencies and devDependencies', () => {
            const content = JSON.stringify({
                dependencies: { react: '^18.0.0' },
                devDependencies: { typescript: '^5.0.0' },
            });
            const result = parseAllDependencies(content);
            expect(result.dependencies).toEqual({ react: '^18.0.0' });
            expect(result.devDependencies).toEqual({ typescript: '^5.0.0' });
        });
    });

    describe('addDependency', () => {
        test('adds a new dependency to existing package.json', () => {
            const files: Record<string, string> = {
                '/package.json': JSON.stringify({
                    name: 'test',
                    dependencies: { react: '^18.0.0' },
                }),
            };
            const result = addDependency(files, 'lodash', '4.17.21');
            expect(result).toEqual({ react: '^18.0.0', lodash: '4.17.21' });

            const updated = JSON.parse(files['/package.json']!);
            expect(updated.dependencies.lodash).toBe('4.17.21');
        });

        test('creates package.json if it does not exist', () => {
            const files: Record<string, string> = {};
            addDependency(files, 'axios', '^1.0.0');
            expect(files['/package.json']).toBeDefined();

            const pkg = JSON.parse(files['/package.json']!);
            expect(pkg.dependencies.axios).toBe('^1.0.0');
        });

        test('defaults version to latest', () => {
            const files: Record<string, string> = {};
            const result = addDependency(files, 'framer-motion');
            expect(result['framer-motion']).toBe('latest');
        });

        test('updates existing dependency version', () => {
            const files: Record<string, string> = {
                '/package.json': JSON.stringify({
                    dependencies: { react: '^17.0.0' },
                }),
            };
            const result = addDependency(files, 'react', '^18.0.0');
            expect(result.react).toBe('^18.0.0');
        });
    });

    describe('removeDependency', () => {
        test('removes an existing dependency', () => {
            const files: Record<string, string> = {
                '/package.json': JSON.stringify({
                    dependencies: { react: '^18.0.0', lodash: '4.17.21' },
                }),
            };
            const result = removeDependency(files, 'lodash');
            expect(result).toEqual({ react: '^18.0.0' });
            expect('lodash' in result).toBe(false);
        });

        test('returns empty object if package.json missing', () => {
            const files: Record<string, string> = {};
            const result = removeDependency(files, 'lodash');
            expect(result).toEqual({});
        });

        test('handles removing non-existent dependency gracefully', () => {
            const files: Record<string, string> = {
                '/package.json': JSON.stringify({
                    dependencies: { react: '^18.0.0' },
                }),
            };
            const result = removeDependency(files, 'nonexistent');
            expect(result).toEqual({ react: '^18.0.0' });
        });
    });
});

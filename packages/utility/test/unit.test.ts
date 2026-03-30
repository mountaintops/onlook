import { describe, expect, it } from 'bun:test';
import { toRelativePixel } from '../src/unit';

describe('toRelativePixel', () => {
    it('should handle px values', () => {
        expect(toRelativePixel('20px')).toBe(20);
    });

    it('should handle rem values with default root font size', () => {
        expect(toRelativePixel('1.25rem')).toBe(20);
    });

    it('should handle rem values with custom root font size', () => {
        expect(toRelativePixel('1.25rem', 20)).toBe(25);
    });

    it('should handle em values with default root font size', () => {
        expect(toRelativePixel('2em')).toBe(32);
    });

    it('should handle em values with current font size', () => {
        expect(toRelativePixel('2em', 16, 20)).toBe(40);
    });

    it('should handle unitless values', () => {
        expect(toRelativePixel('1.5')).toBe(1.5);
    });

    it('should handle invalid values', () => {
        expect(toRelativePixel('abc')).toBe(0);
    });
});

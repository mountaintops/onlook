import { useEditorEngine } from '@/components/store/editor';
import type { Font } from '@onlook/models';
import { convertFontString } from '@onlook/utility';
import { useEffect, useState } from 'react';

/** Map CSS keyword font-weight values to numeric strings */
const FONT_WEIGHT_KEYWORDS: Record<string, string> = {
    thin: '100',
    extralight: '200',
    'extra-light': '200',
    light: '300',
    normal: '400',
    medium: '500',
    semibold: '600',
    'semi-bold': '600',
    bold: '700',
    extrabold: '800',
    'extra-bold': '800',
    black: '900',
    heavy: '900',
};

const normalizeFontWeight = (value: string): string => {
    const lower = value.toLowerCase().trim();
    return FONT_WEIGHT_KEYWORDS[lower] ?? value;
};

export type TextAlign = 'left' | 'center' | 'right' | 'justify';

interface TextState {
    fontFamily: string;
    fontSize: number;
    fontWeight: string;
    textAlign: TextAlign;
    textColor: string;
    letterSpacing: string;
    capitalization: string;
    textDecorationLine: string;
    lineHeight: string;
}

const DefaultState: TextState = {
    fontFamily: '--',
    fontSize: 16,
    fontWeight: '400',
    textAlign: 'left',
    textColor: '#000000',
    letterSpacing: '0',
    capitalization: 'none',
    textDecorationLine: 'none',
    lineHeight: '1.5',
};

export const useTextControl = () => {
    const editorEngine = useEditorEngine();

    const getInitialState = (): TextState => {
        const styles = editorEngine.style.selectedStyle?.styles;
        const getStyleValue = (key: string, defaultValue: string): string => {
            const kebabKey = key.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
            return (
                styles?.defined[key]?.toString() ??
                styles?.defined[kebabKey]?.toString() ??
                styles?.computed[key]?.toString() ??
                styles?.computed[kebabKey]?.toString() ??
                defaultValue
            );
        };

        return {
            fontFamily: convertFontString(getStyleValue('fontFamily', DefaultState.fontFamily)),
            fontSize: (() => {
                const size = parseFloat(getStyleValue('fontSize', DefaultState.fontSize.toString()));
                return isNaN(size) ? DefaultState.fontSize : size;
            })(),
            fontWeight: normalizeFontWeight(getStyleValue('fontWeight', DefaultState.fontWeight)),
            textAlign: getStyleValue('textAlign', DefaultState.textAlign) as TextAlign,
            textColor: getStyleValue('color', DefaultState.textColor),
            letterSpacing: getStyleValue('letterSpacing', DefaultState.letterSpacing),
            capitalization: getStyleValue('textTransform', DefaultState.capitalization),
            textDecorationLine: getStyleValue('textDecorationLine', DefaultState.textDecorationLine),
            lineHeight: getStyleValue('lineHeight', DefaultState.lineHeight),
        };
    };

    const [textState, setTextState] = useState<TextState>(getInitialState());

    useEffect(() => {
        setTextState(getInitialState());
    }, [editorEngine.style.selectedStyle]);

    const handleFontFamilyChange = (fontFamily: Font) => {
        editorEngine.style.updateFontFamily('fontFamily', fontFamily);
    };

    const handleFontSizeChange = (fontSize: number) => {
        setTextState((prev) => ({
            ...prev,
            fontSize,
        }));
        editorEngine.style.update('fontSize', `${fontSize}px`);
    };

    const handleFontWeightChange = (fontWeight: string) => {
        setTextState((prev) => ({
            ...prev,
            fontWeight,
        }));
        editorEngine.style.update('fontWeight', fontWeight);
    };

    const handleTextAlignChange = (textAlign: TextAlign) => {
        setTextState((prev) => ({
            ...prev,
            textAlign,
        }));
        editorEngine.style.update('textAlign', textAlign);
    };

    const handleTextColorChange = (textColor: string) => {
        setTextState((prev) => ({
            ...prev,
            textColor,
        }));
    };

    const handleLetterSpacingChange = (letterSpacing: string) => {
        setTextState((prev) => ({
            ...prev,
            letterSpacing,
        }));
        editorEngine.style.update('letterSpacing', `${letterSpacing}px`);
    };

    const handleCapitalizationChange = (capitalization: string) => {
        setTextState((prev) => ({
            ...prev,
            capitalization,
        }));
        editorEngine.style.update('textTransform', capitalization);
    };

    const handleTextDecorationChange = (textDecorationLine: string) => {
        setTextState((prev) => ({
            ...prev,
            textDecorationLine,
        }));
        editorEngine.style.update('textDecorationLine', textDecorationLine);
    };

    const handleLineHeightChange = (lineHeight: string) => {
        setTextState((prev) => ({
            ...prev,
            lineHeight,
        }));
        editorEngine.style.update('lineHeight', lineHeight);
    };

    return {
        textState,
        handleFontFamilyChange,
        handleFontSizeChange,
        handleFontWeightChange,
        handleTextAlignChange,
        handleTextColorChange,
        handleLetterSpacingChange,
        handleCapitalizationChange,
        handleTextDecorationChange,
        handleLineHeightChange,
    };
};

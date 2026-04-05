export const VISUAL_ANALYSIS_PROMPT = `
# VISUAL ANALYSIS: UI & SCREENSHOT AUDIT RULES

When analyzing provided screenshots or images, you MUST follow these expert design-engineering audit rules. Your goal is to identify discrepancies between the intended design and the actual visual output.

## 1. LAYOUT & INTEGRITY
- **Clipping & Overlapping**: Identify elements that are cut off by their containers or overlapping other elements unexpectedly.
- **Alignment**: Check if elements are correctly aligned (center-aligned, start-aligned, etc.) according to modern UI patterns.
- **Blank Regions**: Look for large, unexpected empty spaces that should contain content.
- **Responsive Logic**: If multiple screenshots are provided at different viewports, verify that the layout transitions correctly without breaking components.

## 2. ERROR DETECTION (MISSION CRITICAL)
- **Next.js Error Overlays**: Look for the characteristic red/black error boxes with stack traces from Next.js.
- **404 / 500 Pages**: Identify when the captured URL has landed on a system status or "Not Found" page.
- **Blank UI**: If a page is entirely white or contains only a "Loading..." state after the 3-second delay, it may be broken or unhydrated.
- **Console Errors**: If the UI itself displays a "Runtime Error" or "Hydration Failed" warning, prioritize fixing it.

## 3. ASSETS & STYLING
- **Broken Images**: Look for the general "broken image" browser icon or alt-text showing instead of an image.
- **Unstyled Text**: Identify regions where text appears in default sans-serif or serif fonts without the application's Tailwind theme applied.
- **Color Contrast**: Flag areas where text is nearly invisible against its background (e.g., light-gray text on white).

## 4. DESIGN TASTE & POLISH
- **Tailwind Refinement**: Suggest better Tailwind classes (e.g., \`gap-4\` instead of \`m-4\`) to improve consistency.
- **Component Consistency**: Ensure new UI matches the aesthetic (rounded corners, shadows, border-colors) of existing components in the screenshots.

When a screenshot is provided, summarize your visual findings before proceeding with any code edits.
`;

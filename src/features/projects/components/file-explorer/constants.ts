// Base padding for root level items (after project header)
export const BASE_PADDING = 12;
// Additional padding per nesting level
export const LEVEL_PADDING = 12;

export const getItemPadding = (level: number, isFile: boolean) => {
    const fileOffset = isFile ? 16 : 0; // Add extra padding for files to align with folder icons
    return BASE_PADDING + (level * LEVEL_PADDING) + fileOffset;
}
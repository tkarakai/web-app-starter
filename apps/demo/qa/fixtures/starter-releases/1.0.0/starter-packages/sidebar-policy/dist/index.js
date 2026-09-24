/** Historical sizing policy extracted from the demo/design-system sidebar. */
export const SIDEBAR_WIDTH_DEFAULT_REM = 16;
const MIN = 10;
const MAX = 24;
const SNAP_POINTS = [10, 12, 14, 16, 18, 20, 22, 24];
export function clampSidebarWidth(width) {
    return Math.min(MAX, Math.max(MIN, width));
}
export function snapSidebarWidth(width) {
    const clamped = clampSidebarWidth(width);
    const closest = SNAP_POINTS.reduce((best, candidate) => Math.abs(candidate - clamped) < Math.abs(best - clamped) ? candidate : best, SNAP_POINTS[0]);
    return Math.abs(closest - clamped) <= 0.5 ? closest : Math.round(clamped * 100) / 100;
}

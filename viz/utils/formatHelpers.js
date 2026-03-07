/**
 * Shared number/coverage formatting helpers for script and popup.
 */

export function toPercent(value) {
    const n = Number(value);
    return Number.isFinite(n) ? (n * 100).toFixed(1) : '0.0';
}

export function toKilometers(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(1) : '0.0';
}

export function firstFiniteNumber(...values) {
    for (const value of values) {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

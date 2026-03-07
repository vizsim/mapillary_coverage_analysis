/**
 * Shared number/coverage formatting helpers for script and popup.
 * German locale: decimal "," and thousands "."
 */

/**
 * Format number with German separators: thousands ".", decimal ",".
 * @param {number} value - Number to format
 * @param {number} [decimalPlaces] - Max decimal places (0 = integer)
 * @returns {string}
 */
export function formatNumberGerman(value, decimalPlaces = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return decimalPlaces > 0 ? '0,0' : '0';

    if (decimalPlaces <= 0) {
        const int = Math.round(n);
        return int.toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    }

    const fixed = n.toFixed(decimalPlaces);
    const [intPart, decPart] = fixed.split('.');
    const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return decPart ? `${intFormatted},${decPart}` : intFormatted;
}

export function toPercent(value) {
    const n = Number(value);
    return Number.isFinite(n) ? formatNumberGerman(n * 100, 1) : '0,0';
}

/**
 * Format km value. Uses whole numbers when value >= 1000 (4+ digits) or when forceWholeNumbers is true (e.g. Bundesländer).
 * @param {number} value - Length in km
 * @param {boolean} [forceWholeNumbers] - If true, always round to integer (e.g. for Bundesländer)
 */
export function toKilometers(value, forceWholeNumbers = false) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    if (forceWholeNumbers || n >= 1000) return formatNumberGerman(Math.round(n), 0);
    return formatNumberGerman(n, 1);
}

export function firstFiniteNumber(...values) {
    for (const value of values) {
        const n = Number(value);
        if (Number.isFinite(n)) return n;
    }
    return null;
}

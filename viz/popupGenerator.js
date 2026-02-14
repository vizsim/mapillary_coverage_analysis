// Generate popup HTML for feature tooltips
import { generatePieChartDataUrl } from './generatePieIcon.js';
import { createCoveragePopupHtml } from './popupTemplates.js';
import { LruCache } from './utils/lruCache.js';

// Cache for pie chart data URLs to avoid regenerating the same charts
const pieChartCache = new LruCache(200);

function toPercent(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '0.0';
    return (numericValue * 100).toFixed(1);
}

/**
 * Get or generate a pie chart data URL with caching
 * @param {number} pano - Pano percentage
 * @param {number} regular - Regular percentage
 * @param {number} noCover - No cover percentage
 * @returns {string|null} Cached or newly generated data URL
 */
function getCachedPieChart(pano, regular, noCover) {
    // Create cache key from rounded values (to increase cache hits)
    const key = `${pano.toFixed(1)}-${regular.toFixed(1)}-${noCover.toFixed(1)}`;
    
    const cached = pieChartCache.get(key);
    if (cached) return cached;
    
    // Generate new pie chart
    const pieChartUrl = generatePieChartDataUrl({
        k1: parseFloat(pano),
        k2: parseFloat(regular),
        k3: parseFloat(noCover),
        size: 100
    });
    
    pieChartCache.set(key, pieChartUrl);
    
    return pieChartUrl;
}

/**
 * Generate HTML for coverage popup
 * @param {Object} properties - Feature properties
 * @param {string} labelProperty - Property name to use for the label
 * @returns {string} HTML string for popup
 */
export function generatePopupHTML(properties, labelProperty) {
    const name = properties[labelProperty] || properties.NAME_2 || properties.NAME_1 || 'Unbekannt';
    const noCover = toPercent(properties.all_no_cover);
    const pano = toPercent(properties.all_pano);
    const regular = toPercent(properties.all_regular);
    
    // Get pie chart from cache or generate new one
    const pieChartUrl = getCachedPieChart(
        parseFloat(pano),
        parseFloat(regular),
        parseFloat(noCover)
    );
    
    return createCoveragePopupHtml({
        name,
        pieChartUrl,
        pano,
        regular,
        missing: noCover
    });
}

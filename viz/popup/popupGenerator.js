// Generate popup HTML for feature tooltips
import { generatePieChartDataUrl } from '../utils/generatePieIcon.js';
import { createCoveragePopupHtml } from './popupTemplates.js';
import { LruCache } from '../utils/lruCache.js';
import { toPercent } from '../utils/formatHelpers.js';

// Cache for pie chart data URLs to avoid regenerating the same charts
const pieChartCache = new LruCache(200);

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
    
    const pieChartUrl = generatePieChartDataUrl({
        k1: pano,
        k2: regular,
        k3: noCover,
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

    const sharePano = (Number(properties.all_pano) || 0) * 100;
    const shareRegular = (Number(properties.all_regular) || 0) * 100;
    const shareNoCover = (Number(properties.all_no_cover) || 0) * 100;

    const pieChartUrl = getCachedPieChart(sharePano, shareRegular, shareNoCover);
    
    return createCoveragePopupHtml({
        name,
        pieChartUrl,
        pano,
        regular,
        missing: noCover
    });
}

// Generate popup HTML for feature tooltips
import { generatePieChartDataUrl } from './generatePieIcon.js';
import { coverageColors } from './config.js';

// Cache for pie chart data URLs to avoid regenerating the same charts
const pieChartCache = new Map();
const MAX_CACHE_SIZE = 200;

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
    
    if (pieChartCache.has(key)) {
        return pieChartCache.get(key);
    }
    
    // Generate new pie chart
    const pieChartUrl = generatePieChartDataUrl({
        k1: parseFloat(pano),
        k2: parseFloat(regular),
        k3: parseFloat(noCover),
        size: 100
    });
    
    // Add to cache, remove oldest if cache is too large (LRU-style)
    if (pieChartCache.size >= MAX_CACHE_SIZE) {
        const firstKey = pieChartCache.keys().next().value;
        pieChartCache.delete(firstKey);
    }
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
    const noCover = (properties.all_no_cover * 100).toFixed(1);
    const pano = (properties.all_pano * 100).toFixed(1);
    const regular = (properties.all_regular * 100).toFixed(1);
    
    // Get pie chart from cache or generate new one
    const pieChartUrl = getCachedPieChart(
        parseFloat(pano),
        parseFloat(regular),
        parseFloat(noCover)
    );
    
    const pieChartHtml = pieChartUrl 
        ? `<img src="${pieChartUrl}" style="width: 100px; height: 100px; margin: 8px 0;" alt="Coverage Chart" />`
        : '';
    
    return `
        <div style="font-family: sans-serif; font-size: 12px;">
            <strong style="font-size: 13px;">${name}</strong><br>
            ${pieChartHtml}
            <div style="margin-top: 8px;">
                ${generateCoverageRow('Panorama', coverageColors.pano, pano)}
                ${generateCoverageRow('Regular', coverageColors.regular, regular)}
                ${generateCoverageRow('Fehlend', coverageColors.missing, noCover)}
            </div>
        </div>
    `;
}

/**
 * Generate a single row for coverage statistics
 * @param {string} label - Label for the row
 * @param {string} color - Color hex code
 * @param {string} value - Percentage value
 * @returns {string} HTML string for the row
 */
function generateCoverageRow(label, color, value) {
    return `
        <div style="margin: 4px 0; display: flex; align-items: center; gap: 6px;">
            <span style="width: 12px; height: 12px; background: ${color}; border-radius: 2px; display: inline-block;"></span>
            <span style="flex: 1;">${label}:</span>
            <span style="font-family: monospace; text-align: right; min-width: 35px;">${value}%</span>
        </div>
    `;
}

/**
 * Coverage layers: fill, outline, visibility, opacity and outline contrast helpers.
 */
import { fillColorGradient, outlineStyle, coverageLayerIds } from '../config.js';
import { hasLayer, setLayersVisibility } from './mapSafeOps.js';

export const COVERAGE_SOURCE_ID = 'coverage-data';
export const COVERAGE_FILL_LAYER_ID = 'coverage-fill';
export const COVERAGE_OUTLINE_LAYER_ID = 'coverage-outline';

const SOURCE_LAYER = 'default';

/**
 * @param {number} fillOpacity - Fill opacity 0–1
 * @returns {object} MapLibre fill layer spec
 */
export function createCoverageFillLayer(fillOpacity) {
    return {
        id: COVERAGE_FILL_LAYER_ID,
        type: 'fill',
        source: COVERAGE_SOURCE_ID,
        'source-layer': SOURCE_LAYER,
        paint: {
            'fill-color': fillColorGradient,
            'fill-opacity': fillOpacity
        }
    };
}

/**
 * @returns {object} MapLibre line layer spec
 */
export function createCoverageOutlineLayer() {
    return {
        id: COVERAGE_OUTLINE_LAYER_ID,
        type: 'line',
        source: COVERAGE_SOURCE_ID,
        'source-layer': SOURCE_LAYER,
        paint: {
            'line-color': outlineStyle.color,
            'line-width': outlineStyle.width,
            'line-opacity': outlineStyle.opacity
        }
    };
}

/**
 * Set visibility of coverage layers and optional hover outline layer.
 * @param {object} map - MapLibre map instance
 * @param {string} visibility - 'visible' or 'none'
 * @param {string} hoverOutlineLayerId - Id of hover outline layer to sync, or null to skip
 */
export function applyCoverageVisibility(map, visibility, hoverOutlineLayerId) {
    if (!map) return;
    setLayersVisibility(map, coverageLayerIds, visibility);
    if (hoverOutlineLayerId && hasLayer(map, hoverOutlineLayerId)) {
        map.setLayoutProperty(hoverOutlineLayerId, 'visibility', visibility);
    }
}

/**
 * @param {object} map - MapLibre map instance
 * @param {number} fillOpacity - Fill opacity 0–1
 */
export function applyCoverageFillOpacity(map, fillOpacity) {
    if (!map || !hasLayer(map, COVERAGE_FILL_LAYER_ID)) return;
    map.setPaintProperty(COVERAGE_FILL_LAYER_ID, 'fill-opacity', fillOpacity);
}

export function hexToRgb(hexColor) {
    const normalized = String(hexColor || '').trim().replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;
    return {
        r: parseInt(normalized.slice(0, 2), 16),
        g: parseInt(normalized.slice(2, 4), 16),
        b: parseInt(normalized.slice(4, 6), 16)
    };
}

export function rgbToHex({ r, g, b }) {
    const toHex = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

export function blendHexColors(baseHex, targetHex, ratio) {
    const base = hexToRgb(baseHex);
    const target = hexToRgb(targetHex);
    if (!base || !target) return baseHex;
    const mixRatio = Math.max(0, Math.min(1, ratio));
    return rgbToHex({
        r: base.r + (target.r - base.r) * mixRatio,
        g: base.g + (target.g - base.g) * mixRatio,
        b: base.b + (target.b - base.b) * mixRatio
    });
}

/**
 * @param {number} fillOpacity - Current fill opacity (lower = stronger outline)
 * @returns {number}
 */
export function getDynamicCoverageOutlineOpacity(fillOpacity) {
    const baseOpacity = Number(outlineStyle.opacity) || 0;
    const additionalOpacity = (1 - fillOpacity) * 0.35;
    return Math.max(baseOpacity, Math.min(1, baseOpacity + additionalOpacity));
}

/**
 * @param {number} fillOpacity - Current fill opacity
 * @returns {string} Hex color
 */
export function getDynamicCoverageOutlineColor(fillOpacity) {
    const darkenRatio = (1 - fillOpacity) * 0.8;
    return blendHexColors(outlineStyle.color, '#2f3745', darkenRatio);
}

/**
 * Update outline layer paint from current fill opacity (contrast/darken).
 * @param {object} map - MapLibre map instance
 * @param {number} fillOpacity - Current fill opacity 0–1
 */
export function applyCoverageOutlineContrast(map, fillOpacity) {
    if (!map || !hasLayer(map, COVERAGE_OUTLINE_LAYER_ID)) return;
    map.setPaintProperty(COVERAGE_OUTLINE_LAYER_ID, 'line-color', getDynamicCoverageOutlineColor(fillOpacity));
    map.setPaintProperty(COVERAGE_OUTLINE_LAYER_ID, 'line-opacity', getDynamicCoverageOutlineOpacity(fillOpacity));
}

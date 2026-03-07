/**
 * Coverage hover outline: feature-state based highlight (no filter → no validator errors, no tile-boundary lines).
 */
import { outlineStyle } from '../config.js';
import { hasSource } from './mapSafeOps.js';

export const COVERAGE_HOVER_OUTLINE_LAYER_ID = 'coverage-hover-outline';

const SOURCE_LAYER = 'default';
let currentHoveredFeatureId = null;

/**
 * Layer spec for the hover outline (line layer, opacity driven by feature-state 'hover').
 * @param {string} sourceId - Coverage vector source id
 * @returns {object} MapLibre layer spec
 */
export function createHoverOutlineLayerSpec(sourceId) {
    return {
        id: COVERAGE_HOVER_OUTLINE_LAYER_ID,
        type: 'line',
        source: sourceId,
        'source-layer': SOURCE_LAYER,
        paint: {
            'line-color': outlineStyle.color,
            'line-width': [
                'interpolate',
                ['exponential', 1],
                ['zoom'],
                5, 2,
                8, 3,
                12, 5
            ],
            'line-opacity': ['case', ['boolean', ['feature-state', 'hover'], false], 0.95, 0]
        }
    };
}

/**
 * Set hover state for the given feature id (shows outline for that feature).
 * @param {object} map - MapLibre map instance
 * @param {string} sourceId - Coverage source id
 * @param {number|string|null} featureId - Feature id from event, or null to clear
 */
export function setHoverOutlineState(map, sourceId, featureId) {
    if (!map || !hasSource(map, sourceId)) return;
    const nextId = featureId ?? null;
    if (currentHoveredFeatureId !== null && currentHoveredFeatureId !== nextId) {
        try {
            map.removeFeatureState({ source: sourceId, sourceLayer: SOURCE_LAYER, id: currentHoveredFeatureId });
        } catch (_) {}
    }
    currentHoveredFeatureId = nextId;
    if (nextId !== null) {
        try {
            map.setFeatureState({ source: sourceId, sourceLayer: SOURCE_LAYER, id: nextId }, { hover: true });
        } catch (e) {
            if (typeof window !== 'undefined' && window.__COVERAGE_DEBUG_HOVER__) {
                console.warn('setFeatureState', e);
            }
        }
    }
}

/**
 * Clear hover state (hide outline).
 * @param {object} map - MapLibre map instance
 * @param {string} sourceId - Coverage source id
 */
export function clearHoverOutline(map, sourceId) {
    if (!map || !hasSource(map, sourceId)) return;
    if (currentHoveredFeatureId !== null) {
        try {
            map.removeFeatureState({ source: sourceId, sourceLayer: SOURCE_LAYER, id: currentHoveredFeatureId });
        } catch (_) {}
        currentHoveredFeatureId = null;
    }
}

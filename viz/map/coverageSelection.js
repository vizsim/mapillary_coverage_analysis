/**
 * Coverage selection: selected-feature outline layer and veil (dim other features).
 */
import { outlineStyle } from '../config.js';
import { hasSource, removeLayerIfExists } from './mapSafeOps.js';

export const COVERAGE_SELECTED_OUTLINE_LAYER_ID = 'coverage-selected-outline';
export const COVERAGE_VEIL_LAYER_ID = 'coverage-veil';

const SOURCE_LAYER = 'default';

const SELECTED_LINE_WIDTH = [
    'interpolate',
    ['exponential', 1],
    ['zoom'],
    5, 1.25,
    8, 2.5,
    12, 5
];

/**
 * Draw outline for the selected feature and a veil over all others.
 * @param {object} map - MapLibre map instance
 * @param {string} sourceId - Coverage vector source id
 * @param {string} sourceLayer - Source layer name (e.g. 'default')
 * @param {string|number|null} selectedId - Selected feature id (property value, e.g. Kreis name)
 * @param {string} labelProperty - Property used for filter (e.g. 'Kreis', 'Gemeinde')
 */
export function setSelectedFeatureOutline(map, sourceId, sourceLayer, selectedId, labelProperty) {
    if (!map || !hasSource(map, sourceId)) return;
    removeLayerIfExists(map, COVERAGE_VEIL_LAYER_ID);
    removeLayerIfExists(map, COVERAGE_SELECTED_OUTLINE_LAYER_ID);

    const selectedIdStr = selectedId != null ? String(selectedId) : null;
    if (!selectedIdStr) return;

    const idProp = labelProperty || 'Kreis';

    map.addLayer({
        id: COVERAGE_SELECTED_OUTLINE_LAYER_ID,
        type: 'line',
        source: sourceId,
        'source-layer': sourceLayer,
        filter: ['==', ['to-string', ['get', idProp]], selectedIdStr],
        paint: {
            'line-color': outlineStyle.color,
            'line-width': SELECTED_LINE_WIDTH,
            'line-opacity': 1
        }
    });
    map.addLayer({
        id: COVERAGE_VEIL_LAYER_ID,
        type: 'fill',
        source: sourceId,
        'source-layer': sourceLayer,
        filter: ['!=', ['to-string', ['get', idProp]], selectedIdStr],
        paint: {
            'fill-color': '#ffffff',
            'fill-opacity': 0.55
        }
    });
}

/**
 * Remove selection outline and veil layers.
 * @param {object} map - MapLibre map instance
 */
export function clearSelectedFeatureOutline(map) {
    if (!map) return;
    removeLayerIfExists(map, COVERAGE_VEIL_LAYER_ID);
    removeLayerIfExists(map, COVERAGE_SELECTED_OUTLINE_LAYER_ID);
}

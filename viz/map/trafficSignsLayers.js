/**
 * Traffic signs layer: source, layer spec, add, visibility.
 */
import { trafficSignsConfig, trafficSignsStyle, trafficSignsLayerIds } from '../config.js';
import { hasLayer, hasSource, addSourceIfMissing, setLayersVisibility } from './mapSafeOps.js';

/**
 * Add traffic signs vector source if missing.
 * @param {object} map - MapLibre map instance
 */
export function addTrafficSignsSource(map) {
    if (!map) return;
    addSourceIfMissing(map, trafficSignsConfig.sourceId, {
        type: 'vector',
        url: trafficSignsConfig.pmtiles
    });
}

/**
 * Build the traffic signs circle layer spec.
 * @returns {object} MapLibre layer spec
 */
export function createTrafficSignsLayerSpec() {
    const signCodeExpression = [
        'downcase',
        [
            'to-string',
            [
                'coalesce',
                ['get', 'traffic_sign'],
                ['get', 'VZ-Code'],
                ['get', 'VZ_Code'],
                ['get', 'vz_code'],
                ['get', 'code'],
                ''
            ]
        ]
    ];
    const isSupplementarySignExpression = ['>=', ['index-of', 'de:10', signCodeExpression], 0];

    return {
        id: trafficSignsLayerIds[0],
        type: 'circle',
        source: trafficSignsConfig.sourceId,
        'source-layer': trafficSignsConfig.sourceLayer,
        minzoom: trafficSignsConfig.minzoom,
        maxzoom: trafficSignsConfig.maxzoom,
        layout: { visibility: 'none' },
        paint: {
            'circle-color': [
                'case',
                isSupplementarySignExpression,
                trafficSignsStyle.supplementarySignColor,
                trafficSignsStyle.mainSignColor
            ],
            'circle-radius': trafficSignsStyle.circleRadius,
            'circle-stroke-color': [
                'case',
                isSupplementarySignExpression,
                trafficSignsStyle.supplementarySignStrokeColor,
                trafficSignsStyle.mainSignStrokeColor
            ],
            'circle-stroke-width': trafficSignsStyle.circleStrokeWidth,
            'circle-opacity': trafficSignsStyle.circleOpacity
        }
    };
}

/**
 * Add traffic signs layer if not present. Optionally insert before a layer (e.g. first missing-streets layer).
 * @param {object} map - MapLibre map instance
 * @param {string} [beforeLayerId] - If set, insert layer before this id; otherwise append
 */
export function addTrafficSignsLayer(map, beforeLayerId) {
    if (!map || !hasSource(map, trafficSignsConfig.sourceId)) return;

    const layerSpec = createTrafficSignsLayerSpec();
    if (hasLayer(map, layerSpec.id)) return;

    if (beforeLayerId && hasLayer(map, beforeLayerId)) {
        map.addLayer(layerSpec, beforeLayerId);
        return;
    }
    map.addLayer(layerSpec);
}

/**
 * Set visibility of all traffic sign layers.
 * @param {object} map - MapLibre map instance
 * @param {boolean} visible - Whether layers should be visible
 */
export function setTrafficSignsVisibility(map, visible) {
    if (!map) return;
    setLayersVisibility(map, trafficSignsLayerIds, visible ? 'visible' : 'none');
}

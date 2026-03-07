/**
 * Traffic signs layer: source, layer spec (symbol with icons), add, visibility.
 */
import { trafficSignsConfig, trafficSignsStyle, trafficSignsLayerIds, trafficSignsCircleLayerId, VZ_CODE_TO_ICON_ID, TRAFFIC_SIGNS_ICON_MIN_ZOOM } from '../config.js';
import { hasLayer, hasSource, addSourceIfMissing, setLayersVisibility } from './mapSafeOps.js';
import { DEFAULT_ICON_ID, TRAFFIC_SIGN_CIRCLE_MAIN_ID, TRAFFIC_SIGN_CIRCLE_SUPPLEMENTARY_ID } from '../utils/trafficSignIcons.js';

/** Build icon-image match expression: [match, signCode, 'de:237', 'iconId', ..., default]. */
function buildIconImageExpression() {
    const pairs = [];
    for (const [vz, iconId] of Object.entries(VZ_CODE_TO_ICON_ID)) {
        pairs.push(vz.toLowerCase(), iconId);
    }
    const signCodeExpression = [
        'downcase',
        [
            'to-string',
            [
                'coalesce',
                ['get', 'traffic_sign'],
                ['get', 'value'],
                ['get', 'mapillary_wording'],
                ['get', 'VZ-Code'],
                ['get', 'VZ_Code'],
                ['get', 'vz_code'],
                ['get', 'code'],
                ''
            ]
        ]
    ];
    return [
        'coalesce',
        ['get', 'value'],
        ['get', 'mapillary_wording'],
        ['match', signCodeExpression, ...pairs, DEFAULT_ICON_ID]
    ];
}

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

/** Zusatzzeichen-Filter: zwei Layer erlauben je eine zoom-interpolate (Haupt kleiner, Zusatz kleiner). */
const COMPLEMENTARY_VALUE_IDS = ['complementary--except-bicycles--g1', 'complementary--bike-route--g1'];
const COMPLEMENTARY_TRAFFIC_SIGNS = ['de:1022-10', '1022-10', 'de:1000-33', '1000-33'];

const filterComplementary = [
    'any',
    ['in', ['get', 'value'], ['literal', COMPLEMENTARY_VALUE_IDS]],
    ['in', ['downcase', ['to-string', ['coalesce', ['get', 'traffic_sign'], '']]], ['literal', COMPLEMENTARY_TRAFFIC_SIGNS]]
];
const filterMain = ['!', filterComplementary];

/** Zoom-Grenze: ab hier SVG-Icons, davor Kreise. */

/**
 * Low-zoom traffic signs: symbol layer with circle images (avoids tile-boundary clipping of circle layer).
 * Zoom 9 until just below TRAFFIC_SIGNS_ICON_MIN_ZOOM.
 */
function createTrafficSignsCircleLayerSpec() {
    const iconSize = [
        'interpolate',
        ['linear'],
        ['zoom'],
        9, 0.55,
        12, 0.75,
        15, 0.9
    ];
    return {
        id: trafficSignsCircleLayerId,
        type: 'symbol',
        source: trafficSignsConfig.sourceId,
        'source-layer': trafficSignsConfig.sourceLayer,
        minzoom: trafficSignsConfig.minzoom,
        maxzoom: TRAFFIC_SIGNS_ICON_MIN_ZOOM,
        layout: {
            visibility: 'none',
            'icon-image': [
                'case',
                filterComplementary,
                TRAFFIC_SIGN_CIRCLE_SUPPLEMENTARY_ID,
                TRAFFIC_SIGN_CIRCLE_MAIN_ID
            ],
            'icon-size': iconSize,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
        },
        paint: {
            'icon-opacity': trafficSignsStyle.circleOpacity
        }
    };
}

/**
 * Hauptzeichen-Layer (größere Icons, ab Zoom 11).
 */
function createTrafficSignsMainLayerSpec() {
    return {
        id: trafficSignsLayerIds[1],
        type: 'symbol',
        source: trafficSignsConfig.sourceId,
        'source-layer': trafficSignsConfig.sourceLayer,
        filter: filterMain,
        minzoom: TRAFFIC_SIGNS_ICON_MIN_ZOOM,
        maxzoom: trafficSignsConfig.maxzoom,
        layout: {
            visibility: 'none',
            'icon-image': buildIconImageExpression(),
            'icon-size': trafficSignsStyle.iconSize,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
        },
        paint: {}
    };
}

/**
 * Zusatzzeichen-Layer (kleinere Icons, ab Zoom 11).
 */
function createTrafficSignsComplementaryLayerSpec() {
    return {
        id: trafficSignsLayerIds[2],
        type: 'symbol',
        source: trafficSignsConfig.sourceId,
        'source-layer': trafficSignsConfig.sourceLayer,
        filter: filterComplementary,
        minzoom: TRAFFIC_SIGNS_ICON_MIN_ZOOM,
        maxzoom: trafficSignsConfig.maxzoom,
        layout: {
            visibility: 'none',
            'icon-image': buildIconImageExpression(),
            'icon-size': trafficSignsStyle.iconSizeComplementary,
            'icon-allow-overlap': true,
            'icon-ignore-placement': true
        },
        paint: {}
    };
}

/**
 * Add traffic signs layers if not present (Kreise 9–11, Icons ab 11). Optionally insert before a layer.
 * @param {object} map - MapLibre map instance
 * @param {string} [beforeLayerId] - If set, insert layers before this id; otherwise append
 */
export function addTrafficSignsLayer(map, beforeLayerId) {
    if (!map || !hasSource(map, trafficSignsConfig.sourceId)) return;

    const circleId = trafficSignsCircleLayerId;
    const mainId = trafficSignsLayerIds[1];
    const complementaryId = trafficSignsLayerIds[2];
    if (hasLayer(map, circleId) && hasLayer(map, mainId) && hasLayer(map, complementaryId)) return;

    const circleSpec = createTrafficSignsCircleLayerSpec();
    const mainSpec = createTrafficSignsMainLayerSpec();
    const compSpec = createTrafficSignsComplementaryLayerSpec();
    const before = beforeLayerId && hasLayer(map, beforeLayerId) ? beforeLayerId : undefined;

    if (!hasLayer(map, circleId)) {
        if (before) map.addLayer(circleSpec, before);
        else map.addLayer(circleSpec);
    }
    if (!hasLayer(map, mainId)) {
        if (before) map.addLayer(mainSpec, before);
        else map.addLayer(mainSpec);
    }
    if (!hasLayer(map, complementaryId)) {
        if (before) map.addLayer(compSpec, before);
        else map.addLayer(compSpec);
    }
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

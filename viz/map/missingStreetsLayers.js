/**
 * Missing streets layers: sources, layer specs, visibility, road-class and highway-type filters.
 */
import {
    MISSING_STREETS_SOURCE_DEFS,
    MISSING_STREETS_CATEGORY_DEFS,
    missingStreetsLayerIds,
    missingStreetsMainRoadLayerIds,
    MAIN_ROAD_CLASS_FILTER,
    HIGHWAY_TYPE_TO_VALUES,
    lineWidthConfig
} from '../config.js';
import { hasLayer, hasSource, addSourceIfMissing, addLayerIfMissing, setLayersVisibility } from './mapSafeOps.js';
import { whenSourcesAvailable } from '../utils/sourceReadiness.js';

let disposeMissingStreetsReadinessWatch = null;
let hoveredHighwayType = null;

/**
 * @param {object} categoryDef - Category from MISSING_STREETS_CATEGORY_DEFS
 * @param {object} sourceDef - Source from MISSING_STREETS_SOURCE_DEFS
 * @returns {object} MapLibre line layer spec
 */
export function createMissingStreetsLayerSpec(categoryDef, sourceDef) {
    return {
        id: `missing-streets-${categoryDef.key}-${sourceDef.layerSuffix}`,
        type: 'line',
        source: sourceDef.sourceId,
        'source-layer': sourceDef.sourceLayer,
        minzoom: sourceDef.minzoom,
        maxzoom: 22,
        layout: { visibility: 'none' },
        paint: {
            'line-width': lineWidthConfig,
            'line-color': categoryDef.color,
            'line-opacity': 0.7
        },
        filter: categoryDef.filter
    };
}

/**
 * @param {object} map - MapLibre map instance
 * @returns {boolean}
 */
export function areMissingStreetSourcesReady(map) {
    return map && MISSING_STREETS_SOURCE_DEFS.every((sourceDef) => hasSource(map, sourceDef.sourceId));
}

/**
 * Cancel any pending watch for missing-streets sources.
 */
export function clearMissingStreetsReadinessWatch() {
    if (!disposeMissingStreetsReadinessWatch) return;
    disposeMissingStreetsReadinessWatch();
    disposeMissingStreetsReadinessWatch = null;
}

/**
 * When all missing-streets sources are available, call onReady once. Call clearMissingStreetsReadinessWatch to cancel.
 * @param {object} map - MapLibre map instance
 * @param {function} onReady - Called when sources are ready (e.g. add layers, restore UI, update zoom warning)
 */
export function watchMissingStreetSourcesUntilAvailable(map, onReady) {
    if (!map || disposeMissingStreetsReadinessWatch) return;

    const sourceIds = MISSING_STREETS_SOURCE_DEFS.map((sourceDef) => sourceDef.sourceId);
    disposeMissingStreetsReadinessWatch = whenSourcesAvailable(map, sourceIds, () => {
        disposeMissingStreetsReadinessWatch = null;
        onReady();
    });
}

/**
 * Add all missing-streets layers if sources are ready; otherwise watch and add when ready.
 * @param {object} map - MapLibre map instance
 * @param {function} [onSourcesReady] - Optional callback when sources become ready (called after layers added)
 */
export function addMissingStreetsLayers(map, onSourcesReady) {
    if (!map) return;

    if (!areMissingStreetSourcesReady(map)) {
        watchMissingStreetSourcesUntilAvailable(map, () => {
            addMissingStreetsLayers(map, onSourcesReady);
            onSourcesReady?.();
        });
        return;
    }

    clearMissingStreetsReadinessWatch();

    for (const sourceDef of MISSING_STREETS_SOURCE_DEFS) {
        for (const categoryDef of MISSING_STREETS_CATEGORY_DEFS) {
            const layerSpec = createMissingStreetsLayerSpec(categoryDef, sourceDef);
            addLayerIfMissing(map, layerSpec);
        }
    }

    onSourcesReady?.();
}

/**
 * Add missing-streets vector sources to the map.
 * @param {object} map - MapLibre map instance
 */
export function addMissingStreetsSources(map) {
    if (!map) return;
    for (const sourceDef of MISSING_STREETS_SOURCE_DEFS) {
        addSourceIfMissing(map, sourceDef.sourceId, {
            type: 'vector',
            tiles: sourceDef.tileConfig.tiles,
            minzoom: sourceDef.tileConfig.minzoom,
            maxzoom: sourceDef.tileConfig.maxzoom
        });
    }
}

/**
 * Set visibility of missing-streets layers; if showMainRoadsOnly, only main-road layers are visible.
 * @param {object} map - MapLibre map instance
 * @param {boolean} visible - Whether missing-streets layers are on
 * @param {boolean} showMainRoadsOnly - If true, only main-road layers visible when visible is true
 */
export function setMissingStreetsVisibility(map, visible, showMainRoadsOnly) {
    if (!map) return;

    applyMissingStreetsRoadClassFilter(map, showMainRoadsOnly);

    if (!visible) {
        setLayersVisibility(map, missingStreetsLayerIds, 'none');
        return;
    }

    if (!showMainRoadsOnly) {
        setLayersVisibility(map, missingStreetsLayerIds, 'visible');
        return;
    }

    setLayersVisibility(map, missingStreetsMainRoadLayerIds, 'visible');
    const nonMainRoadLayerIds = missingStreetsLayerIds.filter(
        (layerId) => !missingStreetsMainRoadLayerIds.includes(layerId)
    );
    setLayersVisibility(map, nonMainRoadLayerIds, 'none');
}

/**
 * Filter expression for a highway type key (e.g. 'motorway', 'primary').
 * @param {string} highwayTypeKey - Key in HIGHWAY_TYPE_TO_VALUES
 * @returns {array|null} MapLibre filter or null
 */
export function getHighwayTypeFilter(highwayTypeKey) {
    const values = HIGHWAY_TYPE_TO_VALUES[highwayTypeKey];
    if (!values || values.length === 0) return null;
    return [
        'in',
        ['downcase', ['to-string', ['coalesce', ['get', 'road'], ['get', 'highway'], '']]],
        ['literal', values]
    ];
}

/**
 * Highlight a highway type (e.g. from legend hover). Pass 'all' to show all main roads.
 * @param {object} map - MapLibre map instance
 * @param {string|null} highwayTypeKey - Key in HIGHWAY_TYPE_TO_VALUES, or 'all', or null to clear
 */
export function setHighwayTypeHighlight(map, highwayTypeKey) {
    if (!map || hoveredHighwayType === highwayTypeKey) return;

    hoveredHighwayType = highwayTypeKey;
    const typeFilter = highwayTypeKey === 'all' ? null : getHighwayTypeFilter(highwayTypeKey);

    for (const categoryDef of MISSING_STREETS_CATEGORY_DEFS) {
        const roadsLayerId = `missing-streets-${categoryDef.key}-roads`;
        if (!hasLayer(map, roadsLayerId)) continue;

        const filter = typeFilter
            ? ['all', categoryDef.filter, typeFilter]
            : ['all', categoryDef.filter, MAIN_ROAD_CLASS_FILTER];

        map.setFilter(roadsLayerId, filter);
    }
}

/**
 * Clear highway-type highlight and restore road-class filter.
 * @param {object} map - MapLibre map instance
 * @param {boolean} showMainRoadsOnly - Current "main roads only" state from UI
 */
export function clearHighwayTypeHighlight(map, showMainRoadsOnly) {
    if (!map || hoveredHighwayType == null) return;
    hoveredHighwayType = null;
    applyMissingStreetsRoadClassFilter(map, showMainRoadsOnly);
}

/**
 * Apply main-roads-only filter to all missing-streets road layers.
 * @param {object} map - MapLibre map instance
 * @param {boolean} showMainRoadsOnly - If true, filter to main road classes only
 */
export function applyMissingStreetsRoadClassFilter(map, showMainRoadsOnly) {
    if (!map) return;

    for (const categoryDef of MISSING_STREETS_CATEGORY_DEFS) {
        const roadsLayerId = `missing-streets-${categoryDef.key}-roads`;
        if (!hasLayer(map, roadsLayerId)) continue;

        const filter = showMainRoadsOnly
            ? ['all', categoryDef.filter, MAIN_ROAD_CLASS_FILTER]
            : categoryDef.filter;

        map.setFilter(roadsLayerId, filter);
    }
}

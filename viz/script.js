import { generatePieChartDataUrl } from './generatePieIcon.js';
import { whenSourcesAvailable } from './sourceReadiness.js';
import { attachMapErrorTelemetry } from './errorTelemetry.js';
import { createCoveragePopupHtml, createCoverageDetailPopupHtml } from './popupTemplates.js';
import { LruCache } from './utils/lruCache.js';
import {
    hasLayer,
    hasSource,
    removeLayerIfExists,
    removeSourceIfExists,
    addSourceIfMissing,
    addLayerIfMissing,
    setLayersVisibility
} from './mapSafeOps.js';
import {
    layerConfig,
    mapStyles,
    tileServers,
    trafficSignsConfig,
    trafficSignsStyle,
    initialMapConfig,
    fillColorGradient,
    outlineStyle,
    lineWidthConfig,
    coverageColors,
    coverageLayerIds,
    missingStreetsLayerIds,
    trafficSignsLayerIds
} from './config.js';

const COVERAGE_SOURCE_ID = 'coverage-data';
const COVERAGE_FILL_LAYER_ID = 'coverage-fill';
const COVERAGE_OUTLINE_LAYER_ID = 'coverage-outline';

const MISSING_STREETS_SOURCE_DEFS = [
    {
        sourceId: 'mapillary-roadspathclasses',
        tileConfig: tileServers.roadsPathClasses,
        sourceLayer: 'roadsPathClasses',
        minzoom: 15,
        layerSuffix: 'pathclasses'
    },
    {
        sourceId: 'mapillary-roads',
        tileConfig: tileServers.roads,
        sourceLayer: 'roads',
        minzoom: 9,
        layerSuffix: 'roads'
    },
    {
        sourceId: 'bike-lanes',
        tileConfig: tileServers.bikeLanes,
        sourceLayer: 'bikelanes',
        minzoom: 11,
        layerSuffix: 'bikelanes'
    }
];

const MISSING_STREETS_CATEGORY_DEFS = [
    {
        key: 'missing',
        color: coverageColors.missing,
        filter: [
            'any',
            ['==', ['get', 'mapillary_coverage'], 'missing'],
            ['!', ['has', 'mapillary_coverage']],
            ['==', ['get', 'mapillary_coverage'], '']
        ]
    },
    {
        key: 'regular',
        color: coverageColors.regular,
        filter: ['==', ['get', 'mapillary_coverage'], 'regular']
    },
    {
        key: 'pano',
        color: coverageColors.pano,
        filter: ['==', ['get', 'mapillary_coverage'], 'pano']
    }
];

let map;
let currentActiveLayer = null;
let coverageLayerVisible = true;
let disposeMissingStreetsReadinessWatch = null;

const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: 'pmtiles-popup',
    maxWidth: '200px'
});

const detailPopup = new maplibregl.Popup({
    closeButton: true,
    closeOnClick: true,
    className: 'pmtiles-popup pmtiles-popup-detail',
    maxWidth: '340px',
    offset: 12
});

let currentFeatureId = null;
let popupRafId = null;
let pendingPopupLngLat = null;
const popupHtmlCache = new LruCache(200);
const detailPopupHtmlCache = new LruCache(200);

const coverageBreakdownConfig = [
    { key: 'all', label: 'Gesamt' },
    { key: 'motorway', label: 'Motorway' },
    { key: 'trunk', label: 'Trunk' },
    { key: 'primary', label: 'Primary' },
    { key: 'secondary', label: 'Secondary' },
    { key: 'tertiary', label: 'Tertiary' }
];

function getActiveLayerConfig(zoom) {
    let activeLayer = null;
    let highestMinZoom = -1;

    for (const layer of layerConfig) {
        if (zoom >= layer.minZoom && zoom < layer.maxZoom && layer.minZoom > highestMinZoom) {
            activeLayer = layer;
            highestMinZoom = layer.minZoom;
        }
    }

    return activeLayer;
}

function createCoverageFillLayer() {
    return {
        id: COVERAGE_FILL_LAYER_ID,
        type: 'fill',
        source: COVERAGE_SOURCE_ID,
        'source-layer': 'default',
        paint: {
            'fill-color': fillColorGradient,
            'fill-opacity': 0.7
        }
    };
}

function createCoverageOutlineLayer() {
    return {
        id: COVERAGE_OUTLINE_LAYER_ID,
        type: 'line',
        source: COVERAGE_SOURCE_ID,
        'source-layer': 'default',
        paint: {
            'line-color': outlineStyle.color,
            'line-width': outlineStyle.width,
            'line-opacity': outlineStyle.opacity
        }
    };
}

function applyCoverageVisibility() {
    const visibility = coverageLayerVisible ? 'visible' : 'none';
    setLayersVisibility(map, coverageLayerIds, visibility);
}

function updateCoverageLayer() {
    if (!map) return;

    const currentZoom = map.getZoom();
    const activeLayer = getActiveLayerConfig(currentZoom);

    if (!activeLayer) {
        console.warn('No active layer for zoom level', currentZoom);
        return;
    }

    if (currentActiveLayer?.id === activeLayer.id) {
        applyCoverageVisibility();
        return;
    }

    coverageLayerIds.forEach((layerId) => removeLayerIfExists(map, layerId));
    removeSourceIfExists(map, COVERAGE_SOURCE_ID);

    addSourceIfMissing(map, COVERAGE_SOURCE_ID, {
        type: 'vector',
        url: activeLayer.pmtiles
    });

    addLayerIfMissing(map, createCoverageFillLayer());
    addLayerIfMissing(map, createCoverageOutlineLayer());

    currentActiveLayer = activeLayer;
    attachCoverageLayerEvents();
    applyCoverageVisibility();
}

function attachCoverageLayerEvents() {
    if (!map) return;

    map.off('mousemove', COVERAGE_FILL_LAYER_ID, handleCoverageHover);
    map.off('mouseleave', COVERAGE_FILL_LAYER_ID, handleCoverageLeave);
    map.off('click', COVERAGE_FILL_LAYER_ID, handleCoverageClick);

    if (!hasLayer(map, COVERAGE_FILL_LAYER_ID)) return;

    map.on('mousemove', COVERAGE_FILL_LAYER_ID, handleCoverageHover);
    map.on('mouseleave', COVERAGE_FILL_LAYER_ID, handleCoverageLeave);
    map.on('click', COVERAGE_FILL_LAYER_ID, handleCoverageClick);
}

function toPercent(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '0.0';
    return (numericValue * 100).toFixed(1);
}

function getFeatureLabel(props) {
    const labelProperty = currentActiveLayer?.labelProperty || 'Name';
    return props[labelProperty] || props.NAME_2 || props.NAME_1 || 'Unbekannt';
}

function getPopupHtml(props) {
    const name = getFeatureLabel(props);
    const noCover = toPercent(props.all_no_cover);
    const pano = toPercent(props.all_pano);
    const regular = toPercent(props.all_regular);

    const cacheKey = `${name}|${pano}|${regular}|${noCover}`;
    const cached = popupHtmlCache.get(cacheKey);
    if (cached) return cached;

    const pieChartUrl = generatePieChartDataUrl({
        k1: parseFloat(pano),
        k2: parseFloat(regular),
        k3: parseFloat(noCover),
        size: 100
    });

    const html = createCoveragePopupHtml({
        name,
        pieChartUrl,
        pano,
        regular,
        missing: noCover,
        colors: coverageColors
    });

    popupHtmlCache.set(cacheKey, html);

    return html;
}

function hasCoverageBreakdown(props, prefix) {
    const keys = [`${prefix}_pano`, `${prefix}_regular`, `${prefix}_no_cover`];
    return keys.some((key) => Number.isFinite(Number(props?.[key])));
}

function buildCoverageStatRows(props) {
    return coverageBreakdownConfig
        .filter(({ key }) => hasCoverageBreakdown(props, key))
        .map(({ key, label }) => {
            const pano = toPercent(props[`${key}_pano`]);
            const regular = toPercent(props[`${key}_regular`]);
            const missing = toPercent(props[`${key}_no_cover`]);
            return { label, pano, regular, missing };
        });
}

function getDetailedPopupHtml(props) {
    const name = getFeatureLabel(props);
    const noCover = toPercent(props.all_no_cover);
    const pano = toPercent(props.all_pano);
    const regular = toPercent(props.all_regular);

    const cacheKey = `${name}|${pano}|${regular}|${noCover}|detail`;
    const cached = detailPopupHtmlCache.get(cacheKey);
    if (cached) return cached;

    const pieChartUrl = generatePieChartDataUrl({
        k1: parseFloat(pano),
        k2: parseFloat(regular),
        k3: parseFloat(noCover),
        size: 96
    });

    const detailRows = buildCoverageStatRows(props);

    const html = createCoverageDetailPopupHtml({
        name,
        pieChartUrl,
        pano,
        regular,
        missing: noCover,
        breakdownRows: detailRows,
        colors: coverageColors
    });

    detailPopupHtmlCache.set(cacheKey, html);

    return html;
}

function handleCoverageHover(event) {
    if (!map) return;

    map.getCanvas().style.cursor = 'pointer';

    const features = Array.isArray(event?.features) ? event.features : [];
    if (features.length === 0) return;

    const feature = features[0];
    const props = feature?.properties || {};
    const featureId = feature?.id || props.ID_0;

    pendingPopupLngLat = event.lngLat;

    if (featureId !== currentFeatureId) {
        currentFeatureId = featureId;

        const html = getPopupHtml(props);
        popup.setHTML(html);

        if (!popup.isOpen()) {
            popup.addTo(map);
        }
    }

    if (!popupRafId) {
        popupRafId = requestAnimationFrame(() => {
            if (pendingPopupLngLat && popup.isOpen()) {
                popup.setLngLat(pendingPopupLngLat);
            }
            popupRafId = null;
        });
    }
}

function handleCoverageLeave() {
    if (!map) return;

    map.getCanvas().style.cursor = '';
    currentFeatureId = null;
    popup.remove();
    pendingPopupLngLat = null;

    if (popupRafId) {
        cancelAnimationFrame(popupRafId);
        popupRafId = null;
    }
}

function handleCoverageClick(event) {
    const features = Array.isArray(event?.features) ? event.features : [];
    if (features.length > 0) {
        const feature = features[0];
        const properties = feature?.properties || {};

        popup.remove();
        currentFeatureId = null;

        const html = getDetailedPopupHtml(properties);
        detailPopup.setLngLat(event.lngLat).setHTML(html).addTo(map);

    }
}

function createMissingStreetsLayerSpec(categoryDef, sourceDef) {
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

function areMissingStreetSourcesReady() {
    return MISSING_STREETS_SOURCE_DEFS.every((sourceDef) => hasSource(map, sourceDef.sourceId));
}

function clearMissingStreetsReadinessWatch() {
    if (!disposeMissingStreetsReadinessWatch) return;
    disposeMissingStreetsReadinessWatch();
    disposeMissingStreetsReadinessWatch = null;
}

function watchMissingStreetSourcesUntilAvailable() {
    if (!map || disposeMissingStreetsReadinessWatch) return;

    const sourceIds = MISSING_STREETS_SOURCE_DEFS.map((sourceDef) => sourceDef.sourceId);

    disposeMissingStreetsReadinessWatch = whenSourcesAvailable(map, sourceIds, () => {
        disposeMissingStreetsReadinessWatch = null;
        addMissingStreetsLayers();
        restoreLayerVisibilityFromUi();
        updateStreetsZoomWarning();
    });
}

function addMissingStreetsLayers() {
    if (!map) return;

    if (!areMissingStreetSourcesReady()) {
        watchMissingStreetSourcesUntilAvailable();
        return;
    }

    clearMissingStreetsReadinessWatch();

    let addedLayers = 0;
    for (const sourceDef of MISSING_STREETS_SOURCE_DEFS) {
        for (const categoryDef of MISSING_STREETS_CATEGORY_DEFS) {
            const layerSpec = createMissingStreetsLayerSpec(categoryDef, sourceDef);
            const alreadyExists = hasLayer(map, layerSpec.id);
            addLayerIfMissing(map, layerSpec);
            if (!alreadyExists) {
                addedLayers += 1;
            }
        }
    }

    if (addedLayers === 0) return;
}

function addMissingStreetsSources() {
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

function setMissingStreetsVisibility(visible) {
    setLayersVisibility(map, missingStreetsLayerIds, visible ? 'visible' : 'none');
}

function addTrafficSignsSource() {
    if (!map) return;

    addSourceIfMissing(map, trafficSignsConfig.sourceId, {
        type: 'vector',
        url: trafficSignsConfig.pmtiles
    });
}

function createTrafficSignsLayerSpec() {
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

function addTrafficSignsLayer() {
    if (!map || !hasSource(map, trafficSignsConfig.sourceId)) return;

    const layerSpec = createTrafficSignsLayerSpec();
    if (hasLayer(map, layerSpec.id)) return;

    if (hasLayer(map, missingStreetsLayerIds[0])) {
        map.addLayer(layerSpec, missingStreetsLayerIds[0]);
        return;
    }

    map.addLayer(layerSpec);
}

function setTrafficSignsVisibility(visible) {
    setLayersVisibility(map, trafficSignsLayerIds, visible ? 'visible' : 'none');
}

const toggleInfoBtn = document.getElementById('toggle-info');
const closeInfoBtn = document.getElementById('close-info');
const infoPanel = document.querySelector('.info-panel');
const darkModeToggle = document.getElementById('dark-mode-toggle');
const toggleStreetsCheckbox = document.getElementById('toggle-streets-layer');
const streetsLegend = document.getElementById('streets-legend');
const streetsZoomWarning = document.getElementById('streets-zoom-warning');
const toggleTrafficSignsCheckbox = document.getElementById('toggle-traffic-signs-layer');
const trafficSignsLegend = document.getElementById('traffic-signs-legend');
const trafficSignsZoomWarning = document.getElementById('traffic-signs-zoom-warning');
const toggleKreiseCheckbox = document.getElementById('toggle-kreise-layer');
const kreiseLegend = document.getElementById('kreise-legend');

function updateStreetsZoomWarning() {
    if (!map || !streetsZoomWarning) return;

    const currentZoom = map.getZoom();
    const isStreetsChecked = Boolean(toggleStreetsCheckbox?.checked);

    streetsZoomWarning.style.display = isStreetsChecked && currentZoom < 9 ? 'block' : 'none';
}

function updateTrafficSignsZoomWarning() {
    if (!map || !trafficSignsZoomWarning) return;

    const currentZoom = map.getZoom();
    const isTrafficSignsChecked = Boolean(toggleTrafficSignsCheckbox?.checked);

    trafficSignsZoomWarning.style.display = isTrafficSignsChecked && currentZoom < trafficSignsConfig.minzoom ? 'block' : 'none';
}

function restoreLayerVisibilityFromUi() {
    const streetsVisible = Boolean(toggleStreetsCheckbox?.checked);
    setMissingStreetsVisibility(streetsVisible);

    const trafficSignsVisible = Boolean(toggleTrafficSignsCheckbox?.checked);
    setTrafficSignsVisibility(trafficSignsVisible);

    coverageLayerVisible = Boolean(toggleKreiseCheckbox?.checked ?? true);
    applyCoverageVisibility();

    if (streetsLegend) {
        streetsLegend.style.display = streetsVisible ? 'flex' : 'none';
    }
    if (kreiseLegend) {
        kreiseLegend.style.display = coverageLayerVisible ? 'flex' : 'none';
    }
    if (trafficSignsLegend) {
        trafficSignsLegend.style.display = trafficSignsVisible ? 'flex' : 'none';
    }
}

function rebuildRuntimeLayers() {
    if (!map) return;

    try {
        addTrafficSignsSource();
        addMissingStreetsSources();
        updateCoverageLayer();
        addTrafficSignsLayer();
        addMissingStreetsLayers();
        restoreLayerVisibilityFromUi();
        updateStreetsZoomWarning();
        updateTrafficSignsZoomWarning();
    } catch (error) {
        console.error('Error rebuilding layers:', error);
    }
}

if (toggleInfoBtn && infoPanel) {
    toggleInfoBtn.addEventListener('click', () => {
        infoPanel.style.display = infoPanel.style.display === 'none' ? 'flex' : 'none';
    });
}

if (closeInfoBtn && infoPanel) {
    closeInfoBtn.addEventListener('click', () => {
        infoPanel.style.display = 'none';
    });
}

if (typeof maplibregl === 'undefined' || typeof pmtiles === 'undefined') {
    console.error('Map dependencies are missing: maplibregl and/or pmtiles are not available.');
} else {
    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);

    map = new maplibregl.Map({
        container: 'map',
        style: mapStyles.light,
        center: initialMapConfig.center,
        zoom: initialMapConfig.zoom
    });

    attachMapErrorTelemetry(map, { coverageSourceId: COVERAGE_SOURCE_ID });

    if (darkModeToggle) {
        darkModeToggle.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme') || 'light';
            const next = current === 'dark' ? 'light' : 'dark';

            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('theme-override', next);

            const newStyle = next === 'dark' ? mapStyles.dark : mapStyles.light;
            map.setStyle(newStyle);

            map.once('style.load', () => {
                currentActiveLayer = null;
                clearMissingStreetsReadinessWatch();
                rebuildRuntimeLayers();
            });
        });
    }

    if (toggleStreetsCheckbox) {
        toggleStreetsCheckbox.addEventListener('change', (event) => {
            const isChecked = Boolean(event?.target?.checked);
            setMissingStreetsVisibility(isChecked);

            if (streetsLegend) {
                streetsLegend.style.display = isChecked ? 'flex' : 'none';
            }

            updateStreetsZoomWarning();
        });
    }

    if (toggleTrafficSignsCheckbox) {
        toggleTrafficSignsCheckbox.addEventListener('change', (event) => {
            const isChecked = Boolean(event?.target?.checked);
            setTrafficSignsVisibility(isChecked);

            if (trafficSignsLegend) {
                trafficSignsLegend.style.display = isChecked ? 'flex' : 'none';
            }

            updateTrafficSignsZoomWarning();
        });
    }

    if (toggleKreiseCheckbox) {
        toggleKreiseCheckbox.addEventListener('change', (event) => {
            coverageLayerVisible = Boolean(event?.target?.checked);
            applyCoverageVisibility();

            if (kreiseLegend) {
                kreiseLegend.style.display = coverageLayerVisible ? 'flex' : 'none';
            }
        });
    }

    map.on('load', () => {
        rebuildRuntimeLayers();
    });

    map.on('zoomend', () => {
        updateCoverageLayer();
        updateStreetsZoomWarning();
        updateTrafficSignsZoomWarning();
    });
}

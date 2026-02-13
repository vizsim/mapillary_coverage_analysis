import { generatePieChartDataUrl } from './generatePieIcon.js';
import {
    layerConfig,
    mapStyles,
    tileServers,
    initialMapConfig,
    fillColorGradient,
    outlineStyle,
    lineWidthConfig,
    coverageColors,
    coverageLayerIds,
    missingStreetsLayerIds
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
let missingStreetsRetryTimeoutId = null;

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
const popupHtmlCache = new Map();
const detailPopupHtmlCache = new Map();

const coverageBreakdownConfig = [
    { key: 'all', label: 'Gesamt' },
    { key: 'motorway', label: 'Motorway' },
    { key: 'trunk', label: 'Trunk' },
    { key: 'primary', label: 'Primary' },
    { key: 'secondary', label: 'Secondary' },
    { key: 'tertiary', label: 'Tertiary' }
];

function hasLayer(layerId) {
    return Boolean(map && map.getLayer(layerId));
}

function hasSource(sourceId) {
    return Boolean(map && map.getSource(sourceId));
}

function removeLayerIfExists(layerId) {
    if (!map || !hasLayer(layerId)) return;
    map.removeLayer(layerId);
}

function removeSourceIfExists(sourceId) {
    if (!map || !hasSource(sourceId)) return;
    map.removeSource(sourceId);
}

function addSourceIfMissing(sourceId, sourceConfig) {
    if (!map || hasSource(sourceId)) return;
    map.addSource(sourceId, sourceConfig);
}

function addLayerIfMissing(layerConfigEntry) {
    if (!map || hasLayer(layerConfigEntry.id)) return;
    map.addLayer(layerConfigEntry);
}

function setLayerVisibilityIfExists(layerId, visibility) {
    if (!map || !hasLayer(layerId)) return;
    map.setLayoutProperty(layerId, 'visibility', visibility);
}

function setLayersVisibility(layerIds, visibility) {
    layerIds.forEach((layerId) => setLayerVisibilityIfExists(layerId, visibility));
}

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
    setLayersVisibility(coverageLayerIds, visibility);
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

    console.log(`Switching to layer: ${activeLayer.name} (zoom: ${currentZoom})`);
    console.log(`PMTiles URL: ${activeLayer.pmtiles}`);

    coverageLayerIds.forEach(removeLayerIfExists);
    removeSourceIfExists(COVERAGE_SOURCE_ID);

    addSourceIfMissing(COVERAGE_SOURCE_ID, {
        type: 'vector',
        url: activeLayer.pmtiles
    });

    addLayerIfMissing(createCoverageFillLayer());
    addLayerIfMissing(createCoverageOutlineLayer());

    currentActiveLayer = activeLayer;
    attachCoverageLayerEvents();
    applyCoverageVisibility();
}

function attachCoverageLayerEvents() {
    if (!map) return;

    map.off('mousemove', COVERAGE_FILL_LAYER_ID, handleCoverageHover);
    map.off('mouseleave', COVERAGE_FILL_LAYER_ID, handleCoverageLeave);
    map.off('click', COVERAGE_FILL_LAYER_ID, handleCoverageClick);

    if (!hasLayer(COVERAGE_FILL_LAYER_ID)) return;

    map.on('mousemove', COVERAGE_FILL_LAYER_ID, handleCoverageHover);
    map.on('mouseleave', COVERAGE_FILL_LAYER_ID, handleCoverageLeave);
    map.on('click', COVERAGE_FILL_LAYER_ID, handleCoverageClick);
}

function toPercent(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) return '0.0';
    return (numericValue * 100).toFixed(1);
}

function escapeHtml(input) {
    return String(input)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getFeatureLabel(props) {
    const labelProperty = currentActiveLayer?.labelProperty || 'Name';
    return props[labelProperty] || props.NAME_2 || props.NAME_1 || 'Unbekannt';
}

function getPopupHtml(props) {
    const name = escapeHtml(getFeatureLabel(props));
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

    const pieChartHtml = pieChartUrl
        ? `<img src="${pieChartUrl}" style="width: 100px; height: 100px; margin: 8px 0;" alt="Coverage Chart" />`
        : '';

    const html = `
        <div style="font-family: sans-serif; font-size: 12px;">
            <strong style="font-size: 13px;">${name}</strong><br>
            ${pieChartHtml}
            <div style="margin-top: 8px;">
                <div style="margin: 4px 0; display: flex; align-items: center; gap: 6px;">
                    <span style="width: 12px; height: 12px; background: ${coverageColors.pano}; border-radius: 2px; display: inline-block;"></span>
                    <span style="flex: 1;">Panorama:</span>
                    <span style="font-family: monospace; text-align: right; min-width: 35px;">${pano}%</span>
                </div>
                <div style="margin: 4px 0; display: flex; align-items: center; gap: 6px;">
                    <span style="width: 12px; height: 12px; background: ${coverageColors.regular}; border-radius: 2px; display: inline-block;"></span>
                    <span style="flex: 1;">Regular:</span>
                    <span style="font-family: monospace; text-align: right; min-width: 35px;">${regular}%</span>
                </div>
                <div style="margin: 4px 0; display: flex; align-items: center; gap: 6px;">
                    <span style="width: 12px; height: 12px; background: ${coverageColors.missing}; border-radius: 2px; display: inline-block;"></span>
                    <span style="flex: 1;">Fehlend:</span>
                    <span style="font-family: monospace; text-align: right; min-width: 35px;">${noCover}%</span>
                </div>
            </div>
        </div>
    `;

    if (popupHtmlCache.size > 200) {
        const firstKey = popupHtmlCache.keys().next().value;
        popupHtmlCache.delete(firstKey);
    }
    popupHtmlCache.set(cacheKey, html);

    return html;
}

function hasCoverageBreakdown(props, prefix) {
    const keys = [`${prefix}_pano`, `${prefix}_regular`, `${prefix}_no_cover`];
    return keys.some((key) => Number.isFinite(Number(props?.[key])));
}

function buildCoverageStatRows(props, compact = false) {
    return coverageBreakdownConfig
        .filter(({ key }) => hasCoverageBreakdown(props, key))
        .map(({ key, label }) => {
            const pano = toPercent(props[`${key}_pano`]);
            const regular = toPercent(props[`${key}_regular`]);
            const missing = toPercent(props[`${key}_no_cover`]);

            const cellStyle = compact
                ? 'padding: 2px 6px; text-align: right; font-family: monospace; font-size: 11px;'
                : 'padding: 4px 8px; text-align: right; font-family: monospace; font-size: 11px;';
            const labelCellStyle = compact
                ? 'padding: 2px 6px; font-size: 11px; font-weight: 600; text-align: left;'
                : 'padding: 4px 8px; font-size: 11px; font-weight: 600; text-align: left;';

            return `
                <tr>
                    <td style="${labelCellStyle}">${escapeHtml(label)}</td>
                    <td style="${cellStyle}">${pano}%</td>
                    <td style="${cellStyle}">${regular}%</td>
                    <td style="${cellStyle}">${missing}%</td>
                </tr>
            `;
        })
        .join('');
}

function getDetailedPopupHtml(props) {
    const name = escapeHtml(getFeatureLabel(props));
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

    const pieChartHtml = pieChartUrl
        ? `<img src="${pieChartUrl}" style="width: 96px; height: 96px; margin: 2px 10px 0 0; flex-shrink: 0;" alt="Coverage Chart" />`
        : '';

    const detailRows = buildCoverageStatRows(props);

    const html = `
        <div style="font-family: sans-serif; font-size: 12px; min-width: 260px;">
            <strong style="font-size: 14px;">${name}</strong>
            <div style="display: flex; align-items: center; margin-top: 8px;">
                ${pieChartHtml}
                <div style="flex: 1; min-width: 130px;">
                    <div style="margin: 2px 0; display: flex; align-items: center; gap: 6px;">
                        <span style="width: 10px; height: 10px; background: ${coverageColors.pano}; border-radius: 2px; display: inline-block;"></span>
                        <span style="flex: 1;">Panorama:</span>
                        <span style="font-family: monospace;">${pano}%</span>
                    </div>
                    <div style="margin: 2px 0; display: flex; align-items: center; gap: 6px;">
                        <span style="width: 10px; height: 10px; background: ${coverageColors.regular}; border-radius: 2px; display: inline-block;"></span>
                        <span style="flex: 1;">Regular:</span>
                        <span style="font-family: monospace;">${regular}%</span>
                    </div>
                    <div style="margin: 2px 0; display: flex; align-items: center; gap: 6px;">
                        <span style="width: 10px; height: 10px; background: ${coverageColors.missing}; border-radius: 2px; display: inline-block;"></span>
                        <span style="flex: 1;">Fehlend:</span>
                        <span style="font-family: monospace;">${noCover}%</span>
                    </div>
                </div>
            </div>
            <div style="margin-top: 10px; border-top: 1px solid var(--border-color); padding-top: 8px;">
                <div style="font-size: 11px; font-weight: 600; margin-bottom: 6px;">Nach Straßentyp</div>
                <table style="width: 100%; border-collapse: collapse;">
                    <thead>
                        <tr>
                            <th style="padding: 4px 8px; text-align: left; font-size: 11px;">Typ</th>
                            <th style="padding: 4px 8px; text-align: right; font-size: 11px; color: ${coverageColors.pano};">Pano</th>
                            <th style="padding: 4px 8px; text-align: right; font-size: 11px; color: ${coverageColors.regular};">Regular</th>
                            <th style="padding: 4px 8px; text-align: right; font-size: 11px; color: ${coverageColors.missing};">Fehlend</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${detailRows}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    if (detailPopupHtmlCache.size > 200) {
        const firstKey = detailPopupHtmlCache.keys().next().value;
        detailPopupHtmlCache.delete(firstKey);
    }
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

        console.log('Feature properties:', properties);
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
    return MISSING_STREETS_SOURCE_DEFS.every((sourceDef) => hasSource(sourceDef.sourceId));
}

function scheduleMissingStreetsRetry() {
    if (missingStreetsRetryTimeoutId) return;

    missingStreetsRetryTimeoutId = setTimeout(() => {
        missingStreetsRetryTimeoutId = null;
        addMissingStreetsLayers();
    }, 750);
}

function addMissingStreetsLayers() {
    if (!map) return;

    if (!areMissingStreetSourcesReady()) {
        scheduleMissingStreetsRetry();
        return;
    }

    for (const sourceDef of MISSING_STREETS_SOURCE_DEFS) {
        for (const categoryDef of MISSING_STREETS_CATEGORY_DEFS) {
            addLayerIfMissing(createMissingStreetsLayerSpec(categoryDef, sourceDef));
        }
    }

    console.log('Missing Streets layers added');
}

function addMissingStreetsSources() {
    if (!map) return;

    for (const sourceDef of MISSING_STREETS_SOURCE_DEFS) {
        addSourceIfMissing(sourceDef.sourceId, {
            type: 'vector',
            tiles: sourceDef.tileConfig.tiles,
            minzoom: sourceDef.tileConfig.minzoom,
            maxzoom: sourceDef.tileConfig.maxzoom
        });
    }
}

function setMissingStreetsVisibility(visible) {
    setLayersVisibility(missingStreetsLayerIds, visible ? 'visible' : 'none');
}

const toggleInfoBtn = document.getElementById('toggle-info');
const closeInfoBtn = document.getElementById('close-info');
const infoPanel = document.querySelector('.info-panel');
const darkModeToggle = document.getElementById('dark-mode-toggle');
const toggleStreetsCheckbox = document.getElementById('toggle-streets-layer');
const streetsLegend = document.getElementById('streets-legend');
const streetsZoomWarning = document.getElementById('streets-zoom-warning');
const toggleKreiseCheckbox = document.getElementById('toggle-kreise-layer');
const kreiseLegend = document.getElementById('kreise-legend');

function updateStreetsZoomWarning() {
    if (!map || !streetsZoomWarning) return;

    const currentZoom = map.getZoom();
    const isStreetsChecked = Boolean(toggleStreetsCheckbox?.checked);

    streetsZoomWarning.style.display = isStreetsChecked && currentZoom < 9 ? 'block' : 'none';
}

function restoreLayerVisibilityFromUi() {
    const streetsVisible = Boolean(toggleStreetsCheckbox?.checked);
    setMissingStreetsVisibility(streetsVisible);

    coverageLayerVisible = Boolean(toggleKreiseCheckbox?.checked ?? true);
    applyCoverageVisibility();

    if (streetsLegend) {
        streetsLegend.style.display = streetsVisible ? 'flex' : 'none';
    }
    if (kreiseLegend) {
        kreiseLegend.style.display = coverageLayerVisible ? 'flex' : 'none';
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

    map.on('error', (event) => {
        const sourceId = event?.sourceId || event?.source?.id || event?.tile?.tileID?.canonical?.source;
        const tileInfo = event?.tile?.tileID?.canonical
            ? {
                z: event.tile.tileID.canonical.z,
                x: event.tile.tileID.canonical.x,
                y: event.tile.tileID.canonical.y
            }
            : null;

        const details = {
            message: event?.error?.message || 'Unknown map error',
            sourceId: sourceId || null,
            tile: tileInfo,
            status: event?.sourceDataType || null
        };

        console.error('MapLibre source error:', details);

        if (details.message === 'Decoding failed.' && details.sourceId && details.sourceId !== COVERAGE_SOURCE_ID) {
            console.warn(`Decode error is from source "${details.sourceId}" (not PMTiles coverage-data).`);
        }
    });

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

                addMissingStreetsSources();

                setTimeout(() => {
                    updateCoverageLayer();
                    addMissingStreetsLayers();
                    restoreLayerVisibilityFromUi();
                    updateStreetsZoomWarning();
                }, 500);
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
            console.log('Streets layer:', isChecked ? 'shown' : 'hidden');
        });
    }

    if (toggleKreiseCheckbox) {
        toggleKreiseCheckbox.addEventListener('change', (event) => {
            coverageLayerVisible = Boolean(event?.target?.checked);
            applyCoverageVisibility();

            if (kreiseLegend) {
                kreiseLegend.style.display = coverageLayerVisible ? 'flex' : 'none';
            }

            console.log('Coverage layer:', coverageLayerVisible ? 'shown' : 'hidden');
        });
    }

    map.on('load', () => {
        console.log('Map loaded');

        addMissingStreetsSources();

        setTimeout(() => {
            console.log('Adding initial layers...');

            try {
                updateCoverageLayer();
                addMissingStreetsLayers();
                restoreLayerVisibilityFromUi();
                updateStreetsZoomWarning();
            } catch (error) {
                console.error('Error adding layers:', error);
            }
        }, 500);
    });

    map.on('zoom', () => {
        updateCoverageLayer();
        updateStreetsZoomWarning();
    });
}

import { generatePieChartDataUrl } from './utils/generatePieIcon.js';
import { whenSourcesAvailable } from './utils/sourceReadiness.js';
import { attachMapErrorTelemetry } from './utils/errorTelemetry.js';
import { createCoveragePopupHtml, createCoverageDetailPopupHtml } from './popup/popupTemplates.js';
import { LruCache } from './utils/lruCache.js';
import {
    hasLayer,
    hasSource,
    removeLayerIfExists,
    removeSourceIfExists,
    addSourceIfMissing,
    addLayerIfMissing,
    setLayersVisibility
} from './map/mapSafeOps.js';
import { toPercent, toKilometers, firstFiniteNumber } from './utils/formatHelpers.js';
import {
    layerConfig,
    mapStyles,
    tileServers,
    trafficSignsConfig,
    trafficSignsStyle,
    initialMapConfig,
    mapAttribution,
    fillColorGradient,
    outlineStyle,
    lineWidthConfig,
    coverageColors,
    coverageLayerIds,
    missingStreetsLayerIds,
    missingStreetsMainRoadLayerIds,
    trafficSignsLayerIds,
    MISSING_STREETS_SOURCE_DEFS,
    MISSING_STREETS_CATEGORY_DEFS,
    MAIN_ROAD_CLASS_FILTER,
    HIGHWAY_TYPE_TO_VALUES
} from './config.js';

const COVERAGE_SOURCE_ID = 'coverage-data';
const COVERAGE_FILL_LAYER_ID = 'coverage-fill';
const COVERAGE_OUTLINE_LAYER_ID = 'coverage-outline';
const COVERAGE_SELECTED_SOURCE_ID = 'coverage-selected';
const COVERAGE_SELECTED_OUTLINE_LAYER_ID = 'coverage-selected-outline';
const COVERAGE_VEIL_SOURCE_ID = 'coverage-veil-mask';
const COVERAGE_VEIL_LAYER_ID = 'coverage-veil';
const COVERAGE_HOVER_OUTLINE_SOURCE_ID = 'coverage-hover-outline';
const COVERAGE_HOVER_OUTLINE_LAYER_ID = 'coverage-hover-outline';
/** Bbox [minLon, minLat, maxLon, maxLat] for veil mask (covers Germany). No tile boundaries = no seam. */
const VEIL_MASK_BBOX = [5, 46, 16, 56];

/** Ab diesem Zoom wird der Straßenabschnitte-Switch automatisch aktiviert (falls noch aus). */
const STREETS_AUTO_ENABLE_ZOOM = 9;

/** Ab Zoom 10 wird die Transparenz der Gebietsflächen automatisch auf diesen Wert gesetzt. */
const COVERAGE_OPACITY_AT_ZOOM_10 = 0.25;

let map;
let currentActiveLayer = null;
let coverageLayerVisible = true;
let manualCoverageLayerId = null;
let disposeMissingStreetsReadinessWatch = null;
let previousMapZoom = null;

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
    offset: 12,
    anchor: 'top-left'
});

let currentFeatureId = null;
let popupRafId = null;
let pendingPopupLngLat = null;
const popupHtmlCache = new LruCache(200);
const detailPopupHtmlCache = new LruCache(200);

/** When set, roads layers are filtered to this highway type for hover highlight. */
let hoveredHighwayType = null;

/** True while the user is dragging the detail popup (suppress hover tooltips). */
let isDraggingDetailPopup = false;

/** Current pixel offset of the detail popup (anchor stays at Gebiet). */
let detailPopupOffset = [0, 0];

/** Id of the feature whose detail popup is open (for veil filter). */
let selectedFeatureId = null;

const coverageBreakdownConfig = [
    { key: 'all', label: 'Gesamt' },
    { key: 'motorway', label: 'Motorway' },
    { key: 'trunk', label: 'Trunk' },
    { key: 'primary', label: 'Primary' },
    { key: 'secondary', label: 'Secondary' },
    { key: 'tertiary', label: 'Tertiary' }
];

const POPUP_VALUE_MODE_SHARE = 'share';
const POPUP_VALUE_MODE_LENGTH = 'length';
let popupValueMode = POPUP_VALUE_MODE_SHARE;
let currentHoverProps = null;
let currentDetailProps = null;
let coverageFillOpacity = 0.7;

function getActiveLayerConfig(zoom) {
    if (manualCoverageLayerId) {
        const manualLayer = layerConfig.find((layer) => layer.id === manualCoverageLayerId);
        if (manualLayer) {
            return manualLayer;
        }
    }

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
            'fill-opacity': coverageFillOpacity
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
    if (hasLayer(map, COVERAGE_HOVER_OUTLINE_LAYER_ID)) {
        map.setLayoutProperty(COVERAGE_HOVER_OUTLINE_LAYER_ID, 'visibility', visibility);
    }
}

function applyCoverageFillOpacity() {
    if (!map || !hasLayer(map, COVERAGE_FILL_LAYER_ID)) return;
    map.setPaintProperty(COVERAGE_FILL_LAYER_ID, 'fill-opacity', coverageFillOpacity);
}

function hexToRgb(hexColor) {
    const normalized = String(hexColor || '').trim().replace('#', '');
    if (!/^[0-9a-f]{6}$/i.test(normalized)) return null;

    return {
        r: parseInt(normalized.slice(0, 2), 16),
        g: parseInt(normalized.slice(2, 4), 16),
        b: parseInt(normalized.slice(4, 6), 16)
    };
}

function rgbToHex({ r, g, b }) {
    const toHex = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function blendHexColors(baseHex, targetHex, ratio) {
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

function getDynamicCoverageOutlineOpacity() {
    const baseOpacity = Number(outlineStyle.opacity) || 0;
    const additionalOpacity = (1 - coverageFillOpacity) * 0.35;
    return Math.max(baseOpacity, Math.min(1, baseOpacity + additionalOpacity));
}

function getDynamicCoverageOutlineColor() {
    const darkenRatio = (1 - coverageFillOpacity) * 0.8;
    return blendHexColors(outlineStyle.color, '#2f3745', darkenRatio);
}

function applyCoverageOutlineContrast() {
    if (!map || !hasLayer(map, COVERAGE_OUTLINE_LAYER_ID)) return;
    map.setPaintProperty(COVERAGE_OUTLINE_LAYER_ID, 'line-color', getDynamicCoverageOutlineColor());
    map.setPaintProperty(COVERAGE_OUTLINE_LAYER_ID, 'line-opacity', getDynamicCoverageOutlineOpacity());
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
    clearHoverOutline();

    addSourceIfMissing(map, COVERAGE_SOURCE_ID, {
        type: 'vector',
        url: activeLayer.pmtiles
    });

    addLayerIfMissing(map, createCoverageFillLayer());
    addLayerIfMissing(map, createCoverageOutlineLayer());
    addSourceIfMissing(map, COVERAGE_HOVER_OUTLINE_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: [] }
    });
    if (!hasLayer(map, COVERAGE_HOVER_OUTLINE_LAYER_ID)) {
        map.addLayer({
            id: COVERAGE_HOVER_OUTLINE_LAYER_ID,
            type: 'line',
            source: COVERAGE_HOVER_OUTLINE_SOURCE_ID,
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
                'line-opacity': 0.95
            }
        });
    }

    currentActiveLayer = activeLayer;
    attachCoverageLayerEvents();
    applyCoverageFillOpacity();
    applyCoverageOutlineContrast();
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

function getCoverageValuesForPrefix(props, prefix) {
    return {
        share: {
            pano: firstFiniteNumber(props?.[`${prefix}_share_pano`], props?.[`${prefix}_pano`]),
            regular: firstFiniteNumber(props?.[`${prefix}_share_regular`], props?.[`${prefix}_regular`]),
            missing: firstFiniteNumber(props?.[`${prefix}_share_no_cover`], props?.[`${prefix}_no_cover`])
        },
        length: {
            pano: firstFiniteNumber(props?.[`${prefix}_length_pano`]),
            regular: firstFiniteNumber(props?.[`${prefix}_length_regular`]),
            missing: firstFiniteNumber(props?.[`${prefix}_length_no_cover`])
        }
    };
}

function hasLengthValues(lengthValues) {
    return [lengthValues?.pano, lengthValues?.regular, lengthValues?.missing].some((value) => Number.isFinite(value));
}

function formatCoverageValue(value, unit) {
    if (unit === 'km') {
        return toKilometers(value);
    }
    return toPercent(value);
}

function getDisplayValuesForPrefix(props, prefix) {
    const coverageValues = getCoverageValuesForPrefix(props, prefix);
    const kmAvailable = hasLengthValues(coverageValues.length);
    const shouldUseKm = popupValueMode === POPUP_VALUE_MODE_LENGTH && kmAvailable;
    const valueUnit = shouldUseKm ? 'km' : '%';
    const selected = shouldUseKm ? coverageValues.length : coverageValues.share;

    return {
        valueUnit,
        kmAvailable,
        selected,
        share: coverageValues.share
    };
}

function getFeatureLabel(props) {
    const labelProperty = currentActiveLayer?.labelProperty || 'Name';
    const value = props[labelProperty] ?? props[labelProperty?.toLowerCase?.() ?? '']
        ?? props.NAME_2 ?? props.NAME_1;
    if (value != null && String(value).trim() !== '') return value;
    const firstString = props && Object.keys(props).find((k) => {
        const v = props[k];
        return typeof v === 'string' && v.trim() !== '' && !/^(all_|length_|share_)/.test(k);
    });
    return firstString ? props[firstString] : 'Unbekannt';
}

function getPopupHtml(props) {
    const name = getFeatureLabel(props);
    const values = getDisplayValuesForPrefix(props, 'all');
    const pano = formatCoverageValue(values.selected.pano, values.valueUnit);
    const regular = formatCoverageValue(values.selected.regular, values.valueUnit);
    const noCover = formatCoverageValue(values.selected.missing, values.valueUnit);

    const sharePano = toPercent(values.share.pano);
    const shareRegular = toPercent(values.share.regular);
    const shareNoCover = toPercent(values.share.missing);

    const cacheKey = `${name}|${popupValueMode}|${pano}|${regular}|${noCover}|${values.kmAvailable}`;
    const cached = popupHtmlCache.get(cacheKey);
    if (cached) return cached;

    const pieChartUrl = generatePieChartDataUrl({
        k1: parseFloat(sharePano),
        k2: parseFloat(shareRegular),
        k3: parseFloat(shareNoCover),
        size: 100
    });

    const html = createCoveragePopupHtml({
        name,
        pieChartUrl,
        pano,
        regular,
        missing: noCover,
        valueMode: popupValueMode,
        valueUnit: values.valueUnit,
        kmAvailable: values.kmAvailable,
        colors: coverageColors
    });

    popupHtmlCache.set(cacheKey, html);

    return html;
}

function hasCoverageBreakdown(props, prefix) {
    const keys = [
        `${prefix}_pano`, `${prefix}_regular`, `${prefix}_no_cover`,
        `${prefix}_share_pano`, `${prefix}_share_regular`, `${prefix}_share_no_cover`,
        `${prefix}_length_pano`, `${prefix}_length_regular`, `${prefix}_length_no_cover`
    ];
    return keys.some((key) => Number.isFinite(Number(props?.[key])));
}

function buildCoverageStatRows(props) {
    return coverageBreakdownConfig
        .filter(({ key }) => hasCoverageBreakdown(props, key))
        .map(({ key, label }) => {
            const values = getDisplayValuesForPrefix(props, key);
            const pano = formatCoverageValue(values.selected.pano, values.valueUnit);
            const regular = formatCoverageValue(values.selected.regular, values.valueUnit);
            const missing = formatCoverageValue(values.selected.missing, values.valueUnit);
            return { key, label, pano, regular, missing };
        });
}

function getDetailedPopupHtml(props) {
    const name = getFeatureLabel(props);
    const values = getDisplayValuesForPrefix(props, 'all');
    const pano = formatCoverageValue(values.selected.pano, values.valueUnit);
    const regular = formatCoverageValue(values.selected.regular, values.valueUnit);
    const noCover = formatCoverageValue(values.selected.missing, values.valueUnit);

    const sharePano = toPercent(values.share.pano);
    const shareRegular = toPercent(values.share.regular);
    const shareNoCover = toPercent(values.share.missing);

    const cacheKey = `${name}|${popupValueMode}|${pano}|${regular}|${noCover}|${values.kmAvailable}|detail`;
    const cached = detailPopupHtmlCache.get(cacheKey);
    if (cached) return cached;

    const pieChartUrl = generatePieChartDataUrl({
        k1: parseFloat(sharePano),
        k2: parseFloat(shareRegular),
        k3: parseFloat(shareNoCover),
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
        valueMode: popupValueMode,
        valueUnit: values.valueUnit,
        kmAvailable: values.kmAvailable,
        colors: coverageColors
    });

    detailPopupHtmlCache.set(cacheKey, html);

    return html;
}

function bindPopupUnitToggle(popupInstanceOrElement) {
    const fromPopup = popupInstanceOrElement?.getElement?.();
    const el = fromPopup ?? (popupInstanceOrElement && typeof popupInstanceOrElement.querySelector === 'function' ? popupInstanceOrElement : null);
    if (!el) return;

    const toggleInput = el.querySelector('.popup-unit-toggle-input');
    if (!toggleInput) return;

    toggleInput.onchange = (event) => {
        const checked = Boolean(event?.target?.checked);
        popupValueMode = checked ? POPUP_VALUE_MODE_LENGTH : POPUP_VALUE_MODE_SHARE;
        refreshOpenCoveragePopups();
    };
}

function makeDetailPopupDraggable(mapInstance, popupInstance) {
    const popupEl = popupInstance?.getElement?.();
    const handle = popupEl?.querySelector('.popup-detail-drag-handle');
    if (!mapInstance || !popupInstance || !handle) return;

    let dragging = false;

    function onMouseDown(e) {
        if (e.button !== 0) return;
        dragging = true;
        isDraggingDetailPopup = true;
        popup.remove();
        e.preventDefault();
        const startClientX = e.clientX;
        const startClientY = e.clientY;
        const startOffsetX = detailPopupOffset[0];
        const startOffsetY = detailPopupOffset[1];

        function onMouseMove(ev) {
            if (!dragging || !mapInstance.getContainer()) return;
            const dx = ev.clientX - startClientX;
            const dy = ev.clientY - startClientY;
            const newOffset = [startOffsetX + dx, startOffsetY + dy];
            detailPopupOffset[0] = newOffset[0];
            detailPopupOffset[1] = newOffset[1];
            popupInstance.setOffset(newOffset);
        }

        function onMouseUp() {
            dragging = false;
            isDraggingDetailPopup = false;
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        }

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    }

    handle.addEventListener('mousedown', onMouseDown);
}

function bindDetailTableRowHover(popupElement, mapInstance) {
    const tbody = popupElement?.querySelector('.popup-table tbody');
    if (!tbody || !mapInstance) return;

    const rows = tbody.querySelectorAll('tr[data-highway-type]');

    function highlightRow(row) {
        rows.forEach((r) => r.classList.remove('highway-type-hover'));
        if (row) row.classList.add('highway-type-hover');
    }

    function onRowEnter(e) {
        const row = e.target.closest('tr[data-highway-type]');
        if (!row) return;
        const key = row.getAttribute('data-highway-type');
        highlightRow(row);
        setHighwayTypeHighlight(key);
    }

    function onRowLeave(e) {
        const row = e.target.closest('tr[data-highway-type]');
        if (!row) return;
        const related = e.relatedTarget;
        if (related && row.contains(related)) return;
        highlightRow(null);
        clearHighwayTypeHighlight();
    }

    rows.forEach((row) => {
        row.addEventListener('mouseenter', onRowEnter);
        row.addEventListener('mouseleave', onRowLeave);
    });
}

function refreshOpenCoveragePopups() {
    if (popup?.isOpen() && currentHoverProps) {
        const hoverHtml = getPopupHtml(currentHoverProps);
        popup.setHTML(hoverHtml);
        bindPopupUnitToggle(popup);
    }

    if (detailPanel && !detailPanel.hidden && currentDetailProps && detailPanelContent) {
        if (detailPanelLayerHint) {
            detailPanelLayerHint.textContent = currentActiveLayer?.name ? `Gebietsebene: ${currentActiveLayer.name}` : '';
        }
        const detailHtml = getDetailedPopupHtml(currentDetailProps);
        detailPanelContent.innerHTML = detailHtml;
        bindPopupUnitToggle(detailPanelContent);
        bindDetailTableRowHover(detailPanelContent, map);
    }
}

function setHoverOutline(geometry) {
    if (!map || !hasSource(map, COVERAGE_HOVER_OUTLINE_SOURCE_ID)) return;
    const outlineGeometry = geometryExteriorOnly(geometry);
    map.getSource(COVERAGE_HOVER_OUTLINE_SOURCE_ID).setData({
        type: 'Feature',
        geometry: outlineGeometry,
        properties: {}
    });
}

function clearHoverOutline() {
    if (!map || !hasSource(map, COVERAGE_HOVER_OUTLINE_SOURCE_ID)) return;
    map.getSource(COVERAGE_HOVER_OUTLINE_SOURCE_ID).setData({
        type: 'FeatureCollection',
        features: []
    });
}

function handleCoverageHover(event) {
    if (!map || isDraggingDetailPopup) return;

    map.getCanvas().style.cursor = 'pointer';

    const features = Array.isArray(event?.features) ? event.features : [];
    if (features.length === 0) {
        clearHoverOutline();
        return;
    }

    const feature = features[0];
    const props = feature?.properties || {};
    const geometry = feature?.geometry;
    const featureId = feature?.id || props.ID_0;
    currentHoverProps = props;

    if (geometry) setHoverOutline(geometry);

    pendingPopupLngLat = event.lngLat;

    if (featureId !== currentFeatureId) {
        currentFeatureId = featureId;

        const html = getPopupHtml(props);
        popup.setHTML(html);
        bindPopupUnitToggle(popup);

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
    currentHoverProps = null;
    popup.remove();
    pendingPopupLngLat = null;
    clearHoverOutline();

    if (popupRafId) {
        cancelAnimationFrame(popupRafId);
        popupRafId = null;
    }
}

/** Use only exterior ring(s) of polygon geometry to avoid drawing inner boundaries (e.g. thin slits) as visible lines. */
function geometryExteriorOnly(geometry) {
    if (!geometry) return geometry;
    if (geometry.type === 'Polygon' && geometry.coordinates?.length) {
        return { type: 'Polygon', coordinates: [geometry.coordinates[0]] };
    }
    if (geometry.type === 'MultiPolygon' && geometry.coordinates?.length) {
        return {
            type: 'MultiPolygon',
            coordinates: geometry.coordinates.map((part) => [part[0]])
        };
    }
    return geometry;
}

/** Build a single polygon that covers VEIL_MASK_BBOX with hole(s) for the selected feature. No tiles → no tile-boundary seam. */
function buildVeilMaskGeometry(selectedExteriorGeometry) {
    const [minLon, minLat, maxLon, maxLat] = VEIL_MASK_BBOX;
    const exterior = [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat]
    ];
    const reverseRing = (ring) => ring.slice(0, -1).reverse().concat([ring[0]]);
    let holes = [];
    if (selectedExteriorGeometry?.type === 'Polygon' && selectedExteriorGeometry.coordinates?.[0]) {
        holes = [reverseRing(selectedExteriorGeometry.coordinates[0])];
    } else if (selectedExteriorGeometry?.type === 'MultiPolygon' && selectedExteriorGeometry.coordinates?.length) {
        holes = selectedExteriorGeometry.coordinates.map((part) => reverseRing(part[0]));
    }
    return { type: 'Polygon', coordinates: [exterior, ...holes] };
}

function setSelectedFeatureOutline(geometry) {
    if (!map) return;
    removeLayerIfExists(map, COVERAGE_VEIL_LAYER_ID);
    removeLayerIfExists(map, COVERAGE_SELECTED_OUTLINE_LAYER_ID);
    removeSourceIfExists(map, COVERAGE_SELECTED_SOURCE_ID);
    removeSourceIfExists(map, COVERAGE_VEIL_SOURCE_ID);

    if (!hasSource(map, COVERAGE_SOURCE_ID)) return;

    const outlineGeometry = geometryExteriorOnly(geometry);
    addSourceIfMissing(map, COVERAGE_SELECTED_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'Feature', geometry: outlineGeometry, properties: {} }
    });

    const selectedLineWidth = [
        'interpolate',
        ['exponential', 1],
        ['zoom'],
        5, 1.25,
        8, 2.5,
        12, 5
    ];
    map.addLayer({
        id: COVERAGE_SELECTED_OUTLINE_LAYER_ID,
        type: 'line',
        source: COVERAGE_SELECTED_SOURCE_ID,
        paint: {
            'line-color': outlineStyle.color,
            'line-width': selectedLineWidth,
            'line-opacity': 1
        }
    });

    const veilGeometry = buildVeilMaskGeometry(outlineGeometry);
    addSourceIfMissing(map, COVERAGE_VEIL_SOURCE_ID, {
        type: 'geojson',
        data: { type: 'Feature', geometry: veilGeometry, properties: {} }
    });
    map.addLayer({
        id: COVERAGE_VEIL_LAYER_ID,
        type: 'fill',
        source: COVERAGE_VEIL_SOURCE_ID,
        paint: {
            'fill-color': '#ffffff',
            'fill-opacity': 0.55
        }
    }, COVERAGE_SELECTED_OUTLINE_LAYER_ID);
}

function clearSelectedFeatureOutline() {
    if (!map) return;
    removeLayerIfExists(map, COVERAGE_VEIL_LAYER_ID);
    removeLayerIfExists(map, COVERAGE_SELECTED_OUTLINE_LAYER_ID);
    removeSourceIfExists(map, COVERAGE_SELECTED_SOURCE_ID);
    removeSourceIfExists(map, COVERAGE_VEIL_SOURCE_ID);
}

function closeDetailPanel() {
    if (detailPanel) detailPanel.hidden = true;
    clearHighwayTypeHighlight();
    clearSelectedFeatureOutline();
}

function openDetailPanel(html) {
    if (!detailPanel || !detailPanelContent) return;
    if (detailPanelLayerHint) {
        detailPanelLayerHint.textContent = currentActiveLayer?.name ? `Gebietsebene: ${currentActiveLayer.name}` : '';
    }
    detailPanelContent.innerHTML = html;
    detailPanel.hidden = false;
    bindPopupUnitToggle(detailPanelContent);
    bindDetailTableRowHover(detailPanelContent, map);
}

function handleCoverageClick(event) {
    const features = Array.isArray(event?.features) ? event.features : [];
    if (features.length > 0) {
        clearHoverOutline();
        const feature = features[0];
        const properties = feature?.properties || {};
        const geometry = feature?.geometry;
        currentDetailProps = properties;
        const idProp = currentActiveLayer?.labelProperty || 'Kreis';
        selectedFeatureId = properties?.[idProp] ?? feature?.id ?? properties?.ID_0 ?? properties?.ID_1 ?? properties?.ID_2 ?? properties?.AGS_0 ?? properties?.Kreis ?? properties?.Gemeinde ?? properties?.Bundesland;

        popup.remove();
        currentFeatureId = null;
        currentHoverProps = null;

        const html = getDetailedPopupHtml(properties);
        openDetailPanel(html);

        if (geometry) {
            setSelectedFeatureOutline(geometry);
        }
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
    if (!map) return;
    const showMainRoadsOnly = Boolean(toggleMainRoadsOnlyCheckbox?.checked);

    applyMissingStreetsRoadClassFilter(showMainRoadsOnly);

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

function getHighwayTypeFilter(highwayTypeKey) {
    const values = HIGHWAY_TYPE_TO_VALUES[highwayTypeKey];
    if (!values || values.length === 0) return null;

    return [
        'in',
        ['downcase', ['to-string', ['coalesce', ['get', 'road'], ['get', 'highway'], '']]],
        ['literal', values]
    ];
}

function setHighwayTypeHighlight(highwayTypeKey) {
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

function clearHighwayTypeHighlight() {
    if (!map || hoveredHighwayType == null) return;

    hoveredHighwayType = null;
    const showMainRoadsOnly = Boolean(toggleMainRoadsOnlyCheckbox?.checked);
    applyMissingStreetsRoadClassFilter(showMainRoadsOnly);
}

function applyMissingStreetsRoadClassFilter(showMainRoadsOnly) {
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
    if (!map) return;
    setLayersVisibility(map, trafficSignsLayerIds, visible ? 'visible' : 'none');
}

const toggleInfoBtn = document.getElementById('toggle-info');
const closeInfoBtn = document.getElementById('close-info');
const infoPanel = document.querySelector('.info-panel');
const darkModeToggle = document.getElementById('dark-mode-toggle');
const toggleStreetsCheckbox = document.getElementById('toggle-streets-layer');
const toggleMainRoadsOnlyCheckbox = document.getElementById('toggle-main-roads-only');
const streetsLegend = document.getElementById('streets-legend');
const streetsZoomWarning = document.getElementById('streets-zoom-warning');
const toggleTrafficSignsCheckbox = document.getElementById('toggle-traffic-signs-layer');
const trafficSignsLegend = document.getElementById('traffic-signs-legend');
const trafficSignsZoomWarning = document.getElementById('traffic-signs-zoom-warning');
const toggleKreiseCheckbox = document.getElementById('toggle-kreise-layer');
const kreiseLegend = document.getElementById('kreise-legend');
const coverageLayerControl = document.getElementById('coverage-layer-control');
const coverageLayerStatus = document.getElementById('coverage-layer-status');
const coverageFillOpacitySlider = document.getElementById('coverage-fill-opacity-slider');
const coverageFillOpacityValue = document.getElementById('coverage-fill-opacity-value');
const infoContent = document.querySelector('.info-content');
const detailPanel = document.getElementById('detail-panel');
const detailPanelContent = detailPanel?.querySelector('.detail-panel-content');
const detailPanelLayerHint = document.getElementById('detail-panel-layer-hint');
const detailPanelCloseBtn = document.getElementById('detail-panel-close');

function getCoverageLayersForControl() {
    return [...layerConfig].sort((a, b) => a.minZoom - b.minZoom);
}

function getCurrentCoverageLayerForUi() {
    if (currentActiveLayer) return currentActiveLayer;

    const zoomForEvaluation = map ? map.getZoom() : initialMapConfig.zoom;
    return getActiveLayerConfig(zoomForEvaluation);
}

function updateCoverageLayerControlUi() {
    if (!coverageLayerControl) return;

    const activeLayer = getCurrentCoverageLayerForUi();
    const activeLayerId = activeLayer?.id || '';
    const selectedLayerId = manualCoverageLayerId || 'auto';

    const buttons = coverageLayerControl.querySelectorAll('.coverage-level-btn');
    buttons.forEach((button) => {
        const layerId = button.dataset.layerId || '';
        button.classList.toggle('is-active', layerId === activeLayerId);
        button.classList.toggle('is-selected', layerId === selectedLayerId);
    });

    if (!coverageLayerStatus) return;

    if (!activeLayer) {
        coverageLayerStatus.textContent = 'Aktiv: –';
        return;
    }

    const modeLabel = manualCoverageLayerId ? 'manuell' : 'Auto (Zoom)';
    coverageLayerStatus.textContent = `Aktiv: ${activeLayer.name} · ${modeLabel}`;
}

function setManualCoverageLayer(layerId) {
    manualCoverageLayerId = layerId;
    updateCoverageLayer();
    updateCoverageLayerControlUi();
}

function buildCoverageLayerControl() {
    if (!coverageLayerControl) return;

    const layerOptions = getCoverageLayersForControl();
    coverageLayerControl.innerHTML = '';

    const autoButton = document.createElement('button');
    autoButton.type = 'button';
    autoButton.className = 'coverage-level-btn';
    autoButton.dataset.layerId = 'auto';
    autoButton.textContent = 'Auto';
    autoButton.addEventListener('click', () => setManualCoverageLayer(null));
    coverageLayerControl.appendChild(autoButton);

    layerOptions.forEach((layer) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'coverage-level-btn';
        button.dataset.layerId = layer.id;
        button.textContent = layer.name;
        button.addEventListener('click', () => setManualCoverageLayer(layer.id));
        coverageLayerControl.appendChild(button);
    });

    updateCoverageLayerControlUi();
}

function updateCoverageFillOpacityUi(value) {
    if (!coverageFillOpacityValue) return;
    const percent = Math.round(Number(value) * 100);
    coverageFillOpacityValue.textContent = `${percent}%`;
}

function setElementVisibility(element, visible, displayMode = 'flex') {
    if (!element) return;
    element.style.display = visible ? displayMode : 'none';
}

function normalizeInfoPanelScroll() {
    if (!infoContent) return;

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const maxScrollTop = Math.max(0, infoContent.scrollHeight - infoContent.clientHeight);
            if (maxScrollTop <= 1) {
                infoContent.scrollTop = 0;
                return;
            }
            if (infoContent.scrollTop > maxScrollTop) {
                infoContent.scrollTop = maxScrollTop;
            }
        });
    });
}

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

    setElementVisibility(streetsLegend, streetsVisible);
    setElementVisibility(kreiseLegend, coverageLayerVisible);
    setElementVisibility(trafficSignsLegend, trafficSignsVisible);

    updateCoverageLayerControlUi();
    normalizeInfoPanelScroll();
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
        const shouldOpen = infoPanel.style.display === 'none';
        infoPanel.style.display = shouldOpen ? 'flex' : 'none';

        if (shouldOpen && infoContent) {
            infoContent.scrollTop = 0;
        }

        normalizeInfoPanelScroll();
    });
}

if (closeInfoBtn && infoPanel) {
    closeInfoBtn.addEventListener('click', () => {
        infoPanel.style.display = 'none';
        if (infoContent) {
            infoContent.scrollTop = 0;
        }
    });
}

if (detailPanelCloseBtn) {
    detailPanelCloseBtn.addEventListener('click', closeDetailPanel);
}

if (typeof maplibregl === 'undefined' || typeof pmtiles === 'undefined') {
    console.error('Map dependencies are missing: maplibregl and/or pmtiles are not available.');
} else {
    buildCoverageLayerControl();

    const protocol = new pmtiles.Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);

    map = new maplibregl.Map({
        container: 'map',
        style: mapStyles.light,
        center: initialMapConfig.center,
        zoom: initialMapConfig.zoom,
        attributionControl: false
    });

    map.addControl(new maplibregl.AttributionControl({ customAttribution: mapAttribution, compact: true }));

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
                updateCoverageLayerControlUi();
            });
        });
    }

    if (toggleStreetsCheckbox) {
        toggleStreetsCheckbox.addEventListener('change', (event) => {
            const isChecked = Boolean(event?.target?.checked);
            setMissingStreetsVisibility(isChecked);

            setElementVisibility(streetsLegend, isChecked);

            updateStreetsZoomWarning();
            normalizeInfoPanelScroll();
        });
    }

    if (toggleMainRoadsOnlyCheckbox) {
        toggleMainRoadsOnlyCheckbox.addEventListener('change', () => {
            setMissingStreetsVisibility(Boolean(toggleStreetsCheckbox?.checked));
            normalizeInfoPanelScroll();
        });
    }

    if (toggleTrafficSignsCheckbox) {
        toggleTrafficSignsCheckbox.addEventListener('change', (event) => {
            const isChecked = Boolean(event?.target?.checked);
            setTrafficSignsVisibility(isChecked);

            setElementVisibility(trafficSignsLegend, isChecked);

            updateTrafficSignsZoomWarning();
            normalizeInfoPanelScroll();
        });
    }

    if (toggleKreiseCheckbox) {
        toggleKreiseCheckbox.addEventListener('change', (event) => {
            coverageLayerVisible = Boolean(event?.target?.checked);
            applyCoverageVisibility();

            setElementVisibility(kreiseLegend, coverageLayerVisible);

            normalizeInfoPanelScroll();
        });
    }

    if (coverageFillOpacitySlider) {
        const initialOpacity = Number(coverageFillOpacitySlider.value) / 100;
        if (Number.isFinite(initialOpacity)) {
            coverageFillOpacity = Math.max(0, Math.min(1, initialOpacity));
        }
        updateCoverageFillOpacityUi(coverageFillOpacity);

        coverageFillOpacitySlider.addEventListener('input', (event) => {
            const nextOpacity = Number(event?.target?.value) / 100;
            if (!Number.isFinite(nextOpacity)) return;

            coverageFillOpacity = Math.max(0, Math.min(1, nextOpacity));
            updateCoverageFillOpacityUi(coverageFillOpacity);
            applyCoverageFillOpacity();
            applyCoverageOutlineContrast();
        });
    }

    map.on('load', () => {
        const initialZoom = map.getZoom();
        previousMapZoom = initialZoom;
        rebuildRuntimeLayers();
        if (initialZoom >= STREETS_AUTO_ENABLE_ZOOM) {
            coverageFillOpacity = COVERAGE_OPACITY_AT_ZOOM_10;
            if (coverageFillOpacitySlider) {
                coverageFillOpacitySlider.value = Math.round(coverageFillOpacity * 100);
                updateCoverageFillOpacityUi(coverageFillOpacity);
            }
            applyCoverageFillOpacity();
            applyCoverageOutlineContrast();
        }
        updateCoverageLayerControlUi();
    });

    map.on('zoomend', () => {
        updateCoverageLayer();

        const zoom = map.getZoom();

        if (zoom >= STREETS_AUTO_ENABLE_ZOOM && toggleStreetsCheckbox && !toggleStreetsCheckbox.checked) {
            toggleStreetsCheckbox.checked = true;
            setMissingStreetsVisibility(true);
            setElementVisibility(streetsLegend, true);
        } else {
            setMissingStreetsVisibility(Boolean(toggleStreetsCheckbox?.checked));
        }

        if (previousMapZoom !== null && previousMapZoom < STREETS_AUTO_ENABLE_ZOOM && zoom >= STREETS_AUTO_ENABLE_ZOOM) {
            coverageFillOpacity = COVERAGE_OPACITY_AT_ZOOM_10;
            if (coverageFillOpacitySlider) {
                coverageFillOpacitySlider.value = Math.round(coverageFillOpacity * 100);
                updateCoverageFillOpacityUi(coverageFillOpacity);
            }
            applyCoverageFillOpacity();
            applyCoverageOutlineContrast();
        }

        previousMapZoom = zoom;
        updateStreetsZoomWarning();
        updateTrafficSignsZoomWarning();
        updateCoverageLayerControlUi();
    });
}

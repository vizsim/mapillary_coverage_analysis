import { generatePieChartDataUrl } from './utils/generatePieIcon.js';
import { addDefaultTrafficSignIcon, addTrafficSignCircleImages, setupTrafficSignImageHandler } from './utils/trafficSignIcons.js';
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
import {
    COVERAGE_HOVER_OUTLINE_LAYER_ID,
    createHoverOutlineLayerSpec,
    setHoverOutlineState,
    clearHoverOutline
} from './map/coverageHover.js';
import {
    addTrafficSignsSource,
    addTrafficSignsLayer,
    setTrafficSignsVisibility,
    setTrafficSignsDateCutoff
} from './map/trafficSignsLayers.js';
import {
    addMissingStreetsSources,
    addMissingStreetsLayers,
    setMissingStreetsVisibility,
    clearMissingStreetsReadinessWatch,
    setHighwayTypeHighlight,
    clearHighwayTypeHighlight
} from './map/missingStreetsLayers.js';
import {
    addBikeLanesSource,
    addBikeLanesLayers,
    setBikeLanesVisibility
} from './map/bikeLanesLayers.js';
import {
    COVERAGE_SOURCE_ID,
    COVERAGE_FILL_LAYER_ID,
    COVERAGE_OUTLINE_LAYER_ID,
    createCoverageFillLayer,
    createCoverageOutlineLayer,
    applyCoverageVisibility as applyCoverageVisibilityFromModule,
    applyCoverageFillOpacity as applyCoverageFillOpacityFromModule,
    applyCoverageOutlineContrast as applyCoverageOutlineContrastFromModule
} from './map/coverageLayers.js';
import {
    COVERAGE_SELECTED_OUTLINE_LAYER_ID,
    COVERAGE_VEIL_LAYER_ID,
    setSelectedFeatureOutline,
    clearSelectedFeatureOutline
} from './map/coverageSelection.js';
import { toPercent, toKilometers, firstFiniteNumber } from './utils/formatHelpers.js';
import { parseMapFromSearchParams, buildMapParam, updateUrlMapParam } from './utils/permalink.js';
import { loadLayerUpdateDates } from './utils/layerUpdateDates.js';
import {
    layerConfig,
    mapStyles,
    tileServers,
    trafficSignsConfig,
    trafficSignsStyle,
    initialMapConfig,
    mapAttribution,
    coverageColors,
    coverageLayerIds,
    missingStreetsLayerIds,
    missingStreetsMainRoadLayerIds,
    trafficSignsLayerIds,
    TRAFFIC_SIGNS_ICON_MIN_ZOOM,
} from './config.js';

/** Ab diesem Zoom wird der Straßenabschnitte-Switch automatisch aktiviert (falls noch aus). */
const STREETS_AUTO_ENABLE_ZOOM = 9;

/** Ab Zoom 10 wird die Transparenz der Gebietsflächen automatisch auf diesen Wert gesetzt. */
const COVERAGE_OPACITY_AT_ZOOM_10 = 0.25;

let map;
let currentActiveLayer = null;
let coverageLayerVisible = true;
let manualCoverageLayerId = null;
let previousMapZoom = null;

/** True nach dem ersten automatischen Aktivieren des Straßensegmente-Layers bei Zoom ≥ STREETS_AUTO_ENABLE_ZOOM (nur einmal pro Session). */
let streetsAutoEnabledOnce = false;

/** True nach der ersten automatischen Anpassung der Gebietsflächen-Transparenz bei Zoom ≥ STREETS_AUTO_ENABLE_ZOOM (nur einmal pro Session). */
let coverageOpacityAutoAdjustedOnce = false;

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

function applyCoverageVisibility() {
    const visibility = coverageLayerVisible ? 'visible' : 'none';
    applyCoverageVisibilityFromModule(map, visibility, COVERAGE_HOVER_OUTLINE_LAYER_ID);
}

function applyCoverageFillOpacity() {
    applyCoverageFillOpacityFromModule(map, coverageFillOpacity);
}

function applyCoverageOutlineContrast() {
    applyCoverageOutlineContrastFromModule(map, coverageFillOpacity);
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

    removeLayerIfExists(map, COVERAGE_VEIL_LAYER_ID);
    removeLayerIfExists(map, COVERAGE_SELECTED_OUTLINE_LAYER_ID);
    removeLayerIfExists(map, COVERAGE_HOVER_OUTLINE_LAYER_ID);
    coverageLayerIds.forEach((layerId) => removeLayerIfExists(map, layerId));
    removeSourceIfExists(map, COVERAGE_SOURCE_ID);

    addSourceIfMissing(map, COVERAGE_SOURCE_ID, {
        type: 'vector',
        url: activeLayer.pmtiles
    });

    addLayerIfMissing(map, createCoverageFillLayer(coverageFillOpacity));
    addLayerIfMissing(map, createCoverageOutlineLayer());
    map.addLayer(createHoverOutlineLayerSpec(COVERAGE_SOURCE_ID));

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

function formatCoverageValue(value, unit, wholeNumbersForKm = false) {
    if (unit === 'km') {
        return toKilometers(value, wholeNumbersForKm);
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
    const wholeNumbersForKm = currentActiveLayer?.id === 'bundesland';
    const pano = formatCoverageValue(values.selected.pano, values.valueUnit, wholeNumbersForKm);
    const regular = formatCoverageValue(values.selected.regular, values.valueUnit, wholeNumbersForKm);
    const noCover = formatCoverageValue(values.selected.missing, values.valueUnit, wholeNumbersForKm);

    const sharePano = toPercent(values.share.pano);
    const shareRegular = toPercent(values.share.regular);
    const shareNoCover = toPercent(values.share.missing);

    const cacheKey = `${name}|${popupValueMode}|${pano}|${regular}|${noCover}|${values.kmAvailable}`;
    const cached = popupHtmlCache.get(cacheKey);
    if (cached) return cached;

    const pieChartUrl = generatePieChartDataUrl({
        k1: (values.share.pano ?? 0) * 100,
        k2: (values.share.regular ?? 0) * 100,
        k3: (values.share.missing ?? 0) * 100,
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
    const wholeNumbersForKm = currentActiveLayer?.id === 'bundesland';
    return coverageBreakdownConfig
        .filter(({ key }) => hasCoverageBreakdown(props, key))
        .map(({ key, label }) => {
            const values = getDisplayValuesForPrefix(props, key);
            const pano = formatCoverageValue(values.selected.pano, values.valueUnit, wholeNumbersForKm);
            const regular = formatCoverageValue(values.selected.regular, values.valueUnit, wholeNumbersForKm);
            const missing = formatCoverageValue(values.selected.missing, values.valueUnit, wholeNumbersForKm);
            return { key, label, pano, regular, missing };
        });
}

function getDetailedPopupHtml(props) {
    const name = getFeatureLabel(props);
    const values = getDisplayValuesForPrefix(props, 'all');
    const wholeNumbersForKm = currentActiveLayer?.id === 'bundesland';
    const pano = formatCoverageValue(values.selected.pano, values.valueUnit, wholeNumbersForKm);
    const regular = formatCoverageValue(values.selected.regular, values.valueUnit, wholeNumbersForKm);
    const noCover = formatCoverageValue(values.selected.missing, values.valueUnit, wholeNumbersForKm);

    const sharePano = toPercent(values.share.pano);
    const shareRegular = toPercent(values.share.regular);
    const shareNoCover = toPercent(values.share.missing);

    const cacheKey = `${name}|${popupValueMode}|${pano}|${regular}|${noCover}|${values.kmAvailable}|detail`;
    const cached = detailPopupHtmlCache.get(cacheKey);
    if (cached) return cached;

    const pieChartUrl = generatePieChartDataUrl({
        k1: (values.share.pano ?? 0) * 100,
        k2: (values.share.regular ?? 0) * 100,
        k3: (values.share.missing ?? 0) * 100,
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
        setHighwayTypeHighlight(map, key);
    }

    function onRowLeave(e) {
        const row = e.target.closest('tr[data-highway-type]');
        if (!row) return;
        const related = e.relatedTarget;
        if (related && row.contains(related)) return;
        highlightRow(null);
        clearHighwayTypeHighlight(map, Boolean(toggleMainRoadsOnlyCheckbox?.checked));
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

function handleCoverageHover(event) {
    if (!map || isDraggingDetailPopup) return;

    map.getCanvas().style.cursor = 'pointer';

    const features = Array.isArray(event?.features) ? event.features : [];
    if (features.length === 0) {
        clearHoverOutline(map, COVERAGE_SOURCE_ID);
        return;
    }

    const feature = features[0];
    const props = feature?.properties || {};
    const idProperty = currentActiveLayer?.labelProperty || 'Kreis';
    const featureId = feature?.id ?? props?.ID_0;
    currentHoverProps = props;

    if (typeof window !== 'undefined' && window.__COVERAGE_DEBUG_HOVER__) {
        console.log('Hover – was aus dem Event kommt:', {
            'feature.id': feature?.id,
            'feature.id Typ': typeof feature?.id,
            [idProperty]: props?.[idProperty]
        });
    }

    setHoverOutlineState(map, COVERAGE_SOURCE_ID, feature?.id);

    // Don’t show tooltip for the feature that’s already open in the detail panel
    if (detailPanel && !detailPanel.hidden && selectedFeatureId != null) {
        const selectionId = props?.[idProperty] ?? feature?.id ?? props?.ID_0 ?? props?.ID_1 ?? props?.ID_2 ?? props?.AGS_0 ?? props?.Kreis ?? props?.Gemeinde ?? props?.Bundesland;
        if (selectionId != null && String(selectionId) === String(selectedFeatureId)) {
            popup.remove();
            currentFeatureId = null;
            pendingPopupLngLat = null;
            if (popupRafId) {
                cancelAnimationFrame(popupRafId);
                popupRafId = null;
            }
            return;
        }
    }

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
    clearHoverOutline(map, COVERAGE_SOURCE_ID);

    if (popupRafId) {
        cancelAnimationFrame(popupRafId);
        popupRafId = null;
    }
}

function closeDetailPanel() {
    if (detailPanel) detailPanel.hidden = true;
    clearHighwayTypeHighlight(map, Boolean(toggleMainRoadsOnlyCheckbox?.checked));
    clearSelectedFeatureOutline(map);
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
        clearHoverOutline(map, COVERAGE_SOURCE_ID);
        const feature = features[0];
        const properties = feature?.properties || {};
        currentDetailProps = properties;
        const idProp = currentActiveLayer?.labelProperty || 'Kreis';
        selectedFeatureId = properties?.[idProp] ?? feature?.id ?? properties?.ID_0 ?? properties?.ID_1 ?? properties?.ID_2 ?? properties?.AGS_0 ?? properties?.Kreis ?? properties?.Gemeinde ?? properties?.Bundesland;

        popup.remove();
        currentFeatureId = null;
        currentHoverProps = null;

        const html = getDetailedPopupHtml(properties);
        openDetailPanel(html);

        setSelectedFeatureOutline(map, COVERAGE_SOURCE_ID, 'default', selectedFeatureId, currentActiveLayer?.labelProperty || 'Kreis');
    }
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
const trafficSignsLegendCircles = document.getElementById('traffic-signs-legend-circles');
const trafficSignsLegendIcons = document.getElementById('traffic-signs-legend-icons');
const trafficSignsZoomWarning = document.getElementById('traffic-signs-zoom-warning');
const toggleBikeLanesCheckbox = document.getElementById('toggle-bike-lanes-layer');
const bikeLanesLegend = document.getElementById('bike-lanes-legend');
const bikeLanesZoomWarning = document.getElementById('bike-lanes-zoom-warning');
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

/** Info-Tooltips mit position:fixed positionieren, damit sie die Panel-Scrollhöhe nicht aufblähen. */
function setupInfoPanelTooltips() {
    if (!infoPanel) return;
    const icons = infoPanel.querySelectorAll('.info-icon');
    const gap = 8;
    icons.forEach((icon) => {
        const tooltip = icon.querySelector('.info-tooltip');
        if (!tooltip) return;
        icon.addEventListener('mouseenter', () => {
            const r = icon.getBoundingClientRect();
            tooltip.style.right = `${window.innerWidth - r.right}px`;
            tooltip.style.left = 'auto';
            tooltip.style.top = `${r.bottom + gap}px`;
        });
    });
}
setupInfoPanelTooltips();
loadLayerUpdateDates({
    onStreetsCutoff: (ymd) => setTrafficSignsDateCutoff(map, ymd)
});

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

    const rowAuto = document.createElement('div');
    rowAuto.className = 'coverage-level-buttons-row';
    const autoButton = document.createElement('button');
    autoButton.type = 'button';
    autoButton.className = 'coverage-level-btn';
    autoButton.dataset.layerId = 'auto';
    autoButton.textContent = 'Auto';
    autoButton.addEventListener('click', () => setManualCoverageLayer(null));
    rowAuto.appendChild(autoButton);
    coverageLayerControl.appendChild(rowAuto);

    const rowLayers = document.createElement('div');
    rowLayers.className = 'coverage-level-buttons-row';
    layerOptions.forEach((layer) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'coverage-level-btn';
        button.dataset.layerId = layer.id;
        button.textContent = layer.name;
        button.addEventListener('click', () => setManualCoverageLayer(layer.id));
        rowLayers.appendChild(button);
    });
    coverageLayerControl.appendChild(rowLayers);

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

function updateBikeLanesZoomWarning() {
    if (!map || !bikeLanesZoomWarning) return;

    const currentZoom = map.getZoom();
    const isBikeLanesChecked = Boolean(toggleBikeLanesCheckbox?.checked);

    bikeLanesZoomWarning.style.display = isBikeLanesChecked && currentZoom < 9 ? 'block' : 'none';
}

function updateTildaGeoLinks() {
    if (!map) return;

    const center = map.getCenter();
    const zoom = Math.round(map.getZoom());
    const lat = center.lat.toFixed(3);
    const lng = center.lng.toFixed(3);

    const baseUrl = `https://tilda-geo.de/regionen/radinfra?map=${zoom}/${lat}/${lng}&config=1p2va4k.7h39.9fm70g&v=2`;

    const tooltipLink = document.getElementById('tilda-geo-link-tooltip');
    if (tooltipLink) {
        tooltipLink.href = baseUrl;
    }

    const legendLink = document.getElementById('tilda-geo-link-legend');
    if (legendLink) {
        legendLink.href = baseUrl;
    }
}

/** Legende Verkehrszeichen: nur einen Block anzeigen – Punkte (9–&lt;13) oder Icons (≥13). */
function updateTrafficSignsLegend(zoom) {
    if (!trafficSignsLegendCircles || !trafficSignsLegendIcons) return;
    const showIcons = zoom >= TRAFFIC_SIGNS_ICON_MIN_ZOOM;
    trafficSignsLegendCircles.style.display = showIcons ? 'none' : 'flex';
    trafficSignsLegendIcons.style.display = showIcons ? 'flex' : 'none';
}

/** Icon-Liste der Legende einmal aus Config befüllen (Icons + Bezeichnungen). */
function buildTrafficSignsLegendIcons() {
    if (!trafficSignsLegendIcons) return;
    trafficSignsLegendIcons.style.display = 'none';
    const entries = trafficSignsConfig.trafficSignLegendEntries || [];
    const urls = trafficSignsConfig.trafficSignIconUrls || {};
    trafficSignsLegendIcons.textContent = '';
    for (const { id, label } of entries) {
        const url = urls[id];
        if (!url) continue;
        const item = document.createElement('div');
        item.className = 'legend-item';
        const img = document.createElement('img');
        img.className = 'legend-item-icon';
        img.src = url;
        img.alt = '';
        img.loading = 'lazy';
        const span = document.createElement('span');
        span.className = 'legend-item-label';
        span.textContent = label;
        item.append(img, span);
        trafficSignsLegendIcons.appendChild(item);
    }
}

function restoreLayerVisibilityFromUi() {
    const streetsVisible = Boolean(toggleStreetsCheckbox?.checked);
    setMissingStreetsVisibility(map, streetsVisible, Boolean(toggleMainRoadsOnlyCheckbox?.checked));

    const trafficSignsVisible = Boolean(toggleTrafficSignsCheckbox?.checked);
    setTrafficSignsVisibility(map, trafficSignsVisible);

    const bikeLanesVisible = Boolean(toggleBikeLanesCheckbox?.checked);
    setBikeLanesVisibility(map, bikeLanesVisible);

    coverageLayerVisible = Boolean(toggleKreiseCheckbox?.checked ?? true);
    applyCoverageVisibility();

    setElementVisibility(streetsLegend, streetsVisible);
    setElementVisibility(kreiseLegend, coverageLayerVisible);
    setElementVisibility(trafficSignsLegend, trafficSignsVisible);
    setElementVisibility(bikeLanesLegend, bikeLanesVisible);
    if (map) updateTrafficSignsLegend(map.getZoom());

    updateCoverageLayerControlUi();
    normalizeInfoPanelScroll();
}

function rebuildRuntimeLayers() {
    if (!map) return;

    try {
        addTrafficSignsSource(map);
        addMissingStreetsSources(map);
        addBikeLanesSource(map);
        updateCoverageLayer();
        addMissingStreetsLayers(map, () => {
            restoreLayerVisibilityFromUi();
            updateStreetsZoomWarning();
        });
        addTrafficSignsLayer(map);
        addBikeLanesLayers(map);
        updateTrafficSignsZoomWarning();
        updateBikeLanesZoomWarning();
    } catch (error) {
        console.error('Error rebuilding layers:', error);
    }
}

if (toggleInfoBtn && infoPanel) {
    toggleInfoBtn.addEventListener('click', () => {
        const shouldOpen = infoPanel.style.display === 'none';
        infoPanel.style.display = shouldOpen ? 'flex' : 'none';

        if (shouldOpen) {
            if (infoContent) infoContent.scrollTop = 0;
            if (map) updateTrafficSignsLegend(map.getZoom());
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

    const urlMap = typeof window !== 'undefined' ? parseMapFromSearchParams(new URL(window.location.href).searchParams) : null;
    const initialCenter = urlMap ? urlMap.center : initialMapConfig.center;
    const initialZoom = urlMap ? urlMap.zoom : initialMapConfig.zoom;

    map = new maplibregl.Map({
        container: 'map',
        style: mapStyles.light,
        center: initialCenter,
        zoom: initialZoom,
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
                addDefaultTrafficSignIcon(map);
                addTrafficSignCircleImages(map);
                currentActiveLayer = null;
                clearMissingStreetsReadinessWatch();
                rebuildRuntimeLayers();
                updateTildaGeoLinks();
                updateCoverageLayerControlUi();
            });
        });
    }

    if (toggleStreetsCheckbox) {
        toggleStreetsCheckbox.addEventListener('change', (event) => {
            const isChecked = Boolean(event?.target?.checked);
            setMissingStreetsVisibility(map, isChecked, Boolean(toggleMainRoadsOnlyCheckbox?.checked));

            setElementVisibility(streetsLegend, isChecked);

            updateStreetsZoomWarning();
            normalizeInfoPanelScroll();
        });
    }

    if (toggleMainRoadsOnlyCheckbox) {
        toggleMainRoadsOnlyCheckbox.addEventListener('change', () => {
            setMissingStreetsVisibility(map, Boolean(toggleStreetsCheckbox?.checked), Boolean(toggleMainRoadsOnlyCheckbox?.checked));
            normalizeInfoPanelScroll();
        });
    }

    if (toggleTrafficSignsCheckbox) {
        toggleTrafficSignsCheckbox.addEventListener('change', (event) => {
            const isChecked = Boolean(event?.target?.checked);
            setTrafficSignsVisibility(map, isChecked);

            setElementVisibility(trafficSignsLegend, isChecked);

            updateTrafficSignsZoomWarning();
            normalizeInfoPanelScroll();
        });
    }

    if (toggleBikeLanesCheckbox) {
        toggleBikeLanesCheckbox.addEventListener('change', (event) => {
            const isChecked = Boolean(event?.target?.checked);
            setBikeLanesVisibility(map, isChecked);

            setElementVisibility(bikeLanesLegend, isChecked);

            updateBikeLanesZoomWarning();
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
        addDefaultTrafficSignIcon(map);
        addTrafficSignCircleImages(map);
        setupTrafficSignImageHandler(map);
        buildTrafficSignsLegendIcons();
        const initialZoom = map.getZoom();
        previousMapZoom = initialZoom;
        updateTrafficSignsLegend(initialZoom);
        rebuildRuntimeLayers();
        if (initialZoom >= STREETS_AUTO_ENABLE_ZOOM && !coverageOpacityAutoAdjustedOnce) {
            coverageOpacityAutoAdjustedOnce = true;
            coverageFillOpacity = COVERAGE_OPACITY_AT_ZOOM_10;
            if (coverageFillOpacitySlider) {
                coverageFillOpacitySlider.value = Math.round(coverageFillOpacity * 100);
                updateCoverageFillOpacityUi(coverageFillOpacity);
            }
            applyCoverageFillOpacity();
            applyCoverageOutlineContrast();
        }
        updateTildaGeoLinks();
        updateCoverageLayerControlUi();
    });

    map.on('zoom', () => updateTrafficSignsLegend(map.getZoom()));
    map.on('zoomend', () => {
        updateCoverageLayer();
        updateTrafficSignsLegend(map.getZoom());

        const zoom = map.getZoom();

        if (zoom >= STREETS_AUTO_ENABLE_ZOOM && toggleStreetsCheckbox && !toggleStreetsCheckbox.checked && !streetsAutoEnabledOnce) {
            streetsAutoEnabledOnce = true;
            toggleStreetsCheckbox.checked = true;
            setMissingStreetsVisibility(map, true, Boolean(toggleMainRoadsOnlyCheckbox?.checked));
            setElementVisibility(streetsLegend, true);
        } else {
            setMissingStreetsVisibility(map, Boolean(toggleStreetsCheckbox?.checked), Boolean(toggleMainRoadsOnlyCheckbox?.checked));
        }

        if (previousMapZoom !== null && previousMapZoom < STREETS_AUTO_ENABLE_ZOOM && zoom >= STREETS_AUTO_ENABLE_ZOOM && !coverageOpacityAutoAdjustedOnce) {
            coverageOpacityAutoAdjustedOnce = true;
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
        updateBikeLanesZoomWarning();
        updateTildaGeoLinks();
        updateCoverageLayerControlUi();
    });

    map.on('moveend', () => {
        const center = map.getCenter();
        const zoom = map.getZoom();
        const mapParam = buildMapParam([center.lng, center.lat], zoom);
        updateUrlMapParam(mapParam);
        updateTildaGeoLinks();
    });
}

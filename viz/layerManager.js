// Layer management for coverage and streets layers
import { 
    layerConfig, 
    fillColorGradient, 
    outlineStyle, 
    coverageColors, 
    lineWidthConfig,
    tileServers 
} from './config.js';
import { handleCoverageHover, handleCoverageLeave, handleCoverageClick, resetCurrentFeature } from './eventHandlers.js';

// Track currently active layer
let currentActiveLayer = null;

// Track coverage layer visibility state
let coverageLayerVisible = true;

/**
 * Get the active layer configuration based on zoom level
 * @param {number} zoom - Current zoom level
 * @returns {Object|null} Active layer configuration
 */
export function getActiveLayerConfig(zoom) {
    // Find the layer with highest minZoom that is still <= current zoom
    // and has current zoom <= maxZoom
    let activeLayer = null;
    let highestMinZoom = -1;
    
    for (const layer of layerConfig) {
        if (zoom >= layer.minZoom && zoom < layer.maxZoom) {
            if (layer.minZoom > highestMinZoom) {
                activeLayer = layer;
                highestMinZoom = layer.minZoom;
            }
        }
    }
    
    return activeLayer;
}

/**
 * Get current active layer
 * @returns {Object|null} Current active layer
 */
export function getCurrentActiveLayer() {
    return currentActiveLayer;
}

/**
 * Set coverage layer visibility state
 * @param {boolean} visible - Whether coverage layer should be visible
 */
export function setCoverageLayerVisible(visible) {
    coverageLayerVisible = visible;
}

/**
 * Swap between different coverage layers based on zoom level
 * @param {Object} map - MapLibre map instance
 */
export function updateCoverageLayer(map) {
    if (!map) return;
    
    const currentZoom = map.getZoom();
    const activeLayer = getActiveLayerConfig(currentZoom);
    
    if (!activeLayer) {
        console.warn('No active layer for zoom level', currentZoom);
        return;
    }
    
    // If the active layer hasn't changed, do nothing
    if (currentActiveLayer && currentActiveLayer.id === activeLayer.id) {
        return;
    }
    
    console.log(`Switching to layer: ${activeLayer.name} (zoom: ${currentZoom})`);
    
    // Hide all old layers
    if (currentActiveLayer) {
        const oldLayers = ['coverage-fill', 'coverage-outline'];
        oldLayers.forEach(layerId => {
            if (map.getLayer(layerId)) {
                map.removeLayer(layerId);
            }
        });
        
        if (map.getSource('coverage-data')) {
            map.removeSource('coverage-data');
        }
    }
    
    // Add new source and layers for the active layer
    map.addSource('coverage-data', {
        type: 'vector',
        url: activeLayer.pmtiles
    });
    
    // Add coverage layer
    map.addLayer({
        id: 'coverage-fill',
        type: 'fill',
        source: 'coverage-data',
        'source-layer': 'default',
        paint: {
            'fill-color': fillColorGradient,
            'fill-opacity': 0.7
        }
    });

    // Add outline layer
    map.addLayer({
        id: 'coverage-outline',
        type: 'line',
        source: 'coverage-data',
        'source-layer': 'default',
        paint: {
            'line-color': outlineStyle.color,
            'line-width': outlineStyle.width,
            'line-opacity': outlineStyle.opacity
        }
    });
    
    // Update current active layer
    currentActiveLayer = activeLayer;
    
    // Reattach hover effects to new layers
    attachCoverageLayerEvents(map);
    
    // Apply saved visibility state to new layers
    const visibility = coverageLayerVisible ? 'visible' : 'none';
    if (map.getLayer('coverage-fill')) {
        map.setLayoutProperty('coverage-fill', 'visibility', visibility);
    }
    if (map.getLayer('coverage-outline')) {
        map.setLayoutProperty('coverage-outline', 'visibility', visibility);
    }
}

/**
 * Attach hover and click events to coverage layers
 * @param {Object} map - MapLibre map instance
 */
function attachCoverageLayerEvents(map) {
    if (!map) return;
    
    // Create wrapper functions that pass map and currentActiveLayer
    const hoverHandler = (e) => handleCoverageHover(e, map, currentActiveLayer);
    const leaveHandler = () => handleCoverageLeave(map);
    const clickHandler = (e) => handleCoverageClick(e);
    
    // Remove old listeners if they exist
    map.off('mousemove', 'coverage-fill', hoverHandler);
    map.off('mouseleave', 'coverage-fill', leaveHandler);
    map.off('click', 'coverage-fill', clickHandler);
    
    // Reattach listeners
    map.on('mousemove', 'coverage-fill', hoverHandler);
    map.on('mouseleave', 'coverage-fill', leaveHandler);
    map.on('click', 'coverage-fill', clickHandler);
}

/**
 * Add Missing Streets layers to the map
 * @param {Object} map - MapLibre map instance
 */
export function addMissingStreetsLayers(map) {
    // Check if all sources are loaded
    if (!map.getSource("mapillary-roads") || !map.getSource("bike-lanes") || !map.getSource("mapillary-roadspathclasses")) {
        setTimeout(() => {
            if (map.getSource("mapillary-roads") && map.getSource("bike-lanes") && map.getSource("mapillary-roadspathclasses")) {
                addMissingStreetsLayers(map);
            }
        }, 1000);
        return;
    }

    // Define all layers configuration
    const layersConfig = [
        // Missing coverage layers (pink)
        {
            id: 'missing-streets-missing-pathclasses',
            source: 'mapillary-roadspathclasses',
            sourceLayer: 'roadsPathClasses',
            color: coverageColors.missing,
            minzoom: 15,
            filter: [
                'any',
                ['==', ['get', 'mapillary_coverage'], 'missing'],
                ['!', ['has', 'mapillary_coverage']],
                ['==', ['get', 'mapillary_coverage'], '']
            ]
        },
        {
            id: 'missing-streets-missing-roads',
            source: 'mapillary-roads',
            sourceLayer: 'roads',
            color: coverageColors.missing,
            minzoom: 9,
            filter: [
                'any',
                ['==', ['get', 'mapillary_coverage'], 'missing'],
                ['!', ['has', 'mapillary_coverage']],
                ['==', ['get', 'mapillary_coverage'], '']
            ]
        },
        {
            id: 'missing-streets-missing-bikelanes',
            source: 'bike-lanes',
            sourceLayer: 'bikelanes',
            color: coverageColors.missing,
            minzoom: 11,
            filter: [
                'any',
                ['==', ['get', 'mapillary_coverage'], 'missing'],
                ['!', ['has', 'mapillary_coverage']],
                ['==', ['get', 'mapillary_coverage'], '']
            ]
        },
        // Regular coverage layers (light blue)
        {
            id: 'missing-streets-regular-pathclasses',
            source: 'mapillary-roadspathclasses',
            sourceLayer: 'roadsPathClasses',
            color: coverageColors.regular,
            minzoom: 15,
            filter: ['==', ['get', 'mapillary_coverage'], 'regular']
        },
        {
            id: 'missing-streets-regular-roads',
            source: 'mapillary-roads',
            sourceLayer: 'roads',
            color: coverageColors.regular,
            minzoom: 9,
            filter: ['==', ['get', 'mapillary_coverage'], 'regular']
        },
        {
            id: 'missing-streets-regular-bikelanes',
            source: 'bike-lanes',
            sourceLayer: 'bikelanes',
            color: coverageColors.regular,
            minzoom: 11,
            filter: ['==', ['get', 'mapillary_coverage'], 'regular']
        },
        // Panorama coverage layers (dark blue)
        {
            id: 'missing-streets-pano-pathclasses',
            source: 'mapillary-roadspathclasses',
            sourceLayer: 'roadsPathClasses',
            color: coverageColors.pano,
            minzoom: 15,
            filter: ['==', ['get', 'mapillary_coverage'], 'pano']
        },
        {
            id: 'missing-streets-pano-roads',
            source: 'mapillary-roads',
            sourceLayer: 'roads',
            color: coverageColors.pano,
            minzoom: 9,
            filter: ['==', ['get', 'mapillary_coverage'], 'pano']
        },
        {
            id: 'missing-streets-pano-bikelanes',
            source: 'bike-lanes',
            sourceLayer: 'bikelanes',
            color: coverageColors.pano,
            minzoom: 11,
            filter: ['==', ['get', 'mapillary_coverage'], 'pano']
        }
    ];

    // Add all layers
    layersConfig.forEach(config => {
        map.addLayer({
            id: config.id,
            type: 'line',
            source: config.source,
            'source-layer': config.sourceLayer,
            minzoom: config.minzoom,
            maxzoom: 22,
            layout: { visibility: 'none' },
            paint: {
                'line-width': lineWidthConfig,
                'line-color': config.color,
                'line-opacity': 0.7,
            },
            filter: config.filter
        });
    });

    console.log('Missing Streets layers added');
}

/**
 * Add tile sources for Missing Streets data
 * @param {Object} map - MapLibre map instance
 */
export function addMissingStreetsSources(map) {
    map.addSource("mapillary-roads", {
        type: "vector",
        tiles: tileServers.roads.tiles,
        minzoom: tileServers.roads.minzoom,
        maxzoom: tileServers.roads.maxzoom
    });

    map.addSource("bike-lanes", {
        type: "vector",
        tiles: tileServers.bikeLanes.tiles,
        minzoom: tileServers.bikeLanes.minzoom,
        maxzoom: tileServers.bikeLanes.maxzoom
    });

    map.addSource("mapillary-roadspathclasses", {
        type: "vector",
        tiles: tileServers.roadsPathClasses.tiles,
        minzoom: tileServers.roadsPathClasses.minzoom,
        maxzoom: tileServers.roadsPathClasses.maxzoom
    });
}

/**
 * Reset current active layer (useful when style changes)
 */
export function resetCurrentActiveLayer() {
    currentActiveLayer = null;
}

/**
 * Get all Missing Streets layer IDs
 * @returns {Array<string>} Array of layer IDs
 */
export function getMissingStreetsLayerIds() {
    return [
        'missing-streets-missing-pathclasses',
        'missing-streets-missing-roads',
        'missing-streets-missing-bikelanes',
        'missing-streets-regular-pathclasses',
        'missing-streets-regular-roads',
        'missing-streets-regular-bikelanes',
        'missing-streets-pano-pathclasses',
        'missing-streets-pano-roads',
        'missing-streets-pano-bikelanes'
    ];
}

import { generatePieChartDataUrl } from './generatePieIcon.js';

let map;

// Determine base URL for PMTiles based on environment
const isGitHubPages = window.location.hostname.includes('github.io');
const pmtilesBaseURL = isGitHubPages 
    ? 'https://vizsim.github.io/mapillary_coverage_analysis/preprocessing/data/'
    : 'http://' + window.location.host + '/preprocessing/data/';

// Layer configuration for hierarchical display
// Layers are defined from most detailed to least detailed
// The layer with the highest minZoom that is <= current zoom will be shown
const layerConfig = [
    {
        id: 'kreise',
        name: 'Landkreise',
        pmtiles: `pmtiles://${pmtilesBaseURL}kreise_wide.pmtiles`,
        minZoom: 7,
        maxZoom: 24,
        labelProperty: 'Landkreis'
    },
    {
        id: 'bundesland',
        name: 'Bundesländer',
        pmtiles: `pmtiles://${pmtilesBaseURL}bland_wide.pmtiles`,
        minZoom: 0,
        maxZoom: 7,
        labelProperty: 'Bundesland'
    }
    // Future layers can be added here (e.g., Gemeinden)
    // {
    //     id: 'gemeinden',
    //     name: 'Gemeinden',
    //     pmtiles: 'pmtiles://../preprocessing/data/gemeinden_wide.pmtiles',
    //     minZoom: 12,
    //     maxZoom: 24,
    //     labelProperty: 'Gemeinde'
    // }
];

// Track currently active layer
let currentActiveLayer = null;

// Track coverage layer visibility state
let coverageLayerVisible = true;

// Function to get the active layer configuration based on zoom level
function getActiveLayerConfig(zoom) {
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

// Function to swap between different coverage layers
function updateCoverageLayer() {
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
    console.log(`PMTiles URL: ${activeLayer.pmtiles}`);
    
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
            'fill-color': [
                'interpolate',
                ['linear'],
                ['get', 'all_no_cover'],
                0, '#174ed9',      // 0% fehlend = dunkelblau (sehr gut)
                0.2, '#0098f0',    // 20% fehlend = hellblau (gut)
                0.5, '#c026d3',    // 50% fehlend = lila (mittel)
                0.8, '#e91e63',    // 80% fehlend = pink (schlecht)
                1, '#be123c'       // 100% fehlend = dunkelpink (sehr schlecht)
            ],
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
            'line-color': '#e3e5e9',
            'line-width': [
                'interpolate',
                ['exponential', 1.],
                ['zoom'],
                5, 0.5,
                8, 1.,
                12, 2.
            ],
            'line-opacity': 0.6
        }
    });
    
    // Update current active layer
    currentActiveLayer = activeLayer;
    
    // Reattach hover effects to new layers
    attachCoverageLayerEvents();
    
    // Apply saved visibility state to new layers
    const visibility = coverageLayerVisible ? 'visible' : 'none';
    if (map.getLayer('coverage-fill')) {
        map.setLayoutProperty('coverage-fill', 'visibility', visibility);
    }
    if (map.getLayer('coverage-outline')) {
        map.setLayoutProperty('coverage-outline', 'visibility', visibility);
    }
}

// Function to attach hover and click events to coverage layers
function attachCoverageLayerEvents() {
    if (!map) return;
    
    // Remove old listeners if they exist
    map.off('mousemove', 'coverage-fill', handleCoverageHover);
    map.off('mouseleave', 'coverage-fill', handleCoverageLeave);
    map.off('click', 'coverage-fill', handleCoverageClick);
    
    // Reattach listeners
    map.on('mousemove', 'coverage-fill', handleCoverageHover);
    map.on('mouseleave', 'coverage-fill', handleCoverageLeave);
    map.on('click', 'coverage-fill', handleCoverageClick);
}

// Create popup for tooltips (global)
const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: 'pmtiles-popup',
    maxWidth: '200px'
});

let currentFeatureId = null;

// Handle hover
function handleCoverageHover(e) {
    if (e.features.length > 0) {
        const feature = e.features[0];
        const featureId = feature.id || feature.properties.ID_0;
        
        // Only update if it's a different feature
        if (featureId !== currentFeatureId) {
            currentFeatureId = featureId;
            const props = feature.properties;
            
            // Get label from current layer configuration
            const labelProperty = currentActiveLayer?.labelProperty || 'Name';
            const name = props[labelProperty] || props.NAME_2 || props.NAME_1 || 'Unbekannt';
            const noCover = (props.all_no_cover * 100).toFixed(1);
            const pano = (props.all_pano * 100).toFixed(1);
            const regular = (props.all_regular * 100).toFixed(1);
            
            // Generate pie chart data URL
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
                            <span style="width: 12px; height: 12px; background: #174ed9; border-radius: 2px; display: inline-block;"></span>
                            <span style="flex: 1;">Panorama:</span>
                            <span style="font-family: monospace; text-align: right; min-width: 35px;">${pano}%</span>
                        </div>
                        <div style="margin: 4px 0; display: flex; align-items: center; gap: 6px;">
                            <span style="width: 12px; height: 12px; background: #0098f0; border-radius: 2px; display: inline-block;"></span>
                            <span style="flex: 1;">Regular:</span>
                            <span style="font-family: monospace; text-align: right; min-width: 35px;">${regular}%</span>
                        </div>
                        <div style="margin: 4px 0; display: flex; align-items: center; gap: 6px;">
                            <span style="width: 12px; height: 12px; background: #e91e63; border-radius: 2px; display: inline-block;"></span>
                            <span style="flex: 1;">Fehlend:</span>
                            <span style="font-family: monospace; text-align: right; min-width: 35px;">${noCover}%</span>
                        </div>
                    </div>
                </div>
            `;
            
            popup.setLngLat(e.lngLat).setHTML(html).addTo(map);
        }
    }
    map.getCanvas().style.cursor = 'pointer';
}

// Handle leave
function handleCoverageLeave() {
    map.getCanvas().style.cursor = '';
    currentFeatureId = null;
    popup.remove();
}

// Handle click
function handleCoverageClick(e) {
    if (e.features.length > 0) {
        const feature = e.features[0];
        console.log('Feature properties:', feature.properties);
    }
}

// Function to add Missing Streets layers
function addMissingStreetsLayers(map) {
    // Check if all sources are loaded
    if (!map.getSource("mapillary-roads") || !map.getSource("bike-lanes") || !map.getSource("mapillary-roadspathclasses")) {
        setTimeout(() => {
            if (map.getSource("mapillary-roads") && map.getSource("bike-lanes") && map.getSource("mapillary-roadspathclasses")) {
                addMissingStreetsLayers(map);
            }
        }, 1000);
        return;
    }

    // Layer für fehlende Fotos (rosa) - aus roadsPathClasses
    map.addLayer({
        id: 'missing-streets-missing-pathclasses',
        type: 'line',
        source: 'mapillary-roadspathclasses',
        'source-layer': 'roadsPathClasses',
        minzoom: 15,
        maxzoom: 22,
        layout: { visibility: 'none' },
        paint: {
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 12, 1.5, 15, 2],
            'line-color': '#e91e63',
            'line-opacity': 0.7,
        },
        filter: [
            'any',
            ['==', ['get', 'mapillary_coverage'], 'missing'],
            ['!', ['has', 'mapillary_coverage']],
            ['==', ['get', 'mapillary_coverage'], '']
        ],
    });

    // Layer für fehlende Fotos (rosa) - aus roads
    map.addLayer({
        id: 'missing-streets-missing-roads',
        type: 'line',
        source: 'mapillary-roads',
        'source-layer': 'roads',
        minzoom: 9,
        maxzoom: 22,
        layout: { visibility: 'none' },
        paint: {
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 12, 1.5, 15, 2],
            'line-color': '#e91e63',
            'line-opacity': 0.7,
        },
        filter: [
            'any',
            ['==', ['get', 'mapillary_coverage'], 'missing'],
            ['!', ['has', 'mapillary_coverage']],
            ['==', ['get', 'mapillary_coverage'], '']
        ],
    });

    // Layer für fehlende Fotos (rosa) - aus bikelanes
    map.addLayer({
        id: 'missing-streets-missing-bikelanes',
        type: 'line',
        source: 'bike-lanes',
        'source-layer': 'bikelanes',
        minzoom: 11,
        maxzoom: 22,
        layout: { visibility: 'none' },
        paint: {
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 12, 1.5, 15, 2],
            'line-color': '#e91e63',
            'line-opacity': 0.7,
        },
        filter: [
            'any',
            ['==', ['get', 'mapillary_coverage'], 'missing'],
            ['!', ['has', 'mapillary_coverage']],
            ['==', ['get', 'mapillary_coverage'], '']
        ],
    });

    // Layer für regular Fotos (blau) - aus roadsPathClasses
    map.addLayer({
        id: 'missing-streets-regular-pathclasses',
        type: 'line',
        source: 'mapillary-roadspathclasses',
        'source-layer': 'roadsPathClasses',
        minzoom: 15,
        maxzoom: 22,
        layout: { visibility: 'none' },
        paint: {
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 12, 1.5, 15, 2],
            'line-color': '#0098f0',
            'line-opacity': 0.7,
        },
        filter: [
            '==', ['get', 'mapillary_coverage'], 'regular'
        ],
    });

    // Layer für regular Fotos (blau) - aus roads
    map.addLayer({
        id: 'missing-streets-regular-roads',
        type: 'line',
        source: 'mapillary-roads',
        'source-layer': 'roads',
        minzoom: 9,
        maxzoom: 22,
        layout: { visibility: 'none' },
        paint: {
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 12, 1.5, 15, 2],
            'line-color': '#0098f0',
            'line-opacity': 0.7,
        },
        filter: [
            '==', ['get', 'mapillary_coverage'], 'regular'
        ],
    });

    // Layer für regular Fotos (blau) - aus bikelanes
    map.addLayer({
        id: 'missing-streets-regular-bikelanes',
        type: 'line',
        source: 'bike-lanes',
        'source-layer': 'bikelanes',
        minzoom: 11,
        maxzoom: 22,
        layout: { visibility: 'none' },
        paint: {
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 12, 1.5, 15, 2],
            'line-color': '#0098f0',
            'line-opacity': 0.7,
        },
        filter: [
            '==', ['get', 'mapillary_coverage'], 'regular'
        ],
    });

    // Layer für Panorama-Fotos (dunkelblau) - aus roadsPathClasses
    map.addLayer({
        id: 'missing-streets-pano-pathclasses',
        type: 'line',
        source: 'mapillary-roadspathclasses',
        'source-layer': 'roadsPathClasses',
        minzoom: 15,
        maxzoom: 22,
        layout: { visibility: 'none' },
        paint: {
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 12, 1.5, 15, 2],
            'line-color': '#174ed9',
            'line-opacity': 0.7,
        },
        filter: [
            '==', ['get', 'mapillary_coverage'], 'pano'
        ],
    });

    // Layer für Panorama-Fotos (dunkelblau) - aus roads
    map.addLayer({
        id: 'missing-streets-pano-roads',
        type: 'line',
        source: 'mapillary-roads',
        'source-layer': 'roads',
        minzoom: 9,
        maxzoom: 22,
        layout: { visibility: 'none' },
        paint: {
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 12, 1.5, 15, 2],
            'line-color': '#174ed9',
            'line-opacity': 0.7,
        },
        filter: [
            '==', ['get', 'mapillary_coverage'], 'pano'
        ],
    });

    // Layer für Panorama-Fotos (dunkelblau) - aus bikelanes
    map.addLayer({
        id: 'missing-streets-pano-bikelanes',
        type: 'line',
        source: 'bike-lanes',
        'source-layer': 'bikelanes',
        minzoom: 11,
        maxzoom: 22,
        layout: { visibility: 'none' },
        paint: {
            'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.5, 12, 1.5, 15, 2],
            'line-color': '#174ed9',
            'line-opacity': 0.7,
        },
        filter: [
            '==', ['get', 'mapillary_coverage'], 'pano'
        ],
    });

    console.log('Missing Streets layers added');
}

// Initialize PMTiles Protocol for MapLibre GL v5.x
const protocol = new pmtiles.Protocol();
maplibregl.addProtocol("pmtiles", protocol.tile);

// Initialize map with OpenFreeMap
map = new maplibregl.Map({
    container: 'map',
    style: 'https://tiles.openfreemap.org/styles/positron',
    center: [10.5, 51.5],
    zoom: 6
});

// UI Elements - only if they exist
const toggleInfoBtn = document.getElementById('toggle-info');
const closeInfoBtn = document.getElementById('close-info');
const infoPanel = document.querySelector('.info-panel');
const darkModeToggle = document.getElementById('dark-mode-toggle');
const toggleStreetsCheckbox = document.getElementById('toggle-streets-layer');
const streetsLegend = document.getElementById('streets-legend');
const streetsZoomWarning = document.getElementById('streets-zoom-warning');
const toggleKreiseCheckbox = document.getElementById('toggle-kreise-layer');
const kreiseLegend = document.getElementById('kreise-legend');

// Function to update streets zoom warning visibility
function updateStreetsZoomWarning() {
    if (!map || !streetsZoomWarning) return;
    
    const currentZoom = map.getZoom();
    const isStreetsChecked = toggleStreetsCheckbox ? toggleStreetsCheckbox.checked : false;
    
    // Show warning if streets layer is enabled and zoom < 9
    if (isStreetsChecked && currentZoom < 9) {
        streetsZoomWarning.style.display = 'block';
    } else {
        streetsZoomWarning.style.display = 'none';
    }
}


// Info Panel Toggle
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

// Dark Mode Toggle
if (darkModeToggle) {
    darkModeToggle.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme-override', next);
        
        // Switch basemap style
        if (map) {
            const newStyle = next === 'dark' 
                ? 'https://tiles.openfreemap.org/styles/dark'
                : 'https://tiles.openfreemap.org/styles/positron';
            
            map.setStyle(newStyle);
            
            // Re-add custom sources and layers after style loads
            map.once('style.load', () => {
                // Reset current active layer to force recreation
                currentActiveLayer = null;
                
                // Add Missing Streets sources
                map.addSource("mapillary-roads", {
                    type: "vector",
                    tiles: ["https://tiles.tilda-geo.de/atlas_generalized_roads/{z}/{x}/{y}"],
                    minzoom: 9,
                    maxzoom: 22
                });

                map.addSource("bike-lanes", {
                    type: "vector",
                    tiles: ["https://tiles.tilda-geo.de/atlas_generalized_bikelanes/{z}/{x}/{y}"],
                    minzoom: 9,
                    maxzoom: 22
                });

                map.addSource("mapillary-roadspathclasses", {
                    type: "vector",
                    tiles: ["https://tiles.tilda-geo.de/atlas_generalized_roadspathclasses/{z}/{x}/{y}"],
                    minzoom: 11,
                    maxzoom: 22
                });

                setTimeout(() => {
                    // Re-add coverage layer first
                    updateCoverageLayer();
                    
                    // Re-add Missing Streets layers (will be on top)
                    addMissingStreetsLayers(map);
                    
                    // Restore visibility states from checkboxes
                    if (toggleStreetsCheckbox) {
                        const streetsVisible = toggleStreetsCheckbox.checked;
                        const streetsVisibility = streetsVisible ? 'visible' : 'none';
                        const missingStreetsLayers = [
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
                        missingStreetsLayers.forEach(layerId => {
                            if (map.getLayer(layerId)) {
                                map.setLayoutProperty(layerId, 'visibility', streetsVisibility);
                            }
                        });
                    }
                    
                    // Update streets zoom warning
                    updateStreetsZoomWarning();
                }, 500);
            });
        }
    });
}

// Streets Layer Toggle (in Legend)
if (toggleStreetsCheckbox) {
    toggleStreetsCheckbox.addEventListener('change', (e) => {
        if (!map) return;
        
        const isChecked = e.target.checked;
        const visibility = isChecked ? 'visible' : 'none';
        
        // Toggle streets legend visibility
        if (streetsLegend) {
            streetsLegend.style.display = isChecked ? 'flex' : 'none';
        }
        
        // Update zoom warning visibility
        updateStreetsZoomWarning();
        
        // Toggle Missing Streets layers
        const missingStreetsLayers = [
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
        
        missingStreetsLayers.forEach(layerId => {
            if (map.getLayer(layerId)) {
                map.setLayoutProperty(layerId, 'visibility', visibility);
            }
        });
        
        console.log('Streets layer:', isChecked ? 'shown' : 'hidden');
    });
}

// Kreise Layer Toggle (in Legend)
if (toggleKreiseCheckbox) {
    toggleKreiseCheckbox.addEventListener('change', (e) => {
        if (!map) return;
        
        const isChecked = e.target.checked;
        const visibility = isChecked ? 'visible' : 'none';
        
        // Save the toggle state
        coverageLayerVisible = isChecked;
        
        // Toggle kreise legend visibility
        if (kreiseLegend) {
            kreiseLegend.style.display = isChecked ? 'flex' : 'none';
        }
        
        // Toggle Kreise layers
        if (map.getLayer('coverage-fill')) {
            map.setLayoutProperty('coverage-fill', 'visibility', visibility);
        }
        if (map.getLayer('coverage-outline')) {
            map.setLayoutProperty('coverage-outline', 'visibility', visibility);
        }
        
        console.log('Coverage layer:', isChecked ? 'shown' : 'hidden');
    });
}

map.on('load', () => {
    console.log('Map loaded');
    
    // Add Missing Streets sources
    map.addSource("mapillary-roads", {
        type: "vector",
        tiles: ["https://tiles.tilda-geo.de/atlas_generalized_roads/{z}/{x}/{y}"],
        minzoom: 9,
        maxzoom: 22
    });

    map.addSource("bike-lanes", {
        type: "vector",
        tiles: ["https://tiles.tilda-geo.de/atlas_generalized_bikelanes/{z}/{x}/{y}"],
        minzoom: 9,
        maxzoom: 22
    });

    map.addSource("mapillary-roadspathclasses", {
        type: "vector",
        tiles: ["https://tiles.tilda-geo.de/atlas_generalized_roadspathclasses/{z}/{x}/{y}"],
        minzoom: 11,
        maxzoom: 22
    });

    // Wait a bit for sources to load
    setTimeout(() => {
        console.log('Adding initial layers...');
        
        try {
            // Add initial coverage layer
            updateCoverageLayer();
            
            // Add Missing Streets layers
            addMissingStreetsLayers(map);
            
            // Update streets zoom warning
            updateStreetsZoomWarning();

        } catch (error) {
            console.error('Error adding layers:', error);
        }
    }, 500);
});

// Handle zoom changes to switch between layer hierarchies
map.on('zoom', () => {
    updateCoverageLayer();
    updateStreetsZoomWarning();
});

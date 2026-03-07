// Configuration for the Mapillary Coverage Analysis visualization

const REPO_OWNER = 'vizsim';
const REPO_NAME = 'mapillary_coverage_analysis';
const PMTILES_PREFIX = 'pmtiles://';

const hasWindow = typeof window !== 'undefined';
const hostname = hasWindow ? window.location.hostname : '';
const protocol = hasWindow ? window.location.protocol : 'https:';
const host = hasWindow ? window.location.host : '';

const isLocalDev = hostname === 'localhost' || hostname === '127.0.0.1';
const isGitHubDomain = /(^|\.)github\.com$|(^|\.)github\.io$/.test(hostname);

const githubRawPmtilesBaseURL = `https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/main/preprocessing/data/`;
const localPmtilesBaseURL = `${protocol}//${host}/preprocessing/data/`;

const pmtilesBaseURL = isLocalDev ? localPmtilesBaseURL : githubRawPmtilesBaseURL;

// Layer configuration for hierarchical display
// Layers are defined from most detailed to least detailed
// The layer with the highest minZoom that is <= current zoom will be shown
export const layerConfig = [
    {
        id: 'gemeinden',
        name: 'Gemeinden',
        pmtiles: `${PMTILES_PREFIX}${pmtilesBaseURL}gem_wide.pmtiles`,
        minZoom: 10,
        maxZoom: 24,
        labelProperty: 'Gemeinde'
    },
    {
        id: 'kreise',
        name: 'Landkreise',
        pmtiles: `${PMTILES_PREFIX}${pmtilesBaseURL}kreise_wide.pmtiles`,
        minZoom: 7,
        maxZoom: 10,
        labelProperty: 'Kreis'
    },
    {
        id: 'bundesland',
        name: 'Bundesländer',
        pmtiles: `${PMTILES_PREFIX}${pmtilesBaseURL}bland_wide.pmtiles`,
        minZoom: 0,
        maxZoom: 7,
        labelProperty: 'Bundesland'
    }
];

// Coverage colors for different states
export const coverageColors = {
    pano: '#174ed9',      // Panorama photos - dark blue
    regular: '#0098f0',   // Regular photos - light blue
    missing: '#e91e63'    // Missing coverage - pink
};

export const coverageLayerIds = ['coverage-fill', 'coverage-outline'];

export const missingStreetsLayerIds = [
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

export const missingStreetsMainRoadLayerIds = missingStreetsLayerIds.filter((layerId) => layerId.endsWith('-roads'));

export const trafficSignsLayerIds = ['traffic-signs-points'];

// Fill color gradient based on missing coverage percentage
export const fillColorGradient = [
    'interpolate',
    ['linear'],
    ['coalesce', ['get', 'all_share_no_cover'], ['get', 'all_no_cover'], 0],
    0, '#174ed9',      // 0% missing = dark blue (very good)
    0.2, '#0098f0',    // 20% missing = light blue (good)
    0.5, '#c026d3',    // 50% missing = purple (medium)
    0.8, '#e91e63',    // 80% missing = pink (bad)
    1, '#be123c'       // 100% missing = dark pink (very bad)
];

// Outline style configuration
export const outlineStyle = {
    color: '#e3e5e9',
    width: [
        'interpolate',
        ['exponential', 1.],
        ['zoom'],
        5, 0.5,
        8, 1.,
        12, 2.
    ],
    opacity: 0.6
};

// Map styles for light and dark mode
export const mapStyles = {
    light: 'https://tiles.openfreemap.org/styles/positron',
    dark: 'https://tiles.openfreemap.org/styles/dark'
};

// Tile server URLs for Missing Streets data
export const tileServers = {
    roads: {
        tiles: ["https://tiles.tilda-geo.de/atlas_generalized_roads/{z}/{x}/{y}"],
        minzoom: 9,
        maxzoom: 22
    },
    bikeLanes: {
        tiles: ["https://tiles.tilda-geo.de/atlas_generalized_bikelanes/{z}/{x}/{y}"],
        minzoom: 9,
        maxzoom: 22
    },
    roadsPathClasses: {
        tiles: ["https://tiles.tilda-geo.de/atlas_generalized_roadspathclasses/{z}/{x}/{y}"],
        minzoom: 11,
        maxzoom: 22
    }
};

// Missing Streets: source and category definitions (used by script.js; must be after tileServers)
export const MISSING_STREETS_SOURCE_DEFS = [
    { sourceId: 'mapillary-roadspathclasses', tileConfig: tileServers.roadsPathClasses, sourceLayer: 'roadsPathClasses', minzoom: 15, layerSuffix: 'pathclasses' },
    { sourceId: 'mapillary-roads', tileConfig: tileServers.roads, sourceLayer: 'roads', minzoom: 9, layerSuffix: 'roads' },
    { sourceId: 'bike-lanes', tileConfig: tileServers.bikeLanes, sourceLayer: 'bikelanes', minzoom: 11, layerSuffix: 'bikelanes' }
];

export const MISSING_STREETS_CATEGORY_DEFS = [
    { key: 'missing', color: coverageColors.missing, filter: ['any', ['==', ['get', 'mapillary_coverage'], 'missing'], ['!', ['has', 'mapillary_coverage']], ['==', ['get', 'mapillary_coverage'], '']] },
    { key: 'regular', color: coverageColors.regular, filter: ['==', ['get', 'mapillary_coverage'], 'regular'] },
    { key: 'pano', color: coverageColors.pano, filter: ['==', ['get', 'mapillary_coverage'], 'pano'] }
];

const MAIN_ROAD_CLASS_VALUES = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link'];

export const MAIN_ROAD_CLASS_FILTER = [
    'in',
    ['downcase', ['to-string', ['coalesce', ['get', 'road'], ['get', 'highway'], '']]],
    ['literal', MAIN_ROAD_CLASS_VALUES]
];

export const trafficSignsConfig = {
    sourceId: 'mapillary-traffic-signs',
    sourceLayer: 'default',
    pmtiles: `${PMTILES_PREFIX}https://raw.githubusercontent.com/vizsim/mapillary_trafficsigns/feature/docker-notebook/use_cases/cycleway_complete_campaign/ts_output/mapillary_trafficsigns_bicycle_latest.pmtiles`,
    minzoom: 9,
    maxzoom: 22
};

export const trafficSignsStyle = {
    mainSignColor: '#2563eb',
    supplementarySignColor: '#ffffff',
    mainSignStrokeColor: '#ffffff',
    supplementarySignStrokeColor: '#9ca3af',
    circleRadius: [
        'interpolate',
        ['linear'],
        ['zoom'],
        9, 2.5,
        12, 4,
        15, 5.5
    ],
    circleStrokeWidth: [
        'interpolate',
        ['linear'],
        ['zoom'],
        11, 0.5,
        14, 1.2,
        22, 1.5
    ],
    circleOpacity: 0.85
};

// Line width configuration for street layers
export const lineWidthConfig = [
    'interpolate', 
    ['linear'], 
    ['zoom'], 
    9, 0.5, 
    12, 1.5, 
    15, 2
];

// Attribution for coverage area shapes (Bundesländer, Landkreise, Gemeinden)
export const shapesAttribution = 'Gebietsgrenzen: © <a href="https://www.bkg.bund.de" target="_blank" rel="noopener noreferrer">GeoBasis-DE / BKG</a>';

// Full map attribution: appended to style attribution (OpenFreeMap adds its own line). Only MapLibre + shapes here.
export const mapAttribution = 'MapLibre | ' + shapesAttribution;

// Initial map configuration
export const initialMapConfig = {
    center: [10.5, 51.5],
    zoom: 6
};

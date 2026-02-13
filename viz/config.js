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

if (hasWindow) {
    console.log('Environment:', isLocalDev ? 'Local' : (isGitHubDomain ? 'GitHub' : 'Online'));
    console.log('PMTiles Base URL:', pmtilesBaseURL);

    if (hostname === 'github.com') {
        console.warn('Detected github.com page view. For runtime testing use GitHub Pages URL, not the repository blob view.');
    }
}

// Layer configuration for hierarchical display
// Layers are defined from most detailed to least detailed
// The layer with the highest minZoom that is <= current zoom will be shown
export const layerConfig = [
    {
        id: 'kreise',
        name: 'Landkreise',
        pmtiles: `${PMTILES_PREFIX}${pmtilesBaseURL}kreise_wide.pmtiles`,
        minZoom: 7,
        maxZoom: 24,
        labelProperty: 'Landkreis'
    },
    {
        id: 'bundesland',
        name: 'Bundesländer',
        pmtiles: `${PMTILES_PREFIX}${pmtilesBaseURL}bland_wide.pmtiles`,
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

// Fill color gradient based on missing coverage percentage
export const fillColorGradient = [
    'interpolate',
    ['linear'],
    ['get', 'all_no_cover'],
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

// Line width configuration for street layers
export const lineWidthConfig = [
    'interpolate', 
    ['linear'], 
    ['zoom'], 
    9, 0.5, 
    12, 1.5, 
    15, 2
];

// Initial map configuration
export const initialMapConfig = {
    center: [10.5, 51.5],
    zoom: 6
};

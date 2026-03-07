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

/** Ab Zoom 11 Icons, davor (9–11) Kreise. */
export const trafficSignsCircleLayerId = 'traffic-signs-circles';
export const trafficSignsLayerIds = [trafficSignsCircleLayerId, 'traffic-signs-points', 'traffic-signs-points-complementary'];

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

/** Map coverage breakdown key to highway values for filtering (base + _link). */
export const HIGHWAY_TYPE_TO_VALUES = {
    motorway: ['motorway', 'motorway_link'],
    trunk: ['trunk', 'trunk_link'],
    primary: ['primary', 'primary_link'],
    secondary: ['secondary', 'secondary_link'],
    tertiary: ['tertiary', 'tertiary_link']
};

/** Zoom ab dem Icons statt Kreise gezeigt werden. Kreise (Punkte) bei Zoom 9–&lt;13, Icons ab 13. */
export const TRAFFIC_SIGNS_ICON_MIN_ZOOM = 13;

export const trafficSignsConfig = {
    sourceId: 'mapillary-traffic-signs',
    sourceLayer: 'default',
    pmtiles: `${PMTILES_PREFIX}https://raw.githubusercontent.com/vizsim/mapillary_trafficsigns/feature/docker-notebook/use_cases/cycleway_complete_campaign/ts_output/mapillary_trafficsigns_bicycle_latest.pmtiles`,
    minzoom: 9,
    maxzoom: 22,
    /** Fallback icon id when no SVG matches (used in symbol layer and styleimagemissing). */
    defaultIconId: 'traffic-sign-default',
    /**
     * Mapillary wording (icon id) → SVG URL. Alle von Wikimedia Commons (CORS-ok, einheitliche Quelle).
     */
    trafficSignIconUrls: {
        'regulatory--bicycles-only--g1': 'https://upload.wikimedia.org/wikipedia/commons/9/91/Zeichen_237_-_Sonderweg_Radfahrer%2C_StVO_1992.svg',
        'regulatory--shared-path-pedestrians-and-bicycles--g1': 'https://upload.wikimedia.org/wikipedia/commons/0/08/Zeichen_240_-_Gemeinsamer_Fu%C3%9F-_und_Radweg%2C_StVO_1992.svg',
        'regulatory--dual-path-pedestrians-and-bicycles--g1': 'https://upload.wikimedia.org/wikipedia/commons/6/68/Zeichen_241-31_-_getrennter_Fu%C3%9F-_und_Radweg%2C_StVO_1992.svg',
        'regulatory--dual-path-bicycles-and-pedestrians--g1': 'https://upload.wikimedia.org/wikipedia/commons/8/86/Zeichen_241-30_-_getrennter_Rad-_und_Fu%C3%9Fweg%2C_StVO_1992.svg',
        'regulatory--end-of-bicycles-only--g2': 'https://upload.wikimedia.org/wikipedia/commons/f/f1/Zeichen_244.2_-_Ende_einer_Fahrradstra%C3%9Fe%2C_StVO_2013.svg',
        'complementary--except-bicycles--g1': 'https://upload.wikimedia.org/wikipedia/commons/0/04/Zusatzzeichen_1022-10_-_Radfahrer_frei%2C_StVO_1992.svg',
        'complementary--bike-route--g1': 'https://upload.wikimedia.org/wikipedia/commons/0/06/Zusatzzeichen_1000-33_-_Radverkehr_im_Gegenverkehr%2C_StVO_1997.svg'
    },
    /** Legende ab Zoom 13: Reihenfolge und Bezeichnung pro Icon. */
    trafficSignLegendEntries: [
        { id: 'regulatory--bicycles-only--g1', label: 'VZ 237 – Sonderweg Radfahrer' },
        { id: 'regulatory--shared-path-pedestrians-and-bicycles--g1', label: 'VZ 240 – Gemeinsamer Fuß- und Radweg' },
        { id: 'regulatory--dual-path-bicycles-and-pedestrians--g1', label: 'VZ 241-30 – Getrennter Rad- und Fußweg' },
        { id: 'regulatory--dual-path-pedestrians-and-bicycles--g1', label: 'VZ 241-31 – Getrennter Fuß- und Radweg' },
        { id: 'regulatory--end-of-bicycles-only--g2', label: 'VZ 244.2 – Ende Fahrradstraße' },
        { id: 'complementary--except-bicycles--g1', label: 'ZZ 1022-10 – Radfahrer frei' },
        { id: 'complementary--bike-route--g1', label: 'ZZ 1000-33 – Radverkehr im Gegenverkehr' }
    ]
};

/** VZ-Code / traffic_sign → Mapillary wording (icon id). Used in symbol layer icon-image expression. */
export const VZ_CODE_TO_ICON_ID = {
    'DE:237': 'regulatory--bicycles-only--g1',
    'DE:240': 'regulatory--shared-path-pedestrians-and-bicycles--g1',
    'DE:241': 'regulatory--dual-path-pedestrians-and-bicycles--g1',
    'DE:241-30': 'regulatory--dual-path-bicycles-and-pedestrians--g1',
    'DE:241-31': 'regulatory--dual-path-pedestrians-and-bicycles--g1',
    'DE:244.2': 'regulatory--end-of-bicycles-only--g2',
    'DE:1022-10': 'complementary--except-bicycles--g1',
    '1022-10': 'complementary--except-bicycles--g1',
    'DE:1000-33': 'complementary--bike-route--g1',
    '1000-33': 'complementary--bike-route--g1'
};

export const trafficSignsStyle = {
    mainSignColor: '#154889',
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
    circleOpacity: 0.75,
    /** Symbol layer: icon size (interpolated by zoom). Kleiner bei Zoom 9–12, bei 17 passend. */
    iconSize: [
        'interpolate',
        ['linear'],
        ['zoom'],
        9, 0.026,
        12, 0.036,
        15, 0.056,
        17, 0.08
    ],
    /** Zusatzzeichen: kleinere Zoom-Kurve (eigener Layer). */
    iconSizeComplementary: [
        'interpolate',
        ['linear'],
        ['zoom'],
        9, 0.02,
        12, 0.03,
        15, 0.046,
        17, 0.064
    ]
};

// Line width configuration for street layers (Straßenabschnitte)
export const lineWidthConfig = [
    'interpolate',
    ['linear'],
    ['zoom'],
    9, 0.9,
    12, 2.2,
    15, 2.8
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

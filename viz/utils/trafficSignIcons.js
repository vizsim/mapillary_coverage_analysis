/**
 * Traffic sign icons for MapLibre: load SVGs via styleimagemissing (OSM-Verkehrswende / OSM-Wiki), fallback default icon.
 */
import { trafficSignsConfig } from '../config.js';

const DEFAULT_ICON_ID = trafficSignsConfig.defaultIconId;
const ICON_URLS = trafficSignsConfig.trafficSignIconUrls || {};

/** Icon ids we have SVG URLs for (Mapillary wording). */
const KNOWN_ICON_IDS = Object.keys(ICON_URLS);

/**
 * Get SVG URL for an icon id (Mapillary wording). Returns undefined if no URL configured.
 * @param {string} iconId
 * @returns {string|undefined}
 */
export function getTrafficSignIconUrl(iconId) {
    return ICON_URLS[iconId];
}

/**
 * Create a simple default sign icon (circle) as ImageData for map.addImage.
 * @returns {{ width: number, height: number, data: Uint8Array }}
 */
function createDefaultSignImageData() {
    const size = 32;
    const radius = 12;
    const center = size / 2;
    const data = new Uint8Array(size * size * 4);
    const fill = [37, 99, 235, 220];   // blue
    const stroke = [255, 255, 255, 255];

    for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
            const dx = x - center;
            const dy = y - center;
            const d = Math.sqrt(dx * dx + dy * dy);
            const i = (y * size + x) * 4;
            if (d <= radius + 1 && d >= radius - 1) {
                data[i] = stroke[0];
                data[i + 1] = stroke[1];
                data[i + 2] = stroke[2];
                data[i + 3] = stroke[3];
            } else if (d < radius - 1) {
                data[i] = fill[0];
                data[i + 1] = fill[1];
                data[i + 2] = fill[2];
                data[i + 3] = fill[3];
            } else {
                data[i + 3] = 0;
            }
        }
    }
    return { width: size, height: size, data };
}

/**
 * Add the default icon as fallback for a given id (e.g. when SVG fetch failed).
 * @param {maplibregl.Map} map
 * @param {string} id
 */
function addFallbackIcon(map, id) {
    try {
        const { width, height, data } = createDefaultSignImageData();
        map.addImage(id, { width, height, data }, { pixelRatio: 2 });
    } catch (_) {
        loaded[id] = false;
    }
}

/**
 * Add the default traffic sign icon to the map (call once after style load).
 * @param {maplibregl.Map} map
 */
export function addDefaultTrafficSignIcon(map) {
    if (!map) return;
    try {
        const { width, height, data } = createDefaultSignImageData();
        map.addImage(DEFAULT_ICON_ID, { width, height, data }, { pixelRatio: 2 });
    } catch (e) {
        console.warn('Could not add default traffic sign icon:', e);
    }
}

/**
 * Setup styleimagemissing handler to load traffic sign SVGs and add them to the map.
 * Call once on map load (before or when adding the traffic signs layer).
 * @param {maplibregl.Map} map
 */
export function setupTrafficSignImageHandler(map) {
    if (!map) return;

    const loaded = Object.create(null);

    map.on('styleimagemissing', (e) => {
        const id = e.id;
        if (id === DEFAULT_ICON_ID) return;
        if (loaded[id]) return;

        const url = getTrafficSignIconUrl(id);
        if (!url) {
            addFallbackIcon(map, id);
            return;
        }
        loaded[id] = true;

        fetch(url)
            .then((res) => {
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                return res.text();
            })
            .then((svgText) => {
                const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
                const img = new Image();
                img.onload = () => {
                    try {
                        map.addImage(id, img);
                    } catch (err) {
                        console.warn('addImage failed for', id, err);
                    }
                };
                img.onerror = () => {
                    loaded[id] = false;
                    addFallbackIcon(map, id);
                };
                img.src = dataUrl;
            })
            .catch(() => {
                loaded[id] = false;
                addFallbackIcon(map, id);
            });
    });
}

export { DEFAULT_ICON_ID, KNOWN_ICON_IDS };

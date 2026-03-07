/**
 * Permalink helpers: sync map view (zoom, center) with URL search param ?map=zoom/lat/lon
 */

const MAP_PARAM = 'map';

/** Valid ranges for zoom/lat/lon. */
const MIN_ZOOM = 0;
const MAX_ZOOM = 22;
const MIN_LAT = -90;
const MAX_LAT = 90;
const MIN_LON = -180;
const MAX_LON = 180;

/**
 * Parse ?map=zoom/lat/lon from URL search params.
 * @param {URLSearchParams} searchParams
 * @returns {{ zoom: number, center: [number, number] } | null} center is [lng, lat]
 */
export function parseMapFromSearchParams(searchParams) {
    const raw = searchParams.get(MAP_PARAM);
    if (!raw || typeof raw !== 'string') return null;

    const parts = raw.split('/').map((s) => s.trim()).filter(Boolean);
    if (parts.length !== 3) return null;

    const zoom = Number(parts[0]);
    const lat = Number(parts[1]);
    const lon = Number(parts[2]);

    if (!Number.isFinite(zoom) || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (zoom < MIN_ZOOM || zoom > MAX_ZOOM) return null;
    if (lat < MIN_LAT || lat > MAX_LAT) return null;
    if (lon < MIN_LON || lon > MAX_LON) return null;

    return {
        zoom,
        center: [lon, lat]
    };
}

/**
 * Build map param string from current view.
 * @param {[number, number]} center - [lng, lat]
 * @param {number} zoom
 * @returns {string} "zoom/lat/lon" with 3 decimal places
 */
export function buildMapParam(center, zoom) {
    const lng = center[0];
    const lat = center[1];
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom));
    const zoomStr = Number(z.toFixed(1));
    const latStr = Number(lat.toFixed(3));
    const lonStr = Number(lng.toFixed(3));
    return `${zoomStr}/${latStr}/${lonStr}`;
}

/**
 * Update the current URL with the given map param, without reload.
 * Preserves other search params and hash.
 * @param {string} mapValue - value for the map param (e.g. "11.1/52.493/13.429")
 */
export function updateUrlMapParam(mapValue) {
    if (typeof window === 'undefined' || !window.history || !window.location) return;

    const url = new URL(window.location.href);
    const params = new URLSearchParams(url.searchParams);
    params.delete(MAP_PARAM);

    let search = params.toString();
    if (mapValue) {
        search += (search ? '&' : '') + MAP_PARAM + '=' + mapValue;
    }
    const full = url.pathname + (search ? '?' + search : '') + url.hash;
    window.history.replaceState(null, '', full);
}

/**
 * Fetches "last updated" timestamps for each legend layer and writes them
 * into the `data-update-tooltip` spans rendered by index.html.
 *
 * Sources:
 *   - coverage:      GitHub API – last commit of preprocessing/data/gem_wide.pmtiles
 *   - streets:       ml_metadata.json (processed_date + freshness_cutoff_berlin)
 *   - traffic-signs: ml-ts_metadata.json (processed_date)
 *   - bike-lanes:    static (radinfra.de SPA, kein Datum im SSR-HTML)
 */

const COVERAGE_COMMIT_API =
    'https://api.github.com/repos/vizsim/mapillary_coverage_analysis/commits' +
    '?path=preprocessing/data/gem_wide.pmtiles&per_page=1';

const STREETS_METADATA_URL =
    'https://raw.githubusercontent.com/vizsim/mapillary_coverage/' +
    'refs/heads/main/output/ml_metadata.json';

const TRAFFIC_SIGNS_METADATA_URL =
    'https://raw.githubusercontent.com/vizsim/mapillary_trafficsigns/' +
    'feature/docker-notebook/output/ml-ts_metadata.json';

function formatDate(isoDate) {
    const d = new Date(isoDate);
    if (Number.isNaN(d.getTime())) return null;
    const day = String(d.getDate()).padStart(2, '0');
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${day}.${month}.${d.getFullYear()}`;
}

function formatStand(isoDate) {
    const formatted = formatDate(isoDate);
    return formatted ? `Stand: ${formatted}` : null;
}

function setTooltip(updateId, html) {
    const target = document.querySelector(`[data-update-tooltip="${updateId}"]`);
    if (!target) return;
    target.innerHTML = html;
}

async function fetchCoverageDate() {
    const res = await fetch(COVERAGE_COMMIT_API, { headers: { Accept: 'application/vnd.github+json' } });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const commits = await res.json();
    const isoDate = commits?.[0]?.commit?.committer?.date || commits?.[0]?.commit?.author?.date;
    if (!isoDate) throw new Error('Kein Commit-Datum gefunden');
    return isoDate;
}

async function fetchTrafficSignsDate() {
    const res = await fetch(TRAFFIC_SIGNS_METADATA_URL);
    if (!res.ok) throw new Error(`ml-ts_metadata.json ${res.status}`);
    const meta = await res.json();
    if (!meta?.processed_date) throw new Error('processed_date fehlt');
    return meta.processed_date;
}

async function fetchStreetsMetadata() {
    const res = await fetch(STREETS_METADATA_URL);
    if (!res.ok) throw new Error(`ml_metadata.json ${res.status}`);
    const meta = await res.json();
    if (!meta?.processed_date) throw new Error('processed_date fehlt');
    return meta;
}

async function loadDynamicDate(updateId, fetcher) {
    try {
        const iso = await fetcher();
        const stand = formatStand(iso);
        if (stand) setTooltip(updateId, stand);
    } catch (err) {
        console.warn(`[layerUpdateDates] ${updateId}:`, err);
        setTooltip(updateId, 'Stand: unbekannt');
    }
}

async function loadStreetsDates(onCutoff) {
    try {
        const meta = await fetchStreetsMetadata();
        const stand = formatStand(meta.processed_date);
        const cutoff = formatDate(meta.freshness_cutoff_berlin);
        const lines = [stand || 'Stand: unbekannt'];
        if (cutoff) lines.push(`Daten ab ${cutoff}`);
        setTooltip('streets', lines.join('<br>'));
        // YYYY-MM-DD aus freshness_cutoff_berlin (z.B. "2023-11-18T00:00:00+01:00" → "2023-11-18")
        if (typeof onCutoff === 'function' && typeof meta.freshness_cutoff_berlin === 'string') {
            const ymd = meta.freshness_cutoff_berlin.slice(0, 10);
            if (/^\d{4}-\d{2}-\d{2}$/.test(ymd)) onCutoff(ymd);
        }
    } catch (err) {
        console.warn('[layerUpdateDates] streets:', err);
        setTooltip('streets', 'Stand: unbekannt');
    }
}

/**
 * @param {object} [opts]
 * @param {(ymd: string) => void} [opts.onStreetsCutoff] - Wird mit dem
 *   freshness_cutoff_berlin (YYYY-MM-DD) aufgerufen, sobald geladen.
 */
export function loadLayerUpdateDates(opts = {}) {
    loadDynamicDate('coverage', fetchCoverageDate);
    loadStreetsDates(opts.onStreetsCutoff);
    loadDynamicDate('traffic-signs', fetchTrafficSignsDate);
    // bike-lanes: statisches Markup aus index.html bleibt stehen
}

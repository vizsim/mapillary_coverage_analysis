import { coverageColors } from './config.js';

function escapeHtml(input) {
    return String(input)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderValueModeToggle(valueMode, kmAvailable) {
    if (!kmAvailable) return '';

    const checked = valueMode === 'length' ? 'checked' : '';

    return `
        <div class="popup-unit-toggle" title="Anzeige in Prozent oder Kilometer">
            <span class="popup-unit-label">%</span>
            <label class="popup-toggle-switch">
                <input class="popup-unit-toggle-input" type="checkbox" ${checked}>
                <span class="popup-toggle-slider"></span>
            </label>
            <span class="popup-unit-label">km</span>
        </div>
    `;
}

function renderCoverageRow(label, color, value, { compact = false, unit = '%' } = {}) {
    const swatchClass = compact ? 'popup-legend-swatch popup-legend-swatch-sm' : 'popup-legend-swatch';
    const renderedValue = unit === 'km' ? `${escapeHtml(value)} km` : `${escapeHtml(value)}%`;

    return `
        <div class="popup-legend-row">
            <span class="${swatchClass}" style="--swatch-color: ${color};"></span>
            <span class="popup-legend-label">${escapeHtml(label)}:</span>
            <span class="popup-legend-value">${renderedValue}</span>
        </div>
    `;
}

export function createCoveragePopupHtml({
    name,
    pieChartUrl,
    pano,
    regular,
    missing,
    valueUnit = '%',
    colors = coverageColors
}) {
    const pieChartHtml = pieChartUrl
        ? `<img src="${pieChartUrl}" class="popup-pie-chart" alt="Coverage Chart" />`
        : '';

    return `
        <div class="popup-content popup-content-summary">
            <div class="popup-title-row">
                <strong class="popup-title popup-title-sm">${escapeHtml(name)}</strong>
            </div>
            ${pieChartHtml}
            <div class="popup-legend-list">
                ${renderCoverageRow('Panorama', colors.pano, pano, { unit: valueUnit })}
                ${renderCoverageRow('Regular', colors.regular, regular, { unit: valueUnit })}
                ${renderCoverageRow('Fehlend', colors.missing, missing, { unit: valueUnit })}
            </div>
        </div>
    `;
}

function renderDetailTableRows(breakdownRows = [], unit = '%') {
    const suffix = unit === 'km' ? ' km' : '%';

    return breakdownRows
        .map((row) => `
            <tr>
                <td class="popup-table-label">${escapeHtml(row.label)}</td>
                <td class="popup-table-value">${escapeHtml(row.pano)}${suffix}</td>
                <td class="popup-table-value">${escapeHtml(row.regular)}${suffix}</td>
                <td class="popup-table-value">${escapeHtml(row.missing)}${suffix}</td>
            </tr>
        `)
        .join('');
}

export function createCoverageDetailPopupHtml({
    name,
    pieChartUrl,
    pano,
    regular,
    missing,
    breakdownRows,
    valueMode = 'share',
    valueUnit = '%',
    kmAvailable = false,
    colors = coverageColors
}) {
    const pieChartHtml = pieChartUrl
        ? `<img src="${pieChartUrl}" class="popup-pie-chart popup-pie-chart-detail" alt="Coverage Chart" />`
        : '';

    return `
        <div class="popup-content popup-content-detail">
            <div class="popup-title-row">
                <strong class="popup-title">${escapeHtml(name)}</strong>
                ${renderValueModeToggle(valueMode, kmAvailable)}
            </div>
            <div class="popup-detail-header">
                ${pieChartHtml}
                <div class="popup-detail-summary">
                    ${renderCoverageRow('Panorama', colors.pano, pano, { compact: true, unit: valueUnit })}
                    ${renderCoverageRow('Regular', colors.regular, regular, { compact: true, unit: valueUnit })}
                    ${renderCoverageRow('Fehlend', colors.missing, missing, { compact: true, unit: valueUnit })}
                </div>
            </div>
            <div class="popup-table-section">
                <div class="popup-table-caption">Nach Straßentyp</div>
                <table class="popup-table">
                    <thead>
                        <tr>
                            <th class="popup-table-header">Typ</th>
                            <th class="popup-table-header popup-table-header-pano">Pano</th>
                            <th class="popup-table-header popup-table-header-regular">Regular</th>
                            <th class="popup-table-header popup-table-header-missing">Fehlend</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${renderDetailTableRows(breakdownRows, valueUnit)}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

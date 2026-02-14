import { coverageColors } from './config.js';

function escapeHtml(input) {
    return String(input)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderCoverageRow(label, color, value, { compact = false } = {}) {
    const swatchClass = compact ? 'popup-legend-swatch popup-legend-swatch-sm' : 'popup-legend-swatch';

    return `
        <div class="popup-legend-row">
            <span class="${swatchClass}" style="--swatch-color: ${color};"></span>
            <span class="popup-legend-label">${escapeHtml(label)}:</span>
            <span class="popup-legend-value">${escapeHtml(value)}%</span>
        </div>
    `;
}

export function createCoveragePopupHtml({
    name,
    pieChartUrl,
    pano,
    regular,
    missing,
    colors = coverageColors
}) {
    const pieChartHtml = pieChartUrl
        ? `<img src="${pieChartUrl}" class="popup-pie-chart" alt="Coverage Chart" />`
        : '';

    return `
        <div class="popup-content popup-content-summary">
            <strong class="popup-title popup-title-sm">${escapeHtml(name)}</strong>
            ${pieChartHtml}
            <div class="popup-legend-list">
                ${renderCoverageRow('Panorama', colors.pano, pano)}
                ${renderCoverageRow('Regular', colors.regular, regular)}
                ${renderCoverageRow('Fehlend', colors.missing, missing)}
            </div>
        </div>
    `;
}

function renderDetailTableRows(breakdownRows = []) {
    return breakdownRows
        .map((row) => `
            <tr>
                <td class="popup-table-label">${escapeHtml(row.label)}</td>
                <td class="popup-table-value">${escapeHtml(row.pano)}%</td>
                <td class="popup-table-value">${escapeHtml(row.regular)}%</td>
                <td class="popup-table-value">${escapeHtml(row.missing)}%</td>
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
    colors = coverageColors
}) {
    const pieChartHtml = pieChartUrl
        ? `<img src="${pieChartUrl}" class="popup-pie-chart popup-pie-chart-detail" alt="Coverage Chart" />`
        : '';

    return `
        <div class="popup-content popup-content-detail">
            <strong class="popup-title">${escapeHtml(name)}</strong>
            <div class="popup-detail-header">
                ${pieChartHtml}
                <div class="popup-detail-summary">
                    ${renderCoverageRow('Panorama', colors.pano, pano, { compact: true })}
                    ${renderCoverageRow('Regular', colors.regular, regular, { compact: true })}
                    ${renderCoverageRow('Fehlend', colors.missing, missing, { compact: true })}
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
                        ${renderDetailTableRows(breakdownRows)}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

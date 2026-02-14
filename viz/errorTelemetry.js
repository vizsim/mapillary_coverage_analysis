function getMapErrorMessage(event) {
    return event?.error?.message || event?.error?.toString?.() || 'Unknown map error';
}

function getMapErrorSourceId(event) {
    return event?.sourceId || event?.source?.id || null;
}

export function attachMapErrorTelemetry(map, { coverageSourceId } = {}) {
    if (!map) return;

    map.on('error', (event) => {
        const message = getMapErrorMessage(event);
        const sourceId = getMapErrorSourceId(event);

        if (sourceId && coverageSourceId && sourceId !== coverageSourceId) {
            return;
        }

        console.error('Map error', {
            message,
            sourceId,
            sourceDataType: event?.sourceDataType || null
        });
    });
}

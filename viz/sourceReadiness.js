export function whenSourcesAvailable(map, sourceIds, onReady) {
    if (!map || typeof onReady !== 'function') {
        return () => {};
    }

    const uniqueSourceIds = Array.from(new Set(sourceIds.filter(Boolean)));

    const areSourcesAvailable = () => uniqueSourceIds.every((sourceId) => Boolean(map.getSource(sourceId)));

    if (areSourcesAvailable()) {
        onReady();
        return () => {};
    }

    let disposed = false;

    const onSourceData = (event) => {
        if (disposed) return;

        const changedSourceId = event?.sourceId;
        if (changedSourceId && !uniqueSourceIds.includes(changedSourceId)) {
            return;
        }

        if (!areSourcesAvailable()) return;

        disposed = true;
        map.off('sourcedata', onSourceData);
        onReady();
    };

    map.on('sourcedata', onSourceData);

    return () => {
        if (disposed) return;
        disposed = true;
        map.off('sourcedata', onSourceData);
    };
}
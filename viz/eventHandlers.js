// Event handlers for map interactions
import { generatePopupHTML } from './popupGenerator.js';

// Create popup for tooltips (singleton)
const popup = new maplibregl.Popup({
    closeButton: false,
    closeOnClick: false,
    className: 'pmtiles-popup',
    maxWidth: '200px',
    offset: 10
});

let currentFeatureId = null;
let rafId = null;
let pendingLngLat = null;

/**
 * Handle mousemove event on coverage layer
 * @param {Object} e - MapLibre event object
 * @param {Object} map - MapLibre map instance
 * @param {Object} activeLayer - Current active layer configuration
 */
export function handleCoverageHover(e, map, activeLayer) {
    map.getCanvas().style.cursor = 'pointer';
    
    if (e.features.length > 0) {
        const feature = e.features[0];
        const featureId = feature.id || feature.properties.ID_0;
        
        // Update content only when feature changes
        if (featureId !== currentFeatureId) {
            currentFeatureId = featureId;
            const labelProperty = activeLayer?.labelProperty || 'Name';
            const html = generatePopupHTML(feature.properties, labelProperty);
            popup.setLngLat(e.lngLat).setHTML(html);
            if (!popup.isOpen()) {
                popup.addTo(map);
            }
        } else {
            // Same feature: update position smoothly using RAF
            pendingLngLat = e.lngLat;
            
            if (!rafId) {
                rafId = requestAnimationFrame(() => {
                    if (pendingLngLat && popup.isOpen()) {
                        popup.setLngLat(pendingLngLat);
                    }
                    rafId = null;
                });
            }
        }
    }
}

/**
 * Handle mouseleave event on coverage layer
 * @param {Object} map - MapLibre map instance
 */
export function handleCoverageLeave(map) {
    map.getCanvas().style.cursor = '';
    currentFeatureId = null;
    popup.remove();
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    pendingLngLat = null;
}

/**
 * Handle click event on coverage layer
 * @param {Object} e - MapLibre event object
 */
export function handleCoverageClick(e) {
    if (e.features.length > 0) {
        const feature = e.features[0];
        console.log('Feature properties:', feature.properties);
    }
}

/**
 * Reset current feature ID (useful when layer changes)
 */
export function resetCurrentFeature() {
    currentFeatureId = null;
    popup.remove();
    if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = null;
    }
    pendingLngLat = null;
}

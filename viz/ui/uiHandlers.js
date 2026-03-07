// UI event handlers for controls and panels
import { mapStyles } from '../config.js';
import { 
    updateCoverageLayer, 
    addMissingStreetsLayers, 
    addMissingStreetsSources,
    resetCurrentActiveLayer,
    setCoverageLayerVisible,
    getMissingStreetsLayerIds
} from '../map/layerManager.js';

/**
 * Update the visibility of the streets zoom warning
 * @param {Object} map - MapLibre map instance
 * @param {HTMLElement} warning - Warning element
 * @param {HTMLInputElement} checkbox - Streets toggle checkbox
 */
export function updateStreetsZoomWarning(map, warning, checkbox) {
    if (!map || !warning) return;
    
    const currentZoom = map.getZoom();
    const isStreetsChecked = checkbox ? checkbox.checked : false;
    
    // Show warning if streets layer is enabled and zoom < 9
    if (isStreetsChecked && currentZoom < 9) {
        warning.style.display = 'block';
    } else {
        warning.style.display = 'none';
    }
}

/**
 * Setup info panel toggle handlers
 * @param {HTMLElement} toggleBtn - Button to toggle panel
 * @param {HTMLElement} closeBtn - Button to close panel
 * @param {HTMLElement} panel - Info panel element
 */
export function setupInfoPanelHandlers(toggleBtn, closeBtn, panel) {
    if (toggleBtn && panel) {
        toggleBtn.addEventListener('click', () => {
            panel.style.display = panel.style.display === 'none' ? 'flex' : 'none';
        });
    }

    if (closeBtn && panel) {
        closeBtn.addEventListener('click', () => {
            panel.style.display = 'none';
        });
    }
}

/**
 * Setup dark mode toggle handler
 * @param {HTMLElement} toggleBtn - Dark mode toggle button
 * @param {Object} map - MapLibre map instance
 * @param {HTMLInputElement} streetsCheckbox - Streets layer toggle checkbox
 * @param {HTMLElement} streetsWarning - Streets zoom warning element
 */
export function setupDarkModeHandler(toggleBtn, map, streetsCheckbox, streetsWarning) {
    if (!toggleBtn) return;

    toggleBtn.addEventListener('click', () => {
        const current = document.documentElement.getAttribute('data-theme') || 'light';
        const next = current === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('theme-override', next);
        
        // Switch basemap style
        if (map) {
            const newStyle = next === 'dark' ? mapStyles.dark : mapStyles.light;
            map.setStyle(newStyle);
            
            // Re-add custom sources and layers after style loads
            map.once('style.load', () => {
                // Reset current active layer to force recreation
                resetCurrentActiveLayer();
                
                // Add Missing Streets sources
                addMissingStreetsSources(map);

                setTimeout(() => {
                    // Re-add coverage layer first
                    updateCoverageLayer(map);
                    
                    // Re-add Missing Streets layers (will be on top)
                    addMissingStreetsLayers(map);
                    
                    // Restore visibility states from checkboxes
                    if (streetsCheckbox) {
                        const streetsVisible = streetsCheckbox.checked;
                        const streetsVisibility = streetsVisible ? 'visible' : 'none';
                        const missingStreetsLayers = getMissingStreetsLayerIds();
                        missingStreetsLayers.forEach(layerId => {
                            if (map.getLayer(layerId)) {
                                map.setLayoutProperty(layerId, 'visibility', streetsVisibility);
                            }
                        });
                    }
                    
                    // Update streets zoom warning
                    updateStreetsZoomWarning(map, streetsWarning, streetsCheckbox);
                }, 500);
            });
        }
    });
}

/**
 * Setup streets layer toggle handler
 * @param {HTMLInputElement} checkbox - Streets toggle checkbox
 * @param {HTMLElement} legend - Streets legend element
 * @param {HTMLElement} warning - Streets zoom warning element
 * @param {Object} map - MapLibre map instance
 */
export function setupStreetsLayerHandler(checkbox, legend, warning, map) {
    if (!checkbox) return;

    checkbox.addEventListener('change', (e) => {
        if (!map) return;
        
        const isChecked = e.target.checked;
        const visibility = isChecked ? 'visible' : 'none';
        
        // Toggle streets legend visibility
        if (legend) {
            legend.style.display = isChecked ? 'flex' : 'none';
        }
        
        // Update zoom warning visibility
        updateStreetsZoomWarning(map, warning, checkbox);
        
        // Toggle Missing Streets layers
        const missingStreetsLayers = getMissingStreetsLayerIds();
        missingStreetsLayers.forEach(layerId => {
            if (map.getLayer(layerId)) {
                map.setLayoutProperty(layerId, 'visibility', visibility);
            }
        });
        
        console.log('Streets layer:', isChecked ? 'shown' : 'hidden');
    });
}

/**
 * Setup coverage layer (Kreise/Bundesland) toggle handler
 * @param {HTMLInputElement} checkbox - Coverage toggle checkbox
 * @param {HTMLElement} legend - Coverage legend element
 * @param {Object} map - MapLibre map instance
 */
export function setupCoverageLayerHandler(checkbox, legend, map) {
    if (!checkbox) return;

    checkbox.addEventListener('change', (e) => {
        if (!map) return;
        
        const isChecked = e.target.checked;
        const visibility = isChecked ? 'visible' : 'none';
        
        // Save the toggle state
        setCoverageLayerVisible(isChecked);
        
        // Toggle coverage legend visibility
        if (legend) {
            legend.style.display = isChecked ? 'flex' : 'none';
        }
        
        // Toggle coverage layers
        if (map.getLayer('coverage-fill')) {
            map.setLayoutProperty('coverage-fill', 'visibility', visibility);
        }
        if (map.getLayer('coverage-outline')) {
            map.setLayoutProperty('coverage-outline', 'visibility', visibility);
        }
        
        console.log('Coverage layer:', isChecked ? 'shown' : 'hidden');
    });
}

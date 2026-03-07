# Plan: script.js aufteilen

Ziel: Das große `script.js` (~1300 Zeilen) in Module auslagern, die zur bestehenden Ordnerstruktur passen.

---

## ~~1. Coverage-Hover & -Outline auslagern~~ ✅ Erledigt

**Neue Datei:** `map/coverageHover.js`

**Inhalt (aus script.js raus):**
- Konstanten: `COVERAGE_HOVER_OUTLINE_LAYER_ID`
- State: `currentHoveredFeatureId`
- Funktionen: `setHoverOutlineState`, `clearHoverOutline`
- Hover-Layer beim Setup hinzufügen (Factory oder `registerHoverOutlineLayer(map, sourceId, sourceLayer)`)

**Export:**
- `setHoverOutlineState(map, sourceId, sourceLayer, featureId)`
- `clearHoverOutline(map, sourceId, sourceLayer)`
- `createHoverOutlineLayerSpec(sourceId, sourceLayer)` oder `addHoverOutlineLayer(map, sourceId, sourceLayer)`

**script.js:** Importiert die Funktionen, ruft sie in `handleCoverageHover` / `handleCoverageLeave` und beim Layer-Setup auf. Übergibt `map`, `COVERAGE_SOURCE_ID`, `'default'`.

---

## ~~2. Coverage-Klick, Auswahl, Schleier~~ ✅ Erledigt

**Neue Datei:** `map/coverageSelection.js`

**Inhalt (umgesetzt):**
- Konstanten: `COVERAGE_SELECTED_OUTLINE_LAYER_ID`, `COVERAGE_VEIL_LAYER_ID`
- Funktionen: `setSelectedFeatureOutline`, `clearSelectedFeatureOutline`
- Detail-Panel (`closeDetailPanel`, `openDetailPanel`) bewusst in script.js gelassen (DOM + State-Kopplung).

---

## 3. Coverage-Popup & -Detail (HTML, Werte, Tabellen-Hover)

**Bestehende Nutzung:** `popup/popupTemplates.js` wird schon genutzt.

**Auslagern in** `popup/` oder `coverage/`:
- `getCoverageValuesForPrefix`, `getDisplayValuesForPrefix`, `hasCoverageBreakdown`, `buildCoverageStatRows`
- `getFeatureLabel`, `getPopupHtml`, `getDetailedPopupHtml`
- `bindPopupUnitToggle`, `bindDetailTableRowHover`, `refreshOpenCoveragePopups`
- `makeDetailPopupDraggable` (oder in ui/)

Diese Funktionen hängen an `currentActiveLayer`, `currentDetailProps`, `popupValueMode` – entweder als Parameter durchreichen oder ein kleines „CoveragePopup“-Modul, das diese State-Variablen hält und exportiert.

**Neue Datei:** `popup/coveragePopupLogic.js`  
Exporte: `getPopupHtml`, `getDetailedPopupHtml`, `getFeatureLabel`, `refreshOpenCoveragePopups`, …  
State (`currentActiveLayer`, `popupValueMode`, …) bleibt in script.js oder wird in das Modul verschoben und von script.js gesetzt/gelesen.

---

## ~~4. Coverage-Layer-Setup (Fill, Outline, Zoom-Wechsel)~~ ✅ Erledigt

**Umsetzung:** `map/coverageLayers.js` (Option B) – Fill/Outline-Factory, applyVisibility/FillOpacity/OutlineContrast, Hex-Helfer. `updateCoverageLayer` und Zoom-Logik bleiben in script.js (Orchestrierung).

---

## ~~5. Missing Streets~~ ✅ Erledigt

**Neue Datei:** `map/missingStreetsLayers.js`

**Inhalt (umgesetzt):** Sources, Layer-Specs, `setMissingStreetsVisibility(map, visible, showMainRoadsOnly)`, Highway-Type-Highlight, Road-Class-Filter, Readiness-Watch.

---

## ~~6. Traffic Signs~~ ✅ Erledigt

**Neue Datei:** `map/trafficSignsLayers.js`

**Inhalt (umgesetzt):** `addTrafficSignsSource`, `createTrafficSignsLayerSpec`, `addTrafficSignsLayer(map, beforeLayerId?)`, `setTrafficSignsVisibility`.

---

## 7. UI: DOM-Referenzen & Event-Bindings

**Bestehend:** `ui/uiHandlers.js`

**Erweiterung:** Alle `getElementById` / `querySelector` und die einfachen Listener (Toggle, Slider, Close-Buttons) in `ui/` bündeln, z.B.:
- `ui/domRefs.js` – exportiert nur die DOM-Referenzen (eine zentrale Stelle für alle IDs/Klassen).
- `ui/coverageLayerControl.js` – `buildCoverageLayerControl`, `updateCoverageLayerControlUi`, `setManualCoverageLayer`, `getCoverageLayersForControl`, `getCurrentCoverageLayerForUi`.
- Event-Bindings für Info-Panel, Detail-Panel, Dark-Mode, Streets, Traffic-Signs, Kreise, Opacity-Slider in `ui/` (oder in script.js lassen, aber DOM-Refs aus ui/domRefs.js).

---

## 8. script.js nach dem Refactor (aktueller Stand)

**script.js** ist Einstiegspunkt und orchestriert:

- Imports aus allen neuen Modulen (coverageHover, coverageSelection, coverageLayers, trafficSignsLayers, missingStreetsLayers, …)
- Initialisierung: Map, Protokolle, Error-Telemetrie
- `buildCoverageLayerControl()`, `attachCoverageLayerEvents()`, `updateCoverageLayer()`, `rebuildRuntimeLayers()`
- `map.on('load')` / `map.on('zoomend')` und weitere Map-Events
- Event-Listener für UI (Dark-Mode, Toggles, Slider, Detail-Panel)
- Verbleibende Logik: Popup/Detail-HTML-Helfer, Layer-Control, Zoom/Visibility-Handler

**Aktuelle Größe:** ~930 Zeilen. Optional weiter reduzierbar durch Schritt 3 (Popup) und/oder 7 (UI).

---

## Empfohlene Reihenfolge (Stand: erledigt 1, 2, 4, 5, 6)

- ~~1. **Coverage-Hover** → `map/coverageHover.js`~~ ✅
- ~~2. **Coverage-Selection & Veil** → `map/coverageSelection.js`~~ ✅
- 3. **Coverage-Popup-Logik** → `popup/coveragePopupLogic.js` (offen)
- ~~4. **Coverage-Layer** → `map/coverageLayers.js`~~ ✅
- ~~5. **Missing Streets** → `map/missingStreetsLayers.js`~~ ✅
- ~~6. **Traffic Signs** → `map/trafficSignsLayers.js`~~ ✅
- 7. **UI-Refs und -Bindings** → `ui/domRefs.js` + ggf. erweiterte `uiHandlers.js` (offen)

---

## Bewertung: Sinnvollkeit & Aufwand

| Schritt | Sinnvollkeit | Aufwand | Status |
|--------|--------------|--------|--------|
| **1. Hover** | hoch | gering | ~~Erledigt – `map/coverageHover.js`~~ ✅ |
| **2. Selection/Veil** | hoch | mittel | ~~Erledigt – `map/coverageSelection.js`~~ ✅ |
| **3. Popup-Logik** | mittel | hoch | **Offen** – siehe unten |
| **4. Coverage-Layer** | hoch | mittel | ~~Erledigt – `map/coverageLayers.js`~~ ✅ |
| **5. Missing Streets** | hoch | mittel | ~~Erledigt – `map/missingStreetsLayers.js`~~ ✅ |
| **6. Traffic Signs** | hoch | gering | ~~Erledigt – `map/trafficSignsLayers.js`~~ ✅ |
| **7. UI Refs/Bindings** | mittel | hoch | **Offen** – siehe unten |

---

## Noch offen – lohnt sich?

**3. Popup-Logik** (`popup/coveragePopupLogic.js`)  
- **Sinnvoll?** Eher optional. script.js ist schon deutlich schlanker (~930 Zeilen). Popup/Detail-HTML und Wertelogik auslagern bringt Lesbarkeit, aber viel State (`currentActiveLayer`, `popupValueMode`, `currentDetailProps`) und viele Aufrufer – Refactor ist aufwändig.  
- **Empfehlung:** Nur machen, wenn ihr an der Popup-/Detail-Logik oft arbeitet oder script.js weiter schrumpfen soll. Sonst getrost weglassen.

**7. UI Refs & Bindings** (`ui/domRefs.js`, Event-Bindings)  
- **Sinnvoll?** Eher optional. Zentrale DOM-Refs sind nett für Wartung, ändern aber nichts am Verhalten. Viele kleine Änderungen (alle `getElementById`/Listener umziehen).  
- **Empfehlung:** Nur machen, wenn ihr eine einzige „Quelle der Wahrheit“ für Element-IDs wollt oder UI-Code gezielt testen wollt. Sonst weglassen – script.js ist so schon gut handhabbar.

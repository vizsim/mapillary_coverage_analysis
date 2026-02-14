# Viz-Review: Verbesserungs­vorschläge (Performance, Struktur, Robustheit)

## Kurzfazit
Der aktuelle Stand in `viz/` funktioniert grundsätzlich, enthält aber **zwei konkurrierende Architekturansätze**:
- ein monolithisches, tatsächlich genutztes `script.js`
- mehrere modulare Dateien (`layerManager.js`, `eventHandlers.js`, `uiHandlers.js`, `popupGenerator.js`), die aktuell nicht als Laufzeit-Einstiegspunkt verwendet werden.

Das erzeugt unnötige Komplexität, erschwert Wartung und führt zu inhaltlichen Duplikaten.

---

## Wichtigste Befunde

### 1) Doppelter/überlappender Code (hohe Priorität)
**Befund**
- Funktionalität ist doppelt vorhanden:
  - Layer-Management in `script.js` **und** `layerManager.js`
  - Hover/Click-Handling in `script.js` **und** `eventHandlers.js`
  - Popup-HTML-Logik in `script.js` **und** `popupGenerator.js`
- `index.html` lädt nur `script.js`; die modularen Dateien wirken damit wie "parallel gepflegte Alt-/Refactor-Version".

**Auswirkung**
- Höhere Fehlerwahrscheinlichkeit (Fixes landen nur in einem Pfad)
- Mehr mentaler Overhead für jede Änderung

**Empfehlung**
- Entscheidung erzwingen: **entweder** monolithisch halten und ungenutzte Dateien entfernen **oder** (empfohlen) sauber modularisieren und `script.js` auf Orchestrierung reduzieren.

---

### 2) Fragile Lade-/Reinitialisierungslogik mit `setTimeout` (hohe Priorität)
**Befund**
- Mehrfach harte Delays (`setTimeout(..., 500)` / Retry-Loop) für Layer-Rebuild nach `style.load` und für Missing-Streets-Quellen.

**Auswirkung**
- Race-Conditions bei langsamem Netz/Gerät
- Nicht-deterministisches Verhalten (mal klappt’s, mal nicht)

**Empfehlung**
- Ereignisgetrieben statt zeitgetrieben:
  - `style.load` + explizite Source-Readiness (z. B. Promise pro Source)
  - Retry-Backoff mit Abbruchbedingung statt Endlosschleifen-Timing
- Keine magischen Verzögerungen, sondern klare Zustandsmaschine: `INIT -> SOURCES_READY -> LAYERS_READY`.

---

### 3) Zu häufige Reaktionen auf Zoom-Events (mittel-hoch)
**Befund**
- `updateCoverageLayer()` läuft auf jedem `zoom`-Event (sehr häufig während Gesten).

**Auswirkung**
- Viele unnötige Funktionsdurchläufe; bei schwächeren Geräten spürbar

**Empfehlung**
- Auf `zoomend` wechseln (oder `requestAnimationFrame`-throttlen), da Layer-Wechsel nur an Schwellen relevant ist.
- Optional: Schwellen-Caching (nur prüfen, wenn Zoom-Intervall gewechselt hat).

---

### 4) Popup-Rendering: viel Inline-HTML/CSS und doppelte Caches (mittel)
**Befund**
- Sehr große HTML-Strings in JS, viele Inline-Styles.
- Mehrere Cache-Instanzen mit ähnlicher Semantik (`popupHtmlCache`, `detailPopupHtmlCache`, Pie-Cache in `popupGenerator.js`).

**Auswirkung**
- Schwerer testbar und wartbar
- Höhere Änderungsaufwände für UI-Detailanpassungen

**Empfehlung**
- Popup-Markup in Template-Funktionen kapseln + CSS-Klassen statt Inline-Styles.
- Ein gemeinsames kleines LRU-Cache-Utility (`utils/cache.js`) mit konfigurierbarer Größe.

---

### 5) Robustheit/Fehlerverhalten inkonsistent (mittel)
**Befund**
- Gute Guard-Funktionen in `script.js` (`hasLayer`, `addLayerIfMissing`, ...), aber nicht konsistent über alle Module.
- Der modulare Pfad (`layerManager.js`) enthält ein Event-Handler-Muster mit neuen Funktionsreferenzen bei `off/on`, das Listener-Leaks begünstigt.

**Auswirkung**
- Bei künftiger Aktivierung modularer Dateien können schwer nachvollziehbare Doppel-Events auftreten.

**Empfehlung**
- Einheitliche Helper-Schicht für `safeAddSource`, `safeAddLayer`, `safeSetVisibility`.
- Handler-Referenzen stabil speichern (pro Layer/Event genau eine referenzierte Funktion).

---

## Konkrete Zielarchitektur (empfohlen)

### Einstieg
- `script.js`: nur Bootstrapping/Composition Root.

### Module
- `map/initMap.js`: Map-Erzeugung, Theme-/Style-Wechsel-Hooks
- `layers/coverageLayer.js`: aktive Admin-Ebene, Fill/Outline
- `layers/missingStreetsLayer.js`: Quellen + 9 Linien-Layer
- `ui/popupController.js`: Hover/Click, Popup-Templates, Caching
- `ui/controls.js`: Panel, Toggles, Zoom-Warnung
- `utils/mapSafeOps.js`: idempotente MapLibre-Operationen

### Konfig
- `config.js` als Single Source of Truth belassen; doppelte Konstanten in `script.js` entfernen.

---

## Priorisierter Umsetzungsplan

### Phase 1 (Quick Wins, 0.5–1 Tag)
1. ~~Nicht genutzten Parallel-Code entfernen **oder** explizit stilllegen (README-Hinweis).~~
2. ~~`zoom`-Handler auf `zoomend` umstellen.~~
3. ~~Alle `setTimeout`-Magic-Delays dokumentieren und zentralisieren (temporär), um Risiken sichtbar zu machen.~~

### Phase 2 (Stabilität, 1–2 Tage)
1. ~~`setTimeout`-basierte Layer-Initialisierung durch event-/promise-basierten Ablauf ersetzen.~~
2. ~~Einheitliche Safe-Map-Helper einführen und überall verwenden.~~
3. ~~Fehlertelemetrie vereinheitlichen (`console.error` mit einheitlicher Struktur + Source-ID).~~

### Phase 3 (Struktur & Wartbarkeit, 1–2 Tage)
1. ~~Popup-Markup in dedizierte Template-Funktionen + CSS auslagern.~~
2. ~~LRU-Cache-Utility vereinheitlichen und in Popup/Pie-Generierung nutzen.~~
3. `script.js` auf Orchestrierung reduzieren.

---

## Erwarteter Effekt
- **Performance:** weniger unnötige Re-Renders/Checks bei Zoom und Style-Wechsel.
- **Robustheit:** deterministisches Laden statt Timing-Glück.
- **Wartbarkeit:** klarere Verantwortlichkeiten, weniger Duplikate, geringeres Regressionsrisiko.
- **Onboarding:** neue Features schneller implementierbar, weil Zuständigkeiten pro Datei klar sind.

---

## Optional: Kleiner Sicherheits-/Qualitätshinweis
- `script.js` escaped Popup-Namen (`escapeHtml`), der alternative Popup-Pfad (`popupGenerator.js`) aktuell nicht. Falls der modulare Pfad reaktiviert wird, sollte Escaping dort ebenfalls verpflichtend sein.


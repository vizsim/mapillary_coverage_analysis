# Viz Runtime-Hinweise

## Aktueller Einstiegspunkt

Die Anwendung wird aktuell über `index.html` mit `script.js` gestartet:

- `<script type="module" src="script.js"></script>`

`script.js` ist damit derzeit die **maßgebliche Runtime-Implementierung**.

## Ordnerstruktur

- **config.js** – zentrale Konfiguration (Layer, Styles, Tile-Server, etc.)
- **script.js** – Einstieg und Orchestrierung
- **utils/** – `lruCache.js`, `sourceReadiness.js`, `errorTelemetry.js`, `generatePieIcon.js`
- **map/** – `mapSafeOps.js`, `layerManager.js`, `eventHandlers.js`
- **ui/** – `uiHandlers.js`
- **popup/** – `popupGenerator.js`, `popupTemplates.js`

Die modularen Dateien in `map/`, `ui/` und `popup/` sind momentan **nicht an den Laufzeit-Einstieg verdrahtet**; `script.js` enthält die maßgebliche Runtime-Implementierung.

## Refactor-Richtung

Geplante Zielrichtung ist die schrittweise Migration zu einer klar modularen Struktur, bei der `script.js` nur noch Orchestrierung übernimmt. Bis dahin sollten funktionale Änderungen primär in `script.js` erfolgen, um divergierendes Verhalten zu vermeiden.

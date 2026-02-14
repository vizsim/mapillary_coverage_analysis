# Viz Runtime-Hinweise

## Aktueller Einstiegspunkt

Die Anwendung wird aktuell über `index.html` mit `script.js` gestartet:

- `<script type="module" src="script.js"></script>`

`script.js` ist damit derzeit die **maßgebliche Runtime-Implementierung**.

## Status der modularen Dateien

Folgende Dateien enthalten einen alternativen/modularen Implementierungspfad, sind aber momentan **nicht an den Laufzeit-Einstieg verdrahtet**:

- `layerManager.js`
- `eventHandlers.js`
- `uiHandlers.js`
- `popupGenerator.js`

Diese Dateien gelten bis zur Refactor-Phase als **Legacy/parallel gepflegt**.

## Refactor-Richtung

Geplante Zielrichtung ist die schrittweise Migration zu einer klar modularen Struktur, bei der `script.js` nur noch Orchestrierung übernimmt. Bis dahin sollten funktionale Änderungen primär in `script.js` erfolgen, um divergierendes Verhalten zu vermeiden.

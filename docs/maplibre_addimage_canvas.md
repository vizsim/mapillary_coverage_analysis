# MapLibre: addImage mit Canvas und „mismatched image size“

## Fehlermeldung

```
RangeError: mismatched image size. expected: 0 but got: 16384
```
(bzw. andere Werte wie 262144 für 256×256)

## Ursache (MapLibre GL JS Quellcode)

- **Fehlerquelle:** `src/util/image.ts`, Funktion `createImage()` in `RGBAImage`:
  - Prüfung: `data.length !== width * height * channels` → dann `RangeError('mismatched image size. expected: ${data.length} but got: ${width * height * channels}')`.

- **addImage (src/ui/map.ts):**
  - Akzeptiert: `HTMLImageElement | ImageBitmap | ImageData | { width, height, data } | StyleImageInterface`.
  - **HTMLCanvasElement wird nicht explizit unterstützt.**
  - Für Image/ImageBitmap: `browser.getImageData(image)` → liefert `ImageData` (width, height, data).
  - `browser.getImageData()` (src/util/browser.ts) nimmt nur `HTMLImageElement | ImageBitmap`, **kein Canvas**. Canvas hat kein `.data`; wird ein Canvas als „Objekt mit width/height“ durchgereicht, ist `data` undefined → `new Uint8Array(undefined)` hat Länge 0 → Fehler „expected: 0 but got: width*height*4“.

## Konsequenz

- **Nicht:** `map.addImage(id, canvas)` oder Canvas mit `pixelRatio` übergeben – führt je nach Code-Pfad zum obigen Fehler (insb. nach `setStyle`, z. B. Dark Mode).
- **Sondern:** SVG/Icon auf einem Canvas in hoher Auflösung zeichnen, dann **Pixel-Daten** auslesen und als `{ width, height, data }` an `addImage` übergeben:
  - `const ctx = canvas.getContext('2d');`
  - `const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);`
  - `map.addImage(id, { width: imageData.width, height: imageData.height, data: new Uint8Array(imageData.data) }, { pixelRatio: 1 });`
  - So bleibt alles im unterstützten Format und höhere Raster-Auflösung (z. B. 128×128 oder 256×256) für schärfere kleine Icons ist möglich.

## MapLibre-Version

- Projekt nutzt **maplibre-gl@5.18.0** (vgl. `viz/index.html`).
- Aktuellste Release: **v5.19.0** (Stand: Feb 2025); keine Änderung an addImage/Canvas-Verhalten in den Release-Notes.
- PR #2674 (max canvas size / pixel ratio) betrifft die **Karte-Canvas-Größe**, nicht Style-Images.

## Weiterführende Links

- [MapLibre addImage – Generated icon](https://maplibre.org/maplibre-gl-js/docs/examples/add-image-generated/) (Format `{ width, height, data }`).
- [StyleImageInterface](https://www.maplibre.org/maplibre-gl-js/docs/API/interfaces/StyleImageInterface/) (width, height, data als Uint8Array).
- MapLibre GL JS: `src/util/image.ts` (RGBAImage), `src/ui/map.ts` (addImage), `src/util/browser.ts` (getImageData).

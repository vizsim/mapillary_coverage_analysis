# BKG VG5000 – Verwaltungsgrenzen

Quelle: [BKG VG5000](https://gdz.bkg.bund.de/index.php/default/digitale-geodaten/verwaltungsgebiete/verwaltungsgebiete-1-5-000-000-stand-01-01-vg5000-01-01.html)  
Lizenz: dl-de/by-2-0

**Erwartete Datei:** `DE_VG5000.gpkg` (in diesem Ordner)

Falls das GPKG im übergeordneten Ordner liegt (`preprocessing/data/DE_VG5000.gpkg`), z.B. Symlink:

```bash
ln -s ../DE_VG5000.gpkg DE_VG5000.gpkg
```

Im Notebook genutzte Layer:
- `vg5000_lan` – Bundesländer
- `vg5000_krs` – Kreise
- `vg5000_gem` – Gemeinden
- `v_vz5000_gem` – View mit Hierarchie (GEN_L, GEN_K, GEN_G) für einen räumlichen Join

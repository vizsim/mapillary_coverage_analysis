"""Memory-efficient OSM-Highway / Mapillary-Coverage pipeline.

Pro-Region streaming so the peak RAM stays in the 1-2 GB range
(fits an 8 GB Docker container). Reused by both the notebook
(``load_pbf_v04.ipynb``) and the headless CLI (``run_pipeline.py``).
"""
from __future__ import annotations

import gc
import logging
import re
import subprocess
from pathlib import Path
from typing import Callable, Iterable

import geopandas as gpd
import pandas as pd
import pyogrio
from pandas.api.types import union_categoricals

log = logging.getLogger(__name__)

MAJOR_HIGHWAY: tuple[str, ...] = (
    "motorway", "motorway_link",
    "trunk", "trunk_link",
    "primary", "primary_link",
    "secondary", "secondary_link",
    "tertiary", "tertiary_link",
)
HIGHWAY_BASE_CAT: list[str] = ["motorway", "trunk", "primary", "secondary", "tertiary", "all"]
COV_ORDER: list[str] = ["NaN", "pano", "regular"]
TARGET_CRS: int = 25832

# BKG VG-Dateien (vg5000 = 1:5 Mio, vg250 = 1:250.000, …).
# Layer-Namen folgen ``vg<scale>_{lan,krs,gem}`` und ``v_vz<scale>_gem``.
BKG_GPKG_PATTERN = "DE_VG*.gpkg"
_BKG_SCALE_RE = re.compile(r"VG(\d+)", re.IGNORECASE)

EBENEN: list[str] = ["Bundesland", "Kreis", "Gemeinde"]
EXPORT_SPECS: dict[str, dict] = {
    "Bundesland": dict(filename="bland_wide", minzoom=5, maxzoom=7),
    "Kreis":      dict(filename="kreise_wide", minzoom=5, maxzoom=7),
    "Gemeinde":   dict(filename="gem_wide",   minzoom=7, maxzoom=10),
}

# Coverage-CSV wird immer frisch direkt vom Repo gezogen (Single Source of Truth).
COVERAGE_CSV_URL: str = (
    "https://raw.githubusercontent.com/vizsim/mapillary_coverage/"
    "refs/heads/main/output/germany_osm-highways_mp-coverage_latest.csv"
)


# --------------------------------------------------------------------------
# Discovery + IO
# --------------------------------------------------------------------------
def discover_pbfs(osm_dir: Path) -> list[Path]:
    """Sortierte PBF-Dateien ``processed_highways_DE-*_latest.pbf`` in osm_dir."""
    return sorted(Path(osm_dir).glob("processed_highways_*.pbf"))


def _region_from_filename(pbf: Path) -> str:
    return pbf.stem.split("_")[-2]


def _where_clause(values: Iterable[str]) -> str:
    quoted = ",".join(f"'{v}'" for v in values)
    return f"highway IN ({quoted})"


def load_pbf_filtered(pbf_path: Path) -> gpd.GeoDataFrame:
    """Liest nur Major-Roads aus dem PBF — push-down filter + spaltenreduziert.

    Bevorzugt OGR ``WHERE`` (kein Materialisieren der verworfenen Features im DataFrame).
    Falls die Klausel ignoriert wird, fallen wir auf isin() zurück (gleiche Spalten).
    """
    region = _region_from_filename(pbf_path)
    cols = ["osm_id", "highway"]
    where = _where_clause(MAJOR_HIGHWAY)
    try:
        gdf = pyogrio.read_dataframe(
            pbf_path, layer="lines", columns=cols, where=where,
        )
    except Exception as e:
        log.warning("WHERE-Filter fehlgeschlagen (%s) – fallback isin(): %s", pbf_path.name, e)
        gdf = pyogrio.read_dataframe(pbf_path, layer="lines", columns=cols)
        gdf = gdf[gdf["highway"].isin(MAJOR_HIGHWAY)]

    if len(gdf) and not gdf["highway"].isin(MAJOR_HIGHWAY).all():
        gdf = gdf[gdf["highway"].isin(MAJOR_HIGHWAY)]
    gdf["region"] = region
    return gdf


def _bkg_scale(gpkg: Path) -> str:
    """Extrahiert den BKG-Maßstab aus dem Dateinamen (z.B. ``"5000"``, ``"250"``)."""
    m = _BKG_SCALE_RE.search(Path(gpkg).stem)
    if not m:
        raise ValueError(
            f"Kann BKG-Maßstab nicht aus {Path(gpkg).name!r} ableiten "
            "(erwartet DE_VG<N>.gpkg)."
        )
    return m.group(1)


def _bkg_layer_names(gpkg: Path) -> dict[str, str]:
    """Konstruiert die BKG-Layer-Namen aus dem Maßstab."""
    s = _bkg_scale(gpkg)
    return {
        "lan": f"vg{s}_lan",
        "krs": f"vg{s}_krs",
        "gem": f"vg{s}_gem",
        "hierarchy": f"v_vz{s}_gem",
    }


def discover_bkg_gpkg(bkg_dir: Path) -> Path:
    """Findet die höchstauflösende ``DE_VG*.gpkg`` in ``bkg_dir``.

    Sortiert nach Maßstab aufsteigend → kleinerer Wert = mehr Detail.
    Beispiel: VG250 wird VG5000 vorgezogen, wenn beide vorhanden sind.
    """
    bkg_dir = Path(bkg_dir)
    candidates = list(bkg_dir.glob(BKG_GPKG_PATTERN))
    if not candidates:
        raise FileNotFoundError(f"Keine {BKG_GPKG_PATTERN} in {bkg_dir}")
    candidates.sort(key=lambda p: int(_bkg_scale(p)))
    return candidates[0]


def load_bkg_layers(gpkg: Path) -> tuple[gpd.GeoDataFrame, gpd.GeoDataFrame, gpd.GeoDataFrame, gpd.GeoDataFrame]:
    """BKG VG-Layer in EPSG:25832. Wird *einmal* pro Run geladen.

    Layer-Namen werden aus dem ``DE_VG<scale>.gpkg``-Dateinamen abgeleitet.
    Returns ``(gem_hierarchy, gdf_lan, gdf_krs, gdf_gem)``.
    """
    gpkg = Path(gpkg)
    names = _bkg_layer_names(gpkg)
    log.info("BKG-Layer aus %s (VG%s): %s",
             gpkg.name, _bkg_scale(gpkg), names)

    gem_hierarchy = gpd.read_file(gpkg, layer=names["hierarchy"]).rename(
        columns={"GEN_L": "Bundesland", "GEN_K": "Kreis", "GEN_G": "Gemeinde"}
    )
    if "AGS_G" in gem_hierarchy.columns:
        gem_hierarchy["AGS_0"] = gem_hierarchy["AGS_G"]

    gdf_lan = gpd.read_file(gpkg, layer=names["lan"]).rename(columns={"GEN": "Bundesland"})
    gdf_lan = gdf_lan[gdf_lan["GF"] == 9].copy()
    gdf_krs = gpd.read_file(gpkg, layer=names["krs"]).rename(columns={"GEN": "Kreis"})
    gdf_gem = gpd.read_file(gpkg, layer=names["gem"]).rename(columns={"GEN": "Gemeinde"})

    for g in (gem_hierarchy, gdf_lan, gdf_krs, gdf_gem):
        if g.crs is not None and g.crs.to_epsg() != TARGET_CRS:
            g.to_crs(TARGET_CRS, inplace=True)
    return gem_hierarchy, gdf_lan, gdf_krs, gdf_gem


# --------------------------------------------------------------------------
# Per-region processing
# --------------------------------------------------------------------------
def filter_reproject_slim(gdf: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Reduziert auf 4 Spalten, projiziert nach EPSG:25832, schlanke dtypes."""
    keep = ["osm_id", "highway", "region", "geometry"]
    gdf = gdf[keep].copy()
    gdf["osm_id"] = pd.to_numeric(gdf["osm_id"], errors="coerce").astype("Int64").astype("int64")
    gdf["highway"] = gdf["highway"].astype(pd.CategoricalDtype(categories=list(MAJOR_HIGHWAY)))
    gdf["region"] = gdf["region"].astype("category")
    if gdf.crs is None or gdf.crs.to_epsg() != TARGET_CRS:
        gdf = gdf.to_crs(TARGET_CRS)
    return gdf


def process_region(pbf: Path) -> gpd.GeoDataFrame:
    """Load + slim + reproject für eine Region. Liefert kleinen Frame zurück."""
    gdf = load_pbf_filtered(pbf)
    slim = filter_reproject_slim(gdf)
    del gdf
    gc.collect()
    return slim


def _concat_slim(frames: list[gpd.GeoDataFrame]) -> gpd.GeoDataFrame:
    """Concat unter Erhalt der Categoricals (highway, region)."""
    if not frames:
        raise ValueError("Keine PBFs verarbeitet.")
    hw_union = union_categoricals([f["highway"] for f in frames])
    rg_union = union_categoricals([f["region"] for f in frames])
    out = pd.concat(frames, ignore_index=True)
    out["highway"] = pd.Categorical(hw_union.tolist(), categories=hw_union.categories)
    out["region"] = pd.Categorical(rg_union.tolist(), categories=rg_union.categories)
    return gpd.GeoDataFrame(out, geometry="geometry", crs=frames[0].crs)


# --------------------------------------------------------------------------
# Joins
# --------------------------------------------------------------------------
def attach_admin(lines: gpd.GeoDataFrame, gem_hierarchy: gpd.GeoDataFrame) -> gpd.GeoDataFrame:
    """Spatial-Join via representative_point → Bundesland/Kreis/Gemeinde/AGS_0 anhängen."""
    pts = lines[["osm_id", "geometry"]].copy()
    pts["geometry"] = pts.geometry.representative_point()
    cols = [c for c in ["Bundesland", "Kreis", "Gemeinde", "AGS_0", "geometry"] if c in gem_hierarchy.columns]
    joined = pts.sjoin(gem_hierarchy[cols], how="left", predicate="within")
    del pts
    gc.collect()
    join_cols = [c for c in ["osm_id", "Bundesland", "Kreis", "Gemeinde", "AGS_0"] if c in joined.columns]
    out = lines.merge(joined[join_cols], on="osm_id", how="left")
    del joined
    gc.collect()
    return out


def join_coverage(lines: gpd.GeoDataFrame, coverage_csv: str | Path = COVERAGE_CSV_URL) -> gpd.GeoDataFrame:
    """Coverage-CSV einlesen, auf gekommene osm_ids vorfiltern, dann left-mergen.

    ``coverage_csv`` darf URL **oder** lokaler Pfad sein. Default = remote GitHub-Raw.
    """
    osm_ids_keep = pd.Index(lines["osm_id"].unique())
    log.info("Lese Coverage-CSV: %s", coverage_csv)
    cov = pd.read_csv(
        coverage_csv,
        usecols=["osm_id", "mapillary_coverage"],
        dtype={"osm_id": "int64"},
    )
    cov = cov[cov["osm_id"].isin(osm_ids_keep)]
    cov["mapillary_coverage"] = cov["mapillary_coverage"].astype("category")
    out = lines.merge(cov, on="osm_id", how="left")
    out["mapillary_coverage"] = (
        out["mapillary_coverage"].astype("string").fillna("NaN").astype("category")
    )
    del cov
    gc.collect()
    return out


def normalize_highway(df: pd.DataFrame) -> pd.DataFrame:
    """`_link` entfernen, highway als geordnete Categorical."""
    hw = df["highway"].astype("string").str.replace("_link$", "", regex=True)
    df = df.copy()
    df["highway"] = pd.Categorical(hw, categories=HIGHWAY_BASE_CAT, ordered=True)
    return df


# --------------------------------------------------------------------------
# Aggregation
# --------------------------------------------------------------------------
def aggregate_level(df: pd.DataFrame, level: str, gdf_gem: gpd.GeoDataFrame) -> pd.DataFrame:
    """Wide-Pivot (share_/length_ je highway inkl. 'all') auf der Verwaltungs-Ebene."""
    if level not in EBENEN:
        raise ValueError(f"unknown level: {level!r}")
    group_key = "AGS_0" if level == "Gemeinde" else level

    agg = (
        df.groupby([group_key, "highway", "mapillary_coverage"], observed=True)["length_m"]
        .sum()
        .reset_index()
    )
    agg["total_length"] = agg.groupby([group_key, "highway"], observed=True)["length_m"].transform("sum")
    agg["share"] = agg["length_m"] / agg["total_length"]

    agg_all = (
        df.groupby([group_key, "mapillary_coverage"], observed=True)["length_m"]
        .sum()
        .reset_index()
    )
    agg_all["total_length"] = agg_all.groupby(group_key, observed=True)["length_m"].transform("sum")
    agg_all["share"] = agg_all["length_m"] / agg_all["total_length"]
    agg_all["highway"] = "all"

    pivot_df = pd.concat([agg, agg_all], ignore_index=True)
    pivot_df["mapillary_coverage"] = pivot_df["mapillary_coverage"].astype("string").fillna("NaN")

    share_wide = pivot_df.pivot_table(
        index=[group_key, "highway"], columns="mapillary_coverage",
        values="share", aggfunc="sum", fill_value=0,
    )
    length_wide = (
        pivot_df.pivot_table(
            index=[group_key, "highway"], columns="mapillary_coverage",
            values="length_m", aggfunc="sum", fill_value=0,
        )
        .div(1000.0).round(1)
    )
    for c in COV_ORDER:
        if c not in share_wide.columns:
            share_wide[c] = 0
        if c not in length_wide.columns:
            length_wide[c] = 0
    share_wide = share_wide[COV_ORDER].add_prefix("share_")
    length_wide = length_wide[COV_ORDER].add_prefix("length_")
    result = pd.concat([share_wide, length_wide], axis=1).reset_index()
    result["highway"] = pd.Categorical(result["highway"], HIGHWAY_BASE_CAT, ordered=True)
    result = result.sort_values([group_key, "highway"])

    r = result.rename(columns={"share_NaN": "share_no_cover", "length_NaN": "length_no_cover"})
    wide_long = r.melt(
        id_vars=[group_key, "highway"],
        value_vars=[
            "share_no_cover", "share_pano", "share_regular",
            "length_no_cover", "length_pano", "length_regular",
        ],
        var_name="metric_coverage", value_name="value",
    )
    wide_long[["metric", "coverage"]] = wide_long["metric_coverage"].str.split("_", n=1, expand=True)
    wide_long["col"] = (
        wide_long["highway"].astype("string")
        + "_" + wide_long["metric"].astype("string")
        + "_" + wide_long["coverage"].astype("string")
    )
    wide = (
        wide_long.pivot(index=group_key, columns="col", values="value")
        .fillna(0).reset_index()
    )
    if level == "Gemeinde" and "AGS_0" in wide.columns:
        wide = wide.merge(gdf_gem[["AGS_0", "Gemeinde"]].drop_duplicates(), on="AGS_0", how="left")
    return wide


# --------------------------------------------------------------------------
# Export
# --------------------------------------------------------------------------
def _polys_for_level(level: str,
                     gdf_lan: gpd.GeoDataFrame,
                     gdf_krs: gpd.GeoDataFrame,
                     gdf_gem: gpd.GeoDataFrame) -> tuple[gpd.GeoDataFrame, str]:
    if level == "Bundesland":
        return gdf_lan[["Bundesland", "geometry"]], "Bundesland"
    if level == "Kreis":
        return gdf_krs[["Kreis", "geometry"]], "Kreis"
    if level == "Gemeinde":
        return gdf_gem[["AGS_0", "Gemeinde", "geometry"]], "AGS_0"
    raise ValueError(level)


def export_pmtiles(wide: pd.DataFrame,
                   polys: gpd.GeoDataFrame,
                   key: str,
                   out_fgb: Path,
                   out_pmtiles: Path,
                   minzoom: int, maxzoom: int,
                   dry_run: bool = False) -> None:
    """Merge wide auf polys[key], schreibt FlatGeobuf und ruft tippecanoe."""
    if key == "AGS_0":
        wide_noname = wide.drop(columns=["Gemeinde"], errors="ignore")
        merged = polys.merge(wide_noname, on=key, how="left").fillna(0)
    else:
        merged = polys.merge(wide, on=key, how="left").fillna(0)
    merged_4326 = merged.to_crs(4326)
    out_fgb.parent.mkdir(parents=True, exist_ok=True)
    merged_4326.to_file(out_fgb, driver="FlatGeobuf")
    log.info("FlatGeobuf geschrieben: %s (%d features)", out_fgb, len(merged_4326))
    del merged, merged_4326
    gc.collect()

    if dry_run:
        log.info("dry-run: skip tippecanoe für %s", out_pmtiles)
        return

    cmd = [
        "tippecanoe",
        "-o", str(out_pmtiles.resolve()),
        "--layer=default",
        f"--minimum-zoom={minzoom}",
        f"--maximum-zoom={maxzoom}",
        "--force",
        "--read-parallel",
        "--detect-shared-borders",
        "--coalesce-densest-as-needed",
        "--extend-zooms-if-still-dropping",
        str(out_fgb.resolve()),
    ]
    log.info("tippecanoe %s …", out_pmtiles.name)
    subprocess.run(cmd, check=True)


# --------------------------------------------------------------------------
# Orchestration
# --------------------------------------------------------------------------
def run_pipeline(
    data_dir: Path,
    output_dir: Path,
    *,
    osm_dir: Path | None = None,
    bkg_gpkg: Path | None = None,
    limit_regions: list[str] | None = None,
    dry_run: bool = False,
    coverage_csv: str | Path | None = None,
    log_memory: Callable[[str], None] | None = None,
) -> dict:
    """End-to-End pipeline. Liest PBFs pro Region, joint, aggregiert, exportiert.

    Args:
        data_dir: Root mit ``bkg/`` (BKG-Verwaltungsgrenzen).
        output_dir: Wohin ``{bland,kreise,gem}_wide.{fgb,pmtiles}`` geschrieben wird.
        osm_dir: Verzeichnis mit ``processed_highways_DE-*.pbf``.
            Default: ``data_dir / "osm"`` (lokale Entwicklung). Auf dem Server
            typischerweise ``/home/simon/mapillary_coverage/data/osm/processed``.
        bkg_gpkg: Konkrete BKG-GPKG. Default: höchstauflösende ``DE_VG*.gpkg``
            in ``data_dir / "bkg"`` (VG250 schlägt VG5000 wenn vorhanden).
        limit_regions: optional Liste von Region-Codes (z.B. ``["DE-HB", "DE-HH"]``).
        dry_run: skipt den ``tippecanoe``-Aufruf (FGBs werden dennoch geschrieben).
        coverage_csv: URL oder lokaler Pfad. Default = ``COVERAGE_CSV_URL``
            (frisch aus dem ``vizsim/mapillary_coverage``-Repo).
        log_memory: optionaler Callback ``log_memory(tag: str)`` für RSS-Probes.
    """
    data_dir = Path(data_dir)
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    def mem(tag: str) -> None:
        if log_memory is not None:
            log_memory(tag)

    mem("start")

    bkg_gpkg = Path(bkg_gpkg) if bkg_gpkg is not None else discover_bkg_gpkg(data_dir / "bkg")
    coverage_source: str | Path = coverage_csv if coverage_csv is not None else COVERAGE_CSV_URL
    osm_dir = Path(osm_dir) if osm_dir is not None else (data_dir / "osm")
    log.info("BKG-GPKG: %s", bkg_gpkg)
    log.info("OSM PBF-Verzeichnis: %s", osm_dir)

    log.info("Lade BKG-Layer aus %s …", bkg_gpkg)
    gem_hierarchy, gdf_lan, gdf_krs, gdf_gem = load_bkg_layers(bkg_gpkg)
    mem("bkg-loaded")

    pbfs = discover_pbfs(osm_dir)
    if limit_regions:
        wanted = set(limit_regions)
        pbfs = [p for p in pbfs if _region_from_filename(p) in wanted]
        log.info("Limit auf Regionen: %s → %d PBFs", sorted(wanted), len(pbfs))
    if not pbfs:
        raise RuntimeError(f"Keine passenden PBFs in {osm_dir}")
    log.info("Verarbeite %d PBFs:", len(pbfs))
    for p in pbfs:
        log.info("  - %s", p.name)

    slim_frames: list[gpd.GeoDataFrame] = []
    region_rows: dict[str, int] = {}
    for p in pbfs:
        region = _region_from_filename(p)
        log.info("Region %s: lese %s …", region, p.name)
        slim = process_region(p)
        region_rows[region] = len(slim)
        log.info("  → %d Major-Road-Features", len(slim))
        slim_frames.append(slim)
        mem(f"after-{region}")

    log.info("Concat %d Regionen …", len(slim_frames))
    all_lines = _concat_slim(slim_frames)
    slim_frames.clear()
    gc.collect()
    mem("after-concat")
    log.info("all_lines: %d Zeilen", len(all_lines))

    log.info("Spatial-Join auf Verwaltungsgrenzen …")
    all_lines = attach_admin(all_lines, gem_hierarchy)
    mem("after-sjoin")

    log.info("Mapillary-Coverage joinen …")
    all_lines = join_coverage(all_lines, coverage_source)
    mem("after-coverage")

    log.info("length_m berechnen + highway normalisieren …")
    all_lines["length_m"] = all_lines.geometry.length
    all_lines = normalize_highway(all_lines)
    total_length_km = float(all_lines["length_m"].sum() / 1000.0)
    log.info("Gesamt-Länge: %.1f km", total_length_km)

    output_paths: dict[str, dict[str, str]] = {}
    for level in EBENEN:
        log.info("Aggregiere %s …", level)
        wide = aggregate_level(all_lines, level, gdf_gem)
        spec = EXPORT_SPECS[level]
        polys, key = _polys_for_level(level, gdf_lan, gdf_krs, gdf_gem)
        out_fgb = output_dir / f"{spec['filename']}.fgb"
        out_pmtiles = output_dir / f"{spec['filename']}.pmtiles"
        export_pmtiles(
            wide, polys, key, out_fgb, out_pmtiles,
            minzoom=spec["minzoom"], maxzoom=spec["maxzoom"], dry_run=dry_run,
        )
        output_paths[level] = {"fgb": str(out_fgb), "pmtiles": str(out_pmtiles)}
        del wide, polys
        gc.collect()
        mem(f"after-{level}")

    summary = {
        "region_rows": region_rows,
        "total_rows": int(sum(region_rows.values())),
        "total_length_km": round(total_length_km, 1),
        "outputs": output_paths,
        "dry_run": dry_run,
    }
    log.info("Pipeline fertig.")
    return summary

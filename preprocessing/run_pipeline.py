"""Headless-CLI für die Coverage-Pipeline.

Beispiele:
    python run_pipeline.py
    python run_pipeline.py --limit-regions DE-HB,DE-HH --dry-run
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

import psutil

from pipeline import run_pipeline

HERE = Path(__file__).resolve().parent


def _setup_logging() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        stream=sys.stdout,
    )


def _make_mem_logger() -> callable:
    proc = psutil.Process(os.getpid())
    log = logging.getLogger("mem")

    def _mem(tag: str) -> None:
        rss_gb = proc.memory_info().rss / 1e9
        log.info("MEM %-22s rss=%.2f GB", tag, rss_gb)

    return _mem


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--data-dir", type=Path,
                   default=Path(os.environ.get("DATA_DIR", str(HERE / "data"))),
                   help="Root mit bkg/. Default: $DATA_DIR oder %(default)s")
    p.add_argument("--output-dir", type=Path,
                   default=Path(os.environ.get("OUTPUT_DIR", str(HERE / "data"))),
                   help="Wohin .fgb/.pmtiles geschrieben werden. "
                        "Default: $OUTPUT_DIR oder %(default)s")
    p.add_argument("--osm-dir", type=Path,
                   default=Path(os.environ["OSM_DIR"]) if "OSM_DIR" in os.environ else None,
                   help="Verzeichnis mit processed_highways_DE-*.pbf. "
                        "Default: $OSM_DIR oder <data-dir>/osm")
    p.add_argument("--bkg-gpkg", type=Path,
                   default=Path(os.environ["BKG_GPKG"]) if "BKG_GPKG" in os.environ else None,
                   help="Konkrete BKG-GPKG (DE_VG250.gpkg / DE_VG5000.gpkg). "
                        "Default: $BKG_GPKG oder höchstauflösende DE_VG*.gpkg in <data-dir>/bkg")
    p.add_argument("--limit-regions", default=None,
                   help="Komma-Liste z.B. DE-HB,DE-HH (Smoke-Test).")
    p.add_argument("--dry-run", action="store_true",
                   help="FGBs schreiben, tippecanoe-Aufruf überspringen.")
    p.add_argument("--coverage-csv", default=os.environ.get("COVERAGE_CSV"),
                   help="Override Coverage-Quelle (URL oder Pfad). "
                        "Default: $COVERAGE_CSV oder pipeline.COVERAGE_CSV_URL.")
    args = p.parse_args()

    _setup_logging()
    log = logging.getLogger("run_pipeline")

    limit = [r.strip() for r in args.limit_regions.split(",")] if args.limit_regions else None
    try:
        summary = run_pipeline(
            data_dir=args.data_dir,
            output_dir=args.output_dir,
            osm_dir=args.osm_dir,
            bkg_gpkg=args.bkg_gpkg,
            limit_regions=limit,
            dry_run=args.dry_run,
            coverage_csv=args.coverage_csv,
            log_memory=_make_mem_logger(),
        )
    except Exception:
        log.exception("Pipeline fehlgeschlagen")
        return 1

    log.info("Summary:\n%s", json.dumps(summary, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())

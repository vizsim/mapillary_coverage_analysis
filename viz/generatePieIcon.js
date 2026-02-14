const pixelRatio = 4;

/**
 * Generates a pie chart icon as a canvas for MapLibre.
 * @param {Object} params
 * @param {number} params.k1 - Value for first slice (red/pano)
 * @param {number} params.k2 - Value for second slice (blue/regular)
 * @param {number} params.k3 - Value for third slice (green/no_cover)
 * @returns {Object|null} Image object with size and canvas (HTMLCanvasElement) or null if total = 0
 */
export function generatePieIcon({ k1, k2, k3 }) {
  const total = k1 + k2 + k3;
  if (total === 0) return null;

  const size = total > 100 ? 64 : total > 10 ? 48 : 32;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size * pixelRatio;
  const ctx = canvas.getContext("2d");

  const center = (size * pixelRatio) / 2;
  const radius = center;

  const angles = [
    (k1 / total) * 2 * Math.PI,
    (k2 / total) * 2 * Math.PI,
    (k3 / total) * 2 * Math.PI,
  ];

  const colors = [
    "rgba(23, 78, 217, 1)",    // dark blue - pano
    "rgba(0, 152, 240, 1)",    // light blue - regular
    "rgba(233, 30, 99, 1)"     // pink - no_cover
  ];

  let start = -Math.PI / 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.arc(center, center, radius, start, start + angles[i]);
    ctx.closePath();
    ctx.fillStyle = colors[i];
    ctx.fill();
    start += angles[i];
  }

  // Optional border
  ctx.beginPath();
  ctx.arc(center, center, radius - 0.5 * pixelRatio, 0, 2 * Math.PI);
  ctx.lineWidth = 0.8 * pixelRatio;
  ctx.strokeStyle = "#e6e6e6";
  ctx.stroke();

  return {
    size,
    canvas,
  };
}

/**
 * Generates a pie chart as a data URL for embedding in HTML tooltips.
 * @param {Object} params
 * @param {number} params.k1 - Value for first slice (blue/pano)
 * @param {number} params.k2 - Value for second slice (amber/regular)
 * @param {number} params.k3 - Value for third slice (red/no_cover)
 * @param {number} [params.size=80] - Size of the pie chart in pixels
 * @returns {string|null} Data URL for the pie chart or null if total = 0
 */
export function generatePieChartDataUrl({ k1, k2, k3, size = 120 }) {
  const total = k1 + k2 + k3;
  if (total === 0) return null;

  const canvas = document.createElement("canvas");
  const scale = pixelRatio;
  canvas.width = canvas.height = size * scale;
  canvas.style.width = canvas.style.height = size + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(scale, scale);

  const center = size / 2;
  const radius = center * 0.85;

  const angles = [
    (k1 / total) * 2 * Math.PI,
    (k2 / total) * 2 * Math.PI,
    (k3 / total) * 2 * Math.PI,
  ];

  const colors = [
    "#174ed9",   // dark blue - pano
    "#0098f0",   // light blue - regular
    "#e91e63"    // pink - no_cover
  ];

  let start = -Math.PI / 2;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.arc(center, center, radius, start, start + angles[i]);
    ctx.closePath();
    ctx.fillStyle = colors[i];
    ctx.fill();
    start += angles[i];
  }

  // Border
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, 2 * Math.PI);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#d1d5db";
  ctx.stroke();

  return canvas.toDataURL("image/png");
}

/**
 * Setup MapLibre image generation for pie chart icons.
 * @param {maplibregl.Map} map - The MapLibre map instance
 */
export function setupPieChartImageGeneration(map) {
  map.on("styleimagemissing", (e) => {
    const id = e.id;
    if (!id.startsWith("pie-")) return;

    const parts = id.split("-");
    if (parts.length !== 4) return;

    const k1 = parseInt(parts[1], 10);
    const k2 = parseInt(parts[2], 10);
    const k3 = parseInt(parts[3], 10);

    const image = generatePieIcon({ k1, k2, k3 });
    if (image) {
      map.addImage(id, image.canvas, { pixelRatio });
    }
  });
}

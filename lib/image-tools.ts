// Browser-only image helpers for the branding settings.

const MAX_SIDE = 1200;

function loadImage(source: Blob | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Needed to read pixels of an image served from Supabase Storage.
    image.crossOrigin = "anonymous";
    const url = typeof source === "string" ? source : URL.createObjectURL(source);
    image.onload = () => {
      if (typeof source !== "string") URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      if (typeof source !== "string") URL.revokeObjectURL(url);
      reject(new Error("The image could not be read."));
    };
    image.src = url;
  });
}

/**
 * Makes the background of a logo transparent.
 *
 * It takes the colour at the image's edges as "the background" and clears
 * everything connected to the edges that is close to that colour, so areas of
 * the same colour inside the logo (white lettering on a white page, say) are
 * kept. This suits logos on a plain or nearly plain background; it is not a
 * photo cut-out tool.
 *
 * @param tolerance 5–120. Higher removes more (and risks eating into the logo).
 */
export async function removeBackground(source: Blob | string, tolerance: number): Promise<File> {
  const image = await loadImage(source);
  const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("This browser can't edit images.");
  context.drawImage(image, 0, 0, width, height);

  const pixels = context.getImageData(0, 0, width, height);
  clearBackground(pixels.data, width, height, tolerance);
  context.putImageData(pixels, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("The image could not be saved.");
  return new File([blob], "logo-transparent.png", { type: "image/png" });
}

/** The pixel work, on raw RGBA data. Kept separate from the canvas so it can be tested. */
export function clearBackground(data: Uint8ClampedArray, width: number, height: number, tolerance: number) {
  // Background colour: the average of the four corners.
  const corners = [0, width - 1, (height - 1) * width, height * width - 1];
  const background = [0, 0, 0];
  for (const corner of corners) {
    for (let channel = 0; channel < 3; channel += 1) background[channel] += data[corner * 4 + channel] / corners.length;
  }
  const distance = (index: number) =>
    Math.sqrt(
      (data[index * 4] - background[0]) ** 2 + (data[index * 4 + 1] - background[1]) ** 2 + (data[index * 4 + 2] - background[2]) ** 2,
    );

  // Flood fill inward from every edge pixel that matches the background.
  const removed = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let head = 0;
  let tail = 0;
  const visit = (index: number) => {
    if (removed[index] || data[index * 4 + 3] === 0 || distance(index) > tolerance) return;
    removed[index] = 1;
    queue[tail++] = index;
  };
  for (let x = 0; x < width; x += 1) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    visit(y * width);
    visit(y * width + width - 1);
  }
  while (head < tail) {
    const index = queue[head++];
    const x = index % width;
    if (x > 0) visit(index - 1);
    if (x < width - 1) visit(index + 1);
    if (index >= width) visit(index - width);
    if (index < width * (height - 1)) visit(index + width);
  }

  // Clear the background, and soften the logo's outline so it has no hard halo.
  const soft = tolerance * 1.6;
  for (let index = 0; index < width * height; index += 1) {
    if (removed[index]) {
      data[index * 4 + 3] = 0;
      continue;
    }
    const x = index % width;
    const touchesBackground =
      (x > 0 && removed[index - 1]) ||
      (x < width - 1 && removed[index + 1]) ||
      (index >= width && removed[index - width]) ||
      (index < width * (height - 1) && removed[index + width]);
    if (touchesBackground) {
      const d = distance(index);
      if (d < soft) {
        data[index * 4 + 3] = Math.round(data[index * 4 + 3] * Math.max(0.25, (d - tolerance) / (soft - tolerance)));
      }
    }
  }
}

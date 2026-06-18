const config = window.SADDLE_CONFIG || {};

const statusElement = document.querySelector("#status");
const galleryElement = document.querySelector("#shareGallery");

function setStatus(message, isError = false) {
  if (!statusElement) {
    return;
  }
  statusElement.textContent = message;
  statusElement.style.color = isError ? "crimson" : "";
}

function normalizePhoto(photoField) {
  const fallback = "https://placehold.co/640x480?text=No+Photo";

  if (!photoField) {
    return fallback;
  }

  const queue = Array.isArray(photoField) ? [...photoField] : [photoField];

  while (queue.length) {
    const item = queue.shift();

    if (!item) {
      continue;
    }

    if (typeof item === "string") {
      return item;
    }

    if (Array.isArray(item)) {
      queue.push(...item);
      continue;
    }

    if (typeof item === "object") {
      if (item.url) {
        return item.url;
      }

      const thumbUrl = item.thumbnails?.large?.url || item.thumbnails?.small?.url;
      if (thumbUrl) {
        return thumbUrl;
      }
    }
  }

  return fallback;
}

function getFieldValueByAlias(fields, aliases) {
  for (const alias of aliases) {
    if (Object.prototype.hasOwnProperty.call(fields, alias)) {
      return fields[alias];
    }
  }

  const lowerMap = Object.fromEntries(
    Object.keys(fields).map((key) => [key.trim().toLowerCase(), key]),
  );

  for (const alias of aliases) {
    const matchedKey = lowerMap[alias.trim().toLowerCase()];
    if (matchedKey) {
      return fields[matchedKey];
    }
  }

  return undefined;
}

function parseBooleanField(value) {
  if (Array.isArray(value)) {
    value = value.find((item) => item !== null && item !== undefined && `${item}`.trim() !== "");
  }

  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    return value !== 0;
  }

  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "y", "1"].includes(normalized)) {
      return true;
    }
    if (["false", "no", "n", "0", ""].includes(normalized)) {
      return false;
    }
  }

  return false;
}

function sanitizeFilename(value) {
  return String(value || "saddle")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "saddle";
}

function formatWidth(widthValue) {
  if (Array.isArray(widthValue)) {
    widthValue = widthValue.find((item) => item !== null && item !== undefined && `${item}`.trim() !== "");
  }

  if (widthValue === null || widthValue === undefined) {
    return "";
  }

  const text = String(widthValue).trim();
  if (!text) {
    return "";
  }

  return /\bmm\b/i.test(text) ? text : `${text} mm`;
}

function parseRecord(record) {
  const fields = record.fields || {};
  const name = getFieldValueByAlias(fields, ["Model", "Name"]);
  const manufacturer = getFieldValueByAlias(fields, ["Brand", "Manufacturer"]);
  const photo = getFieldValueByAlias(fields, [
    "Manufacturer Image",
    "ManufacturerImage",
    "Manufacturer Photo",
    "Manufacturer Logo",
    "Brand Image",
    "Logo",
    "Photo",
    "Image",
  ]);
  const width = getFieldValueByAlias(fields, ["Width"]);

  return {
    id: record.id,
    name: name || "Untitled Saddle",
    manufacturer: manufacturer || "Unknown",
    photoUrl: normalizePhoto(photo),
    width: formatWidth(width),
  };
}

function drawWrappedText(ctx, text, x, y, maxWidth, lineHeight, maxLines = Infinity) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  let line = "";
  let lines = 0;

  for (const word of words) {
    const testLine = line ? `${line} ${word}` : word;
    if (ctx.measureText(testLine).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
      line = word;
      lines += 1;
      if (lines >= maxLines) {
        return y;
      }
    } else {
      line = testLine;
    }
  }

  if (line && lines < maxLines) {
    ctx.fillText(line, x, y);
    y += lineHeight;
  }

  return y;
}

async function loadImageForCanvas(url) {
  const response = await fetch(url, { mode: "cors" });
  if (!response.ok) {
    throw new Error("Could not load saddle image");
  }

  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);

  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("Could not load saddle image"));
      img.src = objectUrl;
    });

    return { image, objectUrl };
  } catch (error) {
    URL.revokeObjectURL(objectUrl);
    throw error;
  }
}

async function createShareJpgBlob(saddle) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d");

  if (!ctx) {
    throw new Error("Canvas is not supported");
  }

  const bannerHeight = 116;
  const ribbonBottom = bannerHeight - 24;
  ctx.fillStyle = "#f7f2e8";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  let loadedImage = null;
  let objectUrl = "";

  try {
    const result = await loadImageForCanvas(saddle.photoUrl);
    loadedImage = result.image;
    objectUrl = result.objectUrl;
  } catch {
    loadedImage = null;
  }

  const isLandscape = Boolean(loadedImage && loadedImage.width >= loadedImage.height);
  let imageHeight = 0;

  if (loadedImage) {
    const scaledHeight = (canvas.width * loadedImage.height) / loadedImage.width;
    imageHeight = Math.round(Math.min(canvas.height, scaledHeight));

    if (isLandscape) {
      const drawHeight = Math.round(Math.min(canvas.height - ribbonBottom, scaledHeight));
      ctx.drawImage(loadedImage, 0, ribbonBottom, canvas.width, drawHeight);
      imageHeight = ribbonBottom + drawHeight;
    } else if (scaledHeight > canvas.height) {
      const drawY = Math.round((canvas.height - scaledHeight) / 2);
      ctx.drawImage(loadedImage, 0, drawY, canvas.width, Math.round(scaledHeight));
    } else {
      ctx.drawImage(loadedImage, 0, 0, canvas.width, imageHeight);
    }

    URL.revokeObjectURL(objectUrl);
  } else {
    imageHeight = canvas.height;
    const gradient = ctx.createLinearGradient(0, 0, 0, imageHeight);
    gradient.addColorStop(0, "#6b5b4b");
    gradient.addColorStop(1, "#c8b39d");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, canvas.width, imageHeight);
  }

  const ribbonGradient = ctx.createLinearGradient(0, 0, 0, ribbonBottom);
  ribbonGradient.addColorStop(0, "#4f93ff");
  ribbonGradient.addColorStop(1, "#2c6ed6");

  ctx.fillStyle = ribbonGradient;
  ctx.fillRect(0, 0, canvas.width, ribbonBottom);

  ctx.fillStyle = "rgba(14, 49, 110, 0.35)";
  ctx.fillRect(0, ribbonBottom - 6, canvas.width, 6);

  ctx.fillStyle = "rgba(255, 255, 255, 0.22)";
  ctx.fillRect(0, 0, canvas.width, 5);

  ctx.fillStyle = "#f7fbff";
  ctx.font = "800 44px Segoe UI, Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("Borrow me!", canvas.width / 2, ribbonBottom / 2 + 1);
  ctx.textAlign = "start";
  ctx.textBaseline = "alphabetic";

  const overlayGradient = ctx.createLinearGradient(0, canvas.height - 440, 0, canvas.height);
  overlayGradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  overlayGradient.addColorStop(1, "rgba(0, 0, 0, 0.6)");
  ctx.fillStyle = overlayGradient;
  ctx.fillRect(0, canvas.height - 440, canvas.width, 440);

  ctx.fillStyle = "#fff";
  ctx.font = "700 30px Segoe UI, Arial, sans-serif";
  ctx.fillText("Philadelphia Saddle Library", 48, canvas.height - 200);

  ctx.font = "800 52px Segoe UI, Arial, sans-serif";
  ctx.fillText(saddle.name, 48, canvas.height - 136);

  if (saddle.manufacturer || saddle.width) {
    ctx.fillStyle = "rgba(255, 255, 255, 0.92)";
    ctx.font = "600 24px Segoe UI, Arial, sans-serif";
    const caption = [saddle.manufacturer, saddle.width].filter(Boolean).join(" • ");
    ctx.fillText(caption, 48, canvas.height - 98);
  }

  return await new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("Could not generate image"));
          return;
        }
        resolve(blob);
      },
      "image/jpeg",
      0.92,
    );
  });
}

async function createShareObjectUrl(saddle) {
  const blob = await createShareJpgBlob(saddle);
  return URL.createObjectURL(blob);
}

async function fetchSaddles() {
  const { proxyUrl, airtableToken, baseId, tableName, view, pageSize = 100 } = config;

  if (proxyUrl) {
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const reason = payload?.error || response.statusText;
      throw new Error(`Proxy request failed: ${reason}`);
    }

    const data = await response.json();
    return Array.isArray(data.records) ? data.records.map(parseRecord) : [];
  }

  if (!airtableToken || !baseId || !tableName) {
    throw new Error("Airtable credentials are missing in config.js");
  }

  const endpoint = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);
  endpoint.searchParams.set("pageSize", String(pageSize));
  endpoint.searchParams.set("view", view || "Grid view");

  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${airtableToken}`,
    },
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    const reason = payload?.error?.message || response.statusText;
    throw new Error(`Airtable request failed: ${reason}`);
  }

  const data = await response.json();
  return Array.isArray(data.records) ? data.records.map(parseRecord) : [];
}

function buildGalleryItem(saddle) {
  const article = document.createElement("article");
  article.className = "share-item";

  const preview = document.createElement("div");
  preview.className = "share-preview";
  preview.textContent = "Generating...";

  const title = document.createElement("h2");
  title.className = "share-title";
  title.textContent = saddle.name;

  const meta = document.createElement("p");
  meta.className = "share-meta";
  meta.textContent = [saddle.manufacturer, saddle.width].filter(Boolean).join(" • ");

  const actions = document.createElement("div");
  actions.className = "share-actions";

  const downloadButton = document.createElement("button");
  downloadButton.type = "button";
  downloadButton.className = "share-download";
  downloadButton.textContent = "Download JPG";

  actions.appendChild(downloadButton);
  article.appendChild(preview);
  article.appendChild(title);
  article.appendChild(meta);
  article.appendChild(actions);

  (async () => {
    try {
      const objectUrl = await createShareObjectUrl(saddle);
      const image = document.createElement("img");
      image.className = "share-image";
      image.alt = `${saddle.name} social image`;
      image.src = objectUrl;
      preview.textContent = "";
      preview.appendChild(image);

      downloadButton.addEventListener("click", () => {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = `${sanitizeFilename(saddle.name)}.jpg`;
        document.body.appendChild(link);
        link.click();
        link.remove();
      });
    } catch (error) {
      preview.textContent = "Could not generate image";
      downloadButton.disabled = true;
      downloadButton.title = error.message || "Could not generate image";
    }
  })();

  return article;
}

async function init() {
  try {
    setStatus("Loading share images...");
    const saddles = await fetchSaddles();
    galleryElement.innerHTML = "";
    for (const saddle of saddles) {
      galleryElement.appendChild(buildGalleryItem(saddle));
    }
    setStatus(`Loaded ${saddles.length} share images`);
  } catch (error) {
    setStatus(error.message || "Failed to load share images", true);
  }
}

init();

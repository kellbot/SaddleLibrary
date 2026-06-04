const config = window.SADDLE_CONFIG || {};

const state = {
  saddles: [],
  filtered: [],
};

const statusElement = document.querySelector("#status");
const listElement = document.querySelector("#saddleList");
const searchInput = document.querySelector("#searchInput");
const refreshButton = document.querySelector("#refreshButton");
const cardTemplate = document.querySelector("#cardTemplate");
const checkoutDialog = document.querySelector("#checkoutDialog");
const checkoutForm = document.querySelector("#checkoutForm");
const cancelCheckoutButton = document.querySelector("#cancelCheckoutButton");
const checkoutSaddleSummary = document.querySelector("#checkoutSaddleSummary");

const sampleData = [
  {
    id: "rec1",
    fields: {
      Name: "Cambium C17",
      Manufacturer: "Brooks",
      Photo: [{ url: "https://images.unsplash.com/photo-1508973379184-7517410fb0dc?w=1200" }],
      PurchaseLink: "https://example.com/saddles/c17",
      Width: "162 mm",
      Notes: "Popular all-weather touring option.",
    },
  },
  {
    id: "rec2",
    fields: {
      Name: "Power Expert",
      Manufacturer: "Specialized",
      Photo: [{ url: "https://images.unsplash.com/photo-1485965120184-e220f721d03e?w=1200" }],
      PurchaseLink: "https://example.com/saddles/power-expert",
      Width: "143 mm",
      Notes: "Short-nose design for performance riding.",
    },
  },
];

function getCheckoutEndpoint() {
  if (config.checkoutProxyUrl) {
    return config.checkoutProxyUrl;
  }

  if (config.proxyUrl && config.proxyUrl.includes("/api/saddles")) {
    return config.proxyUrl.replace("/api/saddles", "/api/checkouts");
  }

  return "";
}

function setStatus(message, isError = false) {
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

function extractPhotoUrl(photoField) {
  const fallback = "https://placehold.co/640x480?text=No+Photo";
  const resolved = normalizePhoto(photoField);
  return resolved === fallback ? "" : resolved;
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

function findFirstAttachmentLikeField(fields) {
  for (const value of Object.values(fields)) {
    const candidate = extractPhotoUrl(value);
    if (candidate) {
      return value;
    }
  }

  return undefined;
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
  ]) || findFirstAttachmentLikeField(fields);
  const purchaseLink = getFieldValueByAlias(fields, ["PurchaseLink", "Purchase Link"]);
  const width = getFieldValueByAlias(fields, ["Width"]);
  const notes = getFieldValueByAlias(fields, ["Notes", "Description"]);

  return {
    id: record.id,
    name: name || "Untitled Saddle",
    manufacturer: manufacturer || "Unknown",
    photoUrl: normalizePhoto(photo),
    purchaseLink: purchaseLink || "",
    width: formatWidth(width),
    notes: notes || "",
  };
}

function getSaddleById(id) {
  return state.saddles.find((saddle) => saddle.id === id);
}

function openCheckoutDialog(saddleId) {
  const saddle = getSaddleById(saddleId);
  if (!saddle) {
    setStatus("Could not open checkout form for this saddle", true);
    return;
  }

  checkoutForm.dataset.saddleId = saddle.id;
  checkoutSaddleSummary.textContent = `${saddle.name} by ${saddle.manufacturer}`;

  if (typeof checkoutDialog.showModal === "function") {
    checkoutDialog.showModal();
  } else {
    checkoutDialog.setAttribute("open", "open");
  }
}

function closeCheckoutDialog() {
  if (typeof checkoutDialog.close === "function") {
    checkoutDialog.close();
  } else {
    checkoutDialog.removeAttribute("open");
  }
}

async function submitCheckoutRequest(payload) {
  const endpoint = getCheckoutEndpoint();
  if (!endpoint) {
    throw new Error("checkoutProxyUrl is missing in config.js");
  }

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || "Checkout request failed");
  }

  return data;
}

async function fetchSaddlesFromAirtable() {
  const { proxyUrl, airtableToken, baseId, tableName, view, pageSize = 100 } = config;

  if (proxyUrl) {
    const response = await fetch(proxyUrl);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      const reason = payload?.error || response.statusText;
      throw new Error(`Proxy request failed: ${reason}`);
    }

    const data = await response.json();
    return Array.isArray(data.records) ? data.records : [];
  }

  if (!airtableToken || !baseId || !tableName) {
    if (config.useSampleData) {
      return sampleData;
    }
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
  return Array.isArray(data.records) ? data.records : [];
}

function renderCards(records) {
  listElement.innerHTML = "";

  if (!records.length) {
    listElement.innerHTML = "<p>No saddles found.</p>";
    return;
  }

  const fragment = document.createDocumentFragment();

  for (const saddle of records) {
    const node = cardTemplate.content.cloneNode(true);
    const image = node.querySelector(".card-photo");
    const title = node.querySelector(".card-title");
    const meta = node.querySelector(".card-meta");
    const notes = node.querySelector(".card-notes");
    const link = node.querySelector(".card-link");
    const checkoutButton = node.querySelector(".checkout-button");

    image.src = saddle.photoUrl;
    image.alt = `${saddle.name} photo`;
    title.textContent = saddle.name;

    const parts = [saddle.manufacturer];
    if (saddle.width) {
      parts.push(saddle.width);
    }
    meta.textContent = parts.join(" • ");

    notes.textContent = saddle.notes || "No notes";

    checkoutButton.addEventListener("click", () => {
      openCheckoutDialog(saddle.id);
    });

    fragment.appendChild(node);
  }

  listElement.appendChild(fragment);
}

function applySearch() {
  const q = searchInput.value.trim().toLowerCase();
  if (!q) {
    state.filtered = state.saddles;
    renderCards(state.filtered);
    return;
  }

  state.filtered = state.saddles.filter((saddle) => {
    return (
      saddle.name.toLowerCase().includes(q) ||
      saddle.manufacturer.toLowerCase().includes(q) ||
      saddle.notes.toLowerCase().includes(q)
    );
  });

  renderCards(state.filtered);
}

async function load() {
  try {
    setStatus("Loading saddles...");
    const rawRecords = await fetchSaddlesFromAirtable();
    state.saddles = rawRecords.map(parseRecord);
    state.filtered = state.saddles;
    renderCards(state.filtered);
    setStatus(`Loaded ${state.saddles.length} saddles`);
  } catch (error) {
    renderCards([]);
    setStatus(error.message || "Failed to load data", true);
  }
}

searchInput.addEventListener("input", applySearch);
refreshButton.addEventListener("click", load);

cancelCheckoutButton.addEventListener("click", () => {
  closeCheckoutDialog();
});

checkoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const formData = new FormData(checkoutForm);
  const saddleId = checkoutForm.dataset.saddleId;
  const saddle = getSaddleById(saddleId);

  if (!saddleId || !saddle) {
    setStatus("No saddle selected for checkout", true);
    return;
  }

  const payload = {
    saddleId,
    saddleName: saddle.name,
    borrowerName: String(formData.get("borrowerName") || "").trim(),
    borrowerEmail: String(formData.get("borrowerEmail") || "").trim(),
    borrowerPhone: String(formData.get("borrowerPhone") || "").trim(),
    borrowerNotes: String(formData.get("borrowerNotes") || "").trim(),
  };

  if (!payload.borrowerName || !payload.borrowerEmail) {
    setStatus("Name and email are required", true);
    return;
  }

  const submitButton = document.querySelector("#submitCheckoutButton");
  submitButton.disabled = true;

  try {
    await submitCheckoutRequest(payload);
    closeCheckoutDialog();
    checkoutForm.reset();
    setStatus("Checkout request submitted. We will contact you soon.");
  } catch (error) {
    setStatus(error.message || "Could not submit checkout request", true);
  } finally {
    submitButton.disabled = false;
  }
});

load();

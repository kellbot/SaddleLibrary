function buildCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...buildCorsHeaders(),
    },
  });
}

const rateLimitStore = new Map();

function getClientIp(request) {
  const direct = request.headers.get("cf-connecting-ip");
  if (direct) {
    return direct;
  }

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  return "unknown";
}

function enforceRateLimit(request, env) {
  const maxAttempts = Number(env.RATE_LIMIT_MAX || "3");
  const windowMs = Number(env.RATE_LIMIT_WINDOW_MS || String(10 * 60 * 1000));
  const now = Date.now();
  const ip = getClientIp(request);
  const key = `checkout:${ip}`;
  const current = rateLimitStore.get(key);

  if (!current || now > current.resetAt) {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + windowMs,
    });
    return;
  }

  if (current.count >= maxAttempts) {
    throw new Error("Too many requests, please try again later");
  }

  current.count += 1;
}

async function fetchAllRecords(env) {
  const token = env.AIRTABLE_TOKEN;
  const baseId = env.AIRTABLE_BASE_ID;
  const tableName = env.AIRTABLE_TABLE_NAME || "Saddles";
  const view = env.AIRTABLE_VIEW || "Grid view";
  const pageSize = Number(env.AIRTABLE_PAGE_SIZE || "100");

  if (!token || !baseId) {
    throw new Error("Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID Worker secrets");
  }

  const allRecords = [];
  let offset = "";

  do {
    const endpoint = new URL(
      `https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`,
    );
    endpoint.searchParams.set("view", view);
    endpoint.searchParams.set("pageSize", String(Math.min(Math.max(pageSize, 1), 100)));
    if (offset) {
      endpoint.searchParams.set("offset", offset);
    }

    const response = await fetch(endpoint.toString(), {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
      const reason = payload?.error?.message || response.statusText;
      throw new Error(`Airtable error: ${reason}`);
    }

    const batch = Array.isArray(payload.records) ? payload.records : [];
    allRecords.push(...batch);
    offset = payload.offset || "";
  } while (offset);

  return allRecords;
}

function generateBorrowerRef() {
  const random = crypto.randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase();
  return `BRW-${random}`;
}

async function createAirtableRecord({ token, baseId, tableName, fields }) {
  const endpoint = new URL(`https://api.airtable.com/v0/${baseId}/${encodeURIComponent(tableName)}`);

  const response = await fetch(endpoint.toString(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const reason = payload?.error?.message || response.statusText;
    throw new Error(`Airtable write error: ${reason}`);
  }

  return payload;
}

function parseCheckoutPayload(payload) {
  return {
    saddleId: String(payload?.saddleId || "").trim(),
    saddleName: String(payload?.saddleName || "").trim(),
    borrowerName: String(payload?.borrowerName || "").trim(),
    borrowerEmail: String(payload?.borrowerEmail || "").trim(),
    borrowerPhone: String(payload?.borrowerPhone || "").trim(),
    borrowerNotes: String(payload?.borrowerNotes || "").trim(),
    website: String(payload?.website || "").trim(),
    startedAtMs: Number(payload?.startedAtMs || 0),
    turnstileToken: String(payload?.turnstileToken || "").trim(),
  };
}

async function verifyTurnstile(env, token, request) {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) {
    return;
  }

  if (!token) {
    throw new Error("Missing anti-spam token");
  }

  const body = new URLSearchParams();
  body.set("secret", secret);
  body.set("response", token);
  body.set("remoteip", getClientIp(request));

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });

  const result = await response.json().catch(() => ({}));

  if (!response.ok || !result.success) {
    throw new Error("Anti-spam check failed");
  }
}

async function enforceAntiSpam(env, request, payload) {
  if (payload.website) {
    throw new Error("Request rejected");
  }

  const minFillMs = Number(env.MIN_FORM_FILL_MS || "2500");
  const startedAt = Number(payload.startedAtMs || 0);

  if (!startedAt || Date.now() - startedAt < minFillMs) {
    throw new Error("Form submitted too quickly");
  }

  enforceRateLimit(request, env);
  await verifyTurnstile(env, payload.turnstileToken, request);
}

function defaultDueDateIso(daysInFuture = 21) {
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + daysInFuture);
  return due.toISOString().slice(0, 10);
}

async function sendResendEmail({ apiKey, from, to, subject, text, html }) {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      text,
      html,
    }),
  });

  const payload = await response.json().catch(() => ({}));

  if (!response.ok) {
    const reason = payload?.message || payload?.error?.message || response.statusText;
    throw new Error(`Resend error: ${reason}`);
  }

  return payload;
}

async function sendCheckoutEmails(env, payload, checkoutRecordId, dueDateIso) {
  const resendApiKey = env.RESEND_API_KEY;
  const from = env.EMAIL_FROM;
  const adminEmail = env.ADMIN_EMAIL;

  if (!resendApiKey || !from || !adminEmail) {
    return {
      enabled: false,
      reason: "Missing RESEND_API_KEY, EMAIL_FROM, or ADMIN_EMAIL",
    };
  }

  const borrowerSubject = "Your saddle request is pending";
  const borrowerText = [
    `Hi ${payload.borrowerName},`,
    "",
    `Thanks for requesting ${payload.saddleName || "a saddle"}.`,
    "We will let you know when it is ready for pickup.",
    `Requested due date: ${dueDateIso}`,
    "",
  ].join("\n");
  const borrowerHtml = `<p>Hi ${payload.borrowerName},</p><p>Thanks for requesting <strong>${payload.saddleName || "a saddle"}</strong>.</p><p>Your request status is currently: <strong>Pending review</strong>.<br/>Requested due date: <strong>${dueDateIso}</strong></p><p>We will contact you soon.</p>`;

  const adminSubject = "New saddle checkout request to review";
  const adminText = [
    "A new checkout request was submitted.",
    "",
    `Checkout Request ID: ${checkoutRecordId}`,
    `Borrower: ${payload.borrowerName}`,
    `Email: ${payload.borrowerEmail}`,
    `Phone: ${payload.borrowerPhone || "(none)"}`,
    `Saddle: ${payload.saddleName || payload.saddleId}`,
    `Saddle Record ID: ${payload.saddleId}`,
    `Due Date: ${dueDateIso}`,
    `Notes: ${payload.borrowerNotes || "(none)"}`,
  ].join("\n");
  const adminHtml = `<p>A new checkout request was submitted.</p><ul><li><strong>Checkout Request ID:</strong> ${checkoutRecordId}</li><li><strong>Borrower:</strong> ${payload.borrowerName}</li><li><strong>Email:</strong> ${payload.borrowerEmail}</li><li><strong>Phone:</strong> ${payload.borrowerPhone || "(none)"}</li><li><strong>Saddle:</strong> ${payload.saddleName || payload.saddleId}</li><li><strong>Saddle Record ID:</strong> ${payload.saddleId}</li><li><strong>Due Date:</strong> ${dueDateIso}</li><li><strong>Notes:</strong> ${payload.borrowerNotes || "(none)"}</li></ul>`;

  await Promise.all([
    sendResendEmail({
      apiKey: resendApiKey,
      from,
      to: payload.borrowerEmail,
      subject: borrowerSubject,
      text: borrowerText,
      html: borrowerHtml,
    }),
    sendResendEmail({
      apiKey: resendApiKey,
      from,
      to: adminEmail,
      subject: adminSubject,
      text: adminText,
      html: adminHtml,
    }),
  ]);

  return {
    enabled: true,
  };
}

async function createCheckoutRequest(env, request) {
  const token = env.AIRTABLE_TOKEN;
  const baseId = env.AIRTABLE_BASE_ID;
  const borrowersTable = env.AIRTABLE_BORROWERS_TABLE || "Borrowers";
  const checkoutsTable = env.AIRTABLE_CHECKOUTS_TABLE || "Checkout Requests";

  if (!token || !baseId) {
    throw new Error("Missing AIRTABLE_TOKEN or AIRTABLE_BASE_ID Worker secrets");
  }

  const rawPayload = await request.json().catch(() => ({}));
  const payload = parseCheckoutPayload(rawPayload);

  await enforceAntiSpam(env, request, payload);

  if (!payload.saddleId || !payload.borrowerName || !payload.borrowerEmail) {
    throw new Error("saddleId, borrowerName, and borrowerEmail are required");
  }

  const borrowerRef = generateBorrowerRef();
  const dueDateIso = defaultDueDateIso(21);

  const borrowerRecord = await createAirtableRecord({
    token,
    baseId,
    tableName: borrowersTable,
    fields: {
      BorrowerRef: borrowerRef,
      Name: payload.borrowerName,
      Email: payload.borrowerEmail,
      Phone: payload.borrowerPhone,
    },
  });

  const checkoutRecord = await createAirtableRecord({
    token,
    baseId,
    tableName: checkoutsTable,
    fields: {
      Saddle: [payload.saddleId],
      Borrower: [borrowerRecord.id],
      BorrowerNotes: payload.borrowerNotes,
      Status: "Requested",
      DueDate: dueDateIso,
    },
  });

  const emailStatus = await sendCheckoutEmails(env, payload, checkoutRecord.id, dueDateIso);

  return {
    ok: true,
    borrowerRef,
    checkoutRequestId: checkoutRecord.id,
    emailStatus,
  };
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: buildCorsHeaders() });
    }

    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/saddles") {
      try {
        const records = await fetchAllRecords(env);
        return jsonResponse({ records });
      } catch (error) {
        return jsonResponse({ error: error.message || "Proxy failed" }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/checkouts") {
      try {
        const result = await createCheckoutRequest(env, request);
        return jsonResponse(result, 201);
      } catch (error) {
        return jsonResponse({ error: error.message || "Checkout request failed" }, 400);
      }
    }

    if (request.method !== "GET" && request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405);
    }

    return jsonResponse({ error: "Not found" }, 404);
  },
};

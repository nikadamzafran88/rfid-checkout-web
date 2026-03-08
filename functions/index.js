/**
 * Firebase Cloud Functions
 *
 * - createStaff (callable): Admin/manager-only staff user creation
 * - aggregateDaily (http): simple daily aggregation of transactions
 * - scheduledAggregate (pubsub): scheduled daily aggregation
 * - createBillplzBill (callable): create a Billplz bill (server-side key)
 * - getBillplzBill (callable): check Billplz bill status
 * - finalizeBillplzTransaction (callable): verify paid + write transaction record
 */

"use strict";

const functions = require("firebase-functions");
const admin = require("firebase-admin");
const crypto = require("crypto");
const Stripe = require("stripe");

const FUNCTION_REGION = "asia-southeast1";
const region = functions.region(FUNCTION_REGION);

if (admin.apps.length === 0) {
  admin.initializeApp();
}

const db = admin.firestore();

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

function extractFirstJsonObject(text) {
  const src = String(text || "");
  const start = src.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    if (ch === "}") depth -= 1;
    if (depth === 0) {
      const candidate = src.slice(start, i + 1);
      try {
        return JSON.parse(candidate);
      } catch {
        return null;
      }
    }
  }
  return null;
}

function normalizeRiskFlag(value) {
  const v = String(value || "").trim().toLowerCase();
  if (v === "low" || v === "medium" || v === "high") return v;
  return "none";
}

function toCleanText(value, maxLen) {
  const s = String(value || "").replace(/\s+/g, " ").trim();
  if (!s) return "";
  return maxLen ? s.slice(0, maxLen) : s;
}

function toCleanStringArray(value, maxItems, maxLen) {
  const arr = Array.isArray(value) ? value : [];
  const out = [];
  for (const it of arr) {
    const s = toCleanText(it, maxLen);
    if (s) out.push(s);
    if (out.length >= (maxItems || 6)) break;
  }
  return out;
}

function normalizeAiStructured(raw) {
  const obj = raw && typeof raw === "object" ? raw : {};

  const headlineCandidate = obj.headline ?? obj.title ?? obj.summary ?? obj.explanation ?? obj.reason ?? obj.message;
  const whatChangedCandidate = obj.whatChanged ?? obj.what_changed ?? obj.change ?? obj.changes ?? obj.recentChanges;
  const whyLikelyCandidate = obj.whyLikely ?? obj.why_likely ?? obj.why ?? obj.cause ?? obj.causes;
  const whatToDoNextCandidate = obj.whatToDoNext ?? obj.what_to_do_next ?? obj.actions ?? obj.nextActions ?? obj.recommendations;

  const structured = {
    headline: toCleanText(headlineCandidate, 180),
    whatChanged: toCleanText(whatChangedCandidate, 380),
    whyLikely: toCleanText(whyLikelyCandidate, 420),
    whatToDoNext: toCleanStringArray(whatToDoNextCandidate, 4, 140),
    riskFlag: normalizeRiskFlag(obj.riskFlag),
  };

  // Ensure at least something usable.
  const hasAny = Boolean(structured.headline || structured.whatChanged || structured.whyLikely || structured.whatToDoNext.length);
  if (!hasAny) return null;
  return structured;
}

function getGeminiApiKey() {
  const fromConfig = (typeof functions.config === "function" ? functions.config() : {})?.gemini?.key;
  const fromEnv = process.env.GEMINI_API_KEY;
  const key = fromConfig || fromEnv || "";
  return String(key).trim();
}

async function geminiGenerateText({ apiKey, model, prompt }) {
  const key = String(apiKey || "").trim();
  if (!key) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Gemini is not configured. Set functions config gemini.key or GEMINI_API_KEY."
    );
  }

  const requested = String(model || "").trim();
  const candidateModels = Array.from(
    new Set([
      requested || "gemini-1.5-flash",
      "gemini-1.5-flash-latest",
      "gemini-2.0-flash",
      "gemini-1.5-pro",
    ].filter(Boolean))
  );

  const apiVersions = ["v1", "v1beta"]; // try stable first, then beta

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: String(prompt || "") }],
      },
    ],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 220,
    },
  };

  let lastErr = null;

  for (const m of candidateModels) {
    for (const ver of apiVersions) {
      const url = `https://generativelanguage.googleapis.com/${ver}/models/${encodeURIComponent(m)}:generateContent?key=${encodeURIComponent(key)}`;
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const text = await resp.text();
      let parsed;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }

      if (!resp.ok) {
        const errMsg =
          parsed?.error?.message ? String(parsed.error.message) :
          parsed?.message ? String(parsed.message) :
          (typeof text === "string" ? text.slice(0, 800) : "");

        console.error("geminiGenerateText failed", {
          status: resp.status,
          model: m,
          apiVersion: ver,
          response: parsed ?? text,
        });

        lastErr = {
          status: resp.status,
          model: m,
          apiVersion: ver,
          message: errMsg,
        };

        // 404 commonly means: model name not available for this key/project.
        // Try next model/version combination.
        if (resp.status === 404) continue;

        throw new functions.https.HttpsError(
          "internal",
          `Gemini request failed (${resp.status}).`,
          lastErr
        );
      }

      const out =
        parsed?.candidates?.[0]?.content?.parts?.map((p) => p?.text).filter(Boolean).join("") ||
        parsed?.candidates?.[0]?.content?.parts?.[0]?.text ||
        "";

      const trimmed = String(out || "").trim();
      if (trimmed) return trimmed;
    }
  }

  throw new functions.https.HttpsError(
    "internal",
    "Gemini request failed (404).",
    lastErr || { status: 404, message: "Model not found." }
  );
}

async function requireRole(context, allowedRoles) {
  if (!context?.auth?.uid) {
    throw new functions.https.HttpsError("unauthenticated", "Request has no authentication context.");
  }

  const callerUid = String(context.auth.uid);
  const callerDoc = await db.collection("users").doc(callerUid).get();
  if (!callerDoc.exists) {
    throw new functions.https.HttpsError("permission-denied", "Caller profile not found.");
  }

  const callerRole = String(callerDoc.data().role || "").toLowerCase();
  if (!Array.isArray(allowedRoles) || allowedRoles.length === 0) {
    return { uid: callerUid, role: callerRole };
  }

  if (!allowedRoles.includes(callerRole)) {
    throw new functions.https.HttpsError("permission-denied", "Insufficient permissions.");
  }

  return { uid: callerUid, role: callerRole };
}

// Admin: create a promo code
exports.createPromoCode = region.https.onCall(async (data, context) => {
  await requireRole(context, ['admin', 'manager'])

  const codeRaw = data?.code ? String(data.code).trim() : ''
  const type = data?.type === 'percent' ? 'percent' : 'fixed'
  const value = Number.isFinite(Number(data?.value)) ? Number(data.value) : 0
  const maxUses = Number.isFinite(Number(data?.maxUses)) && Number(data.maxUses) > 0 ? Math.floor(Number(data.maxUses)) : 0
  const stations = Array.isArray(data?.stations) ? data.stations.map(s => String(s).trim()).filter(Boolean) : []
  const expiresAt = data?.expiresAt ? new Date(data.expiresAt) : null
  const startsAt = data?.startsAt ? new Date(data.startsAt) : null

  if (!codeRaw) throw new functions.https.HttpsError('invalid-argument', 'code is required')
  if (value <= 0) throw new functions.https.HttpsError('invalid-argument', 'value must be positive')

  const code = String(codeRaw).toUpperCase()
  const now = admin.firestore.FieldValue.serverTimestamp()
  // Determine initial active state: if startsAt is in the future, mark inactive until start.
  let activeFlag = true
  try {
    if (startsAt && startsAt instanceof Date && !Number.isNaN(startsAt.getTime())) {
      activeFlag = Date.now() >= startsAt.getTime()
    }
  } catch {}
  const doc = {
    code,
    type,
    value: Number(value),
    maxUses: maxUses || 0,
    uses: 0,
    stations: stations,
    expiresAt: expiresAt ? admin.firestore.Timestamp.fromDate(expiresAt) : null,
    startsAt: startsAt ? admin.firestore.Timestamp.fromDate(startsAt) : null,
    active: !!activeFlag,
    createdBy: context.auth.uid,
    createdAt: now,
  }

  try {
    await db.collection('promo_codes').doc(code).set(doc, { merge: true })
    return { success: true, code }
  } catch (err) {
    console.error('createPromoCode failed', err)
    throw new functions.https.HttpsError('internal', 'Failed to create promo code')
  }
})

// Validate a promo code (client may call to preview discount)
exports.validatePromoCode = region.https.onCall(async (data, _context) => {
  const codeRaw = data?.code ? String(data.code).trim() : ''
  const subtotal = Number.isFinite(Number(data?.subtotal)) ? Number(data.subtotal) : 0
  const stationId = data?.stationId ? String(data.stationId).trim() : ''
  const membershipId = data?.membershipId ? String(data.membershipId).trim() : ''

  if (!codeRaw) return { valid: false, reason: 'missing_code' }
  const code = String(codeRaw).toUpperCase()
  const snap = await db.collection('promo_codes').doc(code).get()
  if (!snap.exists) return { valid: false, reason: 'not_found' }
  const dataDoc = snap.data() || {}
  if (!dataDoc.active) return { valid: false, reason: 'inactive' }
  if (dataDoc.expiresAt && dataDoc.expiresAt.toMillis && Date.now() > dataDoc.expiresAt.toMillis()) return { valid: false, reason: 'expired' }
  if (Array.isArray(dataDoc.stations) && dataDoc.stations.length > 0 && stationId && !dataDoc.stations.includes(stationId)) return { valid: false, reason: 'not_allowed_at_station' }
  if (dataDoc.maxUses && Number(dataDoc.maxUses) > 0 && (Number(dataDoc.uses || 0) >= Number(dataDoc.maxUses))) return { valid: false, reason: 'exhausted' }

  // If promo is restricted to one use per customer, check existing transactions for this membership.
  try {
    if (dataDoc.onePerCustomer && membershipId) {
      const q = await db.collection('transactions').where('promoCode', '==', code).where('membershipId', '==', membershipId).limit(1).get();
      if (!q.empty) return { valid: false, reason: 'already_used' }
    }
  } catch (err) {
    console.warn('validatePromoCode membership check failed', err)
  }

  let discountAmount = 0
  if (dataDoc.type === 'percent') {
    discountAmount = Math.round((Number(subtotal || 0) * (Number(dataDoc.value || 0) / 100)) * 100) / 100
  } else {
    discountAmount = Number(dataDoc.value || 0)
  }
  if (!Number.isFinite(discountAmount) || discountAmount < 0) discountAmount = 0

  return {
    valid: true,
    code: dataDoc.code,
    type: dataDoc.type,
    value: Number(dataDoc.value || 0),
    discountAmount,
    maxUses: dataDoc.maxUses || 0,
    uses: dataDoc.uses || 0,
    expiresAt: dataDoc.expiresAt ? dataDoc.expiresAt.toMillis() : null,
  }
})

// Analyze a member using Gemini (server-side) and store structured results
// Bind secret `GEMINI_API_KEY` via Firebase Secrets so it is available in `process.env.GEMINI_API_KEY`.
exports.analyzeMember = region.runWith({ secrets: ['GEMINI_API_KEY'] }).https.onCall(async (data, context) => {
  // allow staff/admin/manager
  await requireRole(context, ['admin', 'manager', 'staff'])

  const memberId = data?.memberId ? String(data.memberId).trim() : ''
  const promptOverride = data?.prompt ? String(data.prompt) : ''
  const scope = data?.scope ? String(data.scope) : 'summary'

  if (!memberId) throw new functions.https.HttpsError('invalid-argument', 'memberId is required')

  // Load member
  const memberRef = db.collection('memberships').doc(memberId)
  const memberSnap = await memberRef.get()
  if (!memberSnap.exists) throw new functions.https.HttpsError('not-found', 'Member not found')
  const member = memberSnap.data() || {}

  // Load recent transactions (top-level)
  let txs = []
  try {
    const tq = db.collection('transactions').where('membershipId', '==', memberId).orderBy('timestamp', 'desc').limit(80)
    const tsnap = await tq.get()
    txs = tsnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (e) {
    // ignore errors; continue with empty txs
    console.warn('analyzeMember: transactions query failed', e)
    txs = []
  }

  // Load membership ledger entries
  let ledger = []
  try {
    const lcol = db.collection('memberships').doc(memberId).collection('transactions')
    const lsnap = await lcol.orderBy('timestamp', 'desc').limit(120).get()
    ledger = lsnap.docs.map((d) => ({ id: d.id, ...d.data() }))
  } catch (e) {
    console.warn('analyzeMember: ledger query failed', e)
    ledger = []
  }

  // Build default prompt if none provided
  let prompt = promptOverride && promptOverride.length ? promptOverride : null
  if (!prompt) {
    const lines = []
    lines.push(`You are a helpful analyst. Produce a concise JSON with keys: summary (string), suggestions (array), flags (array).`)
    lines.push(`Member ID: ${memberId}`)
    if (member.name) lines.push(`Name: ${member.name}`)
    if (member.phone) lines.push(`Phone: ${member.phone}`)
    lines.push(`Points: ${member.points || 0}, Lifetime Spend: RM ${Number(member.lifetimeSpend || 0).toFixed(2)}`)
    lines.push('\nRecent transactions:')
    for (const t of txs.slice(0, 20)) {
      const subtotal = (t.subtotalAmount ?? t.subtotal_amount ?? t.subtotal) ?? 0
      const promo = (t.promoCode || t.promo || '—')
      const redeemed = t.redeemedAmount ?? (t.redeemed || 0)
      let total = t.totalAmount ?? t.total_amount ?? t.amount
      if (total == null) {
        total = t.amountCents ? t.amountCents / 100 : 0
      }
      const pdPaid = t.paymentDetails ? (t.paymentDetails.paid_at || t.paymentDetails.paidAt) : null
      const paidAt = pdPaid || t.paidAt || t.timestamp || t.createdAt || '—'
      lines.push(`- ${t.id}: subtotal RM ${subtotal}, promo ${promo}, redeemed RM ${redeemed}, paid RM ${total}, at ${paidAt}`)
    }
    lines.push('\nMembership ledger entries:')
    for (const l of ledger.slice(0, 20)) {
      const lAmount = l.amount != null ? l.amount : (l.amount_cents ? l.amount_cents / 100 : 0)
      const lType = l.type || l.kind || 'entry'
      const lTime = l.timestamp || l.createdAt || '—'
      lines.push(`- ${l.id}: ${lType} RM ${Number(lAmount).toFixed(2)} at ${lTime}`)
    }
    lines.push('\nInstructions: Assess buying frequency, promo responsiveness, likely churn/risk flags, and recommended engagement actions. Return JSON only.')
    prompt = lines.join('\n')
  }

  // Call Gemini
  let rawText
  try {
    const apiKey = getGeminiApiKey()
    rawText = await geminiGenerateText({ apiKey, model: 'gemini-1.5-flash', prompt })
  } catch (e) {
    console.error('analyzeMember: geminiGenerateText failed', e)
    throw e
  }

  // Try to extract JSON and normalize
  const extracted = extractFirstJsonObject(rawText)
  const structured = normalizeAiStructured(extracted)

  // Save result under memberships/{memberId}/analysis/{runId}
  const runRef = db.collection('memberships').doc(memberId).collection('analysis').doc()
  const docData = {
    prompt: prompt.substring(0, 10000),
    raw: rawText,
    structured: structured || null,
    createdBy: context.auth.uid || null,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    scope: scope,
  }

  try {
    await runRef.set(docData)
  } catch (e) {
    console.warn('analyzeMember: failed to persist analysis', e)
  }

  return { raw: rawText, structured: structured || null, runId: runRef.id }
})

function getAllowedWebOrigins() {
  const projectId = getProjectId();
  const defaults = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
  ];

  if (projectId) {
    defaults.push(`https://${projectId}.web.app`);
    defaults.push(`https://${projectId}.firebaseapp.com`);
  }
  return defaults;
}

function applyCors(req, res) {
  const origin = req.get("Origin") || "";
  const allowed = getAllowedWebOrigins();
  if (origin && allowed.includes(origin)) {
    res.set("Access-Control-Allow-Origin", origin);
    res.set("Vary", "Origin");
  }
  res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

async function requireRoleFromRequest(req, allowedRoles) {
  const authHeader = req.get("Authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!token) {
    throw new functions.https.HttpsError("unauthenticated", "Missing Authorization bearer token.");
  }

  let decoded;
  try {
    decoded = await admin.auth().verifyIdToken(token);
  } catch (err) {
    console.error("verifyIdToken failed", err);
    throw new functions.https.HttpsError("unauthenticated", "Invalid or expired token.");
  }

  const uid = String(decoded?.uid || "");
  if (!uid) {
    throw new functions.https.HttpsError("unauthenticated", "Invalid token payload.");
  }

  const userDoc = await db.collection("users").doc(uid).get();
  if (!userDoc.exists) {
    throw new functions.https.HttpsError("permission-denied", "Caller profile not found.");
  }
  const role = String(userDoc.data().role || "").toLowerCase();

  const allowed = Array.isArray(allowedRoles) ? allowedRoles.map((r) => String(r).toLowerCase()) : [];
  if (allowed.length && !allowed.includes(role)) {
    throw new functions.https.HttpsError("permission-denied", "Insufficient permissions.");
  }

  return { uid, role };
}

function toMillis(value) {
  if (!value) return null;
  try {
    if (typeof value?.toDate === "function") return value.toDate().getTime();
    if (typeof value === "object" && typeof value?.seconds === "number") return Math.floor(value.seconds * 1000);
    if (typeof value === "number") return value;
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? ms : null;
  } catch {
    return null;
  }
}

function canDeleteLogDoc(logData, nowMs) {
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  const deletableAfterMs = toMillis(logData?.deletableAfter);
  if (deletableAfterMs && nowMs < deletableAfterMs) return false;

  const createdMs = toMillis(logData?.createdAt) ?? toMillis(logData?.timestamp) ?? toMillis(logData?.time);
  if (createdMs !== null) {
    const ageMs = Math.max(0, nowMs - createdMs);
    if (ageMs < sevenDaysMs) return false;
  }

  // If we can't determine the age (legacy), allow admins to proceed.
  return true;
}

async function deleteQueryInBatches(query, label) {
  let total = 0;
  // Firestore batch limit is 500.
  const limit = 450;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const snap = await query.limit(limit).get();
    if (snap.empty) break;

    const batch = db.batch();
    snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
    await batch.commit();
    total += snap.size;

    if (snap.size < limit) break;
    console.log(`${label}: deleted ${snap.size}, continuing...`);
  }
  return total;
}

function getStripeSecretKey() {
  const fromConfig = functions?.config?.()?.stripe?.secret;
  const fromEnv = process.env.STRIPE_SECRET_KEY;
  const key = fromConfig || fromEnv || "";
  return String(key).trim();
}

function getStripeClient() {
  const key = getStripeSecretKey();
  if (!key) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Stripe is not configured. Set functions config stripe.secret or STRIPE_SECRET_KEY."
    );
  }
  return new Stripe(key, { apiVersion: "2023-10-16" });
}

function generateReceiptToken() {
  // 16 bytes -> 32 hex chars; hard to guess, URL-safe, compact.
  return crypto.randomBytes(16).toString("hex");
}

function normalizeReceiptItems(items) {
  const arr = Array.isArray(items) ? items : [];
  return arr
    .filter((it) => it && typeof it === "object")
    .map((it) => ({
      id: it.id ?? it.productId ?? it.productID ?? null,
      sku: it.sku ?? it.RFID_tag_UID ?? it.uid ?? null,
      name: it.name ?? it.productName ?? null,
      price: typeof it.price === "number" ? it.price : Number(it.price ?? 0),
      quantity: it.quantity ?? it.qty ?? it.count ?? 1,
    }));
}

function getProjectId() {
  try {
    const opt = admin.app().options || {};
    if (opt.projectId) return String(opt.projectId);
  } catch {
    // ignore
  }

  const envProject = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || process.env.FIREBASE_PROJECT;
  if (envProject) return String(envProject);

  // FIREBASE_CONFIG is a JSON string in Functions env
  const fbCfg = process.env.FIREBASE_CONFIG;
  if (fbCfg) {
    try {
      const parsed = JSON.parse(fbCfg);
      if (parsed?.projectId) return String(parsed.projectId);
    } catch {
      // ignore
    }
  }

  return "";
}

function getDefaultBillplzCallbackUrl() {
  const projectId = getProjectId();
  if (!projectId) return "";
  return `https://${FUNCTION_REGION}-${projectId}.cloudfunctions.net/billplzCallback`;
}

function parseBillplzCallbackBody(req) {
  // Billplz callbacks are typically sent as application/x-www-form-urlencoded.
  if (req?.body && typeof req.body === "object" && Object.keys(req.body).length > 0) {
    return req.body;
  }

  const raw = req?.rawBody ? req.rawBody.toString("utf8") : "";
  if (!raw) return {};

  try {
    const params = new URLSearchParams(raw);
    const out = {};
    for (const [k, v] of params.entries()) out[k] = v;
    return out;
  } catch {
    return {};
  }
}

function toDateKey(ts) {
  if (!ts) return "unknown";
  try {
    const d = typeof ts.toDate === "function" ? ts.toDate() : new Date(ts);
    if (!d || Number.isNaN(d.getTime())) return "unknown";
    return d.toISOString().slice(0, 10);
  } catch {
    return "unknown";
  }
}

function getBillplzConfig() {
  const cfg = (typeof functions.config === "function" ? functions.config() : {}) || {};
  const b = cfg.billplz || {};

  const callbackUrl = process.env.BILLPLZ_CALLBACK_URL || b.callback_url || b.callbackUrl;

  return {
    // Primary source: legacy Functions config (set via `firebase functions:config:set`)
    // Fallback: process.env (useful for local testing)
    key: process.env.BILLPLZ_KEY || b.key,
    collectionId: process.env.BILLPLZ_COLLECTION_ID || b.collection_id || b.collectionId,
    callbackUrl: callbackUrl || getDefaultBillplzCallbackUrl(),
    redirectUrl: process.env.BILLPLZ_REDIRECT_URL || b.redirect_url || b.redirectUrl,
    baseUrl: process.env.BILLPLZ_BASE_URL || b.base_url || b.baseUrl,
  };
}

function getAllowedRedirectOrigins() {
  const cfg = (typeof functions.config === "function" ? functions.config() : {}) || {};
  const b = cfg.billplz || {};
  const raw =
    process.env.BILLPLZ_ALLOWED_ORIGINS ||
    b.allowed_origins ||
    b.allowedOrigins ||
    "";

  const fromConfig = String(raw)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (fromConfig.length > 0) return fromConfig;

  const projectId = getProjectId();
  const defaults = ["http://localhost:5173"];
  if (projectId) {
    defaults.push(`https://${projectId}.web.app`);
    defaults.push(`https://${projectId}.firebaseapp.com`);
  }
  return defaults;
}

function isAllowedRedirectOrigin(origin) {
  const trimmed = String(origin || "").trim();
  if (!trimmed) return false;
  const allowed = getAllowedRedirectOrigins();
  if (allowed.length === 0) return false;
  return allowed.includes(trimmed);
}

function deriveRedirectUrl(data, cfg) {
  // Prefer explicit configured redirectUrl.
  if (cfg?.redirectUrl) return String(cfg.redirectUrl);

  const origin = data?.redirectOrigin ? String(data.redirectOrigin).trim() : "";
  if (origin && isAllowedRedirectOrigin(origin)) {
    return `${origin}/success`;
  }

  return "";
}

exports.billplzCallback = region.https.onRequest(async (req, res) => {
  // Billplz expects 200 OK for successful callback receipt.
  try {
    if (req.method !== "POST") {
      res.set("Allow", "POST");
      return res.status(405).send("Method Not Allowed");
    }

    const body = parseBillplzCallbackBody(req);
    const billId = body?.id ? String(body.id) : body?.bill_id ? String(body.bill_id) : "";
    const paid = body?.paid !== undefined ? String(body.paid) : "";
    const paidAt = body?.paid_at ? String(body.paid_at) : null;
    const xSignature = req.get("X-Signature") || req.get("x-signature") || null;

    await db.collection("billplz_callbacks").add({
      receivedAt: admin.firestore.FieldValue.serverTimestamp(),
      bill_id: billId || null,
      paid: paid || null,
      paid_at: paidAt,
      headers: {
        "x-signature": xSignature,
      },
      body,
    });

    if (billId) {
      await db.collection("billplz_bills").doc(String(billId)).set(
        {
          callbackReceivedAt: admin.firestore.FieldValue.serverTimestamp(),
          callback: body,
        },
        { merge: true }
      );
    }

    // Also set a small RTDB status node so kiosks can subscribe for immediate updates.
    try {
      if (billId && typeof admin.database === 'function') {
        const status = (body && (body.paid === true || String(body.paid).toLowerCase() === 'true')) ? 'paid' : 'not_paid';
        const state = body?.state ? String(body.state) : null;
        await admin.database().ref(`billplz_status/${String(billId)}`).set({
          status,
          state,
          callback: body,
          receivedAt: admin.database.ServerValue.TIMESTAMP,
        });
      }
    } catch (e) {
      console.warn('Failed to write RTDB status for Billplz callback', e);
    }

    return res.status(200).send("OK");
  } catch (err) {
    console.error("billplzCallback failed", err);
    return res.status(200).send("OK");
  }
});

function normalizeBillplzBaseUrl(baseUrl) {
  const trimmed = String(baseUrl || "").trim();
  if (!trimmed) return "https://www.billplz.com/api/v3";

  // Accept:
  // - https://www.billplz-sandbox.com/api/  -> https://www.billplz-sandbox.com/api/v3
  // - https://www.billplz-sandbox.com/api  -> https://www.billplz-sandbox.com/api/v3
  // - https://www.billplz-sandbox.com/api/v3/ -> https://www.billplz-sandbox.com/api/v3
  let normalized = trimmed.replace(/\/+$/, "");
  if (/\/api$/i.test(normalized)) normalized = `${normalized}/v3`;
  if (/\/api\/v3$/i.test(normalized)) return normalized;
  if (/\/api\/v3\//i.test(normalized)) return normalized.replace(/\/+$/, "");

  // If user passed host only, fall back to /api/v3
  if (!/\/api(\/v3)?$/i.test(normalized)) {
    normalized = `${normalized}/api/v3`;
  }
  return normalized.replace(/\/+$/, "");
}

function parsePositiveInt(value, fallback = 1) {
  const n = typeof value === "number" ? value : parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  const i = Math.floor(n);
  return i > 0 ? i : fallback;
}

function getItemProductId(item) {
  if (!item || typeof item !== "object") return "";
  const pid = item.productId ?? item.productID ?? item.id;
  return pid ? String(pid) : "";
}

function buildInventoryAdjustments(items) {
  const adjustments = new Map();
  const arr = Array.isArray(items) ? items : [];

  for (const it of arr) {
    const productId = getItemProductId(it);
    if (!productId) continue;
    if (productId.startsWith("unknown_")) continue;

    const qty = parsePositiveInt(it.quantity ?? it.qty ?? it.count ?? 1, 1);
    adjustments.set(productId, (adjustments.get(productId) || 0) + qty);
  }

  return adjustments;
}

function getInventoryStockLevel(invData) {
  const d = invData || {};
  const raw =
    d.stockLevel ??
    d.stock_level ??
    d.stock ??
    d.currentStock ??
    d.quantity ??
    d.qty ??
    d.count ??
    0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

async function findInventoryDocsForProductInTransaction(t, productId) {
  // Deterministic selection + duplicate syncing.
  // Priority:
  // 1) inventory/{productId} doc id (recommended canonical schema)
  // 2) inventory.productID/productId == productId (string)
  // 3) inventory.productID/productRef/product == DocumentReference(products/{productId})
  // Tie-breaker: lexicographically smallest doc id.

  const pid = String(productId);
  const directRef = db.collection("inventory").doc(pid);
  const directSnap = await t.get(directRef);

  const productRef = db.doc(`products/${pid}`);

  const queries = [
    { field: "productID", value: pid },
    { field: "productId", value: pid },
    { field: "productID", value: productRef },
    { field: "productRef", value: productRef },
    { field: "product", value: productRef },
  ];

  const byPath = new Map();
  if (directSnap.exists) byPath.set(directSnap.ref.path, directSnap);

  for (const q of queries) {
    const snap = await t.get(db.collection("inventory").where(q.field, "==", q.value).limit(25));
    snap.docs.forEach((d) => byPath.set(d.ref.path, d));
  }

  const all = Array.from(byPath.values());
  if (all.length === 0) return { best: null, candidates: [] };

  const score = (doc) => {
    const data = doc.data() || {};
    let s = 0;
    if (doc.id === pid) s = Math.max(s, 300);
    if (typeof data.productID === "string" && data.productID === pid) s = Math.max(s, 220);
    if (typeof data.productId === "string" && data.productId === pid) s = Math.max(s, 210);

    const refFields = [data.productID, data.productRef, data.product];
    for (const rf of refFields) {
      if (rf && typeof rf === "object" && typeof rf.path === "string" && rf.path === productRef.path) {
        s = Math.max(s, 120);
      }
    }
    return s;
  };

  all.sort((a, b) => {
    const sa = score(a);
    const sb = score(b);
    if (sb !== sa) return sb - sa;
    return String(a.id).localeCompare(String(b.id));
  });

  return { best: all[0], candidates: all };
}

async function applyInventoryDecrementInTransaction(t, items) {
  const adjustments = buildInventoryAdjustments(items);
  if (adjustments.size === 0) return { updated: 0 };

  // Firestore transaction constraint:
  // ALL reads must happen before ANY writes.
  // So we do a read/validate pass first, then a write pass.
  const plans = [];

  for (const [productId, qty] of adjustments.entries()) {
    const { best, candidates } = await findInventoryDocsForProductInTransaction(t, productId);
    if (!best) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `No inventory record for product ${productId}.`,
        {
          productId,
          hint: "Expected an inventory doc with productID/productId = productId OR a DocumentReference field pointing to products/{productId}.",
        }
      );
    }

    const currentStock = getInventoryStockLevel(best.data());
    const nextStock = currentStock - qty;
    if (nextStock < 0) {
      throw new functions.https.HttpsError(
        "failed-precondition",
        `Insufficient stock for product ${productId}.`,
        { productId, currentStock, requested: qty }
      );
    }

    plans.push({ productId: String(productId), qty, nextStock, candidates });
  }

  let updatedProducts = 0;
  let updatedDocs = 0;
  for (const plan of plans) {
    // Update ALL matching inventory docs so the UI can't accidentally show a stale duplicate.
    for (const docSnap of plan.candidates) {
      t.update(docSnap.ref, {
        stockLevel: plan.nextStock,
        lastUpdated: admin.firestore.FieldValue.serverTimestamp(),
      });
      updatedDocs += 1;
    }
    updatedProducts += 1;
  }

  return { updatedProducts, updatedDocs };
}

// Note: awardPointsInTransaction was removed — awarding and redemption
// logic has been inlined into the transaction callers to ensure all
// reads occur before writes (Firestore transaction ordering requirement).

async function billplzRequest(path, { method = "GET", payload } = {}) {
  const { key, baseUrl } = getBillplzConfig();
  if (!key) {
    throw new functions.https.HttpsError("failed-precondition", "Billplz API key is not configured.");
  }

  const apiBase = normalizeBillplzBaseUrl(baseUrl);
  const url = path.startsWith("http") ? path : `${apiBase}${path}`;
  const auth = Buffer.from(`${key}:`).toString("base64");

  const headers = {
    Authorization: `Basic ${auth}`,
  };

  const init = {
    method,
    headers,
  };

  if (payload) {
    headers["Content-Type"] = "application/x-www-form-urlencoded";
    init.body = new URLSearchParams(
      Object.entries(payload).reduce((acc, [k, v]) => {
        if (v === undefined || v === null || v === "") return acc;
        acc[k] = String(v);
        return acc;
      }, {})
    ).toString();
  }

  const resp = await fetch(url, init);
  const text = await resp.text();

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }

  if (!resp.ok) {
    // Do not log request headers (they contain auth). Logging response is safe.
    console.error("Billplz API error", {
      status: resp.status,
      url,
      method,
      response: parsed ?? text,
    });

    // Return status + response body to the client for debugging (no secrets included).
    throw new functions.https.HttpsError(
      "failed-precondition",
      `Billplz API error (${resp.status}).`,
      { status: resp.status, response: parsed ?? text }
    );
  }

  return parsed ?? text;
}

exports.createStaff = region.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError("unauthenticated", "Request has no authentication context.");
  }

  const callerUid = context.auth.uid;

  const name = data?.name ? String(data.name).trim() : "";
  const email = data?.email ? String(data.email).trim().toLowerCase() : "";
  const tempPassword = data?.tempPassword ? String(data.tempPassword) : "";

  if (!name || !email || !tempPassword) {
    throw new functions.https.HttpsError("invalid-argument", "Missing name, email or temporary password.");
  }

  const callerDoc = await db.collection("users").doc(callerUid).get();
  if (!callerDoc.exists) {
    throw new functions.https.HttpsError("permission-denied", "Caller profile not found.");
  }

  const callerRole = String(callerDoc.data().role || "").toLowerCase();
  if (!["admin", "manager"].includes(callerRole)) {
    throw new functions.https.HttpsError("permission-denied", "Only admin or manager can create staff users.");
  }

  try {
    const year = new Date().getFullYear() % 100;
    const staffQuery = await db.collection("users").where("role", "==", "staff").get();
    const seq = (staffQuery.size || 0) + 1;
    const seqStr = String(seq).padStart(4, "0");
    const staffId = `SID${String(year).padStart(2, "0")}${seqStr}`;

    const userRecord = await admin.auth().createUser({
      email,
      password: tempPassword,
      displayName: name,
    });

    const uid = userRecord.uid;

    await db.collection("users").doc(uid).set({
      uid,
      email,
      displayName: name,
      role: "staff",
      active: true,
      staffId,
      registeredAt: new Date().toISOString(),
      createdBy: callerUid,
    });

    await admin.auth().setCustomUserClaims(uid, { role: "staff" });

    return { success: true, uid, staffId };
  } catch (err) {
    console.error("createStaff failed", err);
    throw new functions.https.HttpsError("internal", err?.message || String(err));
  }
});

// Retention policy:
// - Locked for 7 days (cannot be deleted)
// - After 7 days, can be deleted manually (admin/manager)
// - After 14 days, auto-deleted (scheduled)
exports.deleteLog = region.https.onCall(async (data, context) => {
  await requireRole(context, ["admin"]);

  const logId = data?.logId ? String(data.logId).trim() : "";
  if (!logId) {
    throw new functions.https.HttpsError("invalid-argument", "logId is required.");
  }

  const ref = db.collection("logs").doc(logId);
  const snap = await ref.get();
  if (!snap.exists) {
    return { success: true, deleted: false, reason: "not-found" };
  }

  const nowMs = Date.now();
  const dataDoc = snap.data() || {};
  if (!canDeleteLogDoc(dataDoc, nowMs)) {
    throw new functions.https.HttpsError(
      "permission-denied",
      "This log is locked and cannot be deleted yet (7-day retention)."
    );
  }

  await ref.delete();
  return { success: true, deleted: true };
});

// AI Executive Summary (admin-only)
// HTTP endpoint (CORS enabled) to avoid callable CORS issues in some setups.
exports.generateAiExecutiveSummaryHttp = region.https.onRequest(async (req, res) => {
  applyCors(req, res);
  if (req.method === "OPTIONS") {
    return res.status(204).send("");
  }

  try {
    if (req.method !== "POST") {
      res.set("Allow", "POST, OPTIONS");
      return res.status(405).json({ success: false, error: "Method Not Allowed" });
    }

    const { uid, role } = await requireRoleFromRequest(req, ["admin", "manager", "staff"]);

    const data = (req.body && typeof req.body === "object") ? req.body : {};
    const sales = data?.sales ?? data?.payload ?? null;
    if (!sales || typeof sales !== "object") {
      throw new functions.https.HttpsError("invalid-argument", "Missing sales payload.");
    }

    const currency = data?.currency ? String(data.currency).trim() : "RM";
    const model = data?.model ? String(data.model).trim() : "gemini-1.5-flash";
    const scope = data?.scope ? String(data.scope).trim() : "default";
    const noCache = Boolean(data?.noCache);
    const requestedAudience = data?.audience ? String(data.audience).trim().toLowerCase() : "";

    const roleToAllowedAudiences = {
      admin: ["owner", "staff", "finance"],
      manager: ["owner", "staff"],
      staff: ["staff"],
    };
    const allowedAudiences = new Set(roleToAllowedAudiences[role] || ["owner"]);
    const safeAudience = allowedAudiences.has(requestedAudience)
      ? requestedAudience
      : (allowedAudiences.has("owner") ? "owner" : "staff");

    let json;
    try {
      json = JSON.stringify(sales);
    } catch {
      throw new functions.https.HttpsError("invalid-argument", "Sales payload must be JSON-serializable.");
    }

    // Keep payload bounded to prevent abuse and control cost.
    if (json.length > 15000) {
      throw new functions.https.HttpsError("invalid-argument", "Sales payload is too large.");
    }

    const payloadHash = sha256Hex(`${safeAudience}\n${json}`);
    const dateKeyRaw = String(sales?.today?.date || "").trim();
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(dateKeyRaw) ? dateKeyRaw : new Date().toISOString().slice(0, 10);
    const cacheDocId = `exec_${scope.replace(/[^a-zA-Z0-9_-]/g, "_")}_${safeAudience}_${dateKey}`;
    const cacheRef = db.collection("aiSummaries").doc(cacheDocId);

    if (!noCache) {
      const cachedSnap = await cacheRef.get();
      if (cachedSnap.exists) {
        const cached = cachedSnap.data() || {};
        const cachedHash = String(cached.payloadHash || "");
        const cachedSummary = String(cached.summary || "").trim();
        const cachedStructured = cached.structured && typeof cached.structured === "object" ? cached.structured : null;
        if (cachedHash && cachedHash === payloadHash && (cachedSummary || cachedStructured)) {
          return res.status(200).json({
            success: true,
            summary: cachedSummary,
            structured: cachedStructured,
            cached: true,
          });
        }
      }
    }

    const isForecastExplain = scope === "sales-forecast-explain";

    const isMemberAnalysis = scope === 'member-details' || (sales && typeof sales === 'object' && sales.member);

    const prompt = (isForecastExplain ? [
      "You are a senior retail analyst helping a store manager understand a simple sales forecast.",
      `Audience: ${safeAudience}. Currency: ${currency}.`,
      "Task: Explain the forecast in plain English using ONLY the provided data.",
      "Focus on: trend direction (slope), biggest recent spike/dip, and confidence (R² + points used).",
      "If confidence is low, say so and explain why.",
      "You MUST return valid JSON only (no markdown, no code fences, no extra text).",
      "JSON schema:",
      "{",
      '  "headline": "One short sentence describing the forecast direction.",',
      '  "whatChanged": "1-2 sentences summarizing recent movement and any spike/dip days.",',
      '  "whyLikely": "1-2 sentences referencing slope, R², points used, and volatility (no invented causes).",',
      '  "whatToDoNext": ["Optional action 1", "Optional action 2"],',
      '  "riskFlag": "none|low|medium|high"',
      "}",
      "Rules:",
      "- Keep it SHORT (aim for ~3-5 lines total).",
      "- Do NOT mention Gemini, LLMs, or prompting.",
      "- Do NOT invent reasons like promotions/holidays unless explicitly in data.",
      "- If R² is missing or points used < 7, confidence should be low/medium.",
      "DATA (JSON):",
      json,
    ] : (
      isMemberAnalysis ? [
        "You are a customer-behaviour analyst specialising in memberships and loyalty.",
        `Audience: ${safeAudience || 'customer'}. Currency: ${currency}.`,
        "Task: Analyse the customer's behaviour and return a concise, actionable JSON using the following schema. Use the data to fill in each field as best as possible:",
        "You MUST return valid JSON only (no markdown, no code fences, no extra text).",
        "JSON schema:",
        "{",
        '  "headline": "One short sentence summarising the member behaviour.",',
        '  "whatChanged": "1-2 sentences on what changed in this member’s behaviour (e.g. frequency, spend, promo use, redemptions, etc.)",',
        '  "whyLikely": "1-2 sentences on likely causes or patterns (e.g. promo responsiveness, redemption, churn risk)",',
        '  "whatToDoNext": ["Personalised offer 1", "Engagement action 2", "Retention action 3"],',
        '  "riskFlag": "none|low|medium|high"',
        "}",
        "Rules:",
        "- Use only the supplied data; do not invent personal details.",
        "- If insufficient data, be conservative and mark confidence low.",
        "- Keep each recommendation short and operational (who, what, when).",
        "DATA (JSON):",
        json,
      ] : [
        "You are a senior retail operations analyst.",
        `Audience: ${safeAudience}. Currency: ${currency}.`,
        "Task: Explain the WHY behind performance, not only the numbers.",
        "You MUST return valid JSON only (no markdown, no code fences, no extra text).",
        "JSON schema:",
        "{",
        '  "headline": "One short sentence.",',
        '  "whatChanged": "1-2 sentences on what changed (include key deltas if present).",',
        '  "whyLikely": "1-2 sentences on likely causes using the signals provided.",',
        '  "whatToDoNext": ["Action 1", "Action 2", "Action 3"],',
        '  "riskFlag": "none|low|medium|high"',
        "}",
        "Rules:",
        "- Be practical and specific. If a field is missing, omit it.",
        "- Prefer the provided signals; do not invent facts.",
        "- Keep actions short and executable.",
        "DATA (JSON):",
        json,
      ]
    )).join("\n");

    const apiKey = getGeminiApiKey();
    const text = await geminiGenerateText({ apiKey, model, prompt });

    const extracted = extractFirstJsonObject(text);
    let structured = normalizeAiStructured(extracted);

    if (!structured) {
      try {
        structured = normalizeAiStructured(JSON.parse(String(text || "")));
      } catch {
        // ignore
      }
    }

    if (!structured) {
      const cleaned = toCleanText(text, 600);
      if (cleaned) {
        structured = {
          headline: toCleanText(cleaned, 180),
          whatChanged: "",
          whyLikely: "",
          whatToDoNext: [],
          riskFlag: "none",
        };
      }
    }

    if (!structured) {
      throw new functions.https.HttpsError("internal", "AI returned an empty response. Please try again.");
    }

    const summaryParts = [
      structured?.headline,
      structured?.whatChanged,
      structured?.whyLikely,
    ].filter(Boolean);
    const summary = summaryParts.join(" ").trim();

    if (!summary && !structured) {
      throw new functions.https.HttpsError("internal", "AI returned an empty response. Please try again.");
    }

    await cacheRef.set(
      {
        scope,
        audience: safeAudience,
        dateKey,
        payloadHash,
        summary,
        structured,
        currency,
        requestedModel: model,
        generatedBy: uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return res.status(200).json({ success: true, summary, structured, cached: false });
  } catch (err) {
    if (err instanceof functions.https.HttpsError) {
      return res.status(400).json({ success: false, error: err.message, code: err.code, details: err.details || null });
    }
    console.error("generateAiExecutiveSummaryHttp failed", err);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
});

exports.aggregateDaily = region.https.onRequest(async (req, res) => {
  try {
    const txSnap = await db.collection("transactions").get();
    const daily = {};

    txSnap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const amt = Number(data.total_amount ?? data.totalAmount ?? 0) || 0;
      const dateKey = toDateKey(data.timestamp);

      daily[dateKey] = daily[dateKey] || { total: 0, count: 0 };
      daily[dateKey].total += amt;
      daily[dateKey].count += 1;
    });

    const batch = db.batch();
    Object.keys(daily).forEach((dateKey) => {
      const ref = db.collection("reports").doc(dateKey);
      batch.set(
        ref,
        {
          date: dateKey,
          totalAmount: daily[dateKey].total,
          txCount: daily[dateKey].count,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });

    await batch.commit();
    res.json({ success: true, days: Object.keys(daily).length });
  } catch (err) {
    console.error("Aggregation failed:", err);
    res.status(500).json({ success: false, error: String(err) });
  }
});

exports.scheduledAggregate = region.pubsub.schedule("every 24 hours").onRun(async () => {
  const txSnap = await db.collection("transactions").get();
  const daily = {};

  txSnap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const amt = Number(data.total_amount ?? data.totalAmount ?? 0) || 0;
    const dateKey = toDateKey(data.timestamp);

    daily[dateKey] = daily[dateKey] || { total: 0, count: 0 };
    daily[dateKey].total += amt;
    daily[dateKey].count += 1;
  });

  const batch = db.batch();
  Object.keys(daily).forEach((dateKey) => {
    const ref = db.collection("reports").doc(dateKey);
    batch.set(
      ref,
      {
        date: dateKey,
        totalAmount: daily[dateKey].total,
        txCount: daily[dateKey].count,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  await batch.commit();
  return null;
});

exports.scheduledLogsCleanup = region.pubsub.schedule("every 24 hours").onRun(async () => {
  const now = admin.firestore.Timestamp.now();
  const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const cutoffIso = new Date(cutoff.toMillis()).toISOString();

  let total = 0;

  // Primary path: delete by expiresAt (new logs write this).
  total += await deleteQueryInBatches(
    db.collection("logs").where("expiresAt", "<=", now).orderBy("expiresAt"),
    "logs.expiresAt"
  );

  // Fallback path: delete by createdAt if expiresAt wasn't set.
  total += await deleteQueryInBatches(
    db.collection("logs").where("createdAt", "<=", cutoff).orderBy("createdAt"),
    "logs.createdAt"
  );

  // Legacy fallback: delete by ISO-string timestamp if that's all we have.
  // This only works reliably when timestamp is ISO8601 (lexicographically sortable).
  total += await deleteQueryInBatches(
    db.collection("logs").where("timestamp", "<=", cutoffIso).orderBy("timestamp"),
    "logs.timestamp"
  );

  console.log(`scheduledLogsCleanup: deleted ${total} logs`);
  return null;
});

exports.createBillplzBill = region.https.onCall(async (data) => {
  const cfg = getBillplzConfig();
  if (!cfg.collectionId) {
    throw new functions.https.HttpsError("failed-precondition", "Billplz collection_id is not configured.");
  }

  if (!cfg.callbackUrl) {
    throw new functions.https.HttpsError(
      "failed-precondition",
      "Billplz callback_url is not configured (and could not be auto-derived)."
    );
  }

  const stationId = data?.stationId ? String(data.stationId).trim() : "";
  // If client provides items + promo/redeem metadata, compute server-side payable
  const rawAmount = Number(data?.amount);
  const description = data?.description
    ? String(data.description).trim()
    : `RFID Checkout - ${stationId || "station"}`;
  const items = Array.isArray(data?.items) ? normalizeReceiptItems(data.items) : null;
  const promoCode = data?.promoCode ? String(data.promoCode).trim().toUpperCase() : '';
  const clientDiscountAmount = Number.isFinite(Number(data?.discountAmount)) ? Number(data.discountAmount) : 0;

  if (!stationId) {
    throw new functions.https.HttpsError("invalid-argument", "stationId is required.");
  }

  // Basic abuse prevention: only allow creating bills for known stations.
  try {
    const stationSnap = await db.collection("stations").doc(stationId).get();
    if (!stationSnap.exists) {
      throw new functions.https.HttpsError("permission-denied", "Unknown stationId.");
    }
  } catch (err) {
    if (err instanceof functions.https.HttpsError) throw err;
    console.error("Station validation failed", err);
    throw new functions.https.HttpsError("internal", "Failed to validate station.");
  }

  // Determine final amount: if items present compute payable server-side to avoid rounding mismatches
  let amount = rawAmount;
  if (items && items.length > 0) {
    let subtotal = 0;
    for (const it of items) {
      subtotal += (Number(it.price || 0) * Number(it.quantity || 1));
    }
    subtotal = Math.round(subtotal * 100) / 100;

    // Compute promo discount server-side if promoCode provided
    let promoDiscount = 0;
    if (promoCode) {
      const snap = await db.collection('promo_codes').doc(promoCode).get();
      if (!snap.exists) throw new functions.https.HttpsError('failed-precondition', 'Promo code not found', { promoCode });
      const pc = snap.data() || {};
      if (!pc.active) throw new functions.https.HttpsError('failed-precondition', 'Promo code inactive', { promoCode });
      if (pc.expiresAt && pc.expiresAt.toMillis && Date.now() > pc.expiresAt.toMillis()) throw new functions.https.HttpsError('failed-precondition', 'Promo code expired', { promoCode });
      if (pc.maxUses && Number(pc.maxUses) > 0 && (Number(pc.uses || 0) >= Number(pc.maxUses))) throw new functions.https.HttpsError('failed-precondition', 'Promo code exhausted', { promoCode });
      if (pc.type === 'percent') {
        promoDiscount = Math.round((Number(subtotal || 0) * (Number(pc.value || 0) / 100)) * 100) / 100;
      } else {
        promoDiscount = Number(pc.value || 0);
      }
      if (!Number.isFinite(promoDiscount) || promoDiscount < 0) promoDiscount = 0;
    }

    const redeemedAmount = Number(clientDiscountAmount || 0);
    const totalDiscount = Math.round(((Number(promoDiscount || 0) + Number(redeemedAmount || 0)) * 100)) / 100;
    const expectedPayable = Math.round((Number(subtotal || 0) - Number(totalDiscount || 0)) * 100) / 100;
    if (!Number.isFinite(expectedPayable) || expectedPayable <= 0) {
      throw new functions.https.HttpsError("invalid-argument", "Computed payable is invalid or zero.");
    }
    amount = expectedPayable;
  }

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "amount must be a positive number.");
  }

  const amountCents = Math.round(amount * 100);
  if (amountCents <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "amount is too small.");
  }

  // Billplz collections may require payer details; provide safe defaults for kiosk.
  const payerName = data?.name ? String(data.name).trim() : "Kiosk Customer";
  const payerEmail = data?.email ? String(data.email).trim() : `kiosk+${stationId}@example.com`;

  const payload = {
    collection_id: cfg.collectionId,
    description,
    amount: String(amountCents),
    name: payerName,
    email: payerEmail,
    reference_1_label: "station_id",
    reference_1: stationId,
    callback_url: cfg.callbackUrl,
    redirect_url: deriveRedirectUrl(data, cfg),
  };

  const bill = await billplzRequest("/bills", { method: "POST", payload });
  if (!bill?.id || !bill?.url) {
    console.error("Unexpected Billplz create response:", bill);
    throw new functions.https.HttpsError("internal", "Unexpected Billplz response.");
  }

  await db
    .collection("billplz_bills")
    .doc(String(bill.id))
    .set(
      {
        bill_id: String(bill.id),
        bill_url: String(bill.url),
        station_id: stationId,
        amount_cents: amountCents,
        description,
        paid: Boolean(bill.paid),
        state: bill.state || null,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
        // Store optional metadata from client so finalize can validate/inspect
        membershipId: data?.membershipId ? String(data.membershipId) : null,
        redeemedPoints: Number.isFinite(Number(data?.redeemedPoints)) ? Math.max(0, Math.floor(Number(data.redeemedPoints))) : 0,
        discountAmount: Number.isFinite(Number(data?.discountAmount)) ? Number(data.discountAmount) : 0,
        promoCode: data?.promoCode ? String(data.promoCode).trim().toUpperCase() : null,
      },
      { merge: true }
    );

  return {
    billId: String(bill.id),
    billUrl: String(bill.url),
    amountCents,
    paid: Boolean(bill.paid),
    state: bill.state || null,
  };
});

exports.getBillplzBill = region.https.onCall(async (data) => {
  const billId = data?.billId ? String(data.billId).trim() : "";
  if (!billId) {
    throw new functions.https.HttpsError("invalid-argument", "billId is required.");
  }

  const bill = await billplzRequest(`/bills/${encodeURIComponent(billId)}`, { method: "GET" });

  await db
    .collection("billplz_bills")
    .doc(String(billId))
    .set(
      {
        paid: Boolean(bill?.paid),
        state: bill?.state || null,
        paid_at: bill?.paid_at || null,
        lastCheckedAt: admin.firestore.FieldValue.serverTimestamp(),
        raw: bill,
      },
      { merge: true }
    );

  // Also include any callback info recorded by the webhook handler.
  const billDoc = await db.collection('billplz_bills').doc(String(billId)).get();
  const billDocData = billDoc.exists ? (billDoc.data() || {}) : {};
  const callback = billDocData.callback || null;
  const callbackReceivedAt = billDocData.callbackReceivedAt || null;
  // Normalize callbackPaid if present in the callback body (could be boolean or string)
  let callbackPaid = null;
  try {
    if (callback && Object.prototype.hasOwnProperty.call(callback, 'paid')) {
      const v = callback.paid;
      if (typeof v === 'boolean') callbackPaid = v;
      else if (typeof v === 'string') callbackPaid = String(v).toLowerCase() === 'true';
      else callbackPaid = Boolean(v);
    }
  } catch (e) {
    callbackPaid = null;
  }

  return {
    billId: String(billId),
    billUrl: bill?.url ? String(bill.url) : null,
    paid: Boolean(bill?.paid),
    state: bill?.state || null,
    paidAt: bill?.paid_at || null,
    amountCents: bill?.amount ? Number(bill.amount) : null,
    // Webhook-derived fields (if webhook has fired and the callback was stored)
    callbackReceivedAt: callbackReceivedAt && callbackReceivedAt.toDate ? callbackReceivedAt.toDate().toISOString() : callbackReceivedAt || null,
    callback: callback || null,
    callbackPaid: callbackPaid,
    raw: bill || null,
  };
});

// Membership functions
exports.createMembership = region.https.onCall(async (data, context) => {
  const name = data?.name ? String(data.name).trim() : '';
  const phoneRaw = data?.phone ? String(data.phone).trim() : '';
  if (!phoneRaw) {
    throw new functions.https.HttpsError('invalid-argument', 'phone is required');
  }

  // Normalize phone to digits only for basic uniqueness
  const phone = phoneRaw.replace(/\D+/g, '');
  if (!phone) {
    throw new functions.https.HttpsError('invalid-argument', 'phone is invalid');
  }

  // Check if a membership with this phone already exists
  try {
    const q = await db.collection('memberships').where('phone', '==', phone).limit(1).get();
    if (!q.empty) {
      const doc = q.docs[0];
      const dataOut = doc.data() || {};
      return { membershipId: doc.id, ...dataOut };
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const createData = {
      name: name || null,
      phone,
      points: 0,
      lifetimePoints: 0,
      lifetimeSpend: 0,
      createdAt: now,
      updatedAt: now,
      metadata: {},
    };

    if (context?.auth?.uid) createData.userId = String(context.auth.uid);

    const ref = await db.collection('memberships').add(createData);
    const snap = await ref.get();
    return { membershipId: ref.id, ...(snap.exists ? (snap.data() || {}) : createData) };
  } catch (e) {
    console.error('createMembership failed', e);
    throw new functions.https.HttpsError('internal', 'Failed to create membership');
  }
});

exports.getMembership = region.https.onCall(async (data, _context) => {
  const membershipId = data?.membershipId ? String(data.membershipId).trim() : '';
  const phoneRaw = data?.phone ? String(data.phone).trim() : '';
  const userId = data?.userId ? String(data.userId).trim() : '';

  try {
    if (membershipId) {
      const snap = await db.collection('memberships').doc(membershipId).get();
      if (!snap.exists) return null;
      return { membershipId: snap.id, ...(snap.data() || {}) };
    }

    if (phoneRaw) {
      const phone = phoneRaw.replace(/\D+/g, '');
      if (!phone) return null;
      const q = await db.collection('memberships').where('phone', '==', phone).limit(1).get();
      if (q.empty) return null;
      const doc = q.docs[0];
      return { membershipId: doc.id, ...(doc.data() || {}) };
    }

    if (userId) {
      const q = await db.collection('memberships').where('userId', '==', userId).limit(1).get();
      if (q.empty) return null;
      const doc = q.docs[0];
      return { membershipId: doc.id, ...(doc.data() || {}) };
    }

    return null;
  } catch (e) {
    console.error('getMembership failed', e);
    throw new functions.https.HttpsError('internal', 'Failed to fetch membership');
  }
});

exports.recordTransactionAndDecrement = region.https.onCall(async (data, context) => {
  const stationId = data?.stationId ? String(data.stationId).trim() : "";
  const amount = Number(data?.amount);
  const membershipId = data?.membershipId ? String(data.membershipId).trim() : '';
  const redeemedPoints = Number.isFinite(Number(data?.redeemedPoints)) ? Math.max(0, Math.floor(Number(data.redeemedPoints))) : 0;
  const clientDiscountAmount = Number.isFinite(Number(data?.discountAmount)) ? Number(data.discountAmount) : 0;
  const promoCode = data?.promoCode ? String(data.promoCode).trim().toUpperCase() : '';
  const paymentMethod = data?.paymentMethod ? String(data.paymentMethod).trim() : "SIMULATED";
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.cart) ? data.cart : [];
  const paymentDetails = data?.paymentDetails ?? data?.payment_details ?? null;

  if (!stationId) {
    throw new functions.https.HttpsError("invalid-argument", "stationId is required.");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "amount must be a positive number.");
  }

  // effectiveAmount will be computed inside transaction after validating promo code

  // Best-effort validation: station should exist.
  const stationSnap = await db.collection("stations").doc(stationId).get();
  if (!stationSnap.exists) {
    throw new functions.https.HttpsError("permission-denied", "Unknown stationId.");
  }

  const customerUID = context?.auth?.uid ? String(context.auth.uid) : "Guest";
  const nowMs = Date.now();
  const paymentStatus =
    paymentMethod === "BILLPLZ" ? "Paid (Billplz)" : paymentMethod === "STRIPE" ? "Paid (Stripe)" : "Paid";

  // txData will be built inside the transaction after server-side promo validation

  const result = await db.runTransaction(async (t) => {
    // Pre-read membership document (if any) before any writes to satisfy
    // Firestore transaction requirement: all reads must occur before writes.
    let memRef = null;
    let memSnap = null;
    if (membershipId) {
      memRef = db.collection('memberships').doc(String(membershipId));
      memSnap = await t.get(memRef);
    }
    // Pre-read promo code doc if provided
    let promoRef = null;
    let promoSnap = null;
    if (promoCode) {
      promoRef = db.collection('promo_codes').doc(String(promoCode));
      promoSnap = await t.get(promoRef);
    }

    const invRes = await applyInventoryDecrementInTransaction(t, items);
    const txRef = db.collection("transactions").doc();

    // Determine promo discount (server authoritative) and redemption discount separately
    let promoDiscount = 0;
    let redeemedAmount = Number(clientDiscountAmount || 0); // client-supplied redeem amount (from points)
    if (promoSnap && promoSnap.exists) {
      const pc = promoSnap.data() || {};
      if (!pc.active) throw new functions.https.HttpsError('failed-precondition', 'Promo code inactive', { promoCode });
      if (pc.expiresAt && pc.expiresAt.toMillis && Date.now() > pc.expiresAt.toMillis()) throw new functions.https.HttpsError('failed-precondition', 'Promo code expired', { promoCode });
      if (pc.maxUses && Number(pc.maxUses) > 0 && (Number(pc.uses || 0) >= Number(pc.maxUses))) throw new functions.https.HttpsError('failed-precondition', 'Promo code exhausted', { promoCode });
      if (pc.type === 'percent') {
        promoDiscount = Math.round((Number(amount || 0) * (Number(pc.value || 0) / 100)) * 100) / 100;
      } else {
        promoDiscount = Number(pc.value || 0);
      }
      if (!Number.isFinite(promoDiscount) || promoDiscount < 0) promoDiscount = 0;
    }

    const totalDiscount = Math.round(((Number(promoDiscount || 0) + Number(redeemedAmount || 0)) * 100)) / 100;
    const effectiveAmount = Math.round((Number(amount || 0) - Number(totalDiscount || 0)) * 100) / 100;
    if (!Number.isFinite(effectiveAmount) || effectiveAmount < 0) {
      throw new functions.https.HttpsError("invalid-argument", "Invalid discount/amount resulting in negative payable amount.");
    }

    const receiptToken = generateReceiptToken();
    const txData = {
      items,
      stationId,
      station_id: stationId,
      customerUID,
      subtotalAmount: amount,
      subtotal_amount: amount,
      totalAmount: effectiveAmount,
      total_amount: effectiveAmount,
      paymentMethod,
      payment_method: paymentMethod,
      paymentStatus,
      paymentStatusRaw: paymentStatus,
      timestamp: nowMs,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      paymentDetails: paymentDetails,
      payment_details: paymentDetails,
      redeemedPoints: redeemedPoints,
      redeemedAmount: redeemedAmount,
      promoDiscount: promoDiscount,
      discountAmount: totalDiscount,
      inventoryDecremented: true,
      inventoryDecrementSource: "callable:recordTransactionAndDecrement",
      inventoryDecrementedAt: admin.firestore.FieldValue.serverTimestamp(),
    };

    t.set(txRef, { ...txData, receiptToken, receipt_token: receiptToken, inventoryDecrementResult: invRes });

    const publicRef = db.collection("public_receipts").doc(receiptToken);
    t.set(publicRef, {
      txId: txRef.id,
      stationId,
      subtotalAmount: amount,
      totalAmount: effectiveAmount,
      discountAmount: totalDiscount,
      promoDiscount: promoDiscount,
      redeemedPoints: redeemedPoints,
      redeemedAmount: redeemedAmount,
      paymentStatus,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      timestamp: nowMs,
      items: normalizeReceiptItems(items),
    });

    // If promo was used, record it on the transaction and increment uses
    if (promoSnap && promoSnap.exists) {
      t.update(txRef, { promoCode: promoCode, promoDiscount: promoDiscount, discountAmount: totalDiscount });
      const prevUses = Number(promoSnap.data()?.uses || 0);
      const maxUses = Number(promoSnap.data()?.maxUses || 0);
      t.update(promoRef, { uses: prevUses + 1 });
      if (maxUses > 0 && prevUses + 1 > maxUses) {
        // it's possible another transaction raced; we still allow update but warn
        functions.logger.warn('Promo code may have exceeded maxUses', { promoCode, prevUses, maxUses });
      }
    }

    // Apply redemption and award points using the pre-read membership snapshot.
    try {
      if (membershipId) {
        if (!memSnap || !memSnap.exists) {
          if (redeemedPoints > 0) {
            throw new functions.https.HttpsError('failed-precondition', 'Membership not found for redemption', { membershipId });
          }
        } else {
          const memData = memSnap.data() || {};
          const prevPoints = Number(memData.points || 0);
          const prevLifetimePoints = Number(memData.lifetimePoints || 0);
          const prevLifetimeSpend = Number(memData.lifetimeSpend || 0);
          const now = admin.firestore.FieldValue.serverTimestamp();

            if (redeemedPoints > 0) {
            const available = prevPoints;
            if (available < redeemedPoints) {
              throw new functions.https.HttpsError('failed-precondition', 'Insufficient membership points for redemption', { available, requested: redeemedPoints });
            }
              t.update(memRef, { points: available - redeemedPoints, updatedAt: now });
              const redeemLedgerRef = memRef.collection('transactions').doc(`${txRef.id}_redeem`);
              t.set(redeemLedgerRef, {
                txId: txRef.id,
                type: 'redeem',
                pointsDelta: -Math.abs(redeemedPoints),
                amount: Number(redeemedAmount || 0),
                reason: 'redeem',
                source: 'kiosk',
                timestamp: now,
              });
          }

          // Award points on the effective amount (after discount)
          const awardableAmount = Number(effectiveAmount || 0);
          const pointsToAward = Math.max(0, Math.floor(Number(awardableAmount) || 0));
          if (pointsToAward > 0) {
            functions.logger.info('recordTransactionAndDecrement awarding points', { membershipId, txId: txRef.id, awardableAmount, pointsToAward });
            t.update(memRef, {
              points: prevPoints - Math.max(0, redeemedPoints) + pointsToAward,
              lifetimePoints: prevLifetimePoints + pointsToAward,
              lifetimeSpend: prevLifetimeSpend + Number(awardableAmount || 0),
              updatedAt: now,
            });
            const ledgerRef = memRef.collection('transactions').doc(txRef.id);
            t.set(ledgerRef, {
              txId: txRef.id,
              type: 'earn',
              pointsDelta: pointsToAward,
              amount: Number(awardableAmount || 0),
              reason: 'purchase',
              source: 'kiosk',
              timestamp: now,
            });
          }
        }
      }
    } catch (e) {
      console.warn('awardPointsInTransaction failed', e);
    }

    return { txId: txRef.id, receiptToken, discountAmount: totalDiscount, promoDiscount, redeemedAmount };
  });

  return { txId: result.txId, receiptToken: result.receiptToken, discountAmount: result.discountAmount, promoDiscount: result.promoDiscount || 0, redeemedAmount: result.redeemedAmount || 0 };
});

// Stripe Checkout
// Creates a Stripe Checkout Session and returns { sessionId, url }
exports.createStripeCheckoutSession = region.https.onCall(async (data) => {
  const stationId = data?.stationId ? String(data.stationId).trim() : "";
  const amount = Number(data?.amount);
  const currency = data?.currency ? String(data.currency).toLowerCase().trim() : "myr";
  const origin = data?.origin ? String(data.origin).trim() : "";

  if (!stationId) {
    throw new functions.https.HttpsError("invalid-argument", "stationId is required.");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "amount must be a positive number.");
  }

  const stationSnap = await db.collection("stations").doc(stationId).get();
  if (!stationSnap.exists) {
    throw new functions.https.HttpsError("permission-denied", "Unknown stationId.");
  }

  const stripe = getStripeClient();

  const amountCents = Math.round(amount * 100);
  const safeOrigin = origin && /^https?:\/\//.test(origin) ? origin : "";

  // Point users to a lightweight payment result page instead of the app root
  // so mobile customers don't get redirected to the kiosk login/start screen.
  const successUrl = safeOrigin ? `${safeOrigin}/payment-result?status=success&session_id={CHECKOUT_SESSION_ID}` : "https://example.com";
  const cancelUrl = safeOrigin ? `${safeOrigin}/payment-result?status=cancel` : "https://example.com";

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency,
            unit_amount: amountCents,
            product_data: {
              name: `RFID Checkout (${stationId})`,
            },
          },
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        stationId,
        amount: String(amount),
      },
    });

    return { sessionId: String(session.id), url: session.url ? String(session.url) : null };
  } catch (err) {
    functions.logger.error("Stripe session create failed", { err });
    throw new functions.https.HttpsError("internal", err?.message || "Failed to create Stripe Checkout session.");
  }
});

// Returns current Stripe session status (so kiosk can poll)
exports.getStripeCheckoutSession = region.https.onCall(async (data) => {
  const sessionId = data?.sessionId ? String(data.sessionId).trim() : "";
  if (!sessionId) {
    throw new functions.https.HttpsError("invalid-argument", "sessionId is required.");
  }

  const stripe = getStripeClient();

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return {
      sessionId: String(session.id),
      status: session.status || null,
      paymentStatus: session.payment_status || null,
      amountTotal: session.amount_total ?? null,
      currency: session.currency ?? null,
    };
  } catch (err) {
    functions.logger.warn("Stripe session retrieve failed", { err });
    throw new functions.https.HttpsError("internal", err?.message || "Failed to retrieve Stripe session.");
  }
});

// Fallback safety net:
// If any code path writes a transaction without calling the callable decrementer,
// decrement inventory exactly once on document creation.
exports.decrementInventoryOnTransactionCreate = region.firestore
  .document("transactions/{txId}")
  .onCreate(async (snap, context) => {
    const txId = context?.params?.txId ? String(context.params.txId) : snap.id;
    const tx = snap.data() || {};

    if (tx.inventoryDecremented) return null;

    const items = Array.isArray(tx.items) ? tx.items : [];
    if (items.length === 0) return null;

    try {
      await db.runTransaction(async (t) => {
        const txRef = snap.ref;
        const latest = await t.get(txRef);
        const latestData = latest.data() || {};
        if (latestData.inventoryDecremented) return;

        const invRes = await applyInventoryDecrementInTransaction(t, items);
        t.update(txRef, {
          inventoryDecremented: true,
          inventoryDecrementSource: "trigger:onCreate",
          inventoryDecrementedAt: admin.firestore.FieldValue.serverTimestamp(),
          inventoryDecrementResult: invRes,
        });
      });

      functions.logger.info("Inventory decremented via onCreate trigger", { txId });
      return null;
    } catch (err) {
      functions.logger.error("Failed to decrement inventory via onCreate trigger", { txId, err });
      throw err;
    }
  });

exports.finalizeBillplzTransaction = region.https.onCall(async (data, context) => {
  const stationId = data?.stationId ? String(data.stationId).trim() : "";
  const billId = data?.billId ? String(data.billId).trim() : "";
  const amount = Number(data?.amount);
  const membershipId = data?.membershipId ? String(data.membershipId).trim() : '';
  const redeemedPoints = Number.isFinite(Number(data?.redeemedPoints)) ? Math.max(0, Math.floor(Number(data.redeemedPoints))) : 0;
  const clientDiscountAmount = Number.isFinite(Number(data?.discountAmount)) ? Number(data.discountAmount) : 0;
  const promoCode = data?.promoCode ? String(data.promoCode).trim().toUpperCase() : '';
  const items = Array.isArray(data?.items) ? data.items : Array.isArray(data?.cart) ? data.cart : [];

  if (!stationId) {
    throw new functions.https.HttpsError("invalid-argument", "stationId is required.");
  }
  if (!billId) {
    throw new functions.https.HttpsError("invalid-argument", "billId is required.");
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new functions.https.HttpsError("invalid-argument", "amount must be a positive number.");
  }



  // Station must exist.
  const stationSnap = await db.collection("stations").doc(stationId).get();
  if (!stationSnap.exists) {
    throw new functions.https.HttpsError("permission-denied", "Unknown stationId.");
  }

  // Debug logging: record incoming payloads to help diagnose mismatches and 500s.
  try {
    functions.logger.info('finalizeBillplzTransaction called', {
      stationId,
      billId,
      amount,
      membershipId,
      redeemedPoints,
      clientDiscountAmount,
      promoCode,
      itemsCount: Array.isArray(items) ? items.length : 0,
    });
  } catch (e) {
    // Ignore logging failures
  }

  const bill = await billplzRequest(`/bills/${encodeURIComponent(billId)}`, { method: "GET" });

  const paid = Boolean(bill?.paid);
  if (!paid) {
    throw new functions.https.HttpsError("failed-precondition", "Bill is not paid.", {
      billId,
      state: bill?.state || null,
      paid: Boolean(bill?.paid),
    });
  }

  const amountCents = Math.round(amount * 100);
  const billAmountCents = bill?.amount !== undefined && bill?.amount !== null ? Number(bill.amount) : NaN;
  if (!Number.isFinite(billAmountCents) || billAmountCents !== amountCents) {
    throw new functions.https.HttpsError("failed-precondition", "Bill amount mismatch.", {
      billId,
      expectedAmountCents: amountCents,
      billAmountCents: Number.isFinite(billAmountCents) ? billAmountCents : null,
    });
  }

  // Best-effort check: Billplz reference_1 should match stationId (if present).
  const ref1 = bill?.reference_1 ? String(bill.reference_1) : "";
  if (ref1 && ref1 !== stationId) {
    throw new functions.https.HttpsError("failed-precondition", "Bill reference does not match stationId.", {
      billId,
      stationId,
      reference_1: ref1,
    });
  }

  const customerUID = context?.auth?.uid ? String(context.auth.uid) : "Guest";
  const nowMs = Date.now();

  const tx = {
    // fields expected by UI
    stationId,
    station_id: stationId,
    customerUID,
    items,
    totalAmount: amount,
    total_amount: amount,
    paymentMethod: "BILLPLZ",
    payment_method: "BILLPLZ",
    paymentStatus: "Paid (Billplz)",
    paymentStatusRaw: bill?.state ? `Paid (${bill.state})` : "Paid",
    // time
    timestamp: nowMs,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    // provider metadata
    paymentDetails: {
      provider: "billplz",
      bill_id: String(billId),
      bill_url: bill?.url ? String(bill.url) : null,
      state: bill?.state || null,
      paid_at: bill?.paid_at || null,
      amount_cents: amountCents,
    },
    payment_details: {
      provider: "billplz",
      bill_id: String(billId),
      bill_url: bill?.url ? String(bill.url) : null,
      state: bill?.state || null,
      paid_at: bill?.paid_at || null,
      amount_cents: amountCents,
    },
    redeemedPoints: redeemedPoints,
    discountAmount: clientDiscountAmount,
  };

  const billRef = db.collection("billplz_bills").doc(String(billId));

  const result = await db.runTransaction(async (t) => {
    const billSnap = await t.get(billRef);
    const existingTxId = billSnap.exists ? billSnap.data()?.tx_id : null;
    const existingReceiptToken = billSnap.exists ? billSnap.data()?.receipt_token : null;
    const persistedBillData = billSnap.exists ? (billSnap.data() || {}) : {};
    const persistedDiscountAmount = Number.isFinite(Number(persistedBillData.discountAmount)) ? Number(persistedBillData.discountAmount) : 0;
    const persistedRedeemedPoints = Number.isFinite(Number(persistedBillData.redeemedPoints)) ? Math.max(0, Math.floor(Number(persistedBillData.redeemedPoints))) : 0;

    if (existingTxId) {
      t.set(
        billRef,
        {
          paid: true,
          state: bill?.state || null,
          paid_at: bill?.paid_at || null,
          finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
          tx_id: String(existingTxId),
          receipt_token: existingReceiptToken ? String(existingReceiptToken) : null,
        },
        { merge: true }
      );
      return { txId: String(existingTxId), alreadyFinalized: true, receiptToken: existingReceiptToken ? String(existingReceiptToken) : null };
    }

    // Read membership document (if any) and promo code (if any) before performing any writes to satisfy
    // Firestore transaction requirement: all reads must occur before writes.
    let memRef = null;
    let memSnap = null;
    if (membershipId) {
      memRef = db.collection('memberships').doc(String(membershipId));
      memSnap = await t.get(memRef);
    }
    let promoRef = null;
    let promoSnap = null;
    if (promoCode) {
      promoRef = db.collection('promo_codes').doc(String(promoCode));
      promoSnap = await t.get(promoRef);
    }

    await applyInventoryDecrementInTransaction(t, items);

    const txRef = db.collection("transactions").doc();

    // Normalize items and compute server-side subtotal (so percent promos are based on subtotal)
    const normalizedItems = normalizeReceiptItems(items);
    let subtotal = 0;
    for (const it of normalizedItems) {
      subtotal += (Number(it.price || 0) * Number(it.quantity || 1));
    }
    subtotal = Math.round(subtotal * 100) / 100;

    // Use client-supplied discount/points, but fall back to persisted bill metadata when missing.
    let redeemedAmount = Number(clientDiscountAmount || 0);
    let effectiveRedeemedPoints = Number(redeemedPoints || 0);
    if ((!Number.isFinite(redeemedAmount) || redeemedAmount === 0) && persistedDiscountAmount > 0) {
      redeemedAmount = persistedDiscountAmount;
    }
    if ((!Number.isFinite(effectiveRedeemedPoints) || effectiveRedeemedPoints === 0) && persistedRedeemedPoints > 0) {
      effectiveRedeemedPoints = persistedRedeemedPoints;
    }
    let promoDiscount = 0;
    if (promoSnap && promoSnap.exists) {
      const pc = promoSnap.data() || {};
      if (!pc.active) throw new functions.https.HttpsError('failed-precondition', 'Promo code inactive', { promoCode });
      if (pc.expiresAt && pc.expiresAt.toMillis && Date.now() > pc.expiresAt.toMillis()) throw new functions.https.HttpsError('failed-precondition', 'Promo code expired', { promoCode });
      if (pc.maxUses && Number(pc.maxUses) > 0 && (Number(pc.uses || 0) >= Number(pc.maxUses))) throw new functions.https.HttpsError('failed-precondition', 'Promo code exhausted', { promoCode });
      if (pc.type === 'percent') {
        promoDiscount = Math.round((Number(subtotal || 0) * (Number(pc.value || 0) / 100)) * 100) / 100;
      } else {
        promoDiscount = Number(pc.value || 0);
      }
      if (!Number.isFinite(promoDiscount) || promoDiscount < 0) promoDiscount = 0;
    }

    const totalDiscount = Math.round(((Number(promoDiscount || 0) + Number(redeemedAmount || 0)) * 100)) / 100;
    const expectedPayable = Math.round((Number(subtotal || 0) - Number(totalDiscount || 0)) * 100) / 100;
    // Ensure the client-supplied billed amount matches subtotal minus discounts
    if (!Number.isFinite(expectedPayable) || expectedPayable < 0) {
      throw new functions.https.HttpsError('invalid-argument', 'Invalid discount/amount resulting in negative payable amount.');
    }

    if (Math.round(Number(amount || 0) * 100) / 100 !== expectedPayable) {
      throw new functions.https.HttpsError('failed-precondition', 'Billed amount does not match subtotal minus discounts.', {
        billedAmount: Number(amount || 0),
        expectedPayable,
        subtotal,
        promoDiscount,
        redeemedAmount,
      });
    }

    const receiptToken = generateReceiptToken();
    // Store subtotal (original), totalAmount is the billed/paid amount
    t.set(txRef, { ...tx, membershipId: membershipId || null, membership_id: membershipId || null, subtotalAmount: subtotal, subtotal_amount: subtotal, totalAmount: Number(amount || 0), total_amount: Number(amount || 0), receiptToken, receipt_token: receiptToken, promoDiscount, redeemedAmount, discountAmount: totalDiscount, redeemedPoints: effectiveRedeemedPoints });

    const publicRef = db.collection('public_receipts').doc(receiptToken);
    t.set(publicRef, {
      txId: txRef.id,
      stationId,
      membershipId: membershipId || null,
      subtotalAmount: subtotal,
      totalAmount: Number(amount || 0),
      discountAmount: totalDiscount,
      promoDiscount: promoDiscount,
      redeemedPoints: effectiveRedeemedPoints,
      redeemedAmount: redeemedAmount,
      paymentStatus: 'Paid (Billplz)',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      timestamp: nowMs,
      items: normalizedItems,
    });

    // If promo was used, record code on tx and increment usage
    if (promoSnap && promoSnap.exists) {
      t.update(txRef, { promoCode: promoCode, promoDiscount: promoDiscount, discountAmount: totalDiscount });
      const prevUses = Number(promoSnap.data()?.uses || 0);
      t.update(promoRef, { uses: prevUses + 1 });
    }

    t.set(
      billRef,
      {
        bill_id: String(billId),
        station_id: stationId,
        paid: true,
        state: bill?.state || null,
        paid_at: bill?.paid_at || null,
        finalizedAt: admin.firestore.FieldValue.serverTimestamp(),
        tx_id: txRef.id,
        receipt_token: receiptToken,
      },
      { merge: true }
    );

    // Apply redemption (deduct points) then award membership points on paid amount.
    // We already read the membership document above (memSnap) to satisfy Firestore
    // transaction ordering. Use the snapshot data here and perform only writes.
    try {
      if (membershipId) {
        if (!memSnap || !memSnap.exists) {
          if (redeemedPoints > 0) {
            throw new functions.https.HttpsError('failed-precondition', 'Membership not found for redemption', { membershipId });
          }
          // No membership to award; skip.
        } else {
          const memData = memSnap.data() || {};
          const prevPoints = Number(memData.points || 0);
          const prevLifetimePoints = Number(memData.lifetimePoints || 0);
          const prevLifetimeSpend = Number(memData.lifetimeSpend || 0);
          const now = admin.firestore.FieldValue.serverTimestamp();

          // Redemption: validate and deduct points if requested
          if (effectiveRedeemedPoints > 0) {
            const available = prevPoints;
            if (available < effectiveRedeemedPoints) {
              throw new functions.https.HttpsError('failed-precondition', 'Insufficient membership points for redemption', { available, requested: effectiveRedeemedPoints });
            }
            t.update(memRef, { points: available - effectiveRedeemedPoints, updatedAt: now });
            const redeemLedgerRef = memRef.collection('transactions').doc(`${txRef.id}_redeem`);
            t.set(redeemLedgerRef, {
              txId: txRef.id,
              type: 'redeem',
              pointsDelta: -Math.abs(effectiveRedeemedPoints),
              amount: Number(redeemedAmount || 0),
              reason: 'redeem',
              source: 'kiosk',
              timestamp: now,
            });
          }

          // Award points based on the paid amount (billed `amount`)
          const awardableAmount = Math.max(0, Number(amount || 0));
          const pointsToAward = Math.max(0, Math.floor(Number(awardableAmount) || 0));
          if (pointsToAward > 0) {
            functions.logger.info('finalizeBillplzTransaction awarding points', { membershipId, txId: txRef.id, awardableAmount, pointsToAward });
            t.update(memRef, {
              points: prevPoints - Math.max(0, effectiveRedeemedPoints) + pointsToAward,
              lifetimePoints: prevLifetimePoints + pointsToAward,
              lifetimeSpend: prevLifetimeSpend + Number(awardableAmount || 0),
              updatedAt: now,
            });
            const ledgerRef = memRef.collection('transactions').doc(txRef.id);
            t.set(ledgerRef, {
              txId: txRef.id,
              type: 'earn',
              pointsDelta: pointsToAward,
              amount: Number(awardableAmount || 0),
              reason: 'purchase',
              source: 'kiosk',
              timestamp: now,
            });
          }
        }
      }
    } catch (e) {
      console.warn('award/redeem handling (finalizeBillplz) failed', e);
    }

    return { txId: txRef.id, alreadyFinalized: false, receiptToken, discountAmount: totalDiscount, promoDiscount, redeemedAmount };
  });

  return {
    txId: result.txId,
    receiptToken: result.receiptToken || null,
    billId: String(billId),
    alreadyFinalized: Boolean(result.alreadyFinalized),
    discountAmount: result.discountAmount || 0,
    promoDiscount: result.promoDiscount || 0,
    redeemedAmount: result.redeemedAmount || 0,
  };
});

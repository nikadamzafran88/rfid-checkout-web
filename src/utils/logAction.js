import { addDoc, collection, serverTimestamp, Timestamp } from 'firebase/firestore'

// Small helper to write consistent audit/activity logs.
// Keeps backwards compatibility with existing Logs page by always writing `message`, `level`, `source`, `timestamp`.
export async function logAction(db, {
  type,
  message,
  level = 'info',
  source = 'web',
  actorUID = null,
  actorRole = null,
  targetUID = null,
  targetId = null,
  targetType = null,
  metadata = null,
}) {
  if (!db) return
  const safeType = String(type || 'event')
  const safeMessage = String(message || safeType)

  const nowMs = Date.now()
  const deletableAfterMs = nowMs + 7 * 24 * 60 * 60 * 1000
  const expiresAtMs = nowMs + 14 * 24 * 60 * 60 * 1000

  const payload = {
    type: safeType,
    level,
    message: safeMessage,
    source,
    actorUID,
    actorRole,
    targetUID,
    targetId,
    targetType,
    metadata: metadata && typeof metadata === 'object' ? metadata : metadata ?? null,
    timestamp: new Date().toISOString(),

    // Retention fields
    createdAt: serverTimestamp(),
    deletableAfter: Timestamp.fromMillis(deletableAfterMs),
    expiresAt: Timestamp.fromMillis(expiresAtMs),
  }

  try {
    await addDoc(collection(db, 'logs'), payload)
  } catch (err) {
    // Logging must never break primary workflows.
    console.error('[logAction] failed:', err)
  }
}

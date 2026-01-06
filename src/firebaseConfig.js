// src/firebaseConfig.js

import { initializeApp, getApps, getApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'
import { getDatabase } from 'firebase/database'
import { getFunctions } from 'firebase/functions'
import { getStorage } from 'firebase/storage'

const projectId = 'rfid-self-checkout-system'

// Storage bucket can differ between Firebase projects.
// Newer Firebase projects commonly use "<projectId>.firebasestorage.app" (not ".appspot.com").
// Allow override via Vite env so you can match exactly what Firebase Console shows.
const storageBucket = (import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || `${projectId}.firebasestorage.app`).trim()

// RTDB needs an explicit `databaseURL` when your instance is regional.
// You can override via `VITE_FIREBASE_DATABASE_URL`.
// Normalize trailing slashes so RTDB isn't "initialized multiple times" due to URL format mismatch.
const rawDatabaseURL = import.meta.env.VITE_FIREBASE_DATABASE_URL || 'https://rfid-self-checkout-system-default-rtdb.asia-southeast1.firebasedatabase.app'
const databaseURL = String(rawDatabaseURL).trim().replace(/\/+$/, '')

// Firebase configuration
const firebaseConfig = {
    apiKey: '',
    authDomain: 'rfid-self-checkout-system.firebaseapp.com',
    projectId,
    databaseURL,
    storageBucket,
    messagingSenderId: '157621234150',
    appId: '1:157621234150:web:f99b5b2819ddf1f0fbce27'
}

// Initialize Firebase once
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig)

// Initialize services
export const auth = getAuth(app)
export const db = getFirestore(app)
// Always initialize RTDB with the same databaseURL to avoid "initialized multiple times".
export const rtdb = getDatabase(app, firebaseConfig.databaseURL)
export const fns = getFunctions(app, 'asia-southeast1')
// Use explicit bucket URL so the SDK targets the intended bucket.
export const storage = getStorage(app, `gs://${firebaseConfig.storageBucket}`)

// Default export is the config object (used by `src/services/firebase.js`)
export default firebaseConfig
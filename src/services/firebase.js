// Single source of truth for Firebase initialization.
// Re-export the already-initialized services from `src/firebaseConfig.js`.
export { app, auth, db, rtdb, fns, storage } from '../firebaseConfig'

import { app } from '../firebaseConfig'
export default app

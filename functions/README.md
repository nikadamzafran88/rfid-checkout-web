Firebase Cloud Function: createStaff
=================================

This folder contains a callable Cloud Function `createStaff` that securely creates staff users using the Firebase Admin SDK.

How it works
- Callable function: `createStaff` (use `firebase/functions` httpsCallable from the client)
- Caller must be authenticated and must have role `admin` or `manager` recorded in Firestore `users/{uid}`.
- The function creates the Auth user, writes a `users/{uid}` document with `role: 'staff'` and a generated `staffId` (format: `SIDYYNNNN`), and sets a custom claim `{ role: 'staff' }`.

Files
- `index.js` - the Cloud Function implementation
- `package.json` - function dependencies

Deploy
------
1. Install Firebase CLI and login:

   npm install -g firebase-tools
   firebase login

2. From the repo root run:

   cd functions
   npm install
   cd ..
   firebase deploy --only functions:createStaff

Client usage (example)
----------------------
This example uses the modular `firebase/functions` SDK (v9+). The client must be authenticated as an `admin` or `manager` user in Firestore.

import { getFunctions, httpsCallable } from 'firebase/functions';
import { getAuth } from 'firebase/auth';

const functions = getFunctions();
const createStaff = httpsCallable(functions, 'createStaff');

async function callCreateStaff(name, email, tempPassword) {
  try {
    const res = await createStaff({ name, email, tempPassword });
    console.log('Staff created:', res.data);
    // res.data contains { success: true, uid, staffId }
  } catch (err) {
    console.error('createStaff failed', err);
    // Handle HttpsError: err.code, err.message
  }
}

Security notes
--------------
- The function enforces caller authorization by checking the caller's Firestore `users/{uid}` role.
- Avoid sending long-lived admin credentials to the client. Use the admin role only for privileged users.
- In production, consider additional validation (rate limits, email domain checks, audit logging, monitoring).
# Firebase Functions (RFID Checkout)

This folder contains Cloud Functions to aggregate transaction data into a `reports` collection.

Setup & deploy (requires Firebase CLI and a Firebase project):

1. Install dependencies:

   cd functions
   npm install

2. Deploy functions:

   # login and select project if needed
   firebase login
   firebase use <your-project-id>

   # deploy functions
   firebase deploy --only functions

3. Run the HTTP aggregator manually:

   # After deploy, call the endpoint
   # URL printed by Firebase deploy, or call:
   firebase functions:call aggregateDaily

Notes:
- `scheduledAggregate` uses Pub/Sub schedule and requires Blaze billing for scheduled functions.
- For production scale, consider incremental aggregation (trigger on write to `transactions`) instead of full collection scans.

Billplz (Payments)
-----------------
This repo integrates Billplz using callable Cloud Functions so the Billplz secret key stays server-side.

Required Functions config (recommended):
- `billplz.key`: your Billplz API key
- `billplz.collection_id`: your Billplz Collection ID

Optional:
- `billplz.callback_url`
- `billplz.redirect_url`

Set config (example):
- `firebase functions:config:set billplz.key="YOUR_KEY" billplz.collection_id="YOUR_COLLECTION_ID"`

Deployed functions used by the kiosk:
- `createBillplzBill` (callable)
- `getBillplzBill` (callable)

// src/firebaseConfig.js

// Import the functions needed to initialize the app and get service access
import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getDatabase } from "firebase/database"; // Specifically for the IoT Realtime Sync

// Your web app's Firebase configuration
const firebaseConfig = {
    // This API Key is now visible and should be kept private in a real app (e.g., in a .env file)
    apiKey: "AIzaSyDKgbMCB8SEwOMfP9SqgDOqeT4mCoTirw8",
    authDomain: "rfid-self-checkout-system.firebaseapp.com",
    projectId: "rfid-self-checkout-system",
    storageBucket: "rfid-self-checkout-system.firebasestorage.app",
    messagingSenderId: "157621234150",
    appId: "1:157621234150:web:f99b5b2819ddf1f0fbce27"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Services and export them for use in your React components
export const auth = getAuth(app); // Used for Login/Logout/User Management
export const db = getFirestore(app); // Used for Products, Inventory, Transactions (Stable Data)
export const rtdb = getDatabase(app); // Used for high-speed ESP32/Cart synchronization (Realtime Data)

export default app;
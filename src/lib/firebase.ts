import { initializeApp, getApps, getApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';

const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {} as any;

const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY || "AIzaSyDXYxDV9O20-fgEM8OtAiuio45n1oBOl9g",
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN || "presences-ai-rca.firebaseapp.com",
  projectId: env.VITE_FIREBASE_PROJECT_ID || "presences-ai-rca",
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET || "presences-ai-rca.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "67791159935",
  appId: env.VITE_FIREBASE_APP_ID || "1:67791159935:web:f02baa5c73e4cc5571754a"
};

let appInstance: FirebaseApp;
if (getApps().length > 0) {
  appInstance = getApp();
} else {
  appInstance = initializeApp(firebaseConfig);
}

export const app = appInstance;
export const auth: Auth = getAuth(app);

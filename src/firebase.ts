import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import exampleFirebaseConfig from '../firebase-applet-config.example.json';

type FirebaseConfig = typeof exampleFirebaseConfig;

const localFirebaseConfigs = import.meta.glob('../firebase-applet-config.json', {
  eager: true,
  import: 'default',
}) as Record<string, FirebaseConfig>;

const localFirebaseConfig = localFirebaseConfigs['../firebase-applet-config.json'];

const envFirebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  firestoreDatabaseId: import.meta.env.VITE_FIRESTORE_DATABASE_ID,
};

const firebaseConfig = {
  ...exampleFirebaseConfig,
  ...localFirebaseConfig,
  ...Object.fromEntries(
    Object.entries(envFirebaseConfig).filter(([, value]) => typeof value === 'string' && value.length > 0),
  ),
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId); // CRITICAL: Database ID
export const auth = getAuth(app);

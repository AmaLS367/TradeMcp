import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFirebaseConfig() {
  const configPath = path.resolve(__dirname, '../firebase-applet-config.json');
  if (fs.existsSync(configPath)) {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  }
  const examplePath = path.resolve(__dirname, '../firebase-applet-config.example.json');
  if (fs.existsSync(examplePath)) {
    return JSON.parse(fs.readFileSync(examplePath, 'utf-8'));
  }
  return {
    projectId: process.env.FIREBASE_PROJECT_ID || 'your-project',
    firestoreDatabaseId: process.env.FIRESTORE_DATABASE_ID,
  };
}

const firebaseConfig = loadFirebaseConfig();

if (!admin.apps.length) {
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  admin.initializeApp({
    credential: serviceAccountKey
      ? admin.credential.cert(JSON.parse(serviceAccountKey))
      : admin.credential.applicationDefault(),
    projectId: firebaseConfig.projectId,
  });
}

export const db = getFirestore(admin.app(), firebaseConfig.firestoreDatabaseId);

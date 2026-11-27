import { applicationDefault, cert, getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadFirebaseConfig() {
  const configPath = path.resolve(__dirname, '../firebase-applet-config.json');
  const examplePath = path.resolve(__dirname, '../firebase-applet-config.example.json');
  const sourcePath = fs.existsSync(configPath) ? configPath : examplePath;
  const fileConfig = fs.existsSync(sourcePath)
    ? JSON.parse(fs.readFileSync(sourcePath, 'utf-8'))
    : {};

  return {
    ...fileConfig,
    projectId: process.env.FIREBASE_PROJECT_ID || fileConfig.projectId || 'your-project',
    firestoreDatabaseId: process.env.FIRESTORE_DATABASE_ID || fileConfig.firestoreDatabaseId,
  };
}

const firebaseConfig = loadFirebaseConfig();

if (getApps().length === 0) {
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  initializeApp({
    credential: serviceAccountKey
      ? cert(JSON.parse(serviceAccountKey))
      : applicationDefault(),
    projectId: firebaseConfig.projectId,
  });
}

export const db = getFirestore(getApp(), firebaseConfig.firestoreDatabaseId);

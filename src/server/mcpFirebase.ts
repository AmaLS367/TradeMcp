import admin from 'firebase-admin';
import { getFirestore } from 'firebase-admin/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

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

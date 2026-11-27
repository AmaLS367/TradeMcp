import { describe, expect, it } from 'vitest';
import { getApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue } from 'firebase-admin/firestore';
import { db } from './mcpFirebase.js';

describe('Firebase Admin modular SDK', () => {
  it('uses the initialized default app for auth and Firestore', () => {
    expect(getApps()).toContain(getApp());
    expect(getAuth().app).toBe(getApp());
    expect(db).toBeDefined();
  });

  it('provides the server-side Firestore field sentinels', () => {
    expect(FieldValue.serverTimestamp()).toBeDefined();
    expect(FieldValue.increment(1)).toBeDefined();
  });
});

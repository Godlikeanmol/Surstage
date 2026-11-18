import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, User } from 'firebase/auth';
import {
  collection,
  doc,
  getDocFromServer,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  where,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { SongItem } from '../shared/types.ts';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
testConnection();

function sanitizeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
}

export async function syncUserProfileToFirestore(user: User, avatarColor: string): Promise<void> {
  if (!user.emailVerified) return;
  const uid = sanitizeId(user.uid);
  const displayName = (user.displayName || 'Karaoke Singer').trim().slice(0, 60);
  const userPath = `users/${uid}`;
  try {
    await setDoc(
      doc(db, 'users', uid),
      {
        uid,
        displayName,
        avatarColor: avatarColor.slice(0, 24),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }

  if (user.email) {
    const privatePath = `users/${uid}/private/info`;
    try {
      await setDoc(
        doc(db, 'users', uid, 'private', 'info'),
        {
          uid,
          email: user.email.slice(0, 200),
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, privatePath);
    }
  }
}

export async function saveSongToFirestore(song: SongItem): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;
  const songId = sanitizeId(song.id || `yt_${song.videoId}`);
  const path = `songs/${songId}`;
  try {
    await setDoc(doc(db, 'songs', songId), {
      videoId: song.videoId.slice(0, 11),
      title: song.title.trim().slice(0, 160),
      artist: song.artist.trim().slice(0, 120),
      language: song.language.trim().slice(0, 40),
      category: song.category,
      durationSec: Math.max(10, Math.min(7200, Math.round(song.durationSec || 240))),
      isPublic: true,
      addedByUid: currentUser.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function fetchPublicSongsFromFirestore(): Promise<SongItem[]> {
  if (!auth.currentUser) return [];
  const path = 'songs';
  try {
    const q = query(collection(db, path), where('isPublic', '==', true));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        videoId: String(data.videoId),
        title: String(data.title),
        artist: String(data.artist),
        language: String(data.language),
        category: data.category,
        durationSec: Number(data.durationSec || 240),
      } as SongItem;
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export async function saveRoomToFirestore(
  code: string,
  name: string,
  duetMode = false,
  autoMuteOnStage = false
): Promise<void> {
  const currentUser = auth.currentUser;
  if (!currentUser || !currentUser.emailVerified) return;
  const cleanCode = code.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
  const path = `rooms/${cleanCode}`;
  try {
    await setDoc(doc(db, 'rooms', cleanCode), {
      code: cleanCode,
      name: name.trim().slice(0, 80) || `Jam Room ${cleanCode}`,
      hostUid: currentUser.uid,
      isOpen: true,
      duetMode,
      autoMuteOnStage,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

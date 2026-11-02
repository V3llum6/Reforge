import { initializeApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  getFirestore,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import type {
  ChatMessageRecord,
  ChatPersona,
  CodeModuleRecord,
  EnterpriseSampleTemplate,
  ModelTier,
  ProjectRecord,
  SeverityLevel,
  SourceLanguage,
  TargetFramework,
  VulnerabilityRecord,
} from './types';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

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

// Mandatory connection check on initial boot
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

// Validation constants synchronized verbatim with firebase-blueprint.json & firestore.rules
export const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const MAX_ID_LEN = 128;

export function generateSafeId(prefix: string): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/[^a-zA-Z0-9_-]/g, '')
      : `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const candidate = `${prefix}_${randomPart}`.slice(0, MAX_ID_LEN);
  return ID_PATTERN.test(candidate) ? candidate : `id_${Date.now()}`;
}

function clampString(val: string | undefined | null, maxLen: number, fallback = ''): string {
  const str = (val ?? '').trim() || fallback;
  return str.slice(0, maxLen);
}

function clampRawCode(val: string | undefined | null, maxLen: number, fallback = ''): string {
  const str = val ?? fallback;
  return str.slice(0, maxLen);
}

export function timestampToMs(ts: unknown): number {
  if (ts instanceof Timestamp) {
    return ts.toMillis();
  }
  if (ts && typeof ts === 'object' && 'seconds' in ts && typeof (ts as { seconds: number }).seconds === 'number') {
    return (ts as { seconds: number }).seconds * 1000;
  }
  return Date.now();
}

export async function signInEngineerWithGoogle(): Promise<User> {
  const cred = await signInWithPopup(auth, googleProvider);
  const user = cred.user;
  await ensureUserProfileDocument(user);
  return user;
}

export async function signOutEngineer(): Promise<void> {
  await firebaseSignOut(auth);
}

export async function ensureUserProfileDocument(user: User): Promise<void> {
  const userPath = `users/${user.uid}`;
  const userRef = doc(db, 'users', user.uid);
  const displayName = clampString(user.displayName || user.email?.split('@')[0], 100, 'Engineer');
  const photoURL = clampString(user.photoURL, 500, '');

  try {
    const existingSnap = await getDoc(userRef);
    if (!existingSnap.exists()) {
      await setDoc(userRef, {
        uid: user.uid,
        displayName,
        photoURL,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(userRef, {
        displayName,
        photoURL,
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, userPath);
  }
}

export async function createCloudProjectWithModules(params: {
  uid: string;
  name: string;
  description: string;
  sourceLanguage: SourceLanguage;
  targetFramework: TargetFramework;
  repoUrl?: string;
  modules: Array<{
    filePath: string;
    sourceLanguage: SourceLanguage;
    legacyCode: string;
    modernizedCode?: string;
    modernizedFilePath?: string;
    unitTestCode?: string;
    unitTestFilePath?: string;
    summary?: string;
    refactoringNotes?: string[];
    lifecycleStatus?: 'draft' | 'modernized';
    vulnerabilities?: Array<{
      cwe: string;
      severity: SeverityLevel;
      title: string;
      lineRange: string;
      description: string;
      remediation: string;
    }>;
  }>;
}): Promise<string> {
  const projectId = generateSafeId('proj');
  const projectPath = `projects/${projectId}`;
  const batch = writeBatch(db);

  const totalVulns = params.modules.reduce(
    (sum, mod) => sum + (mod.vulnerabilities?.length ?? 0),
    0
  );

  batch.set(doc(db, 'projects', projectId), {
    ownerId: params.uid,
    name: clampString(params.name, 120, 'Untitled Legacy Project'),
    description: clampString(params.description, 600, ''),
    sourceLanguage: params.sourceLanguage,
    targetFramework: params.targetFramework,
    repoUrl: clampString(params.repoUrl, 300, ''),
    lifecycleStatus: 'active',
    moduleCount: Math.min(params.modules.length, 500),
    vulnerabilityCount: Math.min(totalVulns, 5000),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  for (const mod of params.modules.slice(0, 25)) {
    const moduleId = generateSafeId('mod');
    const vulns = (mod.vulnerabilities || []).slice(0, 40);
    const notes = (mod.refactoringNotes || [])
      .slice(0, 15)
      .map((n) => clampString(n, 600, 'Refactored construct'));

    batch.set(doc(db, 'projects', projectId, 'modules', moduleId), {
      ownerId: params.uid,
      projectId,
      filePath: clampString(mod.filePath, 260, 'legacy_module.src'),
      sourceLanguage: mod.sourceLanguage,
      targetFramework: params.targetFramework,
      legacyCode: clampRawCode(mod.legacyCode, 150000, '// Empty module'),
      modernizedCode: clampRawCode(mod.modernizedCode, 150000, ''),
      modernizedFilePath: clampString(mod.modernizedFilePath, 260, ''),
      unitTestCode: clampRawCode(mod.unitTestCode, 150000, ''),
      unitTestFilePath: clampString(mod.unitTestFilePath, 260, ''),
      summary: clampString(mod.summary, 4000, ''),
      refactoringNotes: notes,
      vulnerabilityCount: vulns.length,
      lifecycleStatus: mod.lifecycleStatus || (mod.modernizedCode ? 'modernized' : 'draft'),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    for (const v of vulns) {
      const vulnId = generateSafeId('vuln');
      const validSeverity: SeverityLevel = ['Critical', 'High', 'Medium', 'Low'].includes(v.severity)
        ? v.severity
        : 'Medium';
      batch.set(doc(db, 'projects', projectId, 'vulnerabilities', vulnId), {
        ownerId: params.uid,
        projectId,
        moduleId,
        filePath: clampString(mod.filePath, 260, 'legacy_module.src'),
        cwe: clampString(v.cwe, 32, 'CWE-20'),
        severity: validSeverity,
        title: clampString(v.title, 200, 'Security Vulnerability'),
        lineRange: clampString(v.lineRange, 64, 'Lines 1-10'),
        description: clampString(v.description, 2500, 'Security flaw detected in legacy module.'),
        remediation: clampString(v.remediation, 2500, 'Remediated in modernized output.'),
        resolutionStatus: 'open',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  }

  try {
    await batch.commit();
    return projectId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, projectPath);
  }
}

export async function createCloudProjectFromSample(
  uid: string,
  sample: EnterpriseSampleTemplate
): Promise<string> {
  return createCloudProjectWithModules({
    uid,
    name: sample.name,
    description: sample.description,
    sourceLanguage: sample.sourceLanguage,
    targetFramework: sample.targetFramework,
    repoUrl: '',
    modules: sample.modules,
  });
}

export async function saveRefactoredModuleToCloud(params: {
  uid: string;
  projectId: string;
  moduleId: string;
  filePath: string;
  targetFramework: TargetFramework;
  modernizedCode: string;
  modernizedFilePath: string;
  unitTestCode: string;
  unitTestFilePath: string;
  summary: string;
  refactoringNotes: string[];
  vulnerabilities: Array<{
    cwe: string;
    severity: SeverityLevel;
    title: string;
    lineRange: string;
    description: string;
    remediation: string;
  }>;
  existingModuleVulns: VulnerabilityRecord[];
  newTotalProjectVulns: number;
}): Promise<void> {
  const modulePath = `projects/${params.projectId}/modules/${params.moduleId}`;
  const batch = writeBatch(db);

  // Remove old vulnerabilities for this module before writing fresh findings
  for (const oldVuln of params.existingModuleVulns) {
    batch.delete(doc(db, 'projects', params.projectId, 'vulnerabilities', oldVuln.id));
  }

  const cappedVulns = params.vulnerabilities.slice(0, 40);
  const sanitizedNotes = params.refactoringNotes
    .slice(0, 15)
    .map((n) => clampString(n, 600, 'Refactored construct'));

  batch.update(doc(db, 'projects', params.projectId, 'modules', params.moduleId), {
    targetFramework: params.targetFramework,
    modernizedCode: clampRawCode(params.modernizedCode, 150000, ''),
    modernizedFilePath: clampString(params.modernizedFilePath, 260, 'modernized_module.ts'),
    unitTestCode: clampRawCode(params.unitTestCode, 150000, ''),
    unitTestFilePath: clampString(params.unitTestFilePath, 260, 'modernized_module.test.ts'),
    summary: clampString(params.summary, 4000, 'Module refactored successfully.'),
    refactoringNotes: sanitizedNotes,
    vulnerabilityCount: cappedVulns.length,
    lifecycleStatus: 'modernized',
    updatedAt: serverTimestamp(),
  });

  for (const v of cappedVulns) {
    const vulnId = generateSafeId('vuln');
    const validSeverity: SeverityLevel = ['Critical', 'High', 'Medium', 'Low'].includes(v.severity)
      ? v.severity
      : 'Medium';

    batch.set(doc(db, 'projects', params.projectId, 'vulnerabilities', vulnId), {
      ownerId: params.uid,
      projectId: params.projectId,
      moduleId: params.moduleId,
      filePath: clampString(params.filePath, 260, 'legacy_module.src'),
      cwe: clampString(v.cwe, 32, 'CWE-20'),
      severity: validSeverity,
      title: clampString(v.title, 200, 'Security Vulnerability'),
      lineRange: clampString(v.lineRange, 64, 'Lines 1-10'),
      description: clampString(v.description, 2500, 'Legacy vulnerability identified.'),
      remediation: clampString(v.remediation, 2500, 'Addressed in modernized module.'),
      resolutionStatus: 'open',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  }

  batch.update(doc(db, 'projects', params.projectId), {
    targetFramework: params.targetFramework,
    vulnerabilityCount: Math.max(0, Math.min(params.newTotalProjectVulns, 5000)),
    updatedAt: serverTimestamp(),
  });

  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, modulePath);
  }
}

export async function updateModuleLegacySourceInCloud(params: {
  projectId: string;
  moduleId: string;
  legacyCode: string;
}): Promise<void> {
  const pathStr = `projects/${params.projectId}/modules/${params.moduleId}`;
  try {
    await updateDoc(doc(db, 'projects', params.projectId, 'modules', params.moduleId), {
      legacyCode: clampRawCode(params.legacyCode, 150000, '// Source'),
      lifecycleStatus: 'draft',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, pathStr);
  }
}

export async function markVulnerabilityRemediatedInCloud(
  projectId: string,
  vulnId: string
): Promise<void> {
  const pathStr = `projects/${projectId}/vulnerabilities/${vulnId}`;
  try {
    await updateDoc(doc(db, 'projects', projectId, 'vulnerabilities', vulnId), {
      resolutionStatus: 'remediated',
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, pathStr);
  }
}

export async function appendChatMessageToCloud(params: {
  uid: string;
  projectId: string;
  role: 'user' | 'model';
  content: string;
  persona: ChatPersona;
  modelTier: ModelTier;
  highThinking: boolean;
}): Promise<string> {
  const messageId = generateSafeId('msg');
  const pathStr = `projects/${params.projectId}/messages/${messageId}`;
  try {
    await setDoc(doc(db, 'projects', params.projectId, 'messages', messageId), {
      ownerId: params.uid,
      projectId: params.projectId,
      role: params.role,
      content: clampRawCode(params.content, 60000, '...'),
      persona: params.persona,
      modelTier: params.modelTier,
      highThinking: params.highThinking,
      createdAt: serverTimestamp(),
    });
    return messageId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, pathStr);
  }
}

export async function clearProjectChatInCloud(uid: string, projectId: string): Promise<void> {
  const pathStr = `projects/${projectId}/messages`;
  try {
    const q = query(collection(db, 'projects', projectId, 'messages'), where('ownerId', '==', uid));
    const snap = await getDocs(q);
    if (snap.empty) return;
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, pathStr);
  }
}

export async function deleteCloudProjectComplete(uid: string, projectId: string): Promise<void> {
  const projectPath = `projects/${projectId}`;
  try {
    const [modsSnap, vulnsSnap, msgsSnap] = await Promise.all([
      getDocs(query(collection(db, 'projects', projectId, 'modules'), where('ownerId', '==', uid))),
      getDocs(
        query(collection(db, 'projects', projectId, 'vulnerabilities'), where('ownerId', '==', uid))
      ),
      getDocs(query(collection(db, 'projects', projectId, 'messages'), where('ownerId', '==', uid))),
    ]);

    const batch = writeBatch(db);
    modsSnap.docs.forEach((d) => batch.delete(d.ref));
    vulnsSnap.docs.forEach((d) => batch.delete(d.ref));
    msgsSnap.docs.forEach((d) => batch.delete(d.ref));
    batch.delete(doc(db, 'projects', projectId));
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, projectPath);
  }
}

export type { ProjectRecord, CodeModuleRecord, VulnerabilityRecord, ChatMessageRecord };

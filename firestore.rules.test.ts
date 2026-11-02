import {
  assertFails,
  initializeTestEnvironment,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { readFileSync } from 'node:fs';
import {
  collection,
  doc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

export async function runDirtyDozenSecuritySuite() {
  const testEnv: RulesTestEnvironment = await initializeTestEnvironment({
    projectId: 'reforge-security-test',
    firestore: {
      rules: readFileSync('firestore.rules', 'utf8'),
    },
  });

  try {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      const adminDb = ctx.firestore();
      const now = Timestamp.now();
      await setDoc(doc(adminDb, 'projects', 'victim_proj'), {
        ownerId: 'uid_victim',
        name: 'Core COBOL Ledger',
        description: 'Mainframe batch settlement',
        sourceLanguage: 'COBOL',
        targetFramework: 'Rust',
        repoUrl: '',
        lifecycleStatus: 'active',
        moduleCount: 1,
        vulnerabilityCount: 1,
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(adminDb, 'projects', 'archived_proj'), {
        ownerId: 'uid_owner',
        name: 'Archived Monolith',
        description: 'Completed migration',
        sourceLanguage: 'Java 8',
        targetFramework: 'Node.js',
        repoUrl: '',
        lifecycleStatus: 'archived',
        moduleCount: 2,
        vulnerabilityCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(adminDb, 'projects', 'owner_proj'), {
        ownerId: 'uid_owner',
        name: 'Active Billing PHP',
        description: 'In progress',
        sourceLanguage: 'PHP',
        targetFramework: 'Node.js',
        repoUrl: '',
        lifecycleStatus: 'active',
        moduleCount: 1,
        vulnerabilityCount: 0,
        createdAt: now,
        updatedAt: now,
      });
      await setDoc(doc(adminDb, 'projects', 'owner_proj', 'messages', 'msg_1'), {
        ownerId: 'uid_owner',
        projectId: 'owner_proj',
        role: 'model',
        content: 'Initial audit summary.',
        persona: 'architect',
        modelTier: 'gemini-3.8-flash',
        highThinking: false,
        createdAt: now,
      });
    });

    const attackerDb = testEnv
      .authenticatedContext('uid_attacker', { email_verified: true })
      .firestore();
    const unverifiedDb = testEnv
      .authenticatedContext('uid_owner', { email_verified: false })
      .firestore();
    const ownerDb = testEnv
      .authenticatedContext('uid_owner', { email_verified: true })
      .firestore();

    // 1. Identity Spoofing on Project Create
    await assertFails(
      setDoc(doc(attackerDb, 'projects', 'spoof_proj'), {
        ownerId: 'uid_victim',
        name: 'Spoofed',
        description: 'Desc',
        sourceLanguage: 'COBOL',
        targetFramework: 'Rust',
        repoUrl: '',
        lifecycleStatus: 'active',
        moduleCount: 0,
        vulnerabilityCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 2. Unverified Email Write
    await assertFails(
      setDoc(doc(unverifiedDb, 'projects', 'unverified_proj'), {
        ownerId: 'uid_owner',
        name: 'Unverified',
        description: 'Desc',
        sourceLanguage: 'COBOL',
        targetFramework: 'Rust',
        repoUrl: '',
        lifecycleStatus: 'active',
        moduleCount: 0,
        vulnerabilityCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 3. Shadow / Ghost Field Injection
    await assertFails(
      setDoc(doc(ownerDb, 'projects', 'shadow_proj'), {
        ownerId: 'uid_owner',
        name: 'Shadow',
        description: 'Desc',
        sourceLanguage: 'COBOL',
        targetFramework: 'Rust',
        repoUrl: '',
        lifecycleStatus: 'active',
        moduleCount: 0,
        vulnerabilityCount: 0,
        isAdmin: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 4. Orphaned Subcollection Module Create
    await assertFails(
      setDoc(doc(ownerDb, 'projects', 'missing_proj', 'modules', 'mod_1'), {
        ownerId: 'uid_owner',
        projectId: 'missing_proj',
        filePath: 'ACCT.cbl',
        sourceLanguage: 'COBOL',
        targetFramework: 'Rust',
        legacyCode: 'IDENTIFICATION DIVISION.',
        modernizedCode: '',
        modernizedFilePath: '',
        unitTestCode: '',
        unitTestFilePath: '',
        summary: '',
        refactoringNotes: [],
        vulnerabilityCount: 0,
        lifecycleStatus: 'draft',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 5. Cross-Tenant Subcollection Hijack
    await assertFails(
      setDoc(doc(attackerDb, 'projects', 'victim_proj', 'modules', 'mod_2'), {
        ownerId: 'uid_attacker',
        projectId: 'victim_proj',
        filePath: 'HACK.cbl',
        sourceLanguage: 'COBOL',
        targetFramework: 'Rust',
        legacyCode: 'IDENTIFICATION DIVISION.',
        modernizedCode: '',
        modernizedFilePath: '',
        unitTestCode: '',
        unitTestFilePath: '',
        summary: '',
        refactoringNotes: [],
        vulnerabilityCount: 0,
        lifecycleStatus: 'draft',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 6. ID Poisoning (Oversized Path ID)
    const poisonedId = 'x'.repeat(200);
    await assertFails(
      setDoc(doc(ownerDb, 'projects', poisonedId), {
        ownerId: 'uid_owner',
        name: 'Poison',
        description: 'Desc',
        sourceLanguage: 'COBOL',
        targetFramework: 'Rust',
        repoUrl: '',
        lifecycleStatus: 'active',
        moduleCount: 0,
        vulnerabilityCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    );

    // 7. Value Poisoning (Oversized Name on Allowed Key)
    await assertFails(
      updateDoc(doc(ownerDb, 'projects', 'owner_proj'), {
        name: 'A'.repeat(500),
        updatedAt: serverTimestamp(),
      })
    );

    // 8. Forged Client Timestamp
    await assertFails(
      setDoc(doc(ownerDb, 'projects', 'forged_time_proj'), {
        ownerId: 'uid_owner',
        name: 'Forged Time',
        description: 'Desc',
        sourceLanguage: 'COBOL',
        targetFramework: 'Rust',
        repoUrl: '',
        lifecycleStatus: 'active',
        moduleCount: 0,
        vulnerabilityCount: 0,
        createdAt: Timestamp.fromMillis(946684800000),
        updatedAt: Timestamp.fromMillis(946684800000),
      })
    );

    // 9. Immortal Field Mutation (ownerId change)
    await assertFails(
      updateDoc(doc(ownerDb, 'projects', 'owner_proj'), {
        ownerId: 'uid_attacker',
        updatedAt: serverTimestamp(),
      })
    );

    // 10. Terminal State Bypass on Archived Project
    await assertFails(
      updateDoc(doc(ownerDb, 'projects', 'archived_proj'), {
        lifecycleStatus: 'active',
        updatedAt: serverTimestamp(),
      })
    );

    // 11. Blanket Unscoped Scrape Query
    await assertFails(getDocs(collection(attackerDb, 'projects')));

    // 12. Chat History Tampering
    await assertFails(
      updateDoc(doc(ownerDb, 'projects', 'owner_proj', 'messages', 'msg_1'), {
        content: 'Tampered content',
      })
    );
  } finally {
    await testEnv.cleanup();
  }
}

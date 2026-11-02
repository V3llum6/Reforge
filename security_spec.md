# Security Specification & Red Team Audit (`security_spec.md`)

## 1. Data Invariants

1. **Zero-Trust Default Deny**: Every path not explicitly matched under `/databases/{database}/documents` is unconditionally denied (`allow read, write: if false;`).
2. **Verified Identity & Anti-Spoofing**: All writes require `request.auth != null && request.auth.token.email_verified == true`. Every entity's `ownerId` (or `uid` on `/users/{userId}`) must strictly match `request.auth.uid` on creation and remain immutable on updates.
3. **Master Gate Relational Sync**: Every subcollection write or single-document read/delete (`modules`, `vulnerabilities`, `messages`) must verify via `get(/databases/$(database)/documents/projects/$(projectId))` that the parent project exists and `data.ownerId == request.auth.uid`.
4. **Cost-Safe Query Enforcer (`allow list`)**: No `get()` or `exists()` calls are permitted inside `allow list` blocks, and no blanket `isSignedIn()` reads exist. Every `allow list` explicitly checks `resource.data.ownerId == request.auth.uid` (and `resource.data.projectId == projectId` on subcollections).
5. **Strict Key Allowlists & Anti-Update-Gap**: Every `create` validates exact required and allowed keys (`hasAll` + `hasOnly`) via `isValid[Entity](incoming())`, and every `update` begins with `isValid[Entity](incoming())` wrapped around explicit named action branches using `incoming().diff(existing()).affectedKeys().hasOnly(...)`.
6. **Terminal State Locking**: Once `Project.lifecycleStatus == 'archived'`, `CodeModule.lifecycleStatus == 'archived'`, or `Vulnerability.resolutionStatus == 'remediated'`, all subsequent `update` operations are rejected. `ChatMessage` documents are strictly append-only (`allow update: if false;`).
7. **Temporal & Volumetric Integrity**: All `createdAt` / `updatedAt` timestamps must equal `request.time`. All string fields enforce `.size() <= MAX` matching `firebase-blueprint.json`, IDs match `^[a-zA-Z0-9_\-]+$` (`<= 128` chars), and bounded arrays (`refactoringNotes`) enforce `.size() <= 15`.

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 — Identity Spoofing on Project Create**: Authenticated user `uid_attacker` creates `/projects/proj_1` with `ownerId: "uid_victim"`. -> `PERMISSION_DENIED` (`data.ownerId == request.auth.uid` fails).
2. **Payload 2 — Unverified Email Write**: Authenticated token with `email_verified: false` attempts to create `/projects/proj_2`. -> `PERMISSION_DENIED` (`isVerifiedUser()` fails).
3. **Payload 3 — Shadow / Ghost Field Injection**: Owner creates `/projects/proj_3` with required keys plus `"isAdmin": true`. -> `PERMISSION_DENIED` (`data.keys().hasOnly(...)` fails).
4. **Payload 4 — Orphaned Subcollection Module Create**: Owner creates `/projects/nonexistent_proj/modules/mod_1` without a parent project document. -> `PERMISSION_DENIED` (`isProjectOwner(projectId)` Master Gate fails).
5. **Payload 5 — Cross-Tenant Subcollection Hijack**: `uid_attacker` writes `/projects/victim_proj/modules/mod_2` setting `ownerId: "uid_attacker"`. -> `PERMISSION_DENIED` (`isProjectOwner("victim_proj")` checks parent project's `ownerId`).
6. **Payload 6 — ID Poisoning (2KB Path ID)**: Owner creates `/projects/[2000-char-junk-id]` to exhaust index storage. -> `PERMISSION_DENIED` (`isValidId(projectId)` rejects `size > 128` or invalid chars).
7. **Payload 7 — Denial-of-Wallet 1MB String Value Poisoning**: Owner updates `Project.name` with a 500KB string on an allowed key. -> `PERMISSION_DENIED` (`isValidProject(incoming())` enforces `name.size() <= 120`).
8. **Payload 8 — Forged Client Timestamp**: Owner creates `/projects/proj_4` with `createdAt: Timestamp.fromMillis(946684800000)` instead of `serverTimestamp()`. -> `PERMISSION_DENIED` (`incoming().createdAt == request.time` fails).
9. **Payload 9 — Immortal Field Mutation**: Owner updates `/projects/proj_1` mutating `createdAt` or `ownerId`. -> `PERMISSION_DENIED` (`affectedKeys().hasOnly(...)` and immutability gates reject).
10. **Payload 10 — Terminal State Bypass**: Owner updates `/projects/proj_archived` where `existing().lifecycleStatus == 'archived'` back to `'active'`. -> `PERMISSION_DENIED` (`existing().lifecycleStatus != 'archived'` fails).
11. **Payload 11 — Blanket Scrape Query (`list`)**: `uid_attacker` executes an unfiltered `getDocs(collection(db, 'projects'))` across all tenants. -> `PERMISSION_DENIED` (`resource.data.ownerId == request.auth.uid` blocks unscoped list).
12. **Payload 12 — Chat History Tampering**: Owner attempts `updateDoc` on `/projects/proj_1/messages/msg_1` to rewrite a previous AI response. -> `PERMISSION_DENIED` (`allow update: if false;` on `messages`).

---

## 3. Red Team Audit & Conflict Report

| Collection | Identity Spoofing | State Shortcutting / Terminal Lock | Resource / Value Poisoning | Query Trust (`allow list`) | Audit Result |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/users/{userId}` | Blocked (`uid == userId && uid == request.auth.uid`) | Immutable `uid` & `createdAt` | Bounded strings (`<= 100`, `<= 500`) + `isValidId` | `list` disabled (`false`); `get` owner-only | **PASS** |
| `/projects/{projectId}` | Blocked (`ownerId == request.auth.uid`) | Locked once `lifecycleStatus == 'archived'` | All strings/enums/ints bounded in `isValidProject` | `resource.data.ownerId == request.auth.uid` (no `get()`) | **PASS** |
| `/projects/{projectId}/modules/{moduleId}` | Blocked (`ownerId == auth.uid` + `isProjectOwner`) | Locked once `lifecycleStatus == 'archived'` | Code `<= 150000`, notes list `<= 15`, `isValidCodeModule` wraps update | `resource.data.ownerId == auth.uid && resource.data.projectId == projectId` | **PASS** |
| `/projects/{projectId}/vulnerabilities/{vulnId}` | Blocked (`ownerId == auth.uid` + `isProjectOwner` + `exists(module)`) | Locked once `resolutionStatus == 'remediated'` | Bounded strings & CWE/severity enums in `isValidVulnerability` | `resource.data.ownerId == auth.uid && resource.data.projectId == projectId` | **PASS** |
| `/projects/{projectId}/messages/{messageId}` | Blocked (`ownerId == auth.uid` + `isProjectOwner`) | Immutable (`allow update: if false`) | Content `<= 60000`, strict enums in `isValidChatMessage` | `resource.data.ownerId == auth.uid && resource.data.projectId == projectId` | **PASS** |

# Reforge Studio — Autonomous Legacy Code Modernization & Security Platform

Reforge Studio enables engineering teams to ingest legacy COBOL, Java 8, and PHP repositories and systematically refactor them into modern React, Rust, or Node.js codebases—complete with side-by-side diffs, automated unit tests, security exploit detection, and a multi-turn Gemini architecture assistant.

## User Review & Critical Decisions

> [!IMPORTANT]
> **Confirmed Choices & Upcoming Provisioning Steps**
> Upon your approval of this plan, two interactive setup prompts will run before code generation begins:
> 1. **Firebase Provisioning**: Configures Google Sign-In and a Cloud Firestore database to persist your refactoring projects, module diffs, security audits, and chat threads.
> 2. **Paid Model Key Selection**: Enables `gemini-4-argon` with High Thinking mode (`ThinkingLevel.HIGH`) for deep cross-module refactoring and complex vulnerability reasoning.

- **Confirmed — Codebase Ingestion**: Public GitHub repository URL import, local source file upload, and curated enterprise legacy sample repositories (COBOL mainframe core banking, Java 8 Spring monolith, and PHP 5.6 billing engine).
- **Confirmed — Modernization Workspace**: Unified workbench with a side-by-side diff viewer, CWE/exploit security audit panel, generated unit test suite, and downloadable multi-file ZIP archive export.
- **Confirmed — Visual Posture**: Dark developer console with crisp cool-slate surfaces, subtle hairline dividers, and tabular monospace typography.
- **Confirmed — Persistence & Accounts**: Cloud persistence with Google Sign-In via Firebase so projects, refactored artifacts, and Gemini chat history sync across sessions.

---

## 1. Overview & Core Concept

- **What It Does**: Engineers connect a legacy codebase (via GitHub URL, uploaded source files, or built-in enterprise samples), select a modern target framework (`React + TypeScript`, `Rust`, or `Node.js + TypeScript`), and run autonomous Gemini-powered refactoring. For every legacy file or module, the platform generates idiomatic modern code, synthesizes unit tests, identifies exploitable security flaws (such as SQL injection, buffer overflows, insecure deserialization, or hardcoded credentials) with remediated code, and provides a persistent multi-turn Gemini engineering chat contextualized to the active codebase.
- **Target Audience / Persona**: Principal Engineers, Enterprise Modernization Architects, and Application Security Leads maintaining mission-critical 15-year-old software who need deterministic visibility into code changes, test coverage, and security posture.
- **Key Value**: Replaces opaque, high-risk manual rewrites with a transparent, file-by-file modernization pipeline that verifies security remediation alongside test generation and exports ready-to-run modern project bundles.

---

## 2. User Experience & Visual Design

### Key User Flows

1. **Workspace Entry & Authentication**:
   - Engineers land directly in the dark-slate workbench where they can immediately inspect or run a curated legacy sample, or sign in with Google to create, save, and sync persistent cloud refactoring projects.
2. **Legacy Repository Ingestion**:
   - Clicking **New Refactoring Project** opens a streamlined ingestion drawer offering three tabs: **Public GitHub URL** (fetches repository metadata, branch tree, and selectable legacy source files via server proxy), **Upload Files** (multi-file drag-and-drop for `.cbl`, `.cob`, `.cpy`, `.java`, `.php`, `.sql`, `.xml`, etc.), and **Enterprise Samples** (authentic COBOL, Java 8, and PHP legacy modules).
   - The engineer selects the target stack (**React 19 + TypeScript**, **Rust (Axum / Tokio)**, or **Node.js + TypeScript**) and reasoning depth.
3. **Autonomous Refactoring, Exploit Audit & Test Synthesis**:
   - Running the pipeline analyzes selected legacy modules on the server using `gemini-4-argon` with `ThinkingLevel.HIGH` to map control flow, translate business logic accurately, uncover security exploits, and author unit tests.
   - Progress updates per module in real time, saving completed results to Firestore when signed in.
4. **Side-by-Side Review, Remediation & ZIP Export**:
   - **Code Diff Tab**: Displays synchronized line-numbered legacy source beside modernized target code, with inline rationale notes explaining architectural translations (e.g., COBOL `PERFORM VARYING` or `COMP-3` packed decimals into safe Rust structs).
   - **Security Audit Tab**: Lists detected vulnerabilities filterable by severity (`Critical`, `High`, `Medium`, `Low`), showing CWE identifier, vulnerable legacy lines, attack vector explanation, and how the modernized output neutralizes the exploit.
   - **Unit Tests Tab**: Renders runnable unit test suites (`Vitest`, `Cargo test`, or `Node test runner`) covering edge cases, boundary math, and security regressions, with one-click copy.
   - **Export ZIP**: Packages all modernized modules, unit test files, a generated migration manifest, and security audit summary into a clean `.zip` archive download.
5. **Contextual Multi-Turn Gemini Engineering Chat**:
   - A toggleable right-hand engineering assistant maintains full multi-turn conversation history per project and automatically receives context on the currently active legacy/modernized module and security findings.
   - Engineers can switch assistant roles (**Migration Architect**, **Security Exploit Analyst**, **Unit Test Specialist**) and choose between three execution modes:
     - **High Thinking (`gemini-4-argon` + `ThinkingLevel.HIGH`)**: Deep multi-step reasoning for intricate legacy business rules, concurrency hazards, and exploit root-cause analysis.
     - **General (`gemini-3.8-flash`)**: Balanced conversational speed and code generation for everyday refactoring questions.
     - **Fast (`gemini-3.1-flash-lite`)**: Sub-second responses for quick syntax checks, naming suggestions, and rapid file triage.

### Visual Identity & Theme

- **Aesthetic Direction**: High-precision utilitarian dark developer console. Clean structural lines, zero nested card clutter, zero decorative pulsing dots on static labels, and unboxed inline metadata separated by `·` and `/`.
- **Color Palette & Mood (60-30-10 Discipline)**:
  - **60% Dominant Neutral Canvas (`--background`)**: Deep cool slate `#0B1120` and workspace canvas `#0F172A`.
  - **30% Structural Surfaces (`--surface`)**: Elevated panels `#131C2E` and `#1E293B` separated by crisp `1px solid rgba(148, 163, 184, 0.14)` hairline borders (single-elevation depth).
  - **10% Accent & Semantic Budget (`--primary` / `--accent`)**: High-intent sky cyan `#0EA5E9` / `#38BDF8` reserved strictly for primary CTAs, active segmented tabs, and focus rings. Semantic states always pair color with explicit text labels and icons: `#16A34A` (`Passed / Remediated`), `#D97706` (`Medium / Review`), and `#DC2626` (`Critical / Exploitable`).
- **Typography & Hierarchy**:
  - **Display & Navigation**: `Plus Jakarta Sans` (600 SemiBold / 700 Bold) with `text-wrap: balance` on headings and slight positive tracking on dark surfaces for crisp legibility.
  - **Body & Audit Prose**: `DM Sans` (400 Regular / 600 SemiBold) at `14px–15px` for dense, scannable vulnerability descriptions and chat threads.
  - **Code Diffs & Quantitative Metrics**: `JetBrains Mono` with `font-variant-numeric: tabular-nums` for aligned line numbers, LOC deltas, CWE codes, severity counts, and timestamps.
- **Component Styling & Layout**:
  - Designed for full `1440px` desktop viewport integrity:
    - **Top Bar (Strict 3-Zone Contract)**: Single-line wordmark (`Reforge Studio`) on the left, concise single-line workspace view links (`Workbench`, `Security Overview`, `Saved Projects`, `Sample Library`) in the center, and primary action / Google account control on the right.
    - **3-Pane Workbench Canvas**: `256px` left repository & module explorer + flexible central inspection viewport (`Code Diff`, `Security Audit`, `Unit Tests`, `Migration Report`) + collapsible `380px` contextual Gemini Engineering Chat drawer.

### Interactive Feedback & Motion

- Micro-interactions and tab transitions use compositor-only properties (`opacity`, `transform`) settling within `150ms` (`cubic-bezier(0.16, 1, 0.3, 1)`).
- Geometry-matched skeleton loaders appear while fetching GitHub trees or running deep High Thinking refactoring, accompanied by clear stage indicators (e.g., parsing legacy AST patterns, auditing CWE vectors, synthesizing unit tests).
- Explicit empty states guide first-time users directly to load a legacy sample or import a GitHub URL, and inline error banners offer one-click retry without losing input state.

---

## 3. Key Product Decisions & Trade-Offs

- **Decision 1: Multi-Model Gemini Routing with Dedicated High Thinking Mode**
  - *Chosen Approach*: Route deep refactoring, exploit detection, and complex architectural chat to `gemini-4-argon` with `ThinkingLevel.HIGH` (without restricting `maxOutputTokens`), general multi-turn chat to `gemini-3.8-flash`, and rapid file classification/quick queries to `gemini-3.1-flash-lite`—all executed exclusively via server-side API endpoints.
  - *Why*: Legacy COBOL and Java 8 codebases contain subtle implicit state (global copybooks, mutable singletons, SQL string concatenation) where High Thinking dramatically improves translation accuracy and security taint analysis, while `gemini-3.1-flash-lite` keeps lightweight triage instantaneous.
  - *Alternatives Considered*: Using a single model tier for every action, which would either sacrifice reasoning depth on complex legacy code or introduce unnecessary latency on simple lookups.

- **Decision 2: Structured Schema Refactoring + Streaming Multi-Turn Chat**
  - *Chosen Approach*: Refactoring runs return strict JSON schemas (`responseSchema`) containing modernized source code, unit test code, architectural change notes, and typed security exploit records; the engineering chat uses Server-Sent Events (SSE) streaming with persistent message history.
  - *Why*: Structured JSON guarantees that the Side-by-Side Diff Viewer, Security Audit filters, Unit Test runner preview, and ZIP exporter always receive deterministic, parse-safe artifacts, while streaming chat gives immediate conversational responsiveness.
  - *Alternatives Considered*: Parsing free-form markdown blocks from a single prompt, which is brittle when extracting multiple code artifacts and structured CWE metadata simultaneously.

- **Decision 3: Subcollection-Based Zero-Trust Firestore Schema**
  - *Chosen Approach*: Store projects under a top-level `projects` collection scoped by `ownerId`, with refactored file modules and chat history stored in dedicated subcollections (`modules` and `messages`) governed by strict owner-only Firestore security rules.
  - *Why*: Multi-file legacy codebases and extended multi-turn chat histories can easily exceed Firestore's 1MB single-document limit if stored in unbounded arrays. Subcollections scale cleanly per file and per chat turn while enforcing strict owner isolation.
  - *Alternatives Considered*: Packing all files and chat messages into a single project document, which risks write failures on larger repositories.

---

## 4. Technical Architecture & Data Strategy *(Technical Reference)*

### Architecture & Component Diagram

```text
┌──────────────────────────────────────────────────────────────────────────────┐
│                        CLIENT WORKBENCH (React + Vite)                       │
│                                                                              │
│  ┌────────────────────┐  ┌──────────────────────────┐  ┌──────────────────┐  │
│  │ Top Bar (3-Zone)   │  │ Ingestion Modal / Drawer │  │ ZIP Bundle       │  │
│  │ Brand · Nav · Auth │  │ GitHub URL│Upload│Samples│  │ Exporter (JSZip) │  │
│  └─────────┬──────────┘  └────────────┬─────────────┘  └────────▲─────────┘  │
│            │                          │                         │            │
│  ┌─────────▼──────────┐  ┌────────────▼─────────────┐  ┌────────┴─────────┐  │
│  │ Module Explorer    │  │ Central Review Viewport  │  │ Gemini Chat Pane │  │
│  │ • Project Selector │─▶│ • Side-by-Side Diff View │◀─│ • Role Personas  │  │
│  │ • File List & LOC  │  │ • Security Audit Filter  │  │ • Model & High   │  │
│  │ • Status & CWE Cnt │  │ • Unit Test Suite Viewer │  │   Thinking Toggle│  │
│  └─────────┬──────────┘  └────────────┬─────────────┘  └────────┬─────────┘  │
└────────────┼──────────────────────────┼─────────────────────────┼────────────┘
             │                          │                         │
             ▼                          ▼                         ▼
┌────────────────────────┐   ┌─────────────────────────────────────────────────┐
│   FIREBASE SERVICES    │   │          EXPRESS SERVER API (/api/*)            │
│                        │   │                                                 │
│ • Google Sign-In Popup │   │ • POST /api/github/fetch                        │
│ • Firestore Enterprise │   │     └─▶ GitHub Public REST API (Tree & Raw Src) │
│   ├─ users/{uid}       │   │ • POST /api/refactor/analyze                    │
│   └─ projects/{projId} │   │     └─▶ @google/genai (gemini-4-argon + HIGH)   │
│       ├─ modules/{id}  │   │ • POST /api/refactor/triage                     │
│       └─ messages/{id} │   │     └─▶ @google/genai (gemini-3.1-flash-lite)   │
│                        │   │ • POST /api/chat/stream (SSE Multi-Turn)        │
│   Zero-Trust Rules     │   │     └─▶ gemini-4-argon (HIGH) / 3.8-flash / lite│
└────────────────────────┘   └─────────────────────────────────────────────────┘
```

### Data Model & State

- **User Workspace Profile (`users/{userId}` / Private Split)**: Tracks authenticated user display metadata (`displayName`, `photoURL`, `createdAt`) strictly isolated by UID so user records are never exposed via blanket reads.
- **Refactoring Project (`projects/{projectId}`)**: Represents a connected repository or uploaded codebase (`ownerId`, `name`, `sourceLanguage` [`COBOL` | `Java 8` | `PHP` | `Mixed`], `targetFramework` [`React` | `Rust` | `Node.js`], `repoUrl`, `moduleCount`, `vulnerabilityCount`, `createdAt`, `updatedAt`).
- **Modernized Module (`projects/{projectId}/modules/{moduleId}`)**: Stores an individual source file and its AI-generated modernization artifacts (`ownerId`, `projectId`, `filePath`, `legacyCode`, `modernizedCode`, `modernizedFilePath`, `unitTestCode`, `unitTestFilePath`, `summary`, `refactoringNotes` [bounded list], `vulnerabilities` [bounded list of `{ id, title, cwe, severity, lineRange, description, remediation }`], `status`, `updatedAt`).
- **Engineering Chat Message (`projects/{projectId}/messages/{messageId}`)**: Persists each turn of the contextual Gemini conversation (`ownerId`, `projectId`, `role` [`user` | `model`], `content`, `persona` [`architect` | `security` | `testing`], `modelTier` [`gemini-4-argon` | `gemini-3.8-flash` | `gemini-3.1-flash-lite`], `highThinking` [boolean], `createdAt`).

### Interactive Component & State Mapping

- **Ingestion Drawer**: Validates GitHub repository URLs (`owner/repo` format), fetches selectable source files with checkboxes and byte-size bounds, accepts local file uploads via FileReader, or loads pre-built legacy samples into the active project state.
- **Module Explorer & Batch Runner**: Selecting a file switches the active module across Diff, Security, and Test tabs; clicking **Refactor Module** or **Refactor All** dispatches server-side Gemini analysis, transitions module status (`pending` → `analyzing` → `completed` / `error`), and writes validated results to Firestore.
- **Diff & Code Viewers**: Toggle between **Split View** (side-by-side legacy vs. modern) and **Unified View**, copy modernized or test code to clipboard, and apply inline security hardening re-runs if custom instructions are added.
- **Security Audit Panel**: Interactive segmented severity filter (`All`, `Critical`, `High`, `Medium`, `Low`) plus live text search across CWE IDs and descriptions; clicking a finding highlights the corresponding legacy line range and lets the engineer send the exploit directly into the Gemini Chat for deeper remediation Q&A.
- **Contextual Gemini Chat**: Maintains ordered conversation history, injects active module code and open vulnerabilities into the system instruction for the chosen role persona, streams token chunks via SSE, and toggles High Thinking (`gemini-4-argon` + `ThinkingLevel.HIGH`) with a single control.

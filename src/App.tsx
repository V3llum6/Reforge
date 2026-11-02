import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import {
  Plus,
  Download,
  MessageSquare,
  FileCode2,
  ShieldAlert,
  FlaskConical,
  Layers,
  Trash2,
  CloudUpload,
  CheckCircle2,
  Play,
  Loader2,
  Search,
  ExternalLink,
} from 'lucide-react';
import {
  appendChatMessageToCloud,
  auth,
  clearProjectChatInCloud,
  createCloudProjectFromSample,
  createCloudProjectWithModules,
  db,
  deleteCloudProjectComplete,
  generateSafeId,
  handleFirestoreError,
  markVulnerabilityRemediatedInCloud,
  OperationType,
  saveRefactoredModuleToCloud,
  signInEngineerWithGoogle,
  signOutEngineer,
  timestampToMs,
  updateModuleLegacySourceInCloud,
} from './firebase';
import { ENTERPRISE_LEGACY_SAMPLES } from './data/legacySamples';
import { exportProjectAsZip } from './utils/zipExporter';
import { TopBar } from './components/TopBar';
import { IngestionModal } from './components/IngestionModal';
import { DiffViewer } from './components/DiffViewer';
import { SecurityAuditView } from './components/SecurityAuditView';
import { UnitTestsView } from './components/UnitTestsView';
import { EngineeringChatDrawer } from './components/EngineeringChatDrawer';
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
  WorkbenchSubTab,
  WorkspaceNavTab,
} from './types';

interface LocalSessionBundle {
  project: ProjectRecord;
  modules: CodeModuleRecord[];
  vulnerabilities: VulnerabilityRecord[];
  messages: ChatMessageRecord[];
}

function createLocalBundleFromSample(sample: EnterpriseSampleTemplate): LocalSessionBundle {
  const now = Date.now();
  const projectId = generateSafeId('local_proj');
  const modules: CodeModuleRecord[] = [];
  const vulnerabilities: VulnerabilityRecord[] = [];

  for (const seed of sample.modules) {
    const moduleId = generateSafeId('local_mod');
    modules.push({
      id: moduleId,
      ownerId: 'guest',
      projectId,
      filePath: seed.filePath,
      sourceLanguage: seed.sourceLanguage,
      targetFramework: sample.targetFramework,
      legacyCode: seed.legacyCode,
      modernizedCode: seed.modernizedCode,
      modernizedFilePath: seed.modernizedFilePath,
      unitTestCode: seed.unitTestCode,
      unitTestFilePath: seed.unitTestFilePath,
      summary: seed.summary,
      refactoringNotes: [...seed.refactoringNotes],
      vulnerabilityCount: seed.vulnerabilities.length,
      lifecycleStatus: seed.lifecycleStatus,
      createdAtMs: now,
      updatedAtMs: now,
    });

    for (const v of seed.vulnerabilities) {
      vulnerabilities.push({
        id: generateSafeId('local_vuln'),
        ownerId: 'guest',
        projectId,
        moduleId,
        filePath: seed.filePath,
        cwe: v.cwe,
        severity: v.severity,
        title: v.title,
        lineRange: v.lineRange,
        description: v.description,
        remediation: v.remediation,
        resolutionStatus: 'open',
        createdAtMs: now,
        updatedAtMs: now,
      });
    }
  }

  return {
    project: {
      id: projectId,
      ownerId: 'guest',
      name: sample.name,
      description: sample.description,
      sourceLanguage: sample.sourceLanguage,
      targetFramework: sample.targetFramework,
      repoUrl: '',
      lifecycleStatus: 'active',
      moduleCount: modules.length,
      vulnerabilityCount: vulnerabilities.length,
      createdAtMs: now,
      updatedAtMs: now,
      isLocalSample: true,
    },
    modules,
    vulnerabilities,
    messages: [],
  };
}

export default function App() {
  // Navigation & UI Drawer state
  const [activeNav, setActiveNav] = useState<WorkspaceNavTab>('workbench');
  const [workbenchTab, setWorkbenchTab] = useState<WorkbenchSubTab>('diff');
  const [ingestOpen, setIngestOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Auth state
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Cloud Firestore state (when signed in)
  const [cloudProjects, setCloudProjects] = useState<ProjectRecord[]>([]);
  const [cloudProjectsLoaded, setCloudProjectsLoaded] = useState(false);
  const [cloudModules, setCloudModules] = useState<CodeModuleRecord[]>([]);
  const [cloudVulns, setCloudVulns] = useState<VulnerabilityRecord[]>([]);
  const [cloudMessages, setCloudMessages] = useState<ChatMessageRecord[]>([]);

  // Guest / Local Exploration state (active before sign-in or when exploring local sessions)
  const [localBundles, setLocalBundles] = useState<LocalSessionBundle[]>(() => [
    createLocalBundleFromSample(ENTERPRISE_LEGACY_SAMPLES[0]),
  ]);

  const [selectedProjectId, setSelectedProjectId] = useState<string>('');
  const [selectedModuleId, setSelectedModuleId] = useState<string>('');

  // Saved Projects view filters & delete confirmation
  const [projectSearch, setProjectSearch] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Refactoring execution state
  const [refactoringModuleId, setRefactoringModuleId] = useState<string | null>(null);
  const [batchRunning, setBatchRunning] = useState(false);
  const [refactorError, setRefactorError] = useState<{
    message: string;
    canRetryWithFlash?: boolean;
  } | null>(null);

  // Streaming Chat state
  const [isChatStreaming, setIsChatStreaming] = useState(false);
  const [chatStreamingText, setChatStreamingText] = useState('');
  const [chatError, setChatError] = useState<{
    message: string;
    canRetryWithFlash?: boolean;
    lastText?: string;
    lastPersona?: ChatPersona;
  } | null>(null);
  const [externalDraftPrompt, setExternalDraftPrompt] = useState<{
    text: string;
    persona: ChatPersona;
    highThinking: boolean;
    nonce: number;
  } | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 3200);
  }, []);

  // Track Firebase Auth
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthReady(true);
      if (!nextUser) {
        setCloudProjects([]);
        setCloudModules([]);
        setCloudVulns([]);
        setCloudMessages([]);
        setCloudProjectsLoaded(false);
      }
    });
    return () => unsub();
  }, []);

  // Attach Projects listener when authenticated
  useEffect(() => {
    if (!authReady || !user) return;
    const projectsPath = 'projects';
    const q = query(collection(db, projectsPath), where('ownerId', '==', user.uid));

    const unsub = onSnapshot(
      q,
      (snapshot) => {
        const list: ProjectRecord[] = snapshot.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              ownerId: String(data.ownerId || ''),
              name: String(data.name || 'Untitled'),
              description: String(data.description || ''),
              sourceLanguage: (data.sourceLanguage as SourceLanguage) || 'COBOL',
              targetFramework: (data.targetFramework as TargetFramework) || 'Rust',
              repoUrl: String(data.repoUrl || ''),
              lifecycleStatus: (data.lifecycleStatus as 'active' | 'archived') || 'active',
              moduleCount: Number(data.moduleCount ?? 0),
              vulnerabilityCount: Number(data.vulnerabilityCount ?? 0),
              createdAtMs: timestampToMs(data.createdAt),
              updatedAtMs: timestampToMs(data.updatedAt),
            };
          })
          .sort((a, b) => b.updatedAtMs - a.updatedAtMs);

        setCloudProjects(list);
        setCloudProjectsLoaded(true);
      },
      (err) => {
        handleFirestoreError(err, OperationType.LIST, projectsPath);
      }
    );

    return () => unsub();
  }, [authReady, user]);

  // Unified list of visible projects
  const allProjects = useMemo(() => {
    if (user && cloudProjects.length > 0) {
      return cloudProjects;
    }
    return [
      ...cloudProjects,
      ...localBundles.map((b) => b.project),
    ];
  }, [user, cloudProjects, localBundles]);

  // Ensure valid active project selection
  const activeProject = useMemo(() => {
    if (allProjects.length === 0) return null;
    return allProjects.find((p) => p.id === selectedProjectId) || allProjects[0];
  }, [allProjects, selectedProjectId]);

  useEffect(() => {
    if (activeProject && activeProject.id !== selectedProjectId) {
      setSelectedProjectId(activeProject.id);
    }
  }, [activeProject, selectedProjectId]);

  const isCloudActive = Boolean(user && activeProject && !activeProject.isLocalSample);

  // Attach subcollection listeners (modules, vulnerabilities, messages) for active cloud project
  useEffect(() => {
    if (!authReady || !user || !activeProject || activeProject.isLocalSample) {
      setCloudModules([]);
      setCloudVulns([]);
      setCloudMessages([]);
      return;
    }

    const pid = activeProject.id;
    const modPath = `projects/${pid}/modules`;
    const vulnPath = `projects/${pid}/vulnerabilities`;
    const msgPath = `projects/${pid}/messages`;

    const unsubMods = onSnapshot(
      query(collection(db, 'projects', pid, 'modules'), where('ownerId', '==', user.uid)),
      (snap) => {
        const items: CodeModuleRecord[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              ownerId: String(data.ownerId || ''),
              projectId: String(data.projectId || pid),
              filePath: String(data.filePath || ''),
              sourceLanguage: (data.sourceLanguage as SourceLanguage) || 'COBOL',
              targetFramework: (data.targetFramework as TargetFramework) || 'Rust',
              legacyCode: String(data.legacyCode || ''),
              modernizedCode: String(data.modernizedCode || ''),
              modernizedFilePath: String(data.modernizedFilePath || ''),
              unitTestCode: String(data.unitTestCode || ''),
              unitTestFilePath: String(data.unitTestFilePath || ''),
              summary: String(data.summary || ''),
              refactoringNotes: Array.isArray(data.refactoringNotes)
                ? data.refactoringNotes.map(String)
                : [],
              vulnerabilityCount: Number(data.vulnerabilityCount ?? 0),
              lifecycleStatus:
                (data.lifecycleStatus as 'draft' | 'modernized' | 'archived') || 'draft',
              createdAtMs: timestampToMs(data.createdAt),
              updatedAtMs: timestampToMs(data.updatedAt),
            };
          })
          .sort((a, b) => a.filePath.localeCompare(b.filePath));
        setCloudModules(items);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, modPath)
    );

    const unsubVulns = onSnapshot(
      query(collection(db, 'projects', pid, 'vulnerabilities'), where('ownerId', '==', user.uid)),
      (snap) => {
        const sevRank = (s: string) =>
          s === 'Critical' ? 0 : s === 'High' ? 1 : s === 'Medium' ? 2 : 3;
        const items: VulnerabilityRecord[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              ownerId: String(data.ownerId || ''),
              projectId: String(data.projectId || pid),
              moduleId: String(data.moduleId || ''),
              filePath: String(data.filePath || ''),
              cwe: String(data.cwe || 'CWE-20'),
              severity: (data.severity as SeverityLevel) || 'Medium',
              title: String(data.title || ''),
              lineRange: String(data.lineRange || ''),
              description: String(data.description || ''),
              remediation: String(data.remediation || ''),
              resolutionStatus: (data.resolutionStatus as 'open' | 'remediated') || 'open',
              createdAtMs: timestampToMs(data.createdAt),
              updatedAtMs: timestampToMs(data.updatedAt),
            };
          })
          .sort((a, b) => sevRank(a.severity) - sevRank(b.severity));
        setCloudVulns(items);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, vulnPath)
    );

    const unsubMsgs = onSnapshot(
      query(collection(db, 'projects', pid, 'messages'), where('ownerId', '==', user.uid)),
      (snap) => {
        const items: ChatMessageRecord[] = snap.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              ownerId: String(data.ownerId || ''),
              projectId: String(data.projectId || pid),
              role: data.role === 'model' ? ('model' as const) : ('user' as const),
              content: String(data.content || ''),
              persona: (data.persona as ChatPersona) || 'architect',
              modelTier: (data.modelTier as ModelTier) || 'gemini-3.8-flash',
              highThinking: Boolean(data.highThinking),
              createdAtMs: timestampToMs(data.createdAt),
            };
          })
          .sort((a, b) => a.createdAtMs - b.createdAtMs);
        setCloudMessages(items);
      },
      (err) => handleFirestoreError(err, OperationType.LIST, msgPath)
    );

    return () => {
      unsubMods();
      unsubVulns();
      unsubMsgs();
    };
  }, [authReady, user, activeProject]);

  // Active modules, vulnerabilities, and chat messages (cloud or local bundle)
  const activeLocalBundle = useMemo(
    () => localBundles.find((b) => b.project.id === activeProject?.id) || null,
    [localBundles, activeProject?.id]
  );

  const activeModules = isCloudActive ? cloudModules : activeLocalBundle?.modules || [];
  const activeVulns = isCloudActive ? cloudVulns : activeLocalBundle?.vulnerabilities || [];
  const activeMessages = isCloudActive ? cloudMessages : activeLocalBundle?.messages || [];

  const activeModule = useMemo(() => {
    if (activeModules.length === 0) return null;
    return activeModules.find((m) => m.id === selectedModuleId) || activeModules[0];
  }, [activeModules, selectedModuleId]);

  useEffect(() => {
    if (activeModule && activeModule.id !== selectedModuleId) {
      setSelectedModuleId(activeModule.id);
    }
  }, [activeModule, selectedModuleId]);

  const activeModuleVulns = useMemo(
    () => activeVulns.filter((v) => v.moduleId === activeModule?.id),
    [activeVulns, activeModule?.id]
  );

  // Auth Handlers
  async function handleSignIn() {
    try {
      const signedInUser = await signInEngineerWithGoogle();
      showToast(`Signed in as ${signedInUser.displayName || signedInUser.email}`);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Google Sign-In was cancelled.');
    }
  }

  async function handleSignOut() {
    await signOutEngineer();
    showToast('Signed out of cloud workspace.');
  }

  async function handlePersistLocalBundleToCloud() {
    if (!user || !activeLocalBundle) return;
    const bundle = activeLocalBundle;
    const newProjId = await createCloudProjectWithModules({
      uid: user.uid,
      name: bundle.project.name,
      description: bundle.project.description,
      sourceLanguage: bundle.project.sourceLanguage,
      targetFramework: bundle.project.targetFramework,
      repoUrl: bundle.project.repoUrl,
      modules: bundle.modules.map((m) => ({
        filePath: m.filePath,
        sourceLanguage: m.sourceLanguage,
        legacyCode: m.legacyCode,
        modernizedCode: m.modernizedCode,
        modernizedFilePath: m.modernizedFilePath,
        unitTestCode: m.unitTestCode,
        unitTestFilePath: m.unitTestFilePath,
        summary: m.summary,
        refactoringNotes: m.refactoringNotes,
        lifecycleStatus: m.lifecycleStatus === 'archived' ? 'modernized' : m.lifecycleStatus,
        vulnerabilities: bundle.vulnerabilities
          .filter((v) => v.moduleId === m.id)
          .map((v) => ({
            cwe: v.cwe,
            severity: v.severity,
            title: v.title,
            lineRange: v.lineRange,
            description: v.description,
            remediation: v.remediation,
          })),
      })),
    });
    setSelectedProjectId(newProjId);
    showToast('Project synced to Cloud Firestore.');
  }

  // Project Ingestion Handlers
  async function handleImportFiles(payload: {
    name: string;
    description: string;
    sourceLanguage: SourceLanguage;
    targetFramework: TargetFramework;
    repoUrl?: string;
    files: Array<{
      filePath: string;
      sourceLanguage: SourceLanguage;
      legacyCode: string;
    }>;
  }) {
    if (user) {
      const projectId = await createCloudProjectWithModules({
        uid: user.uid,
        name: payload.name,
        description: payload.description,
        sourceLanguage: payload.sourceLanguage,
        targetFramework: payload.targetFramework,
        repoUrl: payload.repoUrl,
        modules: payload.files.map((f) => ({
          filePath: f.filePath,
          sourceLanguage: f.sourceLanguage,
          legacyCode: f.legacyCode,
          lifecycleStatus: 'draft',
        })),
      });
      setSelectedProjectId(projectId);
      setActiveNav('workbench');
      setWorkbenchTab('diff');
      showToast(`Imported ${payload.files.length} module(s) to Cloud Firestore.`);
      return;
    }

    const now = Date.now();
    const projectId = generateSafeId('local_proj');
    const modules: CodeModuleRecord[] = payload.files.map((f) => ({
      id: generateSafeId('local_mod'),
      ownerId: 'guest',
      projectId,
      filePath: f.filePath,
      sourceLanguage: f.sourceLanguage,
      targetFramework: payload.targetFramework,
      legacyCode: f.legacyCode,
      modernizedCode: '',
      modernizedFilePath: '',
      unitTestCode: '',
      unitTestFilePath: '',
      summary: '',
      refactoringNotes: [],
      vulnerabilityCount: 0,
      lifecycleStatus: 'draft',
      createdAtMs: now,
      updatedAtMs: now,
    }));

    const nextBundle: LocalSessionBundle = {
      project: {
        id: projectId,
        ownerId: 'guest',
        name: payload.name,
        description: payload.description,
        sourceLanguage: payload.sourceLanguage,
        targetFramework: payload.targetFramework,
        repoUrl: payload.repoUrl || '',
        lifecycleStatus: 'active',
        moduleCount: modules.length,
        vulnerabilityCount: 0,
        createdAtMs: now,
        updatedAtMs: now,
        isLocalSample: true,
      },
      modules,
      vulnerabilities: [],
      messages: [],
    };

    setLocalBundles((prev) => [nextBundle, ...prev]);
    setSelectedProjectId(projectId);
    setSelectedModuleId(modules[0]?.id || '');
    setActiveNav('workbench');
    setWorkbenchTab('diff');
    showToast(`Imported ${modules.length} module(s) into workspace.`);
  }

  async function handleSelectSample(sample: EnterpriseSampleTemplate) {
    if (user) {
      const projectId = await createCloudProjectFromSample(user.uid, sample);
      setSelectedProjectId(projectId);
      setActiveNav('workbench');
      setWorkbenchTab('diff');
      showToast(`Initialized "${sample.name}" in Cloud Firestore.`);
      return;
    }

    const bundle = createLocalBundleFromSample(sample);
    setLocalBundles((prev) => [bundle, ...prev]);
    setSelectedProjectId(bundle.project.id);
    setSelectedModuleId(bundle.modules[0]?.id || '');
    setActiveNav('workbench');
    setWorkbenchTab('diff');
    showToast(`Loaded enterprise sample "${sample.name}".`);
  }

  // Core Autonomous Refactoring Runner
  async function executeModuleRefactor(
    targetModule: CodeModuleRecord,
    options: {
      targetFramework: TargetFramework;
      modelTier: ModelTier;
      highThinking: boolean;
      customInstructions: string;
    }
  ): Promise<boolean> {
    if (!activeProject) return false;
    setRefactoringModuleId(targetModule.id);
    setRefactorError(null);

    try {
      const resp = await fetch('/api/refactor/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: targetModule.filePath,
          sourceLanguage: targetModule.sourceLanguage,
          targetFramework: options.targetFramework,
          legacyCode: targetModule.legacyCode,
          customInstructions: options.customInstructions,
          modelTier: options.modelTier,
          highThinking: options.highThinking,
        }),
      });

      const data = await resp.json();
      if (!resp.ok) {
        setRefactorError({
          message: data.message || data.error || 'Refactoring request failed.',
          canRetryWithFlash: Boolean(data.canRetryWithFlash),
        });
        return false;
      }

      const incomingVulns = Array.isArray(data.vulnerabilities) ? data.vulnerabilities : [];
      const incomingNotes = Array.isArray(data.refactoringNotes)
        ? data.refactoringNotes.map(String)
        : [];

      if (isCloudActive && user) {
        const existingModVulns = activeVulns.filter((v) => v.moduleId === targetModule.id);
        const otherVulnCount = activeVulns.length - existingModVulns.length;

        await saveRefactoredModuleToCloud({
          uid: user.uid,
          projectId: activeProject.id,
          moduleId: targetModule.id,
          filePath: targetModule.filePath,
          targetFramework: options.targetFramework,
          modernizedCode: String(data.modernizedCode || ''),
          modernizedFilePath: String(data.modernizedFilePath || ''),
          unitTestCode: String(data.unitTestCode || ''),
          unitTestFilePath: String(data.unitTestFilePath || ''),
          summary: String(data.summary || ''),
          refactoringNotes: incomingNotes,
          vulnerabilities: incomingVulns,
          existingModuleVulns: existingModVulns,
          newTotalProjectVulns: otherVulnCount + incomingVulns.length,
        });
      } else {
        const now = Date.now();
        setLocalBundles((prev) =>
          prev.map((bundle) => {
            if (bundle.project.id !== activeProject.id) return bundle;
            const remainingVulns = bundle.vulnerabilities.filter(
              (v) => v.moduleId !== targetModule.id
            );
            const createdVulns: VulnerabilityRecord[] = incomingVulns.map(
              (v: {
                cwe: string;
                severity: SeverityLevel;
                title: string;
                lineRange: string;
                description: string;
                remediation: string;
              }) => ({
                id: generateSafeId('local_vuln'),
                ownerId: 'guest',
                projectId: bundle.project.id,
                moduleId: targetModule.id,
                filePath: targetModule.filePath,
                cwe: v.cwe || 'CWE-20',
                severity: ['Critical', 'High', 'Medium', 'Low'].includes(v.severity)
                  ? v.severity
                  : 'Medium',
                title: v.title || 'Security Finding',
                lineRange: v.lineRange || 'Lines 1-10',
                description: v.description || '',
                remediation: v.remediation || '',
                resolutionStatus: 'open',
                createdAtMs: now,
                updatedAtMs: now,
              })
            );

            const nextVulns = [...remainingVulns, ...createdVulns];
            const nextModules = bundle.modules.map((m) =>
              m.id === targetModule.id
                ? {
                    ...m,
                    targetFramework: options.targetFramework,
                    modernizedCode: String(data.modernizedCode || ''),
                    modernizedFilePath: String(data.modernizedFilePath || ''),
                    unitTestCode: String(data.unitTestCode || ''),
                    unitTestFilePath: String(data.unitTestFilePath || ''),
                    summary: String(data.summary || ''),
                    refactoringNotes: incomingNotes,
                    vulnerabilityCount: createdVulns.length,
                    lifecycleStatus: 'modernized' as const,
                    updatedAtMs: now,
                  }
                : m
            );

            return {
              ...bundle,
              project: {
                ...bundle.project,
                targetFramework: options.targetFramework,
                vulnerabilityCount: nextVulns.length,
                updatedAtMs: now,
              },
              modules: nextModules,
              vulnerabilities: nextVulns,
            };
          })
        );
      }

      showToast(
        `Refactored ${targetModule.filePath} (${incomingVulns.length} security finding${incomingVulns.length === 1 ? '' : 's'} audited).`
      );
      return true;
    } catch (err) {
      setRefactorError({
        message: err instanceof Error ? err.message : 'Network error during refactoring.',
      });
      return false;
    } finally {
      setRefactoringModuleId(null);
    }
  }

  async function handleBatchRefactorDrafts() {
    if (!activeProject || batchRunning) return;
    const drafts = activeModules.filter((m) => m.lifecycleStatus === 'draft');
    if (drafts.length === 0) return;

    setBatchRunning(true);
    for (const draftMod of drafts) {
      setSelectedModuleId(draftMod.id);
      const ok = await executeModuleRefactor(draftMod, {
        targetFramework: activeProject.targetFramework,
        modelTier: 'gemini-3.8-flash',
        highThinking: false,
        customInstructions: '',
      });
      if (!ok) break;
    }
    setBatchRunning(false);
  }

  async function handleUpdateLegacyCode(nextCode: string) {
    if (!activeProject || !activeModule) return;
    if (isCloudActive) {
      await updateModuleLegacySourceInCloud({
        projectId: activeProject.id,
        moduleId: activeModule.id,
        legacyCode: nextCode,
      });
    } else {
      setLocalBundles((prev) =>
        prev.map((b) =>
          b.project.id !== activeProject.id
            ? b
            : {
                ...b,
                modules: b.modules.map((m) =>
                  m.id === activeModule.id
                    ? { ...m, legacyCode: nextCode, lifecycleStatus: 'draft' }
                    : m
                ),
              }
        )
      );
    }
    showToast('Updated legacy source code.');
  }

  async function handleMarkVulnRemediated(vulnId: string) {
    if (!activeProject) return;
    if (isCloudActive) {
      await markVulnerabilityRemediatedInCloud(activeProject.id, vulnId);
    } else {
      setLocalBundles((prev) =>
        prev.map((b) =>
          b.project.id !== activeProject.id
            ? b
            : {
                ...b,
                vulnerabilities: b.vulnerabilities.map((v) =>
                  v.id === vulnId ? { ...v, resolutionStatus: 'remediated' } : v
                ),
              }
        )
      );
    }
    showToast('Vulnerability marked verified & remediated.');
  }

  // Multi-Turn Streaming Gemini Chat Handler
  async function handleSendChatMessage(params: {
    text: string;
    persona: ChatPersona;
    modelTier: ModelTier;
    highThinking: boolean;
  }) {
    if (!activeProject) return;
    setChatError(null);

    const priorHistory = activeMessages.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const now = Date.now();
    if (isCloudActive && user) {
      await appendChatMessageToCloud({
        uid: user.uid,
        projectId: activeProject.id,
        role: 'user',
        content: params.text,
        persona: params.persona,
        modelTier: params.modelTier,
        highThinking: params.highThinking,
      });
    } else {
      const localUserMsg: ChatMessageRecord = {
        id: generateSafeId('local_msg'),
        ownerId: 'guest',
        projectId: activeProject.id,
        role: 'user',
        content: params.text,
        persona: params.persona,
        modelTier: params.modelTier,
        highThinking: params.highThinking,
        createdAtMs: now,
      };
      setLocalBundles((prev) =>
        prev.map((b) =>
          b.project.id !== activeProject.id
            ? b
            : { ...b, messages: [...b.messages, localUserMsg] }
        )
      );
    }

    setIsChatStreaming(true);
    setChatStreamingText('');

    try {
      const openVulnsSummary = activeVulns
        .filter((v) => v.resolutionStatus === 'open')
        .slice(0, 8)
        .map((v) => `[${v.severity}] ${v.cwe} in ${v.filePath} (${v.lineRange}): ${v.title}`)
        .join('\n');

      const resp = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          history: priorHistory,
          message: params.text,
          persona: params.persona,
          modelTier: params.modelTier,
          highThinking: params.highThinking,
          projectContext: {
            projectName: activeProject.name,
            sourceLanguage: activeProject.sourceLanguage,
            targetFramework: activeProject.targetFramework,
            activeFilePath: activeModule?.filePath,
            legacySnippet: activeModule?.legacyCode,
            modernizedSnippet: activeModule?.modernizedCode,
            openVulnerabilities: openVulnsSummary,
          },
        }),
      });

      if (!resp.ok || !resp.body) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.message || errData.error || 'Chat stream failed to start.');
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let accumulated = '';
      let finalModelUsed: ModelTier = params.modelTier;
      let finalHighThinking = params.highThinking;

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const events = buffer.split('\n\n');
        buffer = events.pop() || '';

        for (const evt of events) {
          const line = evt.trim();
          if (!line.startsWith('data:')) continue;
          const jsonStr = line.slice(5).trim();
          if (!jsonStr) continue;

          const parsed = JSON.parse(jsonStr) as {
            type: 'delta' | 'done' | 'error';
            text?: string;
            message?: string;
            canRetryWithFlash?: boolean;
            modelUsed?: ModelTier;
            highThinkingUsed?: boolean;
          };

          if (parsed.type === 'delta' && parsed.text) {
            accumulated += parsed.text;
            setChatStreamingText(accumulated);
          } else if (parsed.type === 'done') {
            if (parsed.modelUsed) finalModelUsed = parsed.modelUsed;
            if (typeof parsed.highThinkingUsed === 'boolean') {
              finalHighThinking = parsed.highThinkingUsed;
            }
          } else if (parsed.type === 'error') {
            setChatError({
              message: parsed.message || 'Gemini chat encountered an error.',
              canRetryWithFlash: parsed.canRetryWithFlash,
              lastText: params.text,
              lastPersona: params.persona,
            });
            setIsChatStreaming(false);
            setChatStreamingText('');
            return;
          }
        }
      }

      if (accumulated.trim()) {
        if (isCloudActive && user) {
          await appendChatMessageToCloud({
            uid: user.uid,
            projectId: activeProject.id,
            role: 'model',
            content: accumulated,
            persona: params.persona,
            modelTier: finalModelUsed,
            highThinking: finalHighThinking,
          });
        } else {
          const localModelMsg: ChatMessageRecord = {
            id: generateSafeId('local_msg'),
            ownerId: 'guest',
            projectId: activeProject.id,
            role: 'model',
            content: accumulated,
            persona: params.persona,
            modelTier: finalModelUsed,
            highThinking: finalHighThinking,
            createdAtMs: Date.now(),
          };
          setLocalBundles((prev) =>
            prev.map((b) =>
              b.project.id !== activeProject.id
                ? b
                : { ...b, messages: [...b.messages, localModelMsg] }
            )
          );
        }
      }
    } catch (err) {
      setChatError({
        message: err instanceof Error ? err.message : 'Streaming chat failed.',
        lastText: params.text,
        lastPersona: params.persona,
      });
    } finally {
      setIsChatStreaming(false);
      setChatStreamingText('');
    }
  }

  async function handleClearChatHistory() {
    if (!activeProject) return;
    if (isCloudActive && user) {
      await clearProjectChatInCloud(user.uid, activeProject.id);
    } else {
      setLocalBundles((prev) =>
        prev.map((b) => (b.project.id !== activeProject.id ? b : { ...b, messages: [] }))
      );
    }
    showToast('Cleared project conversation history.');
  }

  async function handleDeleteProject(proj: ProjectRecord) {
    if (!proj.isLocalSample && user) {
      await deleteCloudProjectComplete(user.uid, proj.id);
    } else {
      setLocalBundles((prev) => prev.filter((b) => b.project.id !== proj.id));
    }
    setConfirmDeleteId(null);
    showToast(`Deleted project "${proj.name}".`);
  }

  const draftModulesCount = activeModules.filter((m) => m.lifecycleStatus === 'draft').length;
  const openVulnsCount = activeVulns.filter((v) => v.resolutionStatus === 'open').length;

  const filteredSavedProjects = useMemo(() => {
    const q = projectSearch.trim().toLowerCase();
    if (!q) return allProjects;
    return allProjects.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        p.sourceLanguage.toLowerCase().includes(q) ||
        p.targetFramework.toLowerCase().includes(q)
    );
  }, [allProjects, projectSearch]);

  return (
    <div className="min-h-screen flex flex-col bg-[#0B1120] text-slate-100">
      {/* Strict 3-Zone Top Bar */}
      <TopBar
        activeNav={activeNav}
        onNavigate={setActiveNav}
        user={user}
        authLoading={!authReady}
        onSignIn={() => void handleSignIn()}
        onSignOut={() => void handleSignOut()}
      />

      {/* Mobile Secondary Navigation Strip */}
      <div className="flex md:hidden items-center gap-2 px-4 py-2 border-b border-slate-800/80 bg-[#0F172A] overflow-x-auto">
        {(
          [
            { id: 'workbench', label: 'Workbench' },
            { id: 'security', label: 'Security Audit' },
            { id: 'projects', label: 'Saved Projects' },
            { id: 'samples', label: 'Sample Library' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveNav(item.id)}
            className={`px-3 py-1 text-xs font-medium rounded-md whitespace-nowrap shrink-0 cursor-pointer ${
              activeNav === item.id ? 'bg-slate-800 text-slate-100' : 'text-slate-400'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Main Content Viewport */}
      {activeNav === 'workbench' && (
        <div className="flex-1 flex flex-col lg:flex-row min-h-0">
          {/* Left Repository & Module Explorer Sidebar (264px) */}
          <aside className="w-full lg:w-[264px] shrink-0 border-b lg:border-b-0 lg:border-r border-slate-800/80 bg-[#0F172A] flex flex-col">
            <div className="p-4 border-b border-slate-800/80 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <label
                  htmlFor="active-project-select"
                  className="text-xs font-semibold text-slate-300"
                >
                  Active Repository
                </label>
                <button
                  type="button"
                  onClick={() => setIngestOpen(true)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold bg-sky-500 text-slate-950 rounded-md hover:bg-sky-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Connect Repo
                </button>
              </div>

              {allProjects.length > 0 && (
                <select
                  id="active-project-select"
                  value={activeProject?.id || ''}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                  className="w-full bg-[#131C2E] border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-100 focus:outline-none focus:border-sky-400"
                >
                  {allProjects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sourceLanguage} → {p.targetFramework})
                    </option>
                  ))}
                </select>
              )}

              {activeProject && (
                <div className="text-[11px] text-slate-400 flex flex-wrap items-center gap-1.5">
                  <span>{activeProject.sourceLanguage}</span>
                  <span>·</span>
                  <span>Target {activeProject.targetFramework}</span>
                  <span>·</span>
                  <span className="tabular-nums">{activeModules.length} modules</span>
                </div>
              )}

              {user && activeProject?.isLocalSample && (
                <button
                  type="button"
                  onClick={() => void handlePersistLocalBundleToCloud()}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#131C2E] border border-sky-500/40 text-sky-300 rounded-lg hover:bg-sky-500/10 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <CloudUpload className="w-3.5 h-3.5" />
                  Sync Workspace to Cloud
                </button>
              )}
            </div>

            {/* Module Tree List */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              <div className="flex items-center justify-between px-2 pb-1.5">
                <span className="text-xs font-medium text-slate-400">Source Modules</span>
                {draftModulesCount > 0 && (
                  <button
                    type="button"
                    disabled={batchRunning || Boolean(refactoringModuleId)}
                    onClick={() => void handleBatchRefactorDrafts()}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-sky-400 hover:text-sky-300 disabled:opacity-50 cursor-pointer whitespace-nowrap"
                  >
                    {batchRunning ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Play className="w-3 h-3" />
                    )}
                    Refactor All ({draftModulesCount})
                  </button>
                )}
              </div>

              {activeModules.map((mod) => {
                const isSelected = activeModule?.id === mod.id;
                const isCurrentlyRunning = refactoringModuleId === mod.id;
                return (
                  <button
                    key={mod.id}
                    type="button"
                    onClick={() => {
                      setSelectedModuleId(mod.id);
                      setRefactorError(null);
                    }}
                    className={`w-full text-left px-3 py-2.5 rounded-lg border transition-colors cursor-pointer space-y-1 ${
                      isSelected
                        ? 'bg-[#131C2E] border-slate-700 text-slate-100'
                        : 'border-transparent text-slate-300 hover:bg-[#131C2E]/60 hover:text-slate-100'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs truncate">{mod.filePath}</span>
                      {isCurrentlyRunning ? (
                        <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />
                      ) : mod.lifecycleStatus === 'modernized' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                      ) : null}
                    </div>
                    <div className="text-[11px] text-slate-400 font-mono tabular-nums">
                      {mod.lifecycleStatus === 'modernized' ? 'Modernized' : 'Draft'} ·{' '}
                      {mod.vulnerabilityCount} CWE{mod.vulnerabilityCount === 1 ? '' : 's'}
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          {/* Central Refactoring, Security & Unit Test Viewport */}
          <main className="flex-1 min-w-0 flex flex-col bg-[#0B1120]">
            {activeProject && activeModule ? (
              <>
                {/* Contextual Workspace Toolbar */}
                <div className="px-6 py-3.5 border-b border-slate-800/80 bg-[#0F172A] flex flex-wrap items-center justify-between gap-4">
                  <div className="flex items-center gap-1 p-1 bg-[#131C2E] border border-slate-800 rounded-lg">
                    <button
                      type="button"
                      onClick={() => setWorkbenchTab('diff')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        workbenchTab === 'diff'
                          ? 'bg-slate-800 text-slate-100'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <FileCode2 className="w-3.5 h-3.5" />
                      Side-by-Side Diff
                    </button>

                    <button
                      type="button"
                      onClick={() => setWorkbenchTab('security')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        workbenchTab === 'security'
                          ? 'bg-slate-800 text-slate-100'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <ShieldAlert className="w-3.5 h-3.5" />
                      Security Audit ({activeModuleVulns.length})
                    </button>

                    <button
                      type="button"
                      onClick={() => setWorkbenchTab('tests')}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                        workbenchTab === 'tests'
                          ? 'bg-slate-800 text-slate-100'
                          : 'text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      <FlaskConical className="w-3.5 h-3.5" />
                      Unit Tests
                    </button>
                  </div>

                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() =>
                        void exportProjectAsZip(activeProject, activeModules, activeVulns)
                      }
                      className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-medium bg-[#131C2E] border border-slate-800 text-slate-200 rounded-lg hover:border-slate-700 hover:text-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5 text-sky-400" />
                      Export ZIP Bundle
                    </button>

                    {!chatOpen && (
                      <button
                        type="button"
                        onClick={() => setChatOpen(true)}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                      >
                        <MessageSquare className="w-3.5 h-3.5" />
                        Open Gemini Assistant
                      </button>
                    )}
                  </div>
                </div>

                {/* Active Workbench Sub-View */}
                <div className="flex-1 p-6 overflow-y-auto">
                  {workbenchTab === 'diff' && (
                    <DiffViewer
                      module={activeModule}
                      vulnerabilities={activeModuleVulns}
                      isRefactoring={refactoringModuleId === activeModule.id}
                      refactorError={refactorError}
                      onRunRefactor={async (opts) => {
                        await executeModuleRefactor(activeModule, opts);
                      }}
                      onUpdateLegacyCode={handleUpdateLegacyCode}
                    />
                  )}

                  {workbenchTab === 'security' && (
                    <SecurityAuditView
                      vulnerabilities={activeModuleVulns}
                      scopeLabel={activeModule.filePath}
                      onMarkRemediated={handleMarkVulnRemediated}
                      onAskSecurityAssistant={(vuln) => {
                        setChatOpen(true);
                        setExternalDraftPrompt({
                          text: `Perform a deep exploit & remediation review of ${vuln.cwe} (${vuln.title}) at ${vuln.lineRange} in ${vuln.filePath}. Are there any bypass vectors remaining in the modernized output?`,
                          persona: 'security',
                          highThinking: true,
                          nonce: Date.now(),
                        });
                      }}
                    />
                  )}

                  {workbenchTab === 'tests' && (
                    <UnitTestsView
                      module={activeModule}
                      isRefactoring={refactoringModuleId === activeModule.id}
                      onTriggerRefactor={() => {
                        void executeModuleRefactor(activeModule, {
                          targetFramework: activeModule.targetFramework,
                          modelTier: 'gemini-4-argon',
                          highThinking: true,
                          customInstructions: '',
                        });
                      }}
                      onExpandTestsInChat={() => {
                        setChatOpen(true);
                        setExternalDraftPrompt({
                          text: `Review the unit test suite in ${activeModule.unitTestFilePath || activeModule.filePath} and write additional property/boundary regression tests for malformed legacy inputs.`,
                          persona: 'testing',
                          highThinking: false,
                          nonce: Date.now(),
                        });
                      }}
                    />
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center p-10 text-center space-y-4">
                <Layers className="w-8 h-8 text-sky-400" />
                <div className="space-y-1 max-w-md">
                  <h2 className="text-lg font-semibold text-slate-100">
                    No Legacy Repository Connected
                  </h2>
                  <p className="text-sm text-slate-400 leading-relaxed">
                    Connect a public GitHub repository, upload legacy COBOL/Java 8/PHP source files, or load a curated enterprise sample to begin modernization.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIngestOpen(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400 transition-colors cursor-pointer whitespace-nowrap"
                >
                  <Plus className="w-4 h-4" />
                  Connect Legacy Repository
                </button>
              </div>
            )}
          </main>

          {/* Right Contextual Multi-Turn Gemini Chat Drawer */}
          <EngineeringChatDrawer
            isOpen={chatOpen}
            onClose={() => setChatOpen(false)}
            project={activeProject}
            activeModule={activeModule}
            vulnerabilities={activeVulns}
            messages={activeMessages}
            externalDraftPrompt={externalDraftPrompt}
            onSendMessage={handleSendChatMessage}
            onClearHistory={handleClearChatHistory}
            isStreaming={isChatStreaming}
            streamingText={chatStreamingText}
            chatError={chatError}
          />
        </div>
      )}

      {/* Top-Nav View 2: Full-Repository Security Audit */}
      {activeNav === 'security' && (
        <main className="flex-1 max-w-6xl w-full mx-auto p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-xl font-semibold text-slate-100">
                Repository Security Exploit & CWE Ledger
              </h1>
              <p className="text-sm text-slate-400">
                {activeProject
                  ? `${activeProject.name} · ${openVulnsCount} open vulnerabilities across ${activeModules.length} modules`
                  : 'Select or import a repository to inspect CWE findings.'}
              </p>
            </div>
            {activeProject && (
              <button
                type="button"
                onClick={() => void exportProjectAsZip(activeProject, activeModules, activeVulns)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Download className="w-3.5 h-3.5" />
                Export Audit & Code Bundle
              </button>
            )}
          </div>

          <SecurityAuditView
            vulnerabilities={activeVulns}
            scopeLabel={activeProject?.name || 'All Modules'}
            onMarkRemediated={handleMarkVulnRemediated}
            onJumpToModule={(moduleId) => {
              setSelectedModuleId(moduleId);
              setActiveNav('workbench');
              setWorkbenchTab('diff');
            }}
            onAskSecurityAssistant={(vuln) => {
              setSelectedModuleId(vuln.moduleId);
              setActiveNav('workbench');
              setChatOpen(true);
              setExternalDraftPrompt({
                text: `Analyze ${vuln.cwe} (${vuln.title}) in ${vuln.filePath} (${vuln.lineRange}) and provide verification tests proving the exploit is neutralized.`,
                persona: 'security',
                highThinking: true,
                nonce: Date.now(),
              });
            }}
          />
        </main>
      )}

      {/* Top-Nav View 3: Saved Projects */}
      {activeNav === 'projects' && (
        <main className="flex-1 max-w-6xl w-full mx-auto p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="space-y-1">
              <h1 className="text-xl font-semibold text-slate-100">Modernization Projects</h1>
              <p className="text-sm text-slate-400">
                {user
                  ? `Signed in as ${user.email} · Cloud Firestore sync active`
                  : 'Exploring in local guest mode · Sign in with Google in the top bar to persist projects across sessions'}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={projectSearch}
                  onChange={(e) => setProjectSearch(e.target.value)}
                  placeholder="Search projects..."
                  className="bg-[#131C2E] border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                />
              </div>
              <button
                type="button"
                onClick={() => setIngestOpen(true)}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-xs font-semibold bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Plus className="w-3.5 h-3.5" />
                New Project
              </button>
            </div>
          </div>

          {user && !cloudProjectsLoaded ? (
            <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-6 space-y-3">
              {Array.from({ length: 3 }).map((_, idx) => (
                <div key={idx} className="h-12 bg-slate-800/50 rounded-lg animate-pulse" />
              ))}
            </div>
          ) : filteredSavedProjects.length === 0 ? (
            <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-10 text-center space-y-3">
              <p className="text-sm font-medium text-slate-200">No matching projects found.</p>
              <button
                type="button"
                onClick={() => setIngestOpen(true)}
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400 transition-colors cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Connect Legacy Repository
              </button>
            </div>
          ) : (
            <div className="bg-[#131C2E] border border-slate-800 rounded-xl divide-y divide-slate-800">
              {filteredSavedProjects.map((proj) => {
                const isCurrent = activeProject?.id === proj.id;
                return (
                  <div
                    key={proj.id}
                    className="p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 hover:bg-slate-800/20 transition-colors"
                  >
                    <div className="space-y-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                        <span>{proj.sourceLanguage}</span>
                        <span>→</span>
                        <span className="text-sky-400 font-medium">{proj.targetFramework}</span>
                        <span>·</span>
                        <span className="font-mono tabular-nums">{proj.moduleCount} modules</span>
                        <span>·</span>
                        <span className="font-mono tabular-nums">
                          {proj.vulnerabilityCount} security findings
                        </span>
                        <span>·</span>
                        <span>{proj.isLocalSample ? 'Local Session' : 'Cloud Synced'}</span>
                      </div>
                      <h2 className="text-base font-semibold text-slate-100 truncate">
                        {proj.name}
                      </h2>
                      {proj.description && (
                        <p className="text-xs text-slate-400 line-clamp-2 max-w-2xl">
                          {proj.description}
                        </p>
                      )}
                      {proj.repoUrl && (
                        <a
                          href={proj.repoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-sky-400 hover:underline pt-0.5"
                        >
                          {proj.repoUrl}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedProjectId(proj.id);
                          setActiveNav('workbench');
                        }}
                        className={`px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                          isCurrent
                            ? 'bg-slate-800 text-slate-100 border border-slate-700'
                            : 'bg-sky-500 text-slate-950 hover:bg-sky-400'
                        }`}
                      >
                        {isCurrent ? 'Open in Workbench' : 'Select Project'}
                      </button>

                      {confirmDeleteId === proj.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() => void handleDeleteProject(proj)}
                            className="px-2.5 py-2 text-xs font-medium bg-red-500 text-white rounded-lg hover:bg-red-400 cursor-pointer whitespace-nowrap"
                          >
                            Confirm Delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(null)}
                            className="px-2 py-2 text-xs text-slate-400 hover:text-slate-200 cursor-pointer"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(proj.id)}
                          aria-label={`Delete ${proj.name}`}
                          className="p-2 rounded-lg text-slate-400 hover:text-red-300 hover:bg-slate-800/70 transition-colors cursor-pointer"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      )}

      {/* Top-Nav View 4: Enterprise Sample Library */}
      {activeNav === 'samples' && (
        <main className="flex-1 max-w-6xl w-full mx-auto p-6 space-y-6">
          <div className="space-y-1">
            <h1 className="text-xl font-semibold text-slate-100">
              Enterprise Legacy Reference Repositories
            </h1>
            <p className="text-sm text-slate-400 max-w-2xl leading-relaxed">
              Explore authentic 15-to-25-year-old legacy systems across COBOL-85, Java 8 Servlets, and PHP 5.4. Each sample includes pre-audited modules alongside unrefactored draft modules so you can test live Gemini refactoring immediately.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 items-stretch">
            {ENTERPRISE_LEGACY_SAMPLES.map((sample) => {
              const vulnTotal = sample.modules.reduce(
                (acc, m) => acc + m.vulnerabilities.length,
                0
              );
              return (
                <div
                  key={sample.key}
                  className="bg-[#131C2E] border border-slate-800 rounded-xl p-6 flex flex-col justify-between gap-6"
                >
                  <div className="space-y-3">
                    <div className="text-xs text-slate-400">
                      <span>{sample.industry}</span>
                      <span className="mx-1.5">·</span>
                      <span>{sample.era}</span>
                    </div>
                    <h2 className="text-base font-semibold text-slate-100">{sample.name}</h2>
                    <p className="text-xs text-slate-400 leading-relaxed">{sample.description}</p>

                    <div className="pt-2 border-t border-slate-800/80 space-y-1.5 text-xs">
                      <div className="flex justify-between text-slate-300">
                        <span>Migration Path</span>
                        <span className="font-mono">
                          {sample.sourceLanguage} → {sample.targetFramework}
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span>Included Files</span>
                        <span className="font-mono tabular-nums">
                          {sample.modules.map((m) => m.filePath.split('/').pop()).join(', ')}
                        </span>
                      </div>
                      <div className="flex justify-between text-slate-300">
                        <span>Seeded CWE Exploits</span>
                        <span className="font-mono tabular-nums text-amber-300">
                          {vulnTotal} findings
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => void handleSelectSample(sample)}
                    className="w-full py-2.5 px-4 text-xs font-semibold bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Initialize Sample in Workbench
                  </button>
                </div>
              );
            })}
          </div>
        </main>
      )}

      {/* Repository Ingestion Modal */}
      <IngestionModal
        isOpen={ingestOpen}
        onClose={() => setIngestOpen(false)}
        onImportFiles={handleImportFiles}
        onSelectSample={handleSelectSample}
      />

      {/* Non-Blocking Toast Notification */}
      {toastMessage && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-lg bg-[#1E293B] border border-slate-700 text-xs font-medium text-slate-100 shadow-lg"
        >
          {toastMessage}
        </div>
      )}
    </div>
  );
}

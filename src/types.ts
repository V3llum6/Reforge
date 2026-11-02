export type SourceLanguage = 'COBOL' | 'Java 8' | 'PHP' | 'Mixed';
export type TargetFramework = 'React' | 'Rust' | 'Node.js';
export type ModelTier = 'gemini-4-argon' | 'gemini-3.8-flash' | 'gemini-3.1-flash-lite';
export type ChatPersona = 'architect' | 'security' | 'testing';
export type SeverityLevel = 'Critical' | 'High' | 'Medium' | 'Low';
export type WorkspaceNavTab = 'workbench' | 'security' | 'projects' | 'samples';
export type WorkbenchSubTab = 'diff' | 'security' | 'tests' | 'summary';

export interface ProjectRecord {
  id: string;
  ownerId: string;
  name: string;
  description: string;
  sourceLanguage: SourceLanguage;
  targetFramework: TargetFramework;
  repoUrl: string;
  lifecycleStatus: 'active' | 'archived';
  moduleCount: number;
  vulnerabilityCount: number;
  createdAtMs: number;
  updatedAtMs: number;
  isLocalSample?: boolean;
}

export interface CodeModuleRecord {
  id: string;
  ownerId: string;
  projectId: string;
  filePath: string;
  sourceLanguage: SourceLanguage;
  targetFramework: TargetFramework;
  legacyCode: string;
  modernizedCode: string;
  modernizedFilePath: string;
  unitTestCode: string;
  unitTestFilePath: string;
  summary: string;
  refactoringNotes: string[];
  vulnerabilityCount: number;
  lifecycleStatus: 'draft' | 'modernized' | 'archived';
  createdAtMs: number;
  updatedAtMs: number;
}

export interface VulnerabilityRecord {
  id: string;
  ownerId: string;
  projectId: string;
  moduleId: string;
  filePath: string;
  cwe: string;
  severity: SeverityLevel;
  title: string;
  lineRange: string;
  description: string;
  remediation: string;
  resolutionStatus: 'open' | 'remediated';
  createdAtMs: number;
  updatedAtMs: number;
}

export interface ChatMessageRecord {
  id: string;
  ownerId: string;
  projectId: string;
  role: 'user' | 'model';
  content: string;
  persona: ChatPersona;
  modelTier: ModelTier;
  highThinking: boolean;
  createdAtMs: number;
}

export interface GitHubTreeFile {
  path: string;
  size: number;
  detectedLanguage: SourceLanguage;
}

export interface TriageResult {
  detectedDialect: string;
  complexityLevel: string;
  recommendedTargetFile: string;
  riskHotspots: string[];
}

export interface SampleModuleSeed {
  filePath: string;
  sourceLanguage: SourceLanguage;
  legacyCode: string;
  modernizedCode: string;
  modernizedFilePath: string;
  unitTestCode: string;
  unitTestFilePath: string;
  summary: string;
  refactoringNotes: string[];
  lifecycleStatus: 'draft' | 'modernized';
  vulnerabilities: Array<{
    cwe: string;
    severity: SeverityLevel;
    title: string;
    lineRange: string;
    description: string;
    remediation: string;
  }>;
}

export interface EnterpriseSampleTemplate {
  key: string;
  name: string;
  era: string;
  industry: string;
  description: string;
  sourceLanguage: SourceLanguage;
  targetFramework: TargetFramework;
  modules: SampleModuleSeed[];
}

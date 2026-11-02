import React, { useRef, useState } from 'react';
import {
  X,
  FolderGit2,
  Upload,
  Layers,
  Loader2,
  Check,
  FileCode2,
  AlertCircle,
} from 'lucide-react';
import { ENTERPRISE_LEGACY_SAMPLES } from '../data/legacySamples';
import type {
  EnterpriseSampleTemplate,
  GitHubTreeFile,
  SourceLanguage,
  TargetFramework,
} from '../types';

interface IngestionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportFiles: (payload: {
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
  }) => Promise<void>;
  onSelectSample: (sample: EnterpriseSampleTemplate) => Promise<void>;
}

type IngestTab = 'github' | 'upload' | 'samples';

const GITHUB_EXAMPLE_REPOS = [
  {
    label: 'OpenMainframe COBOL Course',
    url: 'https://github.com/openmainframeproject/cobol-programming-course',
    target: 'Rust' as TargetFramework,
  },
  {
    label: 'Spring PetClinic (Java)',
    url: 'https://github.com/spring-projects/spring-petclinic',
    target: 'Node.js' as TargetFramework,
  },
  {
    label: 'PHPMailer Legacy/Core (PHP)',
    url: 'https://github.com/PHPMailer/PHPMailer',
    target: 'Node.js' as TargetFramework,
  },
];

function detectLanguageByExtension(name: string): SourceLanguage {
  const lower = name.toLowerCase();
  if (lower.endsWith('.cbl') || lower.endsWith('.cob') || lower.endsWith('.cpy') || lower.endsWith('.jcl')) {
    return 'COBOL';
  }
  if (lower.endsWith('.java') || lower.endsWith('.jsp')) {
    return 'Java 8';
  }
  if (lower.endsWith('.php') || lower.endsWith('.phtml') || lower.endsWith('.inc')) {
    return 'PHP';
  }
  return 'Mixed';
}

export const IngestionModal: React.FC<IngestionModalProps> = ({
  isOpen,
  onClose,
  onImportFiles,
  onSelectSample,
}) => {
  const [activeTab, setActiveTab] = useState<IngestTab>('github');
  const [targetFramework, setTargetFramework] = useState<TargetFramework>('Rust');
  const [isBusy, setIsBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // GitHub state
  const [repoUrl, setRepoUrl] = useState('');
  const [repoTreeMeta, setRepoTreeMeta] = useState<{
    owner: string;
    repo: string;
    branch: string;
    fullName: string;
    description: string;
    htmlUrl: string;
    files: GitHubTreeFile[];
  } | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Record<string, boolean>>({});
  const [treeFilter, setTreeFilter] = useState('');

  // Upload & Paste state
  const [projectName, setProjectName] = useState('Legacy Modernization Batch');
  const [sourceLang, setSourceLang] = useState<SourceLanguage>('COBOL');
  const [uploadedFiles, setUploadedFiles] = useState<
    Array<{ filePath: string; sourceLanguage: SourceLanguage; legacyCode: string }>
  >([]);
  const [pasteFileName, setPasteFileName] = useState('PAYROLL-BATCH.cbl');
  const [pasteContent, setPasteContent] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  if (!isOpen) return null;

  async function handleFetchGitHubTree(e: React.FormEvent) {
    e.preventDefault();
    setErrorMsg(null);
    if (!repoUrl.trim()) {
      setErrorMsg('Enter a public GitHub repository URL or owner/repo shorthand.');
      return;
    }

    setIsBusy(true);
    try {
      const resp = await fetch('/api/github/tree', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoUrl: repoUrl.trim() }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Unable to inspect GitHub repository.');
      }

      setRepoTreeMeta(data);
      const preselected: Record<string, boolean> = {};
      (data.files as GitHubTreeFile[]).slice(0, 4).forEach((f) => {
        preselected[f.path] = true;
      });
      setSelectedPaths(preselected);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to fetch GitHub tree.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleConfirmGitHubImport() {
    if (!repoTreeMeta) return;
    const chosen = Object.keys(selectedPaths).filter((p) => selectedPaths[p]);
    if (chosen.length === 0) {
      setErrorMsg('Select at least one source file to import.');
      return;
    }

    setErrorMsg(null);
    setIsBusy(true);
    try {
      const resp = await fetch('/api/github/files', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner: repoTreeMeta.owner,
          repo: repoTreeMeta.repo,
          branch: repoTreeMeta.branch,
          paths: chosen.slice(0, 12),
        }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.error || 'Failed to download source files from GitHub.');
      }

      const downloadedFiles = data.files as Array<{
        filePath: string;
        content: string;
        sourceLanguage: SourceLanguage;
      }>;

      const langs = new Set(downloadedFiles.map((f) => f.sourceLanguage));
      const dominantLang: SourceLanguage =
        langs.size === 1 ? downloadedFiles[0].sourceLanguage : 'Mixed';

      await onImportFiles({
        name: repoTreeMeta.fullName,
        description: repoTreeMeta.description,
        sourceLanguage: dominantLang,
        targetFramework,
        repoUrl: repoTreeMeta.htmlUrl,
        files: downloadedFiles.map((f) => ({
          filePath: f.filePath,
          sourceLanguage: f.sourceLanguage,
          legacyCode: f.content,
        })),
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'GitHub import failed.');
    } finally {
      setIsBusy(false);
    }
  }

  async function handleFileInputChange(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setErrorMsg(null);
    const nextItems: Array<{
      filePath: string;
      sourceLanguage: SourceLanguage;
      legacyCode: string;
    }> = [];

    for (const file of Array.from(fileList).slice(0, 12)) {
      if (file.size > 150000) {
        setErrorMsg(`Skipped ${file.name}: exceeds 150 KB per-module source limit.`);
        continue;
      }
      const text = await file.text();
      if (text.trim()) {
        nextItems.push({
          filePath: file.name,
          sourceLanguage: detectLanguageByExtension(file.name),
          legacyCode: text,
        });
      }
    }

    if (nextItems.length > 0) {
      setUploadedFiles((prev) => [...prev, ...nextItems]);
      setSourceLang(nextItems[0].sourceLanguage);
    }
  }

  function handleAddPastedSnippet() {
    if (!pasteContent.trim()) {
      setErrorMsg('Paste legacy code before adding the module.');
      return;
    }
    const cleanName = pasteFileName.trim() || 'legacy_module.cbl';
    const lang = detectLanguageByExtension(cleanName);
    setUploadedFiles((prev) => [
      ...prev,
      {
        filePath: cleanName,
        sourceLanguage: lang === 'Mixed' ? sourceLang : lang,
        legacyCode: pasteContent,
      },
    ]);
    setPasteContent('');
    setErrorMsg(null);
  }

  async function handleConfirmUploadImport() {
    const modulesToImport = [...uploadedFiles];
    if (modulesToImport.length === 0 && pasteContent.trim()) {
      const cleanName = pasteFileName.trim() || 'legacy_module.cbl';
      modulesToImport.push({
        filePath: cleanName,
        sourceLanguage: sourceLang,
        legacyCode: pasteContent,
      });
    }

    if (modulesToImport.length === 0) {
      setErrorMsg('Upload at least one legacy source file or paste a code module.');
      return;
    }

    setIsBusy(true);
    setErrorMsg(null);
    try {
      await onImportFiles({
        name: projectName.trim() || 'Uploaded Legacy Repository',
        description: `Imported ${modulesToImport.length} legacy source module(s) for modernization into ${targetFramework}.`,
        sourceLanguage: modulesToImport[0].sourceLanguage,
        targetFramework,
        repoUrl: '',
        files: modulesToImport,
      });
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to create project.');
    } finally {
      setIsBusy(false);
    }
  }

  const filteredTreeFiles = (repoTreeMeta?.files || []).filter(
    (f) => !treeFilter.trim() || f.path.toLowerCase().includes(treeFilter.toLowerCase())
  );
  const selectedCount = Object.values(selectedPaths).filter(Boolean).length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="ingest-modal-title"
    >
      <div className="w-full max-w-3xl bg-[#131C2E] border border-slate-800 rounded-xl overflow-hidden flex flex-col max-h-[88vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800/80">
          <div>
            <h2 id="ingest-modal-title" className="text-base font-semibold text-slate-100">
              Connect Legacy Repository
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Import from a public GitHub URL, upload local source files, or initialize an enterprise sample.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-100 hover:bg-slate-800/70 transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Segmented Tab Controls + Target Stack */}
        <div className="flex flex-wrap items-center justify-between gap-4 px-6 py-3 bg-[#0B1120] border-b border-slate-800/80">
          <div className="flex items-center gap-1 p-1 bg-[#131C2E] border border-slate-800 rounded-lg">
            <button
              type="button"
              onClick={() => {
                setActiveTab('github');
                setErrorMsg(null);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'github'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-slate-100'
              }`}
            >
              <FolderGit2 className="w-3.5 h-3.5" />
              Public GitHub URL
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('upload');
                setErrorMsg(null);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'upload'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-slate-100'
              }`}
            >
              <Upload className="w-3.5 h-3.5" />
              Upload or Paste
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('samples');
                setErrorMsg(null);
              }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'samples'
                  ? 'bg-sky-500 text-slate-950 font-semibold'
                  : 'text-slate-300 hover:text-slate-100'
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              Enterprise Samples
            </button>
          </div>

          {activeTab !== 'samples' && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 whitespace-nowrap">Target Stack:</span>
              <div className="flex items-center gap-1 p-1 bg-[#131C2E] border border-slate-800 rounded-lg">
                {(['Rust', 'Node.js', 'React'] as TargetFramework[]).map((fw) => (
                  <button
                    key={fw}
                    type="button"
                    onClick={() => setTargetFramework(fw)}
                    className={`px-2.5 py-1 text-xs font-medium rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      targetFramework === fw
                        ? 'bg-slate-700 text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {fw}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Body */}
        <div className="p-6 overflow-y-auto space-y-5 flex-1">
          {errorMsg && (
            <div className="flex items-start gap-2.5 p-3.5 rounded-lg bg-red-950/40 border border-red-800/60 text-xs text-red-200">
              <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {activeTab === 'github' && (
            <div className="space-y-4">
              <form onSubmit={handleFetchGitHubTree} className="space-y-2.5">
                <label htmlFor="gh-repo-url" className="block text-xs font-medium text-slate-300">
                  Public Repository URL
                </label>
                <div className="flex gap-2">
                  <input
                    id="gh-repo-url"
                    type="text"
                    value={repoUrl}
                    onChange={(e) => setRepoUrl(e.target.value)}
                    placeholder="https://github.com/openmainframeproject/cobol-programming-course"
                    className="flex-1 bg-[#0B1120] border border-slate-800 rounded-lg px-3.5 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                  />
                  <button
                    type="submit"
                    disabled={isBusy}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    {isBusy && !repoTreeMeta ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Fetch Repository Tree
                  </button>
                </div>
              </form>

              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                <span>Quick test repositories:</span>
                {GITHUB_EXAMPLE_REPOS.map((ex) => (
                  <button
                    key={ex.url}
                    type="button"
                    onClick={() => {
                      setRepoUrl(ex.url);
                      setTargetFramework(ex.target);
                    }}
                    className="text-sky-400 hover:text-sky-300 underline underline-offset-2 cursor-pointer whitespace-nowrap"
                  >
                    {ex.label}
                  </button>
                ))}
              </div>

              {repoTreeMeta && (
                <div className="border border-slate-800 rounded-lg bg-[#0B1120] overflow-hidden">
                  <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-b border-slate-800">
                    <div className="text-xs text-slate-300">
                      <span className="font-semibold text-slate-100">{repoTreeMeta.fullName}</span>
                      <span className="mx-1.5 text-slate-600">·</span>
                      <span>Branch {repoTreeMeta.branch}</span>
                      <span className="mx-1.5 text-slate-600">·</span>
                      <span className="tabular-nums">{selectedCount} selected (max 12)</span>
                    </div>
                    <input
                      type="text"
                      value={treeFilter}
                      onChange={(e) => setTreeFilter(e.target.value)}
                      placeholder="Filter file path..."
                      className="bg-[#131C2E] border border-slate-800 rounded px-2.5 py-1 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                    />
                  </div>

                  {filteredTreeFiles.length === 0 ? (
                    <p className="p-6 text-center text-xs text-slate-400">
                      No matching source files under 120 KB found in this branch.
                    </p>
                  ) : (
                    <div className="max-h-60 overflow-y-auto divide-y divide-slate-800/70">
                      {filteredTreeFiles.map((file) => {
                        const checked = !!selectedPaths[file.path];
                        return (
                          <label
                            key={file.path}
                            className="flex items-center justify-between gap-3 px-4 py-2 hover:bg-slate-800/30 cursor-pointer text-xs"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) => {
                                  const next = e.target.checked;
                                  if (next && selectedCount >= 12) return;
                                  setSelectedPaths((prev) => ({
                                    ...prev,
                                    [file.path]: next,
                                  }));
                                }}
                                className="rounded border-slate-700 bg-slate-900 text-sky-500 focus:ring-sky-400"
                              />
                              <span className="font-mono text-slate-200 truncate">{file.path}</span>
                            </div>
                            <span className="text-slate-400 font-mono tabular-nums whitespace-nowrap shrink-0">
                              {file.detectedLanguage} · {(file.size / 1024).toFixed(1)} KB
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {repoTreeMeta && (
                <div className="flex justify-end pt-1">
                  <button
                    type="button"
                    disabled={isBusy || selectedCount === 0}
                    onClick={handleConfirmGitHubImport}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap shrink-0"
                  >
                    {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                    Import {selectedCount} Selected Module{selectedCount === 1 ? '' : 's'}
                  </button>
                </div>
              )}
            </div>
          )}

          {activeTab === 'upload' && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label htmlFor="upload-proj-name" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Project Name
                  </label>
                  <input
                    id="upload-proj-name"
                    type="text"
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    className="w-full bg-[#0B1120] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-400"
                  />
                </div>
                <div>
                  <label htmlFor="upload-src-lang" className="block text-xs font-medium text-slate-300 mb-1.5">
                    Default Legacy Language
                  </label>
                  <select
                    id="upload-src-lang"
                    value={sourceLang}
                    onChange={(e) => setSourceLang(e.target.value as SourceLanguage)}
                    className="w-full bg-[#0B1120] border border-slate-800 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-sky-400"
                  >
                    <option value="COBOL">COBOL</option>
                    <option value="Java 8">Java 8</option>
                    <option value="PHP">PHP</option>
                    <option value="Mixed">Mixed Legacy</option>
                  </select>
                </div>
              </div>

              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => {
                  e.preventDefault();
                  void handleFileInputChange(e.dataTransfer.files);
                }}
                className="border border-dashed border-slate-700 rounded-lg bg-[#0B1120] p-5 text-center space-y-2"
              >
                <FileCode2 className="w-6 h-6 text-slate-400 mx-auto" />
                <p className="text-xs text-slate-300">
                  Drag and drop legacy source files (`.cbl`, `.cob`, `.java`, `.php`, `.sql`, `.xml`)
                </p>
                <div>
                  <input
                    ref={fileInputRef}
                    type="file"
                    multiple
                    accept=".cbl,.cob,.cpy,.jcl,.java,.jsp,.php,.phtml,.inc,.sql,.xml,.py,.rb,.cs,.c,.cpp,.js,.ts,.txt"
                    onChange={(e) => void handleFileInputChange(e.target.files)}
                    className="hidden"
                  />
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="px-3.5 py-1.5 text-xs font-medium bg-[#131C2E] border border-slate-700 rounded-lg text-slate-200 hover:border-slate-500 transition-colors cursor-pointer"
                  >
                    Browse Local Files
                  </button>
                </div>
              </div>

              {uploadedFiles.length > 0 && (
                <div className="border border-slate-800 rounded-lg bg-[#0B1120] divide-y divide-slate-800/80">
                  {uploadedFiles.map((f, idx) => (
                    <div key={`${f.filePath}-${idx}`} className="flex items-center justify-between px-4 py-2 text-xs">
                      <span className="font-mono text-slate-200 truncate">{f.filePath}</span>
                      <div className="flex items-center gap-3 shrink-0">
                        <span className="text-slate-400 tabular-nums">
                          {f.sourceLanguage} · {f.legacyCode.split('\n').length} lines
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setUploadedFiles((prev) => prev.filter((_, i) => i !== idx))
                          }
                          className="text-red-400 hover:text-red-300 cursor-pointer"
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="space-y-2 pt-1 border-t border-slate-800/80">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="paste-code-area" className="text-xs font-medium text-slate-300">
                    Or Paste Legacy Source Module Directly
                  </label>
                  <input
                    type="text"
                    value={pasteFileName}
                    onChange={(e) => setPasteFileName(e.target.value)}
                    placeholder="Module filename (e.g. LEDGER.cbl)"
                    className="bg-[#0B1120] border border-slate-800 rounded px-2.5 py-1 text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-400"
                  />
                </div>
                <textarea
                  id="paste-code-area"
                  rows={5}
                  value={pasteContent}
                  onChange={(e) => setPasteContent(e.target.value)}
                  placeholder="Paste COBOL, Java 8, or PHP source code here..."
                  className="w-full bg-[#0B1120] border border-slate-800 rounded-lg p-3 text-xs font-mono text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
                />
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={handleAddPastedSnippet}
                    className="px-3 py-1.5 text-xs font-medium bg-[#0B1120] border border-slate-700 text-slate-200 rounded-lg hover:border-slate-500 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Stage Pasted Module
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void handleConfirmUploadImport()}
                    className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
                  >
                    {isBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                    Create Modernization Project
                  </button>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'samples' && (
            <div className="space-y-3">
              {ENTERPRISE_LEGACY_SAMPLES.map((sample) => {
                const vulnTotal = sample.modules.reduce(
                  (acc, m) => acc + m.vulnerabilities.length,
                  0
                );
                return (
                  <div
                    key={sample.key}
                    className="p-4 rounded-lg bg-[#0B1120] border border-slate-800 hover:border-slate-700 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="space-y-1">
                      <div className="text-xs text-slate-400">
                        <span>{sample.sourceLanguage}</span>
                        <span className="mx-1.5">·</span>
                        <span>Target {sample.targetFramework}</span>
                        <span className="mx-1.5">·</span>
                        <span>{sample.era}</span>
                      </div>
                      <h3 className="text-sm font-semibold text-slate-100">{sample.name}</h3>
                      <p className="text-xs text-slate-400 leading-relaxed max-w-xl">
                        {sample.description}
                      </p>
                      <div className="text-[11px] font-mono text-slate-400 tabular-nums pt-1">
                        {sample.modules.length} modules · {vulnTotal} documented CWE exploits + 1 unrefactored module ready for live run
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={async () => {
                        setIsBusy(true);
                        try {
                          await onSelectSample(sample);
                          onClose();
                        } finally {
                          setIsBusy(false);
                        }
                      }}
                      className="px-4 py-2 text-xs font-semibold bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                    >
                      Load Sample
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

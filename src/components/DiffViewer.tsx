import React, { useMemo, useState } from 'react';
import {
  Play,
  Copy,
  Check,
  Loader2,
  Zap,
  Cpu,
  Edit3,
  Save,
  AlertTriangle,
} from 'lucide-react';
import type {
  CodeModuleRecord,
  ModelTier,
  TargetFramework,
  TriageResult,
  VulnerabilityRecord,
} from '../types';

interface DiffViewerProps {
  module: CodeModuleRecord;
  vulnerabilities: VulnerabilityRecord[];
  isRefactoring: boolean;
  refactorError: { message: string; canRetryWithFlash?: boolean } | null;
  onRunRefactor: (options: {
    targetFramework: TargetFramework;
    modelTier: ModelTier;
    highThinking: boolean;
    customInstructions: string;
  }) => Promise<void>;
  onUpdateLegacyCode: (nextCode: string) => Promise<void>;
}

function parseHighlightedLines(vulns: VulnerabilityRecord[]): Set<number> {
  const highlighted = new Set<number>();
  for (const v of vulns) {
    if (v.resolutionStatus === 'remediated') continue;
    const nums = v.lineRange.match(/\d+/g);
    if (!nums || nums.length === 0) continue;
    if (nums.length === 1) {
      highlighted.add(Number(nums[0]));
    } else {
      const start = Math.min(Number(nums[0]), Number(nums[1]));
      const end = Math.max(Number(nums[0]), Number(nums[1]));
      for (let line = start; line <= Math.min(end, start + 60); line++) {
        highlighted.add(line);
      }
    }
  }
  return highlighted;
}

export const DiffViewer: React.FC<DiffViewerProps> = ({
  module,
  vulnerabilities,
  isRefactoring,
  refactorError,
  onRunRefactor,
  onUpdateLegacyCode,
}) => {
  const [selectedFramework, setSelectedFramework] = useState<TargetFramework>(
    module.targetFramework
  );
  const [selectedModel, setSelectedModel] = useState<ModelTier>('gemini-4-argon');
  const [highThinking, setHighThinking] = useState<boolean>(true);
  const [customInstructions, setCustomInstructions] = useState<string>('');
  const [copiedSide, setCopiedSide] = useState<'legacy' | 'modern' | null>(null);

  const [isEditingSource, setIsEditingSource] = useState(false);
  const [draftSource, setDraftSource] = useState(module.legacyCode);

  const [triageLoading, setTriageLoading] = useState(false);
  const [triageData, setTriageData] = useState<TriageResult | null>(null);

  // Sync local framework/source when switching modules
  React.useEffect(() => {
    setSelectedFramework(module.targetFramework);
    setDraftSource(module.legacyCode);
    setIsEditingSource(false);
    setTriageData(null);
  }, [module.id, module.targetFramework, module.legacyCode]);

  const legacyLines = useMemo(() => module.legacyCode.split('\n'), [module.legacyCode]);
  const modernLines = useMemo(
    () => (module.modernizedCode ? module.modernizedCode.split('\n') : []),
    [module.modernizedCode]
  );
  const vulnerableLineNumbers = useMemo(
    () => parseHighlightedLines(vulnerabilities),
    [vulnerabilities]
  );

  async function handleCopy(text: string, side: 'legacy' | 'modern') {
    await navigator.clipboard.writeText(text);
    setCopiedSide(side);
    setTimeout(() => setCopiedSide(null), 1600);
  }

  async function handleQuickTriage() {
    setTriageLoading(true);
    try {
      const resp = await fetch('/api/refactor/triage', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filePath: module.filePath,
          legacyCode: module.legacyCode,
          targetFramework: selectedFramework,
        }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setTriageData(data as TriageResult);
      }
    } finally {
      setTriageLoading(false);
    }
  }

  async function handleSaveEditedSource() {
    if (!draftSource.trim()) return;
    await onUpdateLegacyCode(draftSource);
    setIsEditingSource(false);
  }

  return (
    <div className="space-y-4">
      {/* Refactoring Execution Control Bar */}
      <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            {/* Target Framework Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400 whitespace-nowrap">Target:</span>
              <div className="flex items-center gap-1 p-0.5 bg-[#0B1120] border border-slate-800 rounded-lg">
                {(['Rust', 'Node.js', 'React'] as TargetFramework[]).map((fw) => (
                  <button
                    key={fw}
                    type="button"
                    onClick={() => setSelectedFramework(fw)}
                    className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                      selectedFramework === fw
                        ? 'bg-slate-800 text-slate-100'
                        : 'text-slate-400 hover:text-slate-200'
                    }`}
                  >
                    {fw}
                  </button>
                ))}
              </div>
            </div>

            {/* Model & High Thinking Selector */}
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-slate-400 whitespace-nowrap">Engine:</span>
              <select
                aria-label="Refactoring Gemini Model"
                value={highThinking ? 'argon-high' : selectedModel}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === 'argon-high') {
                    setSelectedModel('gemini-4-argon');
                    setHighThinking(true);
                  } else {
                    setSelectedModel(val as ModelTier);
                    setHighThinking(false);
                  }
                }}
                className="bg-[#0B1120] border border-slate-800 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-200 focus:outline-none focus:border-sky-400"
              >
                <option value="argon-high">Gemini 4 Argon · High Thinking</option>
                <option value="gemini-3.8-flash">Gemini 3.8 Flash · Balanced</option>
                <option value="gemini-3.1-flash-lite">Gemini 3.1 Flash Lite · Fast</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={triageLoading || isRefactoring}
              onClick={() => void handleQuickTriage()}
              className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-[#0B1120] border border-slate-800 text-slate-300 rounded-lg hover:border-slate-700 hover:text-slate-100 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {triageLoading ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin text-sky-400" />
              ) : (
                <Zap className="w-3.5 h-3.5 text-sky-400" />
              )}
              Fast Triage
            </button>

            <button
              type="button"
              disabled={isRefactoring}
              onClick={() =>
                void onRunRefactor({
                  targetFramework: selectedFramework,
                  modelTier: selectedModel,
                  highThinking,
                  customInstructions,
                })
              }
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400 disabled:opacity-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              {isRefactoring ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : highThinking ? (
                <Cpu className="w-3.5 h-3.5" />
              ) : (
                <Play className="w-3.5 h-3.5" />
              )}
              {isRefactoring
                ? 'Refactoring & Auditing...'
                : module.modernizedCode
                  ? 'Re-Run Autonomous Refactor'
                  : 'Refactor Module Now'}
            </button>
          </div>
        </div>

        {/* Optional Custom Directive Input */}
        <div className="pt-1">
          <input
            type="text"
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
            placeholder="Optional directive (e.g., 'Use rust_decimal for currency math and enforce zero unsafe blocks')..."
            className="w-full bg-[#0B1120] border border-slate-800 rounded-lg px-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
          />
        </div>

        {/* Rapid Triage Output */}
        {triageData && (
          <div className="pt-2 border-t border-slate-800/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
            <div className="text-slate-300">
              <span className="font-medium text-sky-300">Fast Triage (Gemini 3.1 Flash Lite):</span>{' '}
              <span>{triageData.detectedDialect}</span>
              <span className="mx-1.5 text-slate-600">·</span>
              <span>Complexity: {triageData.complexityLevel}</span>
              <span className="mx-1.5 text-slate-600">·</span>
              <span className="font-mono text-slate-400">{triageData.recommendedTargetFile}</span>
            </div>
            <div className="text-slate-400 truncate">
              Hotspots: {triageData.riskHotspots.join(' / ')}
            </div>
          </div>
        )}

        {/* Error & One-Click Fallback Banner */}
        {refactorError && (
          <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/60 flex flex-wrap items-center justify-between gap-3 text-xs text-red-200">
            <div className="flex items-start gap-2 max-w-2xl">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{refactorError.message}</span>
            </div>
            {refactorError.canRetryWithFlash && (
              <button
                type="button"
                disabled={isRefactoring}
                onClick={() => {
                  setSelectedModel('gemini-3.8-flash');
                  setHighThinking(false);
                  void onRunRefactor({
                    targetFramework: selectedFramework,
                    modelTier: 'gemini-3.8-flash',
                    highThinking: false,
                    customInstructions,
                  });
                }}
                className="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-950 rounded-md hover:bg-white transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                Retry with Gemini 3.8 Flash
              </button>
            )}
          </div>
        )}
      </div>

      {/* Architectural Summary Strip */}
      {module.summary && (
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-4 space-y-2">
          <div className="text-xs text-slate-400">
            <span className="font-semibold text-slate-200">Architectural Refactoring Summary</span>
            <span className="mx-1.5">·</span>
            <span className="font-mono tabular-nums">
              {legacyLines.length} legacy lines → {modernLines.length} modern lines
            </span>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">{module.summary}</p>
          {module.refactoringNotes.length > 0 && (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1.5 pt-2 border-t border-slate-800/70 text-xs text-slate-400">
              {module.refactoringNotes.map((note, idx) => (
                <li key={idx} className="leading-relaxed">
                  <span className="font-mono text-slate-500 mr-1.5 tabular-nums">
                    {String(idx + 1).padStart(2, '0')}.
                  </span>
                  {note}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Side-by-Side Split Diff Panes */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 items-stretch">
        {/* Left Pane: Legacy Source */}
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-800 bg-[#0F172A]">
            <div className="min-w-0 text-xs">
              <span className="font-mono text-slate-200 font-medium truncate">
                {module.filePath}
              </span>
              <span className="mx-1.5 text-slate-600">·</span>
              <span className="text-slate-400">{module.sourceLanguage} Legacy</span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {isEditingSource ? (
                <button
                  type="button"
                  onClick={() => void handleSaveEditedSource()}
                  className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-sky-500 text-slate-950 rounded hover:bg-sky-400 cursor-pointer whitespace-nowrap"
                >
                  <Save className="w-3 h-3" />
                  Save Source
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setIsEditingSource(true)}
                  className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800/70 cursor-pointer whitespace-nowrap"
                >
                  <Edit3 className="w-3 h-3" />
                  Edit
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleCopy(module.legacyCode, 'legacy')}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800/70 cursor-pointer whitespace-nowrap"
              >
                {copiedSide === 'legacy' ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                {copiedSide === 'legacy' ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>

          {isEditingSource ? (
            <textarea
              value={draftSource}
              onChange={(e) => setDraftSource(e.target.value)}
              rows={24}
              className="w-full flex-1 bg-[#0B1120] p-4 font-mono text-xs text-slate-200 leading-5 focus:outline-none resize-y"
            />
          ) : (
            <div className="overflow-x-auto overflow-y-auto max-h-[560px] bg-[#0B1120] py-2">
              <table className="w-full border-collapse font-mono text-xs leading-5">
                <tbody>
                  {legacyLines.map((line, index) => {
                    const lineNum = index + 1;
                    const isVulnerable = vulnerableLineNumbers.has(lineNum);
                    return (
                      <tr
                        key={lineNum}
                        className={
                          isVulnerable
                            ? 'bg-red-950/35 hover:bg-red-950/50'
                            : 'hover:bg-slate-800/30'
                        }
                      >
                        <td className="select-none text-right pr-3 pl-3 w-12 text-slate-600 tabular-nums align-top">
                          {lineNum}
                        </td>
                        <td className="pr-4 whitespace-pre text-slate-300">
                          {line || ' '}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Right Pane: Modernized Output */}
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl overflow-hidden flex flex-col">
          <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-800 bg-[#0F172A]">
            <div className="min-w-0 text-xs">
              <span className="font-mono text-slate-200 font-medium truncate">
                {module.modernizedFilePath || `Pending ${selectedFramework} Output`}
              </span>
              <span className="mx-1.5 text-slate-600">·</span>
              <span className="text-sky-400">{module.targetFramework} Modernized</span>
            </div>
            {module.modernizedCode && (
              <button
                type="button"
                onClick={() => void handleCopy(module.modernizedCode, 'modern')}
                className="inline-flex items-center gap-1 px-2 py-1 text-xs text-slate-400 hover:text-slate-200 rounded hover:bg-slate-800/70 cursor-pointer whitespace-nowrap shrink-0"
              >
                {copiedSide === 'modern' ? (
                  <Check className="w-3 h-3 text-emerald-400" />
                ) : (
                  <Copy className="w-3 h-3" />
                )}
                {copiedSide === 'modern' ? 'Copied' : 'Copy'}
              </button>
            )}
          </div>

          {isRefactoring ? (
            <div className="flex-1 bg-[#0B1120] p-6 space-y-3 min-h-[360px]">
              <div className="flex items-center gap-2.5 text-xs text-sky-300 pb-2">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>
                  {highThinking
                    ? 'Gemini 4 Argon (High Thinking) is translating control flow, auditing CWEs, and synthesizing unit tests...'
                    : `Refactoring legacy module with ${selectedModel}...`}
                </span>
              </div>
              {Array.from({ length: 12 }).map((_, i) => (
                <div
                  key={i}
                  className="h-4 rounded bg-slate-800/50 animate-pulse"
                  style={{ width: `${55 + ((i * 19) % 40)}%` }}
                />
              ))}
            </div>
          ) : module.modernizedCode ? (
            <div className="overflow-x-auto overflow-y-auto max-h-[560px] bg-[#0B1120] py-2">
              <table className="w-full border-collapse font-mono text-xs leading-5">
                <tbody>
                  {modernLines.map((line, index) => (
                    <tr key={index + 1} className="hover:bg-emerald-950/20">
                      <td className="select-none text-right pr-3 pl-3 w-12 text-slate-600 tabular-nums align-top">
                        {index + 1}
                      </td>
                      <td className="pr-4 whitespace-pre text-slate-100">{line || ' '}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="flex-1 bg-[#0B1120] p-8 flex flex-col items-center justify-center text-center min-h-[360px] space-y-3">
              <p className="text-sm font-medium text-slate-200">
                Module Ready for Autonomous Modernization
              </p>
              <p className="text-xs text-slate-400 max-w-sm leading-relaxed">
                Run the refactoring pipeline to generate idiomatic {selectedFramework} code, executable unit tests, and a line-referenced CWE exploit report.
              </p>
              <button
                type="button"
                onClick={() =>
                  void onRunRefactor({
                    targetFramework: selectedFramework,
                    modelTier: selectedModel,
                    highThinking,
                    customInstructions,
                  })
                }
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400 transition-colors cursor-pointer whitespace-nowrap"
              >
                <Play className="w-3.5 h-3.5" />
                Refactor Into {selectedFramework}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

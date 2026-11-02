import React, { useMemo, useState } from 'react';
import {
  Check,
  Copy,
  Download,
  FlaskConical,
  MessageSquare,
  Play,
} from 'lucide-react';
import type { CodeModuleRecord } from '../types';

interface UnitTestsViewProps {
  module: CodeModuleRecord;
  isRefactoring: boolean;
  onTriggerRefactor: () => void;
  onExpandTestsInChat: () => void;
}

function countTestCases(code: string): number {
  if (!code.trim()) return 0;
  const rustMatches = code.match(/#\[test\]/g)?.length ?? 0;
  const jsMatches = code.match(/\b(it|test)\s*\(/g)?.length ?? 0;
  return Math.max(rustMatches + jsMatches, code.trim() ? 1 : 0);
}

export const UnitTestsView: React.FC<UnitTestsViewProps> = ({
  module,
  isRefactoring,
  onTriggerRefactor,
  onExpandTestsInChat,
}) => {
  const [copied, setCopied] = useState(false);

  const lines = useMemo(
    () => (module.unitTestCode ? module.unitTestCode.split('\n') : []),
    [module.unitTestCode]
  );
  const testCount = useMemo(() => countTestCases(module.unitTestCode), [module.unitTestCode]);

  const runnerName =
    module.targetFramework === 'Rust'
      ? 'Cargo Test (#[cfg(test)])'
      : module.targetFramework === 'React'
        ? 'Vitest + React Testing Library'
        : 'Node.js Native Test Runner';

  async function handleCopy() {
    if (!module.unitTestCode) return;
    await navigator.clipboard.writeText(module.unitTestCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  function handleDownloadFile() {
    if (!module.unitTestCode) return;
    const filename =
      module.unitTestFilePath.split('/').pop() ||
      `${module.filePath.replace(/[^a-zA-Z0-9_-]/g, '_')}.test.ts`;
    const blob = new Blob([module.unitTestCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  if (!module.unitTestCode) {
    return (
      <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-10 text-center space-y-3">
        <FlaskConical className="w-7 h-7 text-sky-400 mx-auto" />
        <h3 className="text-sm font-semibold text-slate-100">
          No Unit Test Suite Generated Yet
        </h3>
        <p className="text-xs text-slate-400 max-w-md mx-auto leading-relaxed">
          Refactor <span className="font-mono text-slate-200">{module.filePath}</span> to automatically synthesize executable {runnerName} unit and security-regression tests.
        </p>
        <div>
          <button
            type="button"
            disabled={isRefactoring}
            onClick={onTriggerRefactor}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400 disabled:opacity-50 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Play className="w-3.5 h-3.5" />
            {isRefactoring ? 'Generating Tests...' : 'Refactor & Synthesize Unit Tests'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Metadata Bar */}
      <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-0.5">
          <div className="text-xs text-slate-400">
            <span>{runnerName}</span>
            <span className="mx-1.5">·</span>
            <span className="font-mono tabular-nums">{testCount} test cases</span>
            <span className="mx-1.5">·</span>
            <span className="font-mono tabular-nums">{lines.length} lines</span>
          </div>
          <h3 className="text-sm font-mono font-semibold text-slate-100">
            {module.unitTestFilePath || 'tests/modernized_suite.test'}
          </h3>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onExpandTestsInChat}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#0B1120] border border-slate-800 rounded-lg text-slate-300 hover:text-slate-100 hover:border-slate-700 transition-colors cursor-pointer whitespace-nowrap"
          >
            <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
            Expand Edge Cases in Chat
          </button>

          <button
            type="button"
            onClick={() => void handleCopy()}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#0B1120] border border-slate-800 rounded-lg text-slate-300 hover:text-slate-100 hover:border-slate-700 transition-colors cursor-pointer whitespace-nowrap"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            {copied ? 'Copied' : 'Copy Suite'}
          </button>

          <button
            type="button"
            onClick={handleDownloadFile}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-sky-500 text-slate-950 font-semibold rounded-lg hover:bg-sky-400 transition-colors cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" />
            Download Test File
          </button>
        </div>
      </div>

      {/* Line-Numbered Unit Test Code Pane */}
      <div className="bg-[#131C2E] border border-slate-800 rounded-xl overflow-hidden">
        <div className="overflow-x-auto overflow-y-auto max-h-[600px] bg-[#0B1120] py-3">
          <table className="w-full border-collapse font-mono text-xs leading-5">
            <tbody>
              {lines.map((line, idx) => (
                <tr key={idx + 1} className="hover:bg-slate-800/30">
                  <td className="select-none text-right pr-3 pl-3 w-12 text-slate-600 tabular-nums align-top">
                    {idx + 1}
                  </td>
                  <td className="pr-4 whitespace-pre text-slate-200">{line || ' '}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

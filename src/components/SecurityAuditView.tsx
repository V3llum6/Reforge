import React, { useMemo, useState } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Search,
  MessageSquare,
  CheckCircle2,
} from 'lucide-react';
import type { SeverityLevel, VulnerabilityRecord } from '../types';

interface SecurityAuditViewProps {
  vulnerabilities: VulnerabilityRecord[];
  scopeLabel: string;
  onMarkRemediated: (vulnId: string) => Promise<void>;
  onAskSecurityAssistant: (vuln: VulnerabilityRecord) => void;
  onJumpToModule?: (moduleId: string) => void;
}

export const SecurityAuditView: React.FC<SecurityAuditViewProps> = ({
  vulnerabilities,
  scopeLabel,
  onMarkRemediated,
  onAskSecurityAssistant,
  onJumpToModule,
}) => {
  const [severityFilter, setSeverityFilter] = useState<'All' | SeverityLevel>('All');
  const [searchQuery, setSearchQuery] = useState('');

  const counts = useMemo(() => {
    return {
      total: vulnerabilities.length,
      critical: vulnerabilities.filter((v) => v.severity === 'Critical').length,
      high: vulnerabilities.filter((v) => v.severity === 'High').length,
      remediated: vulnerabilities.filter((v) => v.resolutionStatus === 'remediated').length,
    };
  }, [vulnerabilities]);

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return vulnerabilities.filter((v) => {
      if (severityFilter !== 'All' && v.severity !== severityFilter) return false;
      if (!q) return true;
      return (
        v.cwe.toLowerCase().includes(q) ||
        v.title.toLowerCase().includes(q) ||
        v.filePath.toLowerCase().includes(q) ||
        v.description.toLowerCase().includes(q)
      );
    });
  }, [vulnerabilities, severityFilter, searchQuery]);

  function renderSeverityIndicator(severity: SeverityLevel) {
    if (severity === 'Critical') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-red-400 whitespace-nowrap">
          <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
          Critical Severity
        </span>
      );
    }
    if (severity === 'High') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-amber-400 whitespace-nowrap">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          High Severity
        </span>
      );
    }
    if (severity === 'Medium') {
      return (
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-amber-200 whitespace-nowrap">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          Medium Severity
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-300 whitespace-nowrap">
        Low Severity
      </span>
    );
  }

  return (
    <div className="space-y-4">
      {/* Quantitative Summary Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 bg-[#131C2E] border border-slate-800 rounded-xl divide-y md:divide-y-0 md:divide-x divide-slate-800">
        <div className="p-4">
          <p className="text-xs text-slate-400">Audited Findings ({scopeLabel})</p>
          <p className="text-2xl font-display font-bold text-slate-100 tabular-nums mt-1">
            {counts.total}
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs text-slate-400">Critical Exploits</p>
          <p className="text-2xl font-display font-bold text-red-400 tabular-nums mt-1">
            {counts.critical}
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs text-slate-400">High Risk Vectors</p>
          <p className="text-2xl font-display font-bold text-amber-400 tabular-nums mt-1">
            {counts.high}
          </p>
        </div>
        <div className="p-4">
          <p className="text-xs text-slate-400">Verified Remediated</p>
          <p className="text-2xl font-display font-bold text-emerald-400 tabular-nums mt-1">
            {counts.remediated} / {counts.total}
          </p>
        </div>
      </div>

      {/* Filter & Search Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-[#131C2E] border border-slate-800 rounded-xl px-4 py-3">
        <div className="flex items-center gap-1 p-1 bg-[#0B1120] border border-slate-800 rounded-lg">
          {(['All', 'Critical', 'High', 'Medium', 'Low'] as const).map((sev) => (
            <button
              key={sev}
              type="button"
              onClick={() => setSeverityFilter(sev)}
              className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                severityFilter === sev
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {sev}
            </button>
          ))}
        </div>

        <div className="relative flex-1 max-w-xs min-w-[200px]">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by CWE, file, or vector..."
            className="w-full bg-[#0B1120] border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-sky-400"
          />
        </div>
      </div>

      {/* Findings List */}
      {filtered.length === 0 ? (
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl p-10 text-center space-y-2">
          <ShieldCheck className="w-7 h-7 text-emerald-400 mx-auto" />
          <p className="text-sm font-medium text-slate-200">
            {vulnerabilities.length === 0
              ? 'No security exploits detected yet for this scope.'
              : 'No vulnerabilities match the current filter.'}
          </p>
          <p className="text-xs text-slate-400">
            Run the autonomous refactoring engine on any draft module to perform a full CWE taint and exploit audit.
          </p>
        </div>
      ) : (
        <div className="bg-[#131C2E] border border-slate-800 rounded-xl divide-y divide-slate-800">
          {filtered.map((vuln) => {
            const isRemediated = vuln.resolutionStatus === 'remediated';
            return (
              <article key={vuln.id} className="p-5 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                      {renderSeverityIndicator(vuln.severity)}
                      <span>·</span>
                      <span className="font-mono text-slate-200">{vuln.cwe}</span>
                      <span>·</span>
                      {onJumpToModule ? (
                        <button
                          type="button"
                          onClick={() => onJumpToModule(vuln.moduleId)}
                          className="font-mono text-sky-400 hover:underline cursor-pointer"
                        >
                          {vuln.filePath}
                        </button>
                      ) : (
                        <span className="font-mono text-slate-300">{vuln.filePath}</span>
                      )}
                      <span>·</span>
                      <span className="font-mono tabular-nums">{vuln.lineRange}</span>
                    </div>
                    <h3 className="text-sm font-semibold text-slate-100">{vuln.title}</h3>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => onAskSecurityAssistant(vuln)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[#0B1120] border border-slate-800 rounded-lg text-slate-300 hover:text-slate-100 hover:border-slate-700 transition-colors cursor-pointer whitespace-nowrap"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-sky-400" />
                      Deep Dive in Chat
                    </button>

                    {isRemediated ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-emerald-400 whitespace-nowrap">
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Verified Remediated
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => void onMarkRemediated(vuln.id)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 rounded-lg hover:bg-emerald-500/25 transition-colors cursor-pointer whitespace-nowrap"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Mark Verified
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-1 text-xs leading-relaxed">
                  <div className="bg-[#0B1120] border border-slate-800/90 rounded-lg p-3.5 space-y-1">
                    <p className="font-medium text-slate-300">Legacy Exploit Vector</p>
                    <p className="text-slate-400">{vuln.description}</p>
                  </div>
                  <div className="bg-[#0B1120] border border-slate-800/90 rounded-lg p-3.5 space-y-1">
                    <p className="font-medium text-emerald-300">Modernized Remediation</p>
                    <p className="text-slate-400">{vuln.remediation}</p>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
};

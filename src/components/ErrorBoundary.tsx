import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
  details: string | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      message: '',
      details: null,
    };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    const raw = error instanceof Error ? error.message : String(error);
    try {
      const parsed = JSON.parse(raw) as {
        error?: string;
        operationType?: string;
        path?: string;
      };
      if (parsed && parsed.error && parsed.operationType) {
        return {
          hasError: true,
          message: `Database permission or validation error during ${parsed.operationType} on ${parsed.path || 'collection'}.`,
          details: parsed.error,
        };
      }
    } catch {
      // Standard non-JSON error
    }

    return {
      hasError: true,
      message: raw || 'An unexpected workspace error occurred.',
      details: null,
    };
  }

  override render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="min-h-screen bg-[#0B1120] text-slate-100 flex items-center justify-center p-6">
        <div className="max-w-lg w-full bg-[#131C2E] border border-slate-800 rounded-xl p-6 space-y-4">
          <div className="flex items-center gap-3 text-red-400">
            <AlertTriangle className="w-5 h-5 shrink-0" />
            <h1 className="text-base font-semibold text-slate-100">Workspace Recovery</h1>
          </div>
          <p className="text-sm text-slate-300 leading-relaxed">{this.state.message}</p>
          {this.state.details && (
            <pre className="text-xs font-mono text-slate-400 bg-[#0B1120] border border-slate-800 rounded-lg p-3 overflow-x-auto">
              {this.state.details}
            </pre>
          )}
          <div className="pt-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium bg-sky-500 text-slate-950 rounded-lg hover:bg-sky-400 transition-colors cursor-pointer whitespace-nowrap shrink-0"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              Reload Workspace
            </button>
          </div>
        </div>
      </div>
    );
  }
}

import React, { useEffect, useRef, useState } from 'react';
import {
  Send,
  Trash2,
  Cpu,
  Copy,
  Check,
  Loader2,
  PanelRightClose,
  AlertTriangle,
} from 'lucide-react';
import type {
  ChatMessageRecord,
  ChatPersona,
  CodeModuleRecord,
  ModelTier,
  ProjectRecord,
  VulnerabilityRecord,
} from '../types';

interface EngineeringChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  project: ProjectRecord | null;
  activeModule: CodeModuleRecord | null;
  vulnerabilities: VulnerabilityRecord[];
  messages: ChatMessageRecord[];
  externalDraftPrompt: {
    text: string;
    persona: ChatPersona;
    highThinking: boolean;
    nonce: number;
  } | null;
  onSendMessage: (params: {
    text: string;
    persona: ChatPersona;
    modelTier: ModelTier;
    highThinking: boolean;
  }) => Promise<void>;
  onClearHistory: () => Promise<void>;
  isStreaming: boolean;
  streamingText: string;
  chatError: {
    message: string;
    canRetryWithFlash?: boolean;
    lastText?: string;
    lastPersona?: ChatPersona;
  } | null;
}

function renderFormattedMessage(content: string) {
  const segments = content.split(/(```[\s\S]*?```)/g);
  return segments.map((segment, index) => {
    if (segment.startsWith('```') && segment.endsWith('```')) {
      const inner = segment.slice(3, -3);
      const newlineIdx = inner.indexOf('\n');
      const lang = newlineIdx >= 0 ? inner.slice(0, newlineIdx).trim() : '';
      const codeBody = newlineIdx >= 0 ? inner.slice(newlineIdx + 1) : inner;
      return <CodeFenceBlock key={index} language={lang} code={codeBody.trimEnd()} />;
    }

    if (!segment.trim()) return null;
    return (
      <div key={index} className="whitespace-pre-wrap leading-relaxed">
        {segment.trim()}
      </div>
    );
  });
}

const CodeFenceBlock: React.FC<{ language: string; code: string }> = ({ language, code }) => {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="my-2 rounded-lg border border-slate-800 bg-[#0B1120] overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-slate-800/80 bg-[#0F172A] text-[11px] text-slate-400">
        <span className="font-mono">{language || 'code'}</span>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="inline-flex items-center gap-1 hover:text-slate-200 cursor-pointer"
        >
          {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="p-3 text-xs font-mono text-slate-200 overflow-x-auto leading-5">
        {code}
      </pre>
    </div>
  );
};

export const EngineeringChatDrawer: React.FC<EngineeringChatDrawerProps> = ({
  isOpen,
  onClose,
  project,
  activeModule,
  vulnerabilities,
  messages,
  externalDraftPrompt,
  onSendMessage,
  onClearHistory,
  isStreaming,
  streamingText,
  chatError,
}) => {
  const [persona, setPersona] = useState<ChatPersona>('architect');
  const [modelTier, setModelTier] = useState<ModelTier>('gemini-3.8-flash');
  const [highThinking, setHighThinking] = useState<boolean>(false);
  const [inputValue, setInputValue] = useState('');
  const [confirmClear, setConfirmClear] = useState(false);

  const threadEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (externalDraftPrompt) {
      setInputValue(externalDraftPrompt.text);
      setPersona(externalDraftPrompt.persona);
      if (externalDraftPrompt.highThinking) {
        setHighThinking(true);
        setModelTier('gemini-4-argon');
      }
    }
  }, [externalDraftPrompt]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingText, isOpen]);

  if (!isOpen) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed || isStreaming) return;

    const effectiveModel: ModelTier = highThinking ? 'gemini-4-argon' : modelTier;
    setInputValue('');
    await onSendMessage({
      text: trimmed,
      persona,
      modelTier: effectiveModel,
      highThinking,
    });
  }

  const starterPrompts = [
    {
      label: 'Audit Fixed-Point & Edge Cases',
      persona: 'architect' as ChatPersona,
      high: true,
      prompt: activeModule
        ? `Analyze ${activeModule.filePath} for subtle numeric precision, state-machine, or concurrency edge cases during migration to ${activeModule.targetFramework}.`
        : 'What are the critical risks when refactoring legacy fixed-point arithmetic to modern frameworks?',
    },
    {
      label: 'Explain CWE Exploit Chain',
      persona: 'security' as ChatPersona,
      high: true,
      prompt:
        vulnerabilities.length > 0
          ? `Walk through how an attacker could chain ${vulnerabilities[0].cwe} (${vulnerabilities[0].title}) in ${vulnerabilities[0].filePath} and verify our defense-in-depth fix.`
          : 'Audit the active legacy module for injection, deserialization, or authentication bypass flaws.',
    },
    {
      label: 'Generate Boundary Tests',
      persona: 'testing' as ChatPersona,
      high: false,
      prompt: activeModule
        ? `Write 3 additional boundary and malformed-input unit tests for ${activeModule.modernizedFilePath || activeModule.filePath}.`
        : 'Suggest characterization tests to verify parity before decommissioning legacy code.',
    },
  ];

  return (
    <aside
      aria-label="Gemini Engineering Assistant"
      className="w-full lg:w-[400px] xl:w-[420px] shrink-0 border-l border-slate-800/80 bg-[#0F172A] flex flex-col h-full"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-800/80 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-100 truncate">
            Engineering Assistant
          </h2>
          <p className="text-[11px] text-slate-400 truncate">
            Context: {activeModule ? activeModule.filePath : project?.name || 'Workspace'}
          </p>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {messages.length > 0 && (
            confirmClear ? (
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={async () => {
                    await onClearHistory();
                    setConfirmClear(false);
                  }}
                  className="px-2 py-1 text-[11px] font-medium bg-red-500/20 text-red-300 rounded hover:bg-red-500/30 cursor-pointer whitespace-nowrap"
                >
                  Confirm Clear
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmClear(false)}
                  className="px-2 py-1 text-[11px] text-slate-400 hover:text-slate-200 cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmClear(true)}
                title="Clear conversation history"
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Collapse assistant panel"
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800/70 transition-colors cursor-pointer"
          >
            <PanelRightClose className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Role Persona & Model Controls */}
      <div className="px-4 py-2.5 border-b border-slate-800/80 bg-[#0B1120] space-y-2">
        {/* Role Persona Selector */}
        <div className="flex items-center gap-1 p-0.5 bg-[#131C2E] border border-slate-800 rounded-lg">
          {(
            [
              { id: 'architect', label: 'Architect' },
              { id: 'security', label: 'Security' },
              { id: 'testing', label: 'Testing' },
            ] as const
          ).map((roleItem) => (
            <button
              key={roleItem.id}
              type="button"
              onClick={() => setPersona(roleItem.id)}
              className={`flex-1 py-1 px-2 text-xs font-medium rounded-md transition-colors whitespace-nowrap cursor-pointer ${
                persona === roleItem.id
                  ? 'bg-slate-800 text-slate-100'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              {roleItem.label}
            </button>
          ))}
        </div>

        {/* Model Tier & High Thinking Toggle */}
        <div className="flex items-center justify-between gap-2">
          <select
            aria-label="Chat Gemini Model"
            value={highThinking ? 'gemini-4-argon' : modelTier}
            disabled={highThinking}
            onChange={(e) => {
              const next = e.target.value as ModelTier;
              setModelTier(next);
              if (next === 'gemini-4-argon') {
                setHighThinking(true);
              }
            }}
            className="flex-1 min-w-0 bg-[#131C2E] border border-slate-800 rounded-lg px-2.5 py-1 text-xs text-slate-200 disabled:opacity-75 focus:outline-none focus:border-sky-400"
          >
            <option value="gemini-4-argon">Complex · Gemini 4 Argon</option>
            <option value="gemini-3.8-flash">General · Gemini 3.8 Flash</option>
            <option value="gemini-3.1-flash-lite">Fast · Gemini 3.1 Flash Lite</option>
          </select>

          <button
            type="button"
            onClick={() => {
              const next = !highThinking;
              setHighThinking(next);
              if (next) {
                setModelTier('gemini-4-argon');
              } else if (modelTier === 'gemini-4-argon') {
                setModelTier('gemini-3.8-flash');
              }
            }}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
              highThinking
                ? 'bg-sky-500/20 border-sky-400 text-sky-300'
                : 'bg-[#131C2E] border-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            <Cpu className="w-3.5 h-3.5" />
            High Thinking
          </button>
        </div>
      </div>

      {/* Scrollable Multi-Turn Conversation Thread */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && !isStreaming ? (
          <div className="space-y-4 pt-2">
            <div className="space-y-1">
              <p className="text-xs font-semibold text-slate-200">
                Multi-Turn Codebase & Security Chat
              </p>
              <p className="text-xs text-slate-400 leading-relaxed">
                Ask architectural migration questions, inspect CWE exploit paths, or synthesize additional unit tests. Enable High Thinking for deep Gemini 4 Argon reasoning.
              </p>
            </div>

            <div className="space-y-2">
              {starterPrompts.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => {
                    setPersona(item.persona);
                    setHighThinking(item.high);
                    setModelTier(item.high ? 'gemini-4-argon' : 'gemini-3.8-flash');
                    void onSendMessage({
                      text: item.prompt,
                      persona: item.persona,
                      modelTier: item.high ? 'gemini-4-argon' : 'gemini-3.8-flash',
                      highThinking: item.high,
                    });
                  }}
                  className="w-full text-left p-3 rounded-lg bg-[#131C2E] border border-slate-800 hover:border-slate-700 transition-colors space-y-1 cursor-pointer"
                >
                  <div className="text-xs font-medium text-sky-300">{item.label}</div>
                  <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                    {item.prompt}
                  </p>
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((msg) => (
            <div
              key={msg.id}
              className={`space-y-1 ${msg.role === 'user' ? 'pl-6' : 'pr-2'}`}
            >
              <div className="flex items-center gap-1.5 text-[11px] text-slate-500">
                <span className="font-medium text-slate-400">
                  {msg.role === 'user'
                    ? 'You'
                    : msg.persona === 'security'
                      ? 'Security Auditor'
                      : msg.persona === 'testing'
                        ? 'Test Specialist'
                        : 'Migration Architect'}
                </span>
                {msg.role === 'model' && (
                  <>
                    <span>·</span>
                    <span className="font-mono">{msg.modelTier}</span>
                    {msg.highThinking && (
                      <>
                        <span>·</span>
                        <span className="text-sky-400">High Thinking</span>
                      </>
                    )}
                  </>
                )}
              </div>

              <div
                className={`rounded-xl p-3 text-xs space-y-2 ${
                  msg.role === 'user'
                    ? 'bg-sky-500/15 border border-sky-500/30 text-slate-100'
                    : 'bg-[#131C2E] border border-slate-800 text-slate-200'
                }`}
              >
                {renderFormattedMessage(msg.content)}
              </div>
            </div>
          ))
        )}

        {isStreaming && (
          <div className="space-y-1 pr-2">
            <div className="flex items-center gap-1.5 text-[11px] text-sky-400">
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>
                {highThinking
                  ? 'Gemini 4 Argon reasoning (ThinkingLevel.HIGH)...'
                  : `Streaming from ${modelTier}...`}
              </span>
            </div>
            <div className="rounded-xl p-3 text-xs bg-[#131C2E] border border-slate-800 text-slate-200 space-y-2">
              {streamingText ? (
                renderFormattedMessage(streamingText)
              ) : (
                <div className="h-4 w-32 bg-slate-800/70 rounded animate-pulse" />
              )}
            </div>
          </div>
        )}

        {chatError && (
          <div className="p-3 rounded-lg bg-red-950/40 border border-red-800/60 space-y-2 text-xs text-red-200">
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <span>{chatError.message}</span>
            </div>
            {chatError.canRetryWithFlash && chatError.lastText && (
              <button
                type="button"
                disabled={isStreaming}
                onClick={() => {
                  setHighThinking(false);
                  setModelTier('gemini-3.8-flash');
                  void onSendMessage({
                    text: chatError.lastText!,
                    persona: chatError.lastPersona || persona,
                    modelTier: 'gemini-3.8-flash',
                    highThinking: false,
                  });
                }}
                className="px-3 py-1.5 text-xs font-semibold bg-slate-100 text-slate-950 rounded-md hover:bg-white transition-colors cursor-pointer whitespace-nowrap"
              >
                Retry with Gemini 3.8 Flash
              </button>
            )}
          </div>
        )}

        <div ref={threadEndRef} />
      </div>

      {/* Composer */}
      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="p-3 border-t border-slate-800/80 bg-[#0B1120]"
      >
        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void handleSubmit(e);
              }
            }}
            placeholder={
              highThinking
                ? 'Ask a complex architecture or exploit question (High Thinking)...'
                : 'Ask about legacy code, unit tests, or CWEs...'
            }
            className="flex-1 bg-[#131C2E] border border-slate-800 rounded-lg px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-sky-400 resize-none"
          />
          <button
            type="submit"
            disabled={isStreaming || !inputValue.trim()}
            aria-label="Send message"
            className="p-2.5 rounded-lg bg-sky-500 text-slate-950 hover:bg-sky-400 disabled:opacity-40 transition-colors cursor-pointer shrink-0"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </aside>
  );
};

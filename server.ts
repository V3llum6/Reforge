import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer } from 'vite';
import {
  GenerateContentResponse,
  GoogleGenAI,
  ThinkingLevel,
  Type,
} from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function createGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

interface ParsedGeminiError {
  status: number;
  message: string;
  code: string;
  canRetryWithFlash: boolean;
}

function parseGeminiError(error: unknown, attemptedModel: string): ParsedGeminiError {
  const raw = error instanceof Error ? error.message : String(error);
  const lower = raw.toLowerCase();

  if (
    lower.includes('api_key_invalid') ||
    lower.includes('api key not valid') ||
    lower.includes('missing api key')
  ) {
    return {
      status: 400,
      code: 'API_KEY_INVALID',
      message:
        'Invalid or missing Gemini API key. Please check your attached key in the Settings > Secrets panel.',
      canRetryWithFlash: false,
    };
  }

  if (
    lower.includes('429') ||
    lower.includes('resource_exhausted') ||
    lower.includes('quota') ||
    lower.includes('billing') ||
    (attemptedModel === 'gemini-4-argon' &&
      (lower.includes('403') || lower.includes('permission_denied') || lower.includes('paid')))
  ) {
    return {
      status: 429,
      code: 'PAID_TIER_OR_QUOTA',
      message:
        attemptedModel === 'gemini-4-argon'
          ? 'Gemini 4 Argon High Thinking requires a billing-enabled API key for full quota. You can attach a paid-tier key in Settings > Secrets, or retry immediately with Gemini 3.8 Flash.'
          : 'API quota temporarily reached. Upgrading to a paid tier in Settings > Secrets increases quota.',
      canRetryWithFlash: attemptedModel === 'gemini-4-argon',
    };
  }

  if (lower.includes('403') || lower.includes('permission_denied')) {
    return {
      status: 403,
      code: 'PERMISSION_DENIED',
      message:
        'Permission denied by the Gemini API. Please verify your API key in the Settings > Secrets panel.',
      canRetryWithFlash: attemptedModel === 'gemini-4-argon',
    };
  }

  return {
    status: 500,
    code: 'GENERATION_ERROR',
    message: raw || 'Unexpected error while communicating with Gemini.',
    canRetryWithFlash: attemptedModel === 'gemini-4-argon',
  };
}

function parseGitHubRepoInput(input: string): { owner: string; repo: string; branchHint?: string; subPath?: string } | null {
  const trimmed = input.trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!trimmed) return null;

  // Match full URL: https://github.com/owner/repo(/tree/branch/subpath)
  const urlMatch = trimmed.match(
    /^https?:\/\/(?:www\.)?github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)(?:\/tree\/([^/]+)(?:\/(.*))?)?$/i
  );
  if (urlMatch) {
    return {
      owner: urlMatch[1],
      repo: urlMatch[2],
      branchHint: urlMatch[3],
      subPath: urlMatch[4],
    };
  }

  // Match shorthand: owner/repo
  const shortMatch = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shortMatch) {
    return {
      owner: shortMatch[1],
      repo: shortMatch[2],
    };
  }

  return null;
}

const SUPPORTED_EXTENSIONS = new Set([
  '.cbl',
  '.cob',
  '.cpy',
  '.jcl',
  '.java',
  '.jsp',
  '.php',
  '.phtml',
  '.inc',
  '.sql',
  '.xml',
  '.py',
  '.rb',
  '.cs',
  '.vb',
  '.c',
  '.cpp',
  '.h',
  '.js',
  '.ts',
]);

function detectSourceLanguageFromPath(filePath: string): 'COBOL' | 'Java 8' | 'PHP' | 'Mixed' {
  const ext = path.extname(filePath).toLowerCase();
  if (['.cbl', '.cob', '.cpy', '.jcl'].includes(ext)) return 'COBOL';
  if (['.java', '.jsp'].includes(ext)) return 'Java 8';
  if (['.php', '.phtml', '.inc'].includes(ext)) return 'PHP';
  return 'Mixed';
}

const PERSONA_INSTRUCTIONS: Record<string, string> = {
  architect: `You are the Principal Legacy Modernization Architect inside Reforge Studio.
Your specialty is systematically refactoring 15-to-30-year-old enterprise codebases (COBOL-85 mainframes, Java 6/7/8 monoliths, legacy PHP 5.x procedural code, and raw SQL) into clean, idiomatic modern architectures (React 19 + TypeScript, Rust with Axum/Tokio/rust_decimal, or Node.js + TypeScript).
Always preserve exact business and financial invariants (such as fixed-point COMP-3 decimal precision, batch settlement atomicity, and state transitions), explain structural design trade-offs concisely, and provide production-ready code snippets when asked.`,

  security: `You are the Principal Offensive & Defensive Application Security Auditor inside Reforge Studio.
Your specialty is uncovering exploitable vulnerabilities in legacy software (CWE-89 SQL Injection, CWE-78 Command Injection, CWE-502 Insecure Deserialization, CWE-79 XSS, CWE-190 Numeric/Buffer Overflow, CWE-798 Hardcoded Credentials, CWE-327 Broken Cryptography) and engineering defense-in-depth remediations in React, Rust, and Node.js.
Always cite specific CWE identifiers, explain concrete attack vectors against the legacy code, and show exact hardened replacement code.`,

  testing: `You are the Principal Verification & Test Automation Specialist inside Reforge Studio.
Your specialty is authoring deterministic unit, characterization, boundary, and security-regression test suites (Vitest/React Testing Library, Rust #[cfg(test)] Cargo suites, and Node.js test runner suites) that prove behavioral equivalence between legacy modules and their modernized replacements.
Focus on edge cases: rounding boundaries, null/empty records, malformed inputs, concurrency hazards, and exploit regression assertions.`,
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '4mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // 1. Fetch Public GitHub Repository Tree
  app.post('/api/github/tree', async (req, res) => {
    try {
      const { repoUrl } = req.body as { repoUrl?: string };
      if (!repoUrl || typeof repoUrl !== 'string') {
        res.status(400).json({ error: 'Please provide a valid public GitHub repository URL.' });
        return;
      }

      const parsed = parseGitHubRepoInput(repoUrl);
      if (!parsed) {
        res.status(400).json({
          error: 'Invalid GitHub URL format. Expected https://github.com/owner/repo or owner/repo.',
        });
        return;
      }

      const ghHeaders: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Reforge-Studio-Importer',
      };

      const metaResp = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`,
        { headers: ghHeaders }
      );

      if (!metaResp.ok) {
        if (metaResp.status === 404) {
          res.status(404).json({
            error: `Repository "${parsed.owner}/${parsed.repo}" was not found or is private.`,
          });
          return;
        }
        res.status(metaResp.status).json({
          error: `GitHub API returned status ${metaResp.status} while reading repository metadata.`,
        });
        return;
      }

      const repoMeta = (await metaResp.json()) as {
        full_name: string;
        description: string | null;
        default_branch: string;
        html_url: string;
      };

      const branch = parsed.branchHint || repoMeta.default_branch || 'main';
      const treeResp = await fetch(
        `https://api.github.com/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}/git/trees/${encodeURIComponent(branch)}?recursive=1`,
        { headers: ghHeaders }
      );

      if (!treeResp.ok) {
        res.status(treeResp.status).json({
          error: `Unable to read branch "${branch}" file tree from GitHub (HTTP ${treeResp.status}).`,
        });
        return;
      }

      const treeData = (await treeResp.json()) as {
        tree?: Array<{ path: string; type: string; size?: number }>;
      };

      const candidateFiles = (treeData.tree || [])
        .filter((item) => {
          if (item.type !== 'blob') return false;
          if ((item.size ?? 0) === 0 || (item.size ?? 0) > 120000) return false;
          if (parsed.subPath && !item.path.startsWith(parsed.subPath)) return false;
          const lowerPath = item.path.toLowerCase();
          if (
            lowerPath.includes('node_modules/') ||
            lowerPath.includes('vendor/') ||
            lowerPath.includes('.min.') ||
            lowerPath.includes('package-lock.json')
          ) {
            return false;
          }
          const ext = path.extname(lowerPath);
          return SUPPORTED_EXTENSIONS.has(ext);
        })
        .map((item) => ({
          path: item.path,
          size: item.size ?? 0,
          detectedLanguage: detectSourceLanguageFromPath(item.path),
        }))
        .sort((a, b) => {
          const priority = (lang: string) =>
            lang === 'COBOL' ? 0 : lang === 'Java 8' ? 1 : lang === 'PHP' ? 2 : 3;
          return priority(a.detectedLanguage) - priority(b.detectedLanguage) || a.path.localeCompare(b.path);
        })
        .slice(0, 60);

      res.json({
        owner: parsed.owner,
        repo: parsed.repo,
        branch,
        fullName: repoMeta.full_name,
        description: repoMeta.description || `Imported from ${repoMeta.full_name}`,
        htmlUrl: repoMeta.html_url,
        files: candidateFiles,
      });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to connect to GitHub.',
      });
    }
  });

  // 2. Fetch Selected Raw Source Files from Public GitHub Repo
  app.post('/api/github/files', async (req, res) => {
    try {
      const { owner, repo, branch, paths } = req.body as {
        owner?: string;
        repo?: string;
        branch?: string;
        paths?: string[];
      };

      if (!owner || !repo || !branch || !Array.isArray(paths) || paths.length === 0) {
        res.status(400).json({ error: 'Missing repository coordinates or selected file paths.' });
        return;
      }

      const cappedPaths = paths.slice(0, 12);
      const fetchedFiles = await Promise.all(
        cappedPaths.map(async (filePath) => {
          const encodedSegments = filePath.split('/').map(encodeURIComponent).join('/');
          const rawUrl = `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${encodedSegments}`;
          const fileResp = await fetch(rawUrl, {
            headers: { 'User-Agent': 'Reforge-Studio-Importer' },
          });
          if (!fileResp.ok) {
            throw new Error(`Failed to fetch ${filePath} (HTTP ${fileResp.status})`);
          }
          const content = await fileResp.text();
          return {
            filePath,
            content: content.slice(0, 140000),
            sourceLanguage: detectSourceLanguageFromPath(filePath),
          };
        })
      );

      res.json({ files: fetchedFiles });
    } catch (error) {
      res.status(500).json({
        error: error instanceof Error ? error.message : 'Failed to download source files from GitHub.',
      });
    }
  });

  // 3. Rapid File Triage via gemini-3.1-flash-lite
  app.post('/api/refactor/triage', async (req, res) => {
    const modelName = 'gemini-3.1-flash-lite';
    try {
      const { filePath, legacyCode, targetFramework } = req.body as {
        filePath?: string;
        legacyCode?: string;
        targetFramework?: string;
      };

      if (!legacyCode || typeof legacyCode !== 'string') {
        res.status(400).json({ error: 'Legacy code snippet is required for rapid triage.' });
        return;
      }

      const ai = createGeminiClient();
      const response = await ai.models.generateContent({
        model: modelName,
        contents: `Rapidly triage this legacy source file (${filePath || 'unknown'}) targeted for modernization into ${targetFramework || 'Rust'}.
Identify the primary legacy language/dialect, complexity rating, estimated effort savings, and top 3 risk hotspots.

LEGACY CODE:
${legacyCode.slice(0, 18000)}`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              detectedDialect: {
                type: Type.STRING,
                description: 'Specific legacy language version/dialect, e.g., COBOL-85 Batch, Java 8 Servlet, PHP 5.6.',
              },
              complexityLevel: {
                type: Type.STRING,
                description: 'Low, Moderate, High, or Critical.',
              },
              recommendedTargetFile: {
                type: Type.STRING,
                description: 'Suggested modernized file path.',
              },
              riskHotspots: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Up to 3 concise technical debt or security hotspots.',
              },
            },
            required: ['detectedDialect', 'complexityLevel', 'recommendedTargetFile', 'riskHotspots'],
          },
        },
      });

      const parsed = JSON.parse((response.text ?? '{}').trim());
      res.json(parsed);
    } catch (error) {
      const formatted = parseGeminiError(error, modelName);
      res.status(formatted.status).json(formatted);
    }
  });

  // 4. Autonomous Legacy Refactoring, Unit Test Generation & Security Exploit Detection
  app.post('/api/refactor/analyze', async (req, res) => {
    const {
      filePath,
      sourceLanguage,
      targetFramework,
      legacyCode,
      customInstructions,
      modelTier,
      highThinking,
    } = req.body as {
      filePath?: string;
      sourceLanguage?: string;
      targetFramework?: string;
      legacyCode?: string;
      customInstructions?: string;
      modelTier?: string;
      highThinking?: boolean;
    };

    if (!legacyCode || typeof legacyCode !== 'string') {
      res.status(400).json({ error: 'Legacy source code is required for refactoring.' });
      return;
    }

    const useHighThinkingArgon = highThinking === true || modelTier === 'gemini-4-argon';
    const selectedModel = useHighThinkingArgon
      ? 'gemini-4-argon'
      : modelTier === 'gemini-3.1-flash-lite'
        ? 'gemini-3.1-flash-lite'
        : 'gemini-3.8-flash';

    try {
      const ai = createGeminiClient();

      const systemInstruction = `You are an autonomous enterprise code modernization, unit testing, and offensive security audit engine.
Given a legacy source file (${sourceLanguage || 'Legacy'}) and target modern stack (${targetFramework || 'Node.js'}), you must:
1. Systematically refactor the entire module into complete, idiomatic, production-grade ${targetFramework || 'Node.js'} code with zero placeholders or TODOs. Preserve exact business logic and fix all numeric/concurrency/security flaws.
2. Generate a comprehensive, runnable unit test suite (${
        targetFramework === 'Rust'
          ? 'Rust #[cfg(test)] Cargo unit tests'
          : targetFramework === 'React'
            ? 'Vitest + React Testing Library TypeScript tests'
            : 'Node.js TypeScript unit tests using node:test and node:assert/strict'
      }) covering normal flows, boundary math, and security exploit regression tests.
3. Detect all security exploits and vulnerabilities in the legacy code (with exact CWE codes like CWE-89, CWE-79, CWE-502, CWE-190, CWE-798, line ranges in the legacy file, concrete attack vectors, and how your modernized code eliminates them).`;

      const prompt = `SOURCE FILE PATH: ${filePath || 'legacy_module.src'}
SOURCE LANGUAGE: ${sourceLanguage || 'COBOL'}
TARGET FRAMEWORK: ${targetFramework || 'Rust'}
${customInstructions ? `ENGINEER CUSTOM DIRECTIVES: ${customInstructions}\n` : ''}
LEGACY SOURCE CODE (with implicit 1-based line numbers):
${legacyCode
  .slice(0, 60000)
  .split('\n')
  .map((line, i) => `${String(i + 1).padStart(4, ' ')} | ${line}`)
  .join('\n')}`;

      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          modernizedFilePath: {
            type: Type.STRING,
            description: 'Clean idiomatic path for the refactored modern file, e.g. src/settlement/batch_settle.rs',
          },
          modernizedCode: {
            type: Type.STRING,
            description: 'Complete production-ready modernized source code without markdown fences.',
          },
          unitTestFilePath: {
            type: Type.STRING,
            description: 'Clean path for the unit test file, e.g. tests/batch_settle_test.rs or src/checkout.test.tsx',
          },
          unitTestCode: {
            type: Type.STRING,
            description: 'Complete runnable unit test suite code without markdown fences.',
          },
          summary: {
            type: Type.STRING,
            description: 'Clear 2-4 sentence architectural summary of how technical debt and security risks were eliminated.',
          },
          refactoringNotes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: '4 to 8 specific structural transformations performed during modernization.',
          },
          vulnerabilities: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                cwe: {
                  type: Type.STRING,
                  description: 'CWE identifier, e.g. CWE-89',
                },
                severity: {
                  type: Type.STRING,
                  description: 'Must be one of: Critical, High, Medium, Low',
                },
                title: {
                  type: Type.STRING,
                  description: 'Concise vulnerability title',
                },
                lineRange: {
                  type: Type.STRING,
                  description: 'Legacy line range, e.g. Lines 34-41',
                },
                description: {
                  type: Type.STRING,
                  description: 'Concrete explanation of the legacy exploit vector and business impact.',
                },
                remediation: {
                  type: Type.STRING,
                  description: 'How the modernized code neutralizes this vulnerability.',
                },
              },
              required: ['cwe', 'severity', 'title', 'lineRange', 'description', 'remediation'],
            },
          },
        },
        required: [
          'modernizedFilePath',
          'modernizedCode',
          'unitTestFilePath',
          'unitTestCode',
          'summary',
          'refactoringNotes',
          'vulnerabilities',
        ],
      };

      const config: Record<string, unknown> = {
        systemInstruction,
        responseMimeType: 'application/json',
        responseSchema,
      };

      if (useHighThinkingArgon) {
        config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
      }

      const response: GenerateContentResponse = await ai.models.generateContent({
        model: selectedModel,
        contents: prompt,
        config,
      });

      const rawJson = (response.text ?? '{}').trim();
      const parsed = JSON.parse(rawJson);

      res.json({
        modelUsed: selectedModel,
        highThinkingUsed: useHighThinkingArgon,
        ...parsed,
      });
    } catch (error) {
      const formatted = parseGeminiError(error, selectedModel);
      res.status(formatted.status).json(formatted);
    }
  });

  // 5. Multi-Turn Contextual Gemini Chat (SSE Stream)
  app.post('/api/chat/stream', async (req, res) => {
    const {
      history,
      message,
      persona = 'architect',
      modelTier = 'gemini-3.8-flash',
      highThinking = false,
      projectContext,
    } = req.body as {
      history?: Array<{ role: 'user' | 'model'; content: string }>;
      message?: string;
      persona?: string;
      modelTier?: string;
      highThinking?: boolean;
      projectContext?: {
        projectName?: string;
        sourceLanguage?: string;
        targetFramework?: string;
        activeFilePath?: string;
        legacySnippet?: string;
        modernizedSnippet?: string;
        openVulnerabilities?: string;
      };
    };

    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'Chat message cannot be empty.' });
      return;
    }

    const useHighThinking = highThinking === true || modelTier === 'gemini-4-argon';
    const selectedModel = useHighThinking
      ? 'gemini-4-argon'
      : modelTier === 'gemini-3.1-flash-lite'
        ? 'gemini-3.1-flash-lite'
        : 'gemini-3.8-flash';

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');

    try {
      const ai = createGeminiClient();
      const baseRolePrompt = PERSONA_INSTRUCTIONS[persona] || PERSONA_INSTRUCTIONS.architect;

      let contextualInstruction = baseRolePrompt;
      if (projectContext?.projectName) {
        contextualInstruction += `\n\nACTIVE WORKSPACE CONTEXT:
- Project: ${projectContext.projectName} (${projectContext.sourceLanguage || 'Legacy'} -> ${projectContext.targetFramework || 'Modern'})
- Active Module: ${projectContext.activeFilePath || 'None selected'}`;

        if (projectContext.openVulnerabilities) {
          contextualInstruction += `\n- Detected Security Findings:\n${projectContext.openVulnerabilities.slice(0, 3000)}`;
        }
        if (projectContext.legacySnippet) {
          contextualInstruction += `\n\nLEGACY SOURCE EXCERPT:\n${projectContext.legacySnippet.slice(0, 8000)}`;
        }
        if (projectContext.modernizedSnippet) {
          contextualInstruction += `\n\nMODERNIZED TARGET EXCERPT:\n${projectContext.modernizedSnippet.slice(0, 8000)}`;
        }
      }

      // Build clean alternating multi-turn history starting with 'user'
      const cleanHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];
      if (Array.isArray(history)) {
        for (const turn of history.slice(-24)) {
          if (!turn || typeof turn.content !== 'string' || !turn.content.trim()) continue;
          const role = turn.role === 'model' ? 'model' : 'user';
          if (cleanHistory.length === 0 && role !== 'user') continue;
          const prev = cleanHistory[cleanHistory.length - 1];
          if (prev && prev.role === role) {
            prev.parts[0].text += `\n\n${turn.content}`;
          } else {
            cleanHistory.push({ role, parts: [{ text: turn.content }] });
          }
        }
        // Ensure last history turn before user's new message is 'model'
        if (cleanHistory.length > 0 && cleanHistory[cleanHistory.length - 1].role === 'user') {
          cleanHistory.pop();
        }
      }

      const chatConfig: Record<string, unknown> = {
        systemInstruction: contextualInstruction,
      };

      if (useHighThinking) {
        chatConfig.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
      }

      const chat = ai.chats.create({
        model: selectedModel,
        history: cleanHistory,
        config: chatConfig,
      });

      const streamResponse = await chat.sendMessageStream({
        message,
      });

      for await (const chunk of streamResponse) {
        const c = chunk as GenerateContentResponse;
        const delta = c.text;
        if (delta) {
          res.write(`data: ${JSON.stringify({ type: 'delta', text: delta })}\n\n`);
        }
      }

      res.write(
        `data: ${JSON.stringify({
          type: 'done',
          modelUsed: selectedModel,
          highThinkingUsed: useHighThinking,
        })}\n\n`
      );
      res.end();
    } catch (error) {
      const formatted = parseGeminiError(error, selectedModel);
      res.write(`data: ${JSON.stringify({ type: 'error', ...formatted })}\n\n`);
      res.end();
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Reforge Studio server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();

import JSZip from 'jszip';
import type { CodeModuleRecord, ProjectRecord, VulnerabilityRecord } from '../types';

export async function exportProjectAsZip(
  project: ProjectRecord,
  modules: CodeModuleRecord[],
  vulnerabilities: VulnerabilityRecord[]
): Promise<void> {
  const zip = new JSZip();
  const safeSlug = project.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'reforge-export';

  const modernizedFolder = zip.folder('modernized');
  const testsFolder = zip.folder('tests');
  const legacyFolder = zip.folder('legacy_snapshot');

  for (const mod of modules) {
    legacyFolder?.file(mod.filePath, mod.legacyCode);

    if (mod.modernizedCode.trim()) {
      const targetPath = mod.modernizedFilePath.trim() || `refactored/${mod.filePath}.modern`;
      modernizedFolder?.file(targetPath, mod.modernizedCode);
    }

    if (mod.unitTestCode.trim()) {
      const testPath = mod.unitTestFilePath.trim() || `${mod.filePath}.test`;
      testsFolder?.file(testPath, mod.unitTestCode);
    }
  }

  const reportLines: string[] = [
    `# Modernization & Security Audit Report — ${project.name}`,
    '',
    `- Source Language: ${project.sourceLanguage}`,
    `- Target Framework: ${project.targetFramework}`,
    `- Modules Exported: ${modules.length}`,
    `- Security Findings Audited: ${vulnerabilities.length}`,
    `- Exported At: ${new Date().toISOString()}`,
    '',
    '## 1. Module Refactoring Summary',
    '',
  ];

  for (const mod of modules) {
    reportLines.push(`### ${mod.filePath} -> ${mod.modernizedFilePath || 'Pending Refactor'}`);
    reportLines.push(`- Status: ${mod.lifecycleStatus}`);
    if (mod.summary) {
      reportLines.push(`- Architectural Summary: ${mod.summary}`);
    }
    if (mod.refactoringNotes.length > 0) {
      reportLines.push('- Structural Transformations:');
      for (const note of mod.refactoringNotes) {
        reportLines.push(`  - ${note}`);
      }
    }
    reportLines.push('');
  }

  reportLines.push('## 2. Security Vulnerability Remediation Ledger');
  reportLines.push('');

  if (vulnerabilities.length === 0) {
    reportLines.push('No vulnerabilities recorded for this project.');
  } else {
    for (const v of vulnerabilities) {
      reportLines.push(
        `### [${v.severity}] ${v.cwe} — ${v.title} (${v.filePath}, ${v.lineRange})`
      );
      reportLines.push(`- Resolution Status: ${v.resolutionStatus}`);
      reportLines.push(`- Legacy Attack Vector: ${v.description}`);
      reportLines.push(`- Modernized Remediation: ${v.remediation}`);
      reportLines.push('');
    }
  }

  zip.file('MIGRATION_REPORT.md', reportLines.join('\n'));

  const blob = await zip.generateAsync({ type: 'blob' });
  const downloadUrl = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = `${safeSlug}-${project.targetFramework.toLowerCase().replace(/[^a-z0-9]/g, '')}.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(downloadUrl), 2000);
}

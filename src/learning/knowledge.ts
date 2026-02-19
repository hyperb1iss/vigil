import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { paths } from '../config/xdg.js';

const INITIAL_TEMPLATE = `# Vigil Knowledge

## Review Patterns

## CI Patterns

## Response Templates

## Workflow Patterns
`;

/** Read the entire knowledge file. Returns empty string if it doesn't exist. */
export function readKnowledge(): string {
  const file = paths.knowledgeFile();
  if (!existsSync(file)) return '';
  return readFileSync(file, 'utf-8');
}

/** Read knowledge formatted as agent system prompt context. */
export function getKnowledgeAsContext(): string {
  const content = readKnowledge();
  if (!content) return '';
  return content;
}

/** Overwrite the knowledge file with the given content. */
export function writeKnowledge(content: string): void {
  const file = paths.knowledgeFile();
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf-8');
}

/** Create the knowledge file with initial structure if it doesn't already exist. */
export function initKnowledgeFile(): void {
  const file = paths.knowledgeFile();
  if (existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, INITIAL_TEMPLATE, 'utf-8');
}

/**
 * Append a bullet-point pattern under the given `## section` / `### subsection`.
 * Creates the section or subsection if they don't exist yet.
 */
export function appendPattern(section: string, subsection: string, pattern: string): void {
  initKnowledgeFile();
  let content = readKnowledge();

  const sectionHeader = `## ${section}`;
  const subsectionHeader = `### ${subsection}`;

  const sectionIdx = content.indexOf(sectionHeader);

  if (sectionIdx === -1) {
    // Section doesn't exist — append at end of file
    content = `${content.trimEnd()}\n\n${sectionHeader}\n\n${subsectionHeader}\n\n- ${pattern}\n`;
    writeKnowledge(content);
    return;
  }

  // Find where this section ends (next ## or EOF)
  const afterSection = sectionIdx + sectionHeader.length;
  const nextSectionMatch = content.slice(afterSection).search(/\n## /);
  const sectionEnd = nextSectionMatch === -1 ? content.length : afterSection + nextSectionMatch;

  const sectionSlice = content.slice(sectionIdx, sectionEnd);
  const subIdx = sectionSlice.indexOf(subsectionHeader);

  if (subIdx === -1) {
    // Subsection doesn't exist — insert at end of section
    const insertion = `\n${subsectionHeader}\n\n- ${pattern}\n`;
    content = content.slice(0, sectionEnd) + insertion + content.slice(sectionEnd);
    writeKnowledge(content);
    return;
  }

  // Find where this subsection ends (next ### or ## or EOF within section)
  const afterSub = subIdx + subsectionHeader.length;
  const nextSubMatch = sectionSlice.slice(afterSub).search(/\n#{2,3} /);
  const subEnd = nextSubMatch === -1 ? sectionEnd : sectionIdx + afterSub + nextSubMatch;

  // Append bullet at end of subsection
  const insertion = `- ${pattern}\n`;
  const insertAt = content.slice(0, subEnd).trimEnd().length;
  content = `${content.slice(0, insertAt)}\n${insertion}${content.slice(subEnd)}`;
  writeKnowledge(content);
}

/**
 * Find a pattern matching `trigger` text, parse its `[confidence: X.XX]` tag,
 * increment by 0.1 (capped at 1.0), and rewrite.
 */
export function bumpConfidence(section: string, trigger: string): void {
  let content = readKnowledge();
  if (!content) return;

  const sectionHeader = `## ${section}`;
  const sectionIdx = content.indexOf(sectionHeader);
  if (sectionIdx === -1) return;

  const afterSection = sectionIdx + sectionHeader.length;
  const nextSectionMatch = content.slice(afterSection).search(/\n## /);
  const sectionEnd = nextSectionMatch === -1 ? content.length : afterSection + nextSectionMatch;
  const sectionSlice = content.slice(sectionIdx, sectionEnd);

  // Find lines matching the trigger text
  const confidenceRe = /\[confidence:\s*([\d.]+)\]/;
  const lines = sectionSlice.split('\n');
  let modified = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    if (!line.includes(trigger)) continue;

    const match = confidenceRe.exec(line);
    if (!match?.[1]) continue;

    const current = parseFloat(match[1]);
    const bumped = Math.min(1.0, Math.round((current + 0.1) * 100) / 100);
    lines[i] = line.replace(confidenceRe, `[confidence: ${bumped.toFixed(2)}]`);
    modified = true;
    break; // bump first match only
  }

  if (modified) {
    const updatedSection = lines.join('\n');
    content = content.slice(0, sectionIdx) + updatedSection + content.slice(sectionEnd);
    writeKnowledge(content);
  }
}

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractTenancyFile } from '../lib/tenancy/parser';

type GroundTruthCase = {
  id: string;
  path: string;
  mimeType: 'application/pdf' | 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' | 'text/plain';
  format: 'digital_pdf' | 'scanned_pdf' | 'docx' | 'txt';
  language: 'english' | 'chinese' | 'mixed';
  expected: Record<string, string | number>;
};

const enabled = process.env.LIVE_AI_LEGAL === '1';

test('live AI legal validation uses real agreements and measured ground truth', { skip: !enabled }, async () => {
  assert.ok(process.env.OPENAI_API_KEY, 'OPENAI_API_KEY is required for LIVE_AI_LEGAL');
  assert.ok(process.env.SPRINT011_GROUND_TRUTH_PATH, 'SPRINT011_GROUND_TRUTH_PATH is required for LIVE_AI_LEGAL');
  const cases = JSON.parse(readFileSync(process.env.SPRINT011_GROUND_TRUTH_PATH!, 'utf8')) as GroundTruthCase[];
  assert.ok(cases.length >= 7, 'ground truth must include at least seven real agreements');
  for (const format of ['digital_pdf', 'scanned_pdf', 'docx', 'txt']) assert.ok(cases.some((item) => item.format === format), `missing ${format} case`);
  for (const language of ['english', 'chinese', 'mixed']) assert.ok(cases.some((item) => item.language === language), `missing ${language} case`);

  let correct = 0;
  let measured = 0;
  for (const fixture of cases) {
    const buffer = readFileSync(fixture.path);
    const result = await extractTenancyFile({ buffer, filename: fixture.path, mimeType: fixture.mimeType });
    assert.equal(result.advancedAiConfigured, true, `${fixture.id} unexpectedly used fallback`);
    assert.ok(result.rawText.length >= 80, `${fixture.id} did not extract full text`);
    assert.ok(result.summary, `${fixture.id} did not generate a summary`);
    assert.ok(result.legalIntelligence.risks.every((risk) => risk.category && risk.reason && risk.recommendation), `${fixture.id} returned an incomplete risk`);
    for (const [path, expected] of Object.entries(fixture.expected)) {
      const actual = readPath(result.legalIntelligence as unknown as Record<string, unknown>, path);
      measured += 1;
      if (String(actual).trim().toLowerCase() === String(expected).trim().toLowerCase()) correct += 1;
      const evidence = result.legalIntelligence.field_evidence[path];
      assert.ok(evidence, `${fixture.id} missing evidence for ${path}`);
      assert.equal(evidence.value, String(actual), `${fixture.id} evidence value diverged for ${path}`);
      assert.ok(evidence.confidence >= 0 && evidence.confidence <= 100, `${fixture.id} invalid confidence for ${path}`);
      if (!actual) assert.equal(evidence.confidence, 0, `${fixture.id} assigned confidence to empty ${path}`);
    }
  }
  assert.ok(measured > 0, 'ground truth contains no measured fields');
  const accuracy = correct / measured;
  assert.ok(accuracy >= 0.95, `measured extraction accuracy was ${(accuracy * 100).toFixed(2)}%`);
});

function readPath(source: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => current && typeof current === 'object'
    ? (current as Record<string, unknown>)[segment] : undefined, source);
}

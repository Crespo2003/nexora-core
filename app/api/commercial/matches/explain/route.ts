import { NextResponse } from 'next/server';
import { explainCommercialMatch } from '../../../../../lib/commercial/aiExplanation';
import type { MatchResult } from '../../../../../lib/commercial/types';
import { getApiErrorMessage, requireWorkspaceAccess } from '../../../../../lib/supabase/server';

export async function POST(request: Request) {
  try {
    const auth = await requireWorkspaceAccess(['owner', 'admin', 'manager', 'agent'], request);
    if (auth instanceof Response) return auth;
    const { matchId } = await request.json() as { matchId?: string };
    if (!matchId) return NextResponse.json({ success: false, error: 'match-required' }, { status: 400 });
    const match = await auth.supabase.from('commercial_matches').select('*').eq('id', matchId).eq('workspace_id', auth.workspaceId).maybeSingle();
    if (match.error) throw match.error;
    if (!match.data) return NextResponse.json({ success: false, error: 'match-not-found' }, { status: 404 });
    const row = match.data as Record<string, unknown>;
    const deterministic: MatchResult = {
      overallScore: Number(row.overall_score), categoryScores: row.category_scores as MatchResult['categoryScores'],
      matchedCriteria: row.matched_criteria as string[], missingCriteria: row.missing_criteria as string[],
      hardConflicts: row.hard_conflicts as string[], warnings: row.warnings as string[],
      recommendationLevel: row.recommendation_level as MatchResult['recommendationLevel'], explanation: String(row.explanation ?? '')
    };
    const explanation = await explainCommercialMatch(deterministic);
    if (explanation.status === 'completed') {
      const saved = await auth.supabase.from('commercial_matches').update({ ai_explanation: explanation.text, ai_model: explanation.model, ai_generated_at: explanation.generatedAt }).eq('id', matchId).eq('workspace_id', auth.workspaceId);
      if (saved.error) throw saved.error;
    }
    return NextResponse.json({ success: true, score: deterministic.overallScore, explanation });
  } catch (error) {
    return NextResponse.json({ success: false, error: getApiErrorMessage(error) }, { status: 500 });
  }
}

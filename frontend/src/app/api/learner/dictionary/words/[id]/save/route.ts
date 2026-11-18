import type { NextRequest } from 'next/server';

import { handleDictionarySave } from '@/features/learner-dictionary/dictionary-route-handler';
import { dictionaryDependencies } from '@/features/learner-dictionary/dictionary-service';

export const dynamic = 'force-dynamic';

type Context = RouteContext<'/api/learner/dictionary/words/[id]/save'>;

export async function POST(request: NextRequest, ctx: Context) {
  const { id } = await ctx.params;
  return handleDictionarySave(request, id, 'POST', dictionaryDependencies());
}

export async function DELETE(request: NextRequest, ctx: Context) {
  const { id } = await ctx.params;
  return handleDictionarySave(request, id, 'DELETE', dictionaryDependencies());
}

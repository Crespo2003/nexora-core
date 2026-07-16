import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({ success: true, setupOpen: false, replacement: '/signup' });
}

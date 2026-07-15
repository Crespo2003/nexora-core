'use client';
export default function ErrorPage({ reset }: { reset: () => void }) { return <div className="pi-route-state"><h2>Property Intelligence could not load</h2><button className="pi-primary" onClick={reset}>Try again</button></div>; }

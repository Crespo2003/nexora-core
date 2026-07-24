export default function HomeLoading() {
  return (
    <main className="command-shell">
      <div className="portal-home-loading" aria-label="Loading Home portal">
        {Array.from({ length: 8 }).map((_, index) => <span key={index} />)}
      </div>
    </main>
  );
}

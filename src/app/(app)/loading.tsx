export default function AppLoading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="glass-panel flex flex-col gap-6 p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-col gap-2">
            <div className="h-3 w-40 animate-pulse rounded-full bg-muted" />
            <div className="h-8 w-64 animate-pulse rounded-lg bg-muted" />
            <div className="h-4 w-48 animate-pulse rounded-full bg-muted" />
          </div>
          <div className="flex items-center gap-3">
            <div className="h-6 w-20 animate-pulse rounded-full bg-muted" />
            <div className="h-9 w-24 animate-pulse rounded-full bg-muted" />
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.35fr)]">
        <div className="paper-card animate-pulse flex flex-col gap-6 rounded-2xl p-6">
          <div className="flex flex-col gap-1.5">
            <div className="h-3 w-36 rounded-full bg-muted" />
            <div className="h-6 w-28 rounded-lg bg-muted" />
          </div>
          <div className="blueprint-surface flex h-40 items-center justify-center rounded-xl">
            <div className="h-10 w-48 rounded-lg bg-muted" />
          </div>
          <div className="h-12 w-full animate-pulse rounded-full bg-muted" />
        </div>

        <div className="paper-card animate-pulse flex flex-col gap-6 rounded-2xl p-6">
          <div className="flex flex-col gap-1.5">
            <div className="h-3 w-36 rounded-full bg-muted" />
            <div className="h-6 w-40 rounded-lg bg-muted" />
          </div>
          <div className="flex flex-col gap-2">
            {[0, 1, 2, 3].map((row) => (
              <div
                key={row}
                className="flex items-center gap-4 rounded-xl bg-muted/50 p-3"
              >
                <div className="h-4 w-24 rounded bg-muted" />
                <div className="h-5 w-20 rounded-full bg-muted" />
                <div className="h-4 w-14 rounded bg-muted" />
                <div className="h-4 flex-1 rounded bg-muted" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

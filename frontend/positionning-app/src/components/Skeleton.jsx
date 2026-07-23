export function SkeletonBar({ width = '100%', height = 20, style = {} }) {
  return <div className="skeleton skeleton-bar" style={{ width, height, ...style }} />;
}

export function SkeletonBlock({ width = '100%', height = 200, style = {} }) {
  return <div className="skeleton skeleton-block" style={{ width, height, ...style }} />;
}

export function SkeletonGraph() {
  return (
    <div className="skeleton-graph">
      <SkeletonBlock height={400} />
      <div className="skeleton-graph-side">
        <SkeletonBlock height={180} />
        <SkeletonBlock height={120} style={{ marginTop: 12 }} />
      </div>
    </div>
  );
}

export function SkeletonTabs() {
  return (
    <div className="skeleton-tabs">
      <SkeletonBar width={80} height={36} />
      <SkeletonBar width={90} height={36} />
      <SkeletonBar width={100} height={36} />
      <SkeletonBar width={70} height={36} />
    </div>
  );
}

export function SkeletonChips() {
  return (
    <div className="skeleton-chips">
      <SkeletonBar width={100} height={28} style={{ borderRadius: 999 }} />
      <SkeletonBar width={130} height={28} style={{ borderRadius: 999 }} />
      <SkeletonBar width={90} height={28} style={{ borderRadius: 999 }} />
    </div>
  );
}

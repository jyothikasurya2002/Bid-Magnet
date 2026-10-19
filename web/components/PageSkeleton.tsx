// Shown the moment you navigate, while the page's data loads.
export function PageSkeleton({ variant }: { variant: "list" | "detail" | "feed" | "company" }) {
  const bar = (width: string, height = 12) => <span className="skel" style={{ width, height }} />;
  return (
    <div className={`skel-page skel-${variant}`} aria-busy="true" aria-label="Loading">
      <div className="skel-head">
        {bar("120px", 10)}
        {bar("min(560px, 70%)", 22)}
        {bar("min(320px, 50%)", 10)}
      </div>
      {variant === "feed" ? (
        <div className="skel-split">
          <div className="skel-stack">
            {Array.from({ length: 7 }, (_, index) => (
              <div key={index} className="skel-card">
                {bar("70%")}
                {bar("45%", 10)}
              </div>
            ))}
          </div>
          <div className="skel-card skel-pane">
            {bar("80%", 18)}
            {bar("60%", 10)}
            {bar("100%", 80)}
          </div>
        </div>
      ) : variant === "detail" ? (
        <>
          <div className="skel-row">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="skel-card">
                {bar("50%")}
                {bar("90%", 10)}
                {bar("70%", 10)}
              </div>
            ))}
          </div>
          <div className="skel-card skel-tall">
            {Array.from({ length: 8 }, (_, index) => bar(`${90 - index * 6}%`, 14))}
          </div>
        </>
      ) : (
        <div className="skel-stack">
          {Array.from({ length: variant === "company" ? 5 : 6 }, (_, index) => (
            <div key={index} className="skel-card">
              {bar("60%")}
              {bar("35%", 10)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

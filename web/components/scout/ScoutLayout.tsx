"use client";

import { useRef, useState, useSyncExternalStore } from "react";

// A page with Scout docked on the right: slides in, and its left edge drags to resize.
// The width is remembered in this browser.

const WIDTH_KEY = "bidmagnet:scout-width";
const DEFAULT_WIDTH = 420;
const MIN_WIDTH = 340;

const widthListeners = new Set<() => void>();
function subscribeWidth(listener: () => void) {
  widthListeners.add(listener);
  return () => widthListeners.delete(listener);
}

function storedWidth() {
  try {
    return Number(window.localStorage.getItem(WIDTH_KEY)) || DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

function saveWidth(width: number) {
  try {
    window.localStorage.setItem(WIDTH_KEY, String(Math.round(width)));
  } catch {}
  widthListeners.forEach((listener) => listener());
}

function clamp(width: number) {
  const max = Math.max(MIN_WIDTH, Math.min(window.innerWidth * 0.7, window.innerWidth - 420));
  return Math.round(Math.max(MIN_WIDTH, Math.min(max, width)));
}

type ScoutLayoutProps = {
  open: boolean;
  panel: React.ReactNode;
  children: React.ReactNode;
};

export function ScoutLayout({ open, panel, children }: ScoutLayoutProps) {
  const saved = useSyncExternalStore(subscribeWidth, storedWidth, () => DEFAULT_WIDTH);
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const drag = useRef<{ x: number; width: number } | null>(null);
  const width = dragWidth ?? saved;

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, width };
    setDragWidth(width);
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!drag.current) return;
    setDragWidth(clamp(drag.current.width + (drag.current.x - event.clientX)));
  }

  function onPointerUp() {
    if (!drag.current) return;
    drag.current = null;
    if (dragWidth !== null) saveWidth(dragWidth);
    setDragWidth(null);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const step = event.shiftKey ? 80 : 24;
    if (event.key === "ArrowLeft") saveWidth(clamp(width + step));
    else if (event.key === "ArrowRight") saveWidth(clamp(width - step));
    else return;
    event.preventDefault();
  }

  return (
    <div
      className={`scout-layout${open ? " scout-open" : ""}${dragWidth !== null ? " scout-dragging" : ""}`}
      style={{ "--scout-w": `${width}px` } as React.CSSProperties}
    >
      <div className="scout-main">{children}</div>
      <div className="scout-dock" inert={!open}>
        <div
          className="scout-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize Scout"
          aria-valuenow={width}
          tabIndex={open ? 0 : -1}
          title="Drag to resize · double-click to reset"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={() => saveWidth(DEFAULT_WIDTH)}
          onKeyDown={onKeyDown}
        />
        <div className="scout-panel">{panel}</div>
      </div>
    </div>
  );
}

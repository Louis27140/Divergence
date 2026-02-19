import type { MouseEvent, RefObject } from "react";

type StreamPanelProps = {
  expanded: boolean;
  visible: boolean;
  screenSharing: boolean;
  remoteScreenShareCount: number;
  liveTakeoverActive: boolean;
  onToggleTakeover: () => void;
  containerRef: RefObject<HTMLDivElement>;
};

export function StreamPanel({
  expanded,
  visible,
  screenSharing,
  remoteScreenShareCount,
  liveTakeoverActive,
  onToggleTakeover,
  containerRef,
}: StreamPanelProps) {
  const liveLabel =
    screenSharing && remoteScreenShareCount === 0
      ? "Live (you)"
      : `Live (${remoteScreenShareCount})`;

  function handleContentClick(event: MouseEvent<HTMLDivElement>) {
    if ((event.target as HTMLElement).closest("button")) return;
    onToggleTakeover();
  }

  // The container div must ALWAYS stay in the DOM so that addScreenShareTile()
  // can insert video elements at any time (even before the section is visible).
  // We hide the whole section with display:none instead of returning null.
  return (
    <div
      className="m-voice__live m-stream-panel"
      style={{ display: expanded && visible ? undefined : "none" }}
    >
      <div className="m-stream-panel__header">
        <div className="m-voice__live-header">{liveLabel}</div>
        <button
          type="button"
          className={`m-stream-panel__toggle${liveTakeoverActive ? " m-stream-panel__toggle--active" : ""}`}
          onClick={onToggleTakeover}
        >
          {liveTakeoverActive ? "Retour chat" : "Ouvrir live"}
        </button>
      </div>
      {/* Hidden when takeover is active: tiles have been moved to the expanded left area */}
      <div
        className="m-voice__live-content m-stream-panel__content"
        ref={containerRef}
        style={{ display: liveTakeoverActive ? "none" : undefined }}
        onClick={handleContentClick}
      />
    </div>
  );
}

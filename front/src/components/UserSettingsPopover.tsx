import { useEffect, useState } from "react";
import type { AudioDeviceConfig, UserColorConfig } from "../types";
import { resolveNameStyle } from "../utils/userColor";

type Props = {
  username: string;
  colorConfig: UserColorConfig;
  audioConfig: AudioDeviceConfig;
  onColorChange: (config: UserColorConfig) => void;
  onAudioChange: (config: AudioDeviceConfig) => void;
  onClose: () => void;
};

const PRESETS: Array<{ label: string; stops: string[] }> = [
  { label: "Rainbow", stops: ["#ff0000", "#ff7f00", "#ffff00", "#00cc44", "#0088ff", "#8800ff"] },
  { label: "Warm", stops: ["#ff6b35", "#f7c59f", "#ffe066"] },
  { label: "Ocean", stops: ["#7aa2ff", "#00d4ff"] },
  { label: "Pink", stops: ["#ff7aa2", "#ffb3c6"] },
  { label: "Cyber", stops: ["#00ffcc", "#7b2fff"] },
];

export function UserSettingsPopover({
  username,
  colorConfig,
  audioConfig,
  onColorChange,
  onAudioChange,
  onClose,
}: Props) {
  const [tab, setTab] = useState<"appearance" | "sound">("appearance");
  const [inputDevices, setInputDevices] = useState<MediaDeviceInfo[]>([]);
  const [outputDevices, setOutputDevices] = useState<MediaDeviceInfo[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);

  const [mode, setMode] = useState<UserColorConfig["mode"]>(colorConfig.mode);
  const [staticColor, setStaticColor] = useState(
    colorConfig.mode === "static" ? colorConfig.color : "#7aa2ff",
  );
  const [gradientStops, setGradientStops] = useState<string[]>(
    colorConfig.mode === "gradient" ? colorConfig.stops : ["#7aa2ff", "#ff7aa2"],
  );
  const [gradientAngle, setGradientAngle] = useState(
    colorConfig.mode === "gradient" ? colorConfig.angle : 90,
  );
  const [gradientAnimated, setGradientAnimated] = useState(
    colorConfig.mode === "gradient" ? colorConfig.animated : false,
  );

  useEffect(() => {
    if (tab !== "sound") return;
    navigator.mediaDevices
      .enumerateDevices()
      .then((devices) => {
        setInputDevices(devices.filter((d) => d.kind === "audioinput"));
        setOutputDevices(devices.filter((d) => d.kind === "audiooutput"));
        setDevicesLoaded(true);
      })
      .catch(() => setDevicesLoaded(true));
  }, [tab]);

  function buildPreviewConfig(): UserColorConfig {
    if (mode === "hash") return { mode: "hash" };
    if (mode === "static") return { mode: "static", color: staticColor };
    return { mode: "gradient", stops: gradientStops, angle: gradientAngle, animated: gradientAnimated };
  }

  function applyColor() {
    onColorChange(buildPreviewConfig());
  }

  function setPreset(stops: string[]) {
    setGradientStops(stops);
  }

  function updateStop(index: number, value: string) {
    setGradientStops((prev) => prev.map((s, i) => (i === index ? value : s)));
  }

  function removeStop(index: number) {
    setGradientStops((prev) => prev.filter((_, i) => i !== index));
  }

  function addStop() {
    setGradientStops((prev) => [...prev, "#ffffff"]);
  }

  const previewStyle = resolveNameStyle(buildPreviewConfig(), "var(--m-text-1)");

  return (
    <>
      <div className="m-popover-backdrop" onClick={onClose} />
      <div className="m-user-settings">
        <div className="m-user-settings__header">
          <span className="m-user-settings__title">Settings</span>
          <div className="m-user-settings__tabs">
            <button
              type="button"
              className={`m-user-settings__tab${tab === "appearance" ? " m-user-settings__tab--active" : ""}`}
              onClick={() => setTab("appearance")}
            >
              Appearance
            </button>
            <button
              type="button"
              className={`m-user-settings__tab${tab === "sound" ? " m-user-settings__tab--active" : ""}`}
              onClick={() => setTab("sound")}
            >
              Sound
            </button>
          </div>
        </div>

        {tab === "appearance" && (
          <div className="m-user-settings__body">
            <div className="m-uset-section">
              <div className="m-uset-section__title">Username color</div>

              <div className="m-uset-preview">
                <span style={previewStyle as any}>{username}</span>
              </div>

              <div className="m-uset-modes">
                {(["hash", "static", "gradient"] as const).map((m) => (
                  <label key={m} className={`m-uset-mode${mode === m ? " m-uset-mode--active" : ""}`}>
                    <input
                      type="radio"
                      name="colorMode"
                      value={m}
                      checked={mode === m}
                      onChange={() => setMode(m)}
                    />
                    {m === "hash" ? "Auto" : m === "static" ? "Static" : "Gradient"}
                  </label>
                ))}
              </div>

              {mode === "static" && (
                <div className="m-uset-row">
                  <input
                    type="color"
                    value={staticColor}
                    onChange={(e: any) => setStaticColor(e.target.value)}
                    className="m-uset-colorpick"
                  />
                  <span className="m-uset-hex">{staticColor}</span>
                </div>
              )}

              {mode === "gradient" && (
                <div className="m-uset-gradient">
                  <div className="m-uset-presets">
                    {PRESETS.map((p) => (
                      <button
                        key={p.label}
                        type="button"
                        className="m-uset-preset"
                        style={{
                          background: `linear-gradient(90deg, ${p.stops.join(", ")})`,
                        }}
                        onClick={() => setPreset(p.stops)}
                        title={p.label}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  <div className="m-uset-stops">
                    {gradientStops.map((stop, i) => (
                      <div key={i} className="m-uset-stop">
                        <input
                          type="color"
                          value={stop}
                          onChange={(e: any) => updateStop(i, e.target.value)}
                          className="m-uset-colorpick"
                        />
                        {gradientStops.length > 2 && (
                          <button
                            type="button"
                            className="m-uset-stop__remove"
                            onClick={() => removeStop(i)}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    {gradientStops.length < 8 && (
                      <button type="button" className="m-uset-stop__add" onClick={addStop}>
                        +
                      </button>
                    )}
                  </div>

                  <div className="m-uset-row">
                    <span className="m-uset-label">Angle</span>
                    <input
                      type="range"
                      min={0}
                      max={360}
                      value={gradientAngle}
                      onChange={(e: any) => setGradientAngle(parseInt(e.target.value))}
                      className="m-uset-slider"
                    />
                    <span className="m-uset-val">{gradientAngle}°</span>
                  </div>

                  <div className="m-uset-row">
                    <span className="m-uset-label">Animated</span>
                    <label className="m-uset-toggle">
                      <input
                        type="checkbox"
                        checked={gradientAnimated}
                        onChange={(e: any) => setGradientAnimated(e.target.checked)}
                      />
                      <span className="m-uset-toggle__track" />
                    </label>
                  </div>
                </div>
              )}
            </div>

            <button type="button" className="m-uset-apply" onClick={applyColor}>
              Apply
            </button>
          </div>
        )}

        {tab === "sound" && (
          <div className="m-user-settings__body">
            <div className="m-uset-section">
              <div className="m-uset-section__title">Audio devices</div>
              {!devicesLoaded ? (
                <div className="m-uset-loading">Loading devices…</div>
              ) : (
                <>
                  <div className="m-uset-device-row">
                    <span className="m-uset-label">Microphone</span>
                    <select
                      value={audioConfig.inputDeviceId ?? ""}
                      onChange={(e: any) =>
                        onAudioChange({ ...audioConfig, inputDeviceId: e.target.value || undefined })
                      }
                      className="m-uset-select"
                    >
                      <option value="">System default</option>
                      {inputDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Microphone (${d.deviceId.slice(0, 8)})`}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="m-uset-device-row">
                    <span className="m-uset-label">Speaker</span>
                    <select
                      value={audioConfig.outputDeviceId ?? ""}
                      onChange={(e: any) =>
                        onAudioChange({ ...audioConfig, outputDeviceId: e.target.value || undefined })
                      }
                      className="m-uset-select"
                    >
                      <option value="">System default</option>
                      {outputDevices.map((d) => (
                        <option key={d.deviceId} value={d.deviceId}>
                          {d.label || `Speaker (${d.deviceId.slice(0, 8)})`}
                        </option>
                      ))}
                    </select>
                  </div>

                  {outputDevices.length === 0 && (
                    <p className="m-uset-note">
                      Speaker selection requires microphone permission. Join a voice channel first.
                    </p>
                  )}
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

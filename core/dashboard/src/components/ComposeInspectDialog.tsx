import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import type { ComposeInspectionPayload } from "../types";

type InspectTab = "raw" | "parsed" | "analysis";

type ComposeInspectDialogProps = {
  open: boolean;
  title: string;
  inspection: ComposeInspectionPayload | null;
  onClose: () => void;
};

function stringifyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return error instanceof Error ? error.message : "JSON へ整形できませんでした。";
  }
}

export function ComposeInspectDialog(props: ComposeInspectDialogProps) {
  const { open, title, inspection, onClose } = props;
  const [activeTab, setActiveTab] = useState<InspectTab>("raw");

  useEffect(() => {
    if (!open) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, open]);

  useEffect(() => {
    if (open) {
      setActiveTab("raw");
    }
  }, [open]);

  const parsedJsonText = useMemo(() => {
    if (!inspection || inspection.parsedYaml === null) {
      return "";
    }
    return stringifyJson(inspection.parsedYaml);
  }, [inspection]);

  if (!open || !inspection) {
    return null;
  }

  const hasWarnings = inspection.parseWarnings.length > 0 || inspection.analysisWarnings.length > 0;

  return createPortal(
    <div className="dialog-backdrop" role="presentation" onClick={onClose}>
      <div
        className="dialog-panel compose-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="compose-inspect-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="dialog-head">
          <div>
            <h2 id="compose-inspect-title">{title}</h2>
            <p className="panel-sub">
              source: <code>{inspection.source.kind}</code> / <code>{inspection.selectedComposePath}</code>
            </p>
          </div>
          <button type="button" className="button secondary" onClick={onClose}>
            閉じる
          </button>
        </div>

        <div className="dialog-tabs" role="tablist" aria-label="compose inspection tabs">
          <button
            type="button"
            className={`dialog-tab ${activeTab === "raw" ? "active" : ""}`}
            onClick={() => setActiveTab("raw")}
          >
            Raw YAML
          </button>
          <button
            type="button"
            className={`dialog-tab ${activeTab === "parsed" ? "active" : ""}`}
            onClick={() => setActiveTab("parsed")}
          >
            Parsed JSON
          </button>
          <button
            type="button"
            className={`dialog-tab ${activeTab === "analysis" ? "active" : ""}`}
            onClick={() => setActiveTab("analysis")}
          >
            Analysis
          </button>
        </div>

        {activeTab === "raw" ? (
          <div className="dialog-content">
            <pre className="dialog-code-block">
              {inspection.rawYaml.length > 0 ? inspection.rawYaml : "YAML を取得できませんでした。"}
            </pre>
          </div>
        ) : null}

        {activeTab === "parsed" ? (
          <div className="dialog-content">
            {inspection.parseError ? (
              <div className="inspect-error-block">
                <strong>YAML 解析エラー</strong>
                <pre className="dialog-code-block">{inspection.parseError}</pre>
              </div>
            ) : (
              <pre className="dialog-code-block">{parsedJsonText}</pre>
            )}
          </div>
        ) : null}

        {activeTab === "analysis" ? (
          <div className="dialog-content inspect-analysis">
            <div className="inspect-metadata">
              <p>
                path: <code>{inspection.source.path}</code>
              </p>
              <p>
                selected: <code>{inspection.selectedComposePath}</code>
              </p>
              {inspection.source.repositoryUrl ? (
                <p>
                  repo: <code>{inspection.source.repositoryUrl}</code>
                </p>
              ) : null}
              {inspection.source.branch ? (
                <p>
                  branch: <code>{inspection.source.branch}</code>
                </p>
              ) : null}
              {inspection.source.absolutePath ? (
                <p>
                  local: <code>{inspection.source.absolutePath}</code>
                </p>
              ) : null}
              {inspection.source.blobUrl ? (
                <p>
                  blob: <code>{inspection.source.blobUrl}</code>
                </p>
              ) : null}
              <p>
                compose候補: <strong>{inspection.composeCandidates.length}</strong> 件 / YAML: <strong>{inspection.yamlFiles.length}</strong> 件
              </p>
              <p>
                env要件:{" "}
                <strong>{inspection.environmentRequirements.length > 0 ? inspection.environmentRequirements.map((item) => item.name).join(", ") : "なし"}</strong>
              </p>
              <p>
                device要件:{" "}
                <strong>{inspection.detectedDeviceRequirements.length > 0 ? inspection.detectedDeviceRequirements.join(", ") : "なし"}</strong>
              </p>
            </div>

            {inspection.parseError ? (
              <p className="hint warning">YAML の parse に失敗しているため、サービス解析結果は空です。</p>
            ) : null}

            {hasWarnings ? (
              <div className="inspect-warning-grid">
                {inspection.parseWarnings.length > 0 ? (
                  <div>
                    <h3>Parser Warnings</h3>
                    <ul className="inspect-list">
                      {inspection.parseWarnings.map((warning) => (
                        <li key={`parse-${warning}`}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
                {inspection.analysisWarnings.length > 0 ? (
                  <div>
                    <h3>Analysis Warnings</h3>
                    <ul className="inspect-list">
                      {inspection.analysisWarnings.map((warning) => (
                        <li key={`analysis-${warning}`}>{warning}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="hint">parser / analysis warning はありません。</p>
            )}

            <div>
              <h3>Detected Services</h3>
              {inspection.services.length > 0 ? (
                <div className="inspect-service-list">
                  {inspection.services.map((service) => (
                    <article key={service.name} className="inspect-service-card">
                      <strong>{service.name}</strong>
                      <p>推定公開ポート: {service.detectedPublicPort ?? "未検出"}</p>
                      <p>port options: {service.portOptions.length > 0 ? service.portOptions.join(", ") : "なし"}</p>
                      <p>published: {service.publishedPorts.length > 0 ? service.publishedPorts.join(", ") : "なし"}</p>
                      <p>expose: {service.exposePorts.length > 0 ? service.exposePorts.join(", ") : "なし"}</p>
                      <p>{service.reason}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="hint">検出できた service はありません。</p>
              )}
            </div>

            <div>
              <h3>Detected Environment Variables</h3>
              {inspection.environmentRequirements.length > 0 ? (
                <div className="inspect-service-list">
                  {inspection.environmentRequirements.map((requirement) => (
                    <article key={requirement.name} className="inspect-service-card">
                      <strong>{requirement.name}</strong>
                      <p>{requirement.required ? "必須" : "任意"}</p>
                      <p>default: {requirement.defaultValue ?? "なし"}</p>
                      <p>services: {requirement.services.join(", ")}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="hint">検出できた環境変数要件はありません。</p>
              )}
            </div>

            <div>
              <h3>Detected Devices</h3>
              {inspection.serviceDeviceRequirements.length > 0 ? (
                <div className="inspect-service-list">
                  {inspection.serviceDeviceRequirements.map((entry) => (
                    <article key={entry.serviceName} className="inspect-service-card">
                      <strong>{entry.serviceName}</strong>
                      <p>{entry.devicePaths.join(", ")}</p>
                    </article>
                  ))}
                </div>
              ) : (
                <p className="hint">検出できた device 要件はありません。</p>
              )}
            </div>
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

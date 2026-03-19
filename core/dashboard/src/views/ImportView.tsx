import { useState, type FormEvent } from "react";
import { ComposeInspectDialog } from "../components/ComposeInspectDialog";
import type { ComposeServiceCandidate, ImportComposeInspectResponse } from "../types";

export type ImportFormState = {
  name: string;
  description: string;
  sourceUrl: string;
  defaultBranch: string;
  composePath: string;
  publicServiceName: string;
  publicPort: string;
  hostname: string;
  mode: "standard" | "headless";
  keepVolumesOnRebuild: boolean;
};

export type ImportResolveState = {
  status: "idle" | "resolving" | "resolved" | "error";
  canonicalRepositoryUrl: string;
  branchCandidates: string[];
  branchFixed: boolean;
  repositoryFiles: string[];
  yamlFiles: string[];
  composeCandidates: string[];
  recommendedComposePath: string | null;
  warning: string;
};

export type ImportComposeState = {
  status: "idle" | "inspecting" | "ready" | "error";
  inspection: ImportComposeInspectResponse | null;
  services: ComposeServiceCandidate[];
  warning: string;
};

type ImportViewProps = {
  form: ImportFormState;
  deviceRequirementsRaw: string;
  environmentOverrides: Record<string, string>;
  resolveState: ImportResolveState;
  composeState: ImportComposeState;
  rootDomain: string;
  loading: boolean;
  onFieldChange: <K extends keyof ImportFormState>(key: K, value: ImportFormState[K]) => void;
  onDeviceRequirementsChange: (value: string) => void;
  onEnvironmentOverrideChange: (name: string, value: string) => void;
  onResolveSource: () => Promise<void>;
  onInspectCompose: (composePath: string) => Promise<void>;
  onSelectService: (service: ComposeServiceCandidate) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
};

export function ImportView(props: ImportViewProps) {
  const {
    form,
    deviceRequirementsRaw,
    environmentOverrides,
    resolveState,
    composeState,
    rootDomain,
    loading,
    onFieldChange,
    onDeviceRequirementsChange,
    onEnvironmentOverrideChange,
    onResolveSource,
    onInspectCompose,
    onSelectService,
    onSubmit
  } = props;
  const [inspectDialogOpen, setInspectDialogOpen] = useState(false);

  const hasResolvedRepository = resolveState.canonicalRepositoryUrl.length > 0;
  const hasBranch = form.defaultBranch.trim().length > 0;
  const hasComposeSelection = form.composePath.trim().length > 0;
  const hasComposeInspection = composeState.status === "ready" && composeState.services.length > 0 && form.publicServiceName.trim().length > 0;
  const otherYamlFiles = resolveState.yamlFiles.filter((yamlPath) => !resolveState.composeCandidates.includes(yamlPath));

  return (
    <div className="view-grid">
      <section className="panel-card import-card">
        <div className="panel-head">
          <div>
            <h2>GitHub からアプリ登録</h2>
            <p className="panel-sub">上から順に進めるウィザード形式で登録します。</p>
          </div>
        </div>

        <form onSubmit={(event) => void onSubmit(event)} className="import-form">
          <section className="step-section">
            <p className="step-index">STEP 1</p>
            <h3>GitHub URL を入力</h3>
            <p className="panel-sub">`/tree/&lt;branch&gt;` URL または `.git` URL を指定します。</p>

            <label>
              GitHub URL
              <div className="inline-field">
                <input
                  required
                  placeholder="https://github.com/<org>/<repo>/tree/<branch>"
                  value={form.sourceUrl}
                  onChange={(event) => onFieldChange("sourceUrl", event.target.value)}
                  onBlur={() => void onResolveSource()}
                />
                <button
                  type="button"
                  className="button secondary"
                  onClick={() => void onResolveSource()}
                  disabled={resolveState.status === "resolving"}
                >
                  {resolveState.status === "resolving" ? "解析中..." : "URL解析"}
                </button>
              </div>
            </label>
          </section>

          {hasResolvedRepository ? (
            <section className="step-section">
              <p className="step-index">STEP 2</p>
              <h3>ブランチを確認</h3>
              <div className="resolve-panel">
                <p>
                  正規化URL: <code>{resolveState.canonicalRepositoryUrl}</code>
                </p>
                <label>
                  ブランチ
                  <input
                    list="branch-candidates"
                    value={form.defaultBranch}
                    onChange={(event) => onFieldChange("defaultBranch", event.target.value)}
                    disabled={resolveState.branchFixed}
                  />
                  <datalist id="branch-candidates">
                    {resolveState.branchCandidates.map((branch) => (
                      <option key={branch} value={branch} />
                    ))}
                  </datalist>
                </label>
                <p className="hint">
                  {resolveState.branchFixed
                    ? "このURL形式では branch は main 固定です。"
                    : "branch候補は自動取得されています。必要ならここで上書きできます。"}
                </p>
                <p className="hint">取得ファイル数: {resolveState.repositoryFiles.length} 件</p>
                {resolveState.warning ? <p className="hint warning">{resolveState.warning}</p> : null}
              </div>
            </section>
          ) : (
            <section className="step-section locked">
              <p className="step-index">STEP 2</p>
              <h3>ブランチを確認</h3>
              <p className="step-lock">先に GitHub URL を解析してください。</p>
            </section>
          )}

          {hasResolvedRepository && hasBranch ? (
            <section className="step-section">
              <p className="step-index">STEP 3</p>
              <h3>composeファイル候補を選択</h3>
              <div className="resolve-panel">
                <p className="hint">自動検出: {resolveState.composeCandidates.length} 件</p>
                {resolveState.composeCandidates.length > 0 ? (
                  <div className="chip-list">
                    {resolveState.composeCandidates.map((composePath) => (
                      <button
                        key={composePath}
                        type="button"
                        className={`chip-button ${form.composePath === composePath ? "active" : ""}`}
                        onClick={() => {
                          onFieldChange("composePath", composePath);
                          void onInspectCompose(composePath);
                        }}
                      >
                        {composePath}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="hint warning">compose 候補を自動検出できませんでした。下の YAML 一覧から選択してください。</p>
                )}

                {otherYamlFiles.length > 0 ? (
                  <div className="yaml-block">
                    <p className="hint">その他の YAML ファイル</p>
                    <div className="yaml-file-list">
                      {otherYamlFiles.slice(0, 24).map((yamlPath) => (
                        <button
                          key={yamlPath}
                          type="button"
                          className={`file-link-button ${form.composePath === yamlPath ? "active" : ""}`}
                          onClick={() => {
                            onFieldChange("composePath", yamlPath);
                            void onInspectCompose(yamlPath);
                          }}
                        >
                          {yamlPath}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : null}
              </div>
            </section>
          ) : (
            <section className="step-section locked">
              <p className="step-index">STEP 3</p>
              <h3>composeファイル候補を選択</h3>
              <p className="step-lock">ブランチを確定すると compose ファイル候補が表示されます。</p>
            </section>
          )}

          {hasResolvedRepository && hasBranch && hasComposeSelection ? (
            <section className="step-section">
              <p className="step-index">STEP 4</p>
              <h3>composeファイルを解析してサービスを選ぶ</h3>
              <div className="resolve-panel">
                <div className="compose-summary-row">
                  <p>
                    選択中: <code>{form.composePath}</code>
                  </p>
                  {composeState.inspection ? (
                    <button
                      type="button"
                      className="icon-button"
                      aria-label="取得した YAML と解析結果を表示"
                      title="取得した YAML と解析結果を表示"
                      onClick={() => setInspectDialogOpen(true)}
                    >
                      i
                    </button>
                  ) : null}
                </div>
                {composeState.warning ? <p className="hint warning">{composeState.warning}</p> : null}
                {composeState.services.length > 0 ? (
                  <div className="service-grid">
                    {composeState.services.map((service) => (
                      <button
                        key={service.name}
                        type="button"
                        className={`service-card ${form.publicServiceName === service.name ? "active" : ""}`}
                        onClick={() => onSelectService(service)}
                      >
                        <strong>{service.name}</strong>
                        <span>{service.likelyPublic ? "公開候補" : "候補"}</span>
                        <span>推定ポート: {service.detectedPublicPort ?? "未検出"}</span>
                        <span>ports/expose: {service.portOptions.length > 0 ? service.portOptions.join(", ") : "なし"}</span>
                        <span>{service.reason}</span>
                      </button>
                    ))}
                  </div>
                ) : composeState.status === "inspecting" ? (
                  <p className="hint">compose を解析しています。</p>
                ) : composeState.inspection?.parseError ? (
                  <p className="hint warning">YAML の parse に失敗しました。右上の i ボタンから raw YAML と parse error を確認できます。</p>
                ) : (
                  <p className="hint">サービス候補がまだありません。compose解析を実行してください。</p>
                )}
              </div>
            </section>
          ) : (
            <section className="step-section locked">
              <p className="step-index">STEP 4</p>
              <h3>composeファイルを解析してサービスを選ぶ</h3>
              <p className="step-lock">compose ファイルを選択するとサービス候補が表示されます。</p>
            </section>
          )}

          {hasComposeInspection ? (
            <section className="step-section">
              <p className="step-index">STEP 5</p>
              <h3>アプリ情報を入力して登録</h3>
              <div className="resolve-panel">
                <p>
                  選択した compose: <code>{form.composePath}</code>
                </p>
                <p>
                  選択した公開サービス: <code>{form.publicServiceName}</code>
                </p>
              </div>
              <div className="form-grid">
                <label>
                  アプリ名
                  <input required value={form.name} onChange={(event) => onFieldChange("name", event.target.value)} />
                </label>
                <label>
                  説明
                  <input value={form.description} onChange={(event) => onFieldChange("description", event.target.value)} />
                </label>
                <label>
                  サブドメイン
                  <input
                    required
                    placeholder={`app.${rootDomain}`}
                    value={form.hostname}
                    onChange={(event) => onFieldChange("hostname", event.target.value)}
                  />
                </label>
                <label>
                  公開ポート
                  <input
                    type="number"
                    required
                    min={1}
                    max={65535}
                    value={form.publicPort}
                    onChange={(event) => onFieldChange("publicPort", event.target.value)}
                  />
                </label>
                <label>
                  モード
                  <select
                    value={form.mode}
                    onChange={(event) => onFieldChange("mode", event.target.value as "standard" | "headless")}
                  >
                    <option value="standard">Standard</option>
                    <option value="headless">Headless</option>
                  </select>
                </label>
                <label>
                  再ビルド時データ保持
                  <select
                    value={String(form.keepVolumesOnRebuild)}
                    onChange={(event) => onFieldChange("keepVolumesOnRebuild", event.target.value === "true")}
                  >
                    <option value="true">保持する</option>
                    <option value="false">保持しない</option>
                  </select>
                </label>
              </div>

              <label>
                デバイス要件 (カンマ区切り)
                <input
                  placeholder="/dev/bus/usb, /dev/ttyUSB0"
                  value={deviceRequirementsRaw}
                  onChange={(event) => onDeviceRequirementsChange(event.target.value)}
                />
              </label>

              {composeState.inspection?.detectedDeviceRequirements.length ? (
                <p className="hint">
                  compose から自動検出: <code>{composeState.inspection.detectedDeviceRequirements.join(", ")}</code>
                </p>
              ) : null}

              {composeState.inspection?.environmentRequirements.length ? (
                <div className="env-override-section">
                  <p className="hint">compose から検出した環境変数</p>
                  <div className="env-override-grid">
                    {composeState.inspection.environmentRequirements.map((requirement) => (
                      <label key={requirement.name} className="env-override-card">
                        <span>
                          {requirement.name}
                          {requirement.required ? " *" : ""}
                        </span>
                        <input
                          value={environmentOverrides[requirement.name] ?? ""}
                          onChange={(event) => onEnvironmentOverrideChange(requirement.name, event.target.value)}
                          placeholder={requirement.defaultValue ?? "値を入力"}
                        />
                        <small className="hint">
                          services: <code>{requirement.services.join(", ")}</code>
                          {requirement.required
                            ? " / 必須"
                            : requirement.defaultValue !== null
                              ? ` / 既定値: ${requirement.defaultValue}`
                              : " / 任意"}
                        </small>
                      </label>
                    ))}
                  </div>
                </div>
              ) : null}

              <p className="hint">
                現在の設定ドメインは <code>{rootDomain}</code> です。別ドメインも登録できますが、
                その場合は DNS または hosts で名前解決できるようにしてください。
              </p>

              <button type="submit" className="button primary" disabled={loading}>
                登録して配備キューに追加
              </button>
            </section>
          ) : (
            <section className="step-section locked">
              <p className="step-index">STEP 5</p>
              <h3>アプリ情報を入力して登録</h3>
              <p className="step-lock">compose 解析が終わると登録フォームが表示されます。</p>
            </section>
          )}
        </form>
      </section>

      <ComposeInspectDialog
        open={inspectDialogOpen}
        title="Compose Inspection"
        inspection={composeState.inspection}
        onClose={() => setInspectDialogOpen(false)}
      />
    </div>
  );
}

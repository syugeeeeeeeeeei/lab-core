import { useEffect, useRef, useState } from "react";
import { ComposeInspectDialog } from "../components/ComposeInspectDialog";
import type { ApplicationDetail, ApplicationListItem, ComposeServiceCandidate, DeleteMode } from "../types";
import { jobStatusBadgeClass, logLineClass, shortCommit, statusBadgeClass, toLocale } from "../ui";

export type DetailLogState = {
  opened: boolean;
  services: string[];
  selectedService: string;
  tail: number;
  lines: string[];
  lastFetchedAt: string;
  loading: boolean;
  autoScroll: boolean;
};

type DeploymentFormState = {
  composePath: string;
  publicServiceName: string;
  publicPort: string;
  hostname: string;
  keepVolumesOnRebuild: boolean;
  envOverrides: Record<string, string>;
};

type DeploymentComposeState = {
  status: "idle" | "loading" | "ready" | "error";
  composeCandidates: string[];
  yamlFiles: string[];
  services: ComposeServiceCandidate[];
  selectedComposePath: string;
  inspection: ApplicationDetail["composeInspection"];
  warning: string;
};

type ApplicationDetailViewProps = {
  application: ApplicationListItem | null;
  detail: ApplicationDetail | null;
  detailLoading: boolean;
  loading: boolean;
  logs: DetailLogState;
  deploymentForm: DeploymentFormState;
  deploymentComposeState: DeploymentComposeState;
  deploymentDirty: boolean;
  deleteMode: DeleteMode;
  deleteConfirmText: string;
  onBackToApplications: () => void;
  onDeploymentFieldChange: <K extends keyof DeploymentFormState>(key: K, value: DeploymentFormState[K]) => void;
  onDeploymentEnvironmentOverrideChange: (name: string, value: string) => void;
  onSelectDeploymentCompose: (composePath: string) => void;
  onSelectDeploymentService: (service: ComposeServiceCandidate) => void;
  onResetDeployment: () => void;
  onSaveDeployment: () => void;
  onStop: (applicationId: string, applicationName: string) => void;
  onResume: (applicationId: string, applicationName: string) => void;
  onRestart: (applicationId: string, applicationName: string) => void;
  onRebuild: (applicationId: string, applicationName: string) => void;
  onCheckUpdate: (applicationId: string, applicationName: string) => void;
  onApplyUpdate: (applicationId: string, applicationName: string) => void;
  onRollback: (applicationId: string, applicationName: string) => void;
  onOpenLogs: (application: ApplicationListItem) => void;
  onRefreshLogs: (service?: string, tail?: number) => void;
  onSetSelectedLogService: (service: string) => void;
  onSetLogTail: (tail: number) => void;
  onSetAutoScroll: (enabled: boolean) => void;
  onDeleteModeChange: (mode: DeleteMode) => void;
  onDeleteConfirmChange: (value: string) => void;
  onDeleteSubmit: () => void;
};

export function ApplicationDetailView(props: ApplicationDetailViewProps) {
  const {
    application,
    detail,
    detailLoading,
    loading,
    logs,
    deploymentForm,
    deploymentComposeState,
    deploymentDirty,
    deleteMode,
    deleteConfirmText,
    onBackToApplications,
    onDeploymentFieldChange,
    onDeploymentEnvironmentOverrideChange,
    onSelectDeploymentCompose,
    onSelectDeploymentService,
    onResetDeployment,
    onSaveDeployment,
    onStop,
    onResume,
    onRestart,
    onRebuild,
    onCheckUpdate,
    onApplyUpdate,
    onRollback,
    onOpenLogs,
    onRefreshLogs,
    onSetSelectedLogService,
    onSetLogTail,
    onSetAutoScroll,
    onDeleteModeChange,
    onDeleteConfirmChange,
    onDeleteSubmit
  } = props;
  const logViewerRef = useRef<HTMLDivElement | null>(null);
  const [deploymentExpanded, setDeploymentExpanded] = useState(true);
  const [eventsExpanded, setEventsExpanded] = useState(true);
  const [logsExpanded, setLogsExpanded] = useState(false);
  const [inspectDialogOpen, setInspectDialogOpen] = useState(false);

  useEffect(() => {
    if (!logs.opened || !logs.autoScroll || !logViewerRef.current) {
      return;
    }
    logViewerRef.current.scrollTop = logViewerRef.current.scrollHeight;
  }, [logs.autoScroll, logs.lines, logs.opened]);

  useEffect(() => {
    setDeploymentExpanded(true);
    setEventsExpanded(true);
    setLogsExpanded(false);
    setInspectDialogOpen(false);
  }, [application?.application_id]);

  if (!application) {
    return (
      <div className="view-grid detail-view">
        <section className="panel-card">
          <h2>アプリ詳細</h2>
          <p className="empty-message">アプリを選択すると詳細を表示します。</p>
          <button type="button" className="button primary" onClick={onBackToApplications}>
            アプリ一覧へ
          </button>
        </section>
      </div>
    );
  }

  const currentApplication = application;
  const recentEvents = (detail?.events ?? []).slice(0, 20);
  const deployment = detail?.deployment;
  const composeCandidates = deploymentComposeState.composeCandidates;
  const otherYamlFiles = deploymentComposeState.yamlFiles.filter((yamlPath) => !composeCandidates.includes(yamlPath));
  const environmentRequirements = deploymentComposeState.inspection?.environmentRequirements ?? [];
  const environmentRequirementMap = new Map(environmentRequirements.map((requirement) => [requirement.name, requirement]));
  const envOverrideKeys = [...new Set([...environmentRequirements.map((requirement) => requirement.name), ...Object.keys(deploymentForm.envOverrides)])]
    .sort((a, b) => a.localeCompare(b));
  const deploymentEnabled = detail?.deployment?.enabled ?? currentApplication.status !== "Stopped";

  function toggleLogsPanel(): void {
    const nextExpanded = !logsExpanded;
    setLogsExpanded(nextExpanded);

    if (nextExpanded && !logs.opened && !logs.loading) {
      onOpenLogs(currentApplication);
    }
  }

  return (
    <div className="view-grid detail-view">
      <section className="panel-card">
        <div className="panel-head">
          <h2>{currentApplication.name}</h2>
          <button type="button" className="button secondary" onClick={onBackToApplications}>
            一覧へ戻る
          </button>
        </div>

        <div className="detail-summary">
          <p>
            状態: <span className={statusBadgeClass(currentApplication.status)}>{currentApplication.status}</span>
          </p>
          <p>公開状態: {deploymentEnabled ? "有効" : "停止中"}</p>
          <p>
            公開先:{" "}
            <a href={`http://${currentApplication.hostname}`} target="_blank" rel="noreferrer">
              {currentApplication.hostname}
            </a>
          </p>
          <p>default branch: {currentApplication.default_branch}</p>
          <p>current: {shortCommit(currentApplication.current_commit)}</p>
          <p>previous: {shortCommit(currentApplication.previous_commit)}</p>
        </div>

        {currentApplication.latest_job_status || currentApplication.latest_job_message ? (
          <div className="detail-progress-card">
            <div className="panel-head compact">
              <h3>進行状況</h3>
              <span className={jobStatusBadgeClass(currentApplication.latest_job_status)}>
                {currentApplication.latest_job_type ?? "job"} / {currentApplication.latest_job_status ?? "unknown"}
              </span>
            </div>
            {currentApplication.latest_job_message ? <p className="detail-progress-message">{currentApplication.latest_job_message}</p> : null}
            <div className="detail-progress-meta">
              {currentApplication.latest_job_created_at ? <p>作成: {toLocale(currentApplication.latest_job_created_at)}</p> : null}
              {currentApplication.latest_job_started_at ? <p>開始: {toLocale(currentApplication.latest_job_started_at)}</p> : null}
              {currentApplication.latest_job_finished_at ? <p>終了: {toLocale(currentApplication.latest_job_finished_at)}</p> : null}
            </div>
            <p className="panel-sub">配備や更新が進むと、この表示は自動で更新されます。</p>
          </div>
        ) : null}

        {currentApplication.latest_error_title ? (
          <div className="detail-error-card">
            <strong>{currentApplication.latest_error_title}</strong>
            {currentApplication.latest_error_at ? <p>{toLocale(currentApplication.latest_error_at)}</p> : null}
            {currentApplication.latest_error_message ? <pre>{currentApplication.latest_error_message}</pre> : null}
          </div>
        ) : null}

        <div className="detail-actions">
          {deploymentEnabled ? (
            <button type="button" className="button tiny secondary" onClick={() => onStop(currentApplication.application_id, currentApplication.name)}>
              停止
            </button>
          ) : (
            <button type="button" className="button tiny primary" onClick={() => onResume(currentApplication.application_id, currentApplication.name)}>
              再開
            </button>
          )}
          <button
            type="button"
            className="button tiny"
            onClick={() => onRestart(currentApplication.application_id, currentApplication.name)}
            disabled={!deploymentEnabled}
            title={!deploymentEnabled ? "停止中は再開してから再起動してください" : ""}
          >
            再起動
          </button>
          <button type="button" className="button tiny secondary" onClick={() => onRebuild(currentApplication.application_id, currentApplication.name)}>
            再ビルド
          </button>
          <button type="button" className="button tiny warn" onClick={() => onCheckUpdate(currentApplication.application_id, currentApplication.name)}>
            更新確認
          </button>
          <button type="button" className="button tiny warn" onClick={() => onApplyUpdate(currentApplication.application_id, currentApplication.name)}>
            更新適用
          </button>
          <button
            type="button"
            className="button tiny"
            onClick={() => onRollback(currentApplication.application_id, currentApplication.name)}
            disabled={!currentApplication.previous_commit}
            title={!currentApplication.previous_commit ? "ロールバック可能な1つ前コミットがありません" : ""}
          >
            ロールバック
          </button>
        </div>
      </section>

      <section className={`panel-card accordion-card ${deploymentExpanded ? "open" : ""}`}>
        <button
          type="button"
          className="accordion-toggle"
          onClick={() => setDeploymentExpanded((prev) => !prev)}
          aria-expanded={deploymentExpanded}
        >
          <div>
            <h2>デプロイ設定</h2>
            <p className="panel-sub">
              保存すると公開先と次回以降の配備設定に反映されます。
              {detailLoading ? " 読み込み中..." : ""}
            </p>
          </div>
          <span className="accordion-meta">{deploymentExpanded ? "折りたたむ" : "開く"}</span>
        </button>

        <div className={`accordion-body-wrap ${deploymentExpanded ? "open" : ""}`}>
          <div className="accordion-body-inner">
            <div className="accordion-body">
        {deployment ? (
          <>
            <div className="deployment-picker-section">
              <div className="compose-summary-row">
                <p>
                  選択中: <code>{deploymentForm.composePath}</code>
                </p>
                {deploymentComposeState.inspection ? (
                  <button
                    type="button"
                    className="icon-button"
                    aria-label="取得した YAML と解析結果を表示"
                    title="取得した YAML と解析結果を表示"
                    onClick={() => setInspectDialogOpen(true)}
                    disabled={deploymentComposeState.status === "loading"}
                  >
                    i
                  </button>
                ) : null}
              </div>

              <p className="hint">compose 候補から選択</p>
              {composeCandidates.length > 0 ? (
                <div className="chip-list">
                  {composeCandidates.map((composePath) => (
                    <button
                      key={composePath}
                      type="button"
                      className={`chip-button ${deploymentForm.composePath === composePath ? "active" : ""}`}
                      onClick={() => onSelectDeploymentCompose(composePath)}
                      disabled={loading || deploymentComposeState.status === "loading"}
                    >
                      {composePath}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="hint warning">compose 候補をまだ検出できていません。</p>
              )}

              {otherYamlFiles.length > 0 ? (
                <div className="yaml-block">
                  <p className="hint">その他の YAML ファイル</p>
                  <div className="yaml-file-list">
                    {otherYamlFiles.map((yamlPath) => (
                      <button
                        key={yamlPath}
                        type="button"
                        className={`file-link-button ${deploymentForm.composePath === yamlPath ? "active" : ""}`}
                        onClick={() => onSelectDeploymentCompose(yamlPath)}
                        disabled={loading || deploymentComposeState.status === "loading"}
                      >
                        {yamlPath}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {deploymentComposeState.warning ? <p className="hint warning">{deploymentComposeState.warning}</p> : null}
            </div>

            <div className="deployment-picker-section">
              <p className="hint">公開サービスを選択</p>
              {deploymentComposeState.services.length > 0 ? (
                <div className="service-grid">
                  {deploymentComposeState.services.map((service) => (
                    <button
                      key={service.name}
                      type="button"
                      className={`service-card ${deploymentForm.publicServiceName === service.name ? "active" : ""}`}
                      onClick={() => onSelectDeploymentService(service)}
                      disabled={loading || deploymentComposeState.status === "loading"}
                    >
                      <strong>{service.name}</strong>
                      <span>{service.likelyPublic ? "公開候補" : "候補"}</span>
                      <span>推定ポート: {service.detectedPublicPort ?? "未検出"}</span>
                      <span>ports/expose: {service.portOptions.length > 0 ? service.portOptions.join(", ") : "なし"}</span>
                      <span>{service.reason}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <p className="hint warning">
                  {deploymentComposeState.inspection?.parseError
                    ? "YAML の parse に失敗しました。上の i ボタンから raw YAML と parse error を確認できます。"
                    : "compose を選ぶとサービス候補が表示されます。"}
                </p>
              )}
            </div>

            <div className="form-grid deployment-form-grid">
              <label>
                公開ホスト名
                <input
                  value={deploymentForm.hostname}
                  onChange={(event) => onDeploymentFieldChange("hostname", event.target.value)}
                  placeholder="example.fukaya-sus.lab"
                />
              </label>
              <label>
                公開ポート
                <input
                  inputMode="numeric"
                  value={deploymentForm.publicPort}
                  onChange={(event) => onDeploymentFieldChange("publicPort", event.target.value)}
                  placeholder="3000"
                />
              </label>
            </div>

            <label className="checkbox-row detail-checkbox-row">
              <input
                type="checkbox"
                checked={deploymentForm.keepVolumesOnRebuild}
                onChange={(event) => onDeploymentFieldChange("keepVolumesOnRebuild", event.target.checked)}
              />
              再ビルド時にデータを保持する
            </label>

            {envOverrideKeys.length > 0 ? (
              <div className="deployment-picker-section">
                <p className="hint">compose から検出した環境変数</p>
                <div className="env-override-grid">
                  {envOverrideKeys.map((name) => {
                    const requirement = environmentRequirementMap.get(name);
                    return (
                      <label key={name} className="env-override-card">
                        <span>
                          {name}
                          {requirement?.required ? " *" : ""}
                        </span>
                        <input
                          value={deploymentForm.envOverrides[name] ?? ""}
                          onChange={(event) => onDeploymentEnvironmentOverrideChange(name, event.target.value)}
                          placeholder={requirement?.defaultValue ?? "値を入力"}
                        />
                        <small className="hint">
                          {requirement
                            ? `services: ${requirement.services.join(", ")}`
                            : "保存済み override"}
                          {requirement?.required
                            ? " / 必須"
                            : requirement && requirement.defaultValue !== null
                              ? ` / 既定値: ${requirement.defaultValue}`
                              : ""}
                        </small>
                      </label>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="detail-actions">
              <button
                type="button"
                className="button primary"
                onClick={onSaveDeployment}
                disabled={loading || !deploymentDirty}
              >
                デプロイ設定を保存
              </button>
              <button
                type="button"
                className="button secondary"
                onClick={onResetDeployment}
                disabled={loading || !deploymentDirty}
              >
                編集を戻す
              </button>
            </div>
          </>
        ) : (
          <p className="empty-message">
            {detailLoading ? "配備設定を読み込んでいます..." : "このアプリの配備設定はまだ取得できていません。"}
          </p>
        )}
            </div>
          </div>
        </div>
      </section>

      <section className={`panel-card accordion-card ${eventsExpanded ? "open" : ""}`}>
        <button
          type="button"
          className="accordion-toggle"
          onClick={() => setEventsExpanded((prev) => !prev)}
          aria-expanded={eventsExpanded}
        >
          <div>
            <h2>最近の進行イベント</h2>
            <p className="panel-sub">10秒ごとに自動更新します。</p>
          </div>
          <span className="accordion-meta">{recentEvents.length} 件 / {eventsExpanded ? "折りたたむ" : "開く"}</span>
        </button>

        <div className={`accordion-body-wrap ${eventsExpanded ? "open" : ""}`}>
          <div className="accordion-body-inner">
            <div className="accordion-body detail-events-scroll">
            {recentEvents.length === 0 ? (
              <p className="empty-message">
                {detailLoading ? "イベントを読み込んでいます..." : "このアプリに紐づくイベントはまだありません。"}
              </p>
            ) : (
              <ul className="event-list detail-event-list">
                {recentEvents.map((event) => (
                  <li key={event.event_id} className={`event-item ${event.level}`}>
                    <div>
                      <strong>{event.title}</strong>
                      <p>{event.message}</p>
                      {(event.message.includes("\n") || event.message.length > 140) ? (
                        <details className="event-details">
                          <summary>詳細を開く</summary>
                          <pre>{event.message}</pre>
                        </details>
                      ) : null}
                    </div>
                    <time>{toLocale(event.created_at)}</time>
                  </li>
                ))}
              </ul>
            )}
            </div>
          </div>
        </div>
      </section>

      <section className={`panel-card accordion-card ${logsExpanded ? "open" : ""}`}>
        <button type="button" className="accordion-toggle" onClick={toggleLogsPanel} aria-expanded={logsExpanded}>
          <div>
            <h2>ログ確認</h2>
            <p className="panel-sub">
              {logs.lastFetchedAt.length > 0 ? `最終取得: ${toLocale(logs.lastFetchedAt)}` : "開くと5秒ごとに自動更新します。"}
            </p>
          </div>
          <span className="accordion-meta">{logsExpanded ? "折りたたむ" : "開く"}</span>
        </button>

        <div className={`accordion-body-wrap ${logsExpanded ? "open" : ""}`}>
          <div className="accordion-body-inner">
            <div className="accordion-body">
            <div className="logs-controls">
              <label>
                サービス
                <select
                  value={logs.selectedService}
                  onChange={(event) => {
                    const service = event.target.value;
                    onSetSelectedLogService(service);
                    onRefreshLogs(service);
                  }}
                >
                  <option value="">全サービス</option>
                  {logs.services.map((service) => (
                    <option key={service} value={service}>
                      {service}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                表示行数
                <select
                  value={String(logs.tail)}
                  onChange={(event) => {
                    const tail = Number(event.target.value);
                    onSetLogTail(tail);
                    onRefreshLogs(undefined, tail);
                  }}
                >
                  <option value="100">100</option>
                  <option value="200">200</option>
                  <option value="500">500</option>
                  <option value="1000">1000</option>
                </select>
              </label>
              <label className="checkbox-row">
                <input type="checkbox" checked={logs.autoScroll} onChange={(event) => onSetAutoScroll(event.target.checked)} />
                自動スクロール
              </label>
              <button type="button" className="button tiny secondary" onClick={() => onRefreshLogs()} disabled={logs.loading}>
                {logs.loading ? "取得中..." : "ログ更新"}
              </button>
            </div>

            <div className="log-viewer detail-log-viewer" ref={logViewerRef}>
              {logs.lines.length === 0 ? (
                <p className="log-empty">{logs.loading ? "ログを取得しています..." : "表示できるログがありません。"}</p>
              ) : (
                <ul className="log-lines">
                  {logs.lines.map((line, index) => (
                    <li key={`${index}-${line.slice(0, 30)}`} className={logLineClass(line)}>
                      {line}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            </div>
          </div>
        </div>
      </section>

      <section className="panel-card danger-card">
        <h2>削除</h2>
        <p className="panel-sub">破壊的操作です。モード選択と確認入力が必要です。</p>
        <div className="delete-grid">
          <label>
            削除モード
            <select value={deleteMode} onChange={(event) => onDeleteModeChange(event.target.value as DeleteMode)}>
              <option value="config_only">構成のみ削除</option>
              <option value="source_and_config">構成 + ソース削除</option>
              <option value="full">構成 + ソース + データ削除</option>
            </select>
          </label>
          <label>
            確認用アプリ名
            <input
              placeholder={currentApplication.name}
              value={deleteConfirmText}
              onChange={(event) => onDeleteConfirmChange(event.target.value)}
            />
          </label>
        </div>
        <div className="delete-actions">
          <button type="button" className="button danger" onClick={onDeleteSubmit} disabled={loading}>
            削除ジョブを開始
          </button>
        </div>
      </section>

      <ComposeInspectDialog
        open={inspectDialogOpen}
        title="Compose Inspection"
        inspection={deploymentComposeState.inspection}
        onClose={() => setInspectDialogOpen(false)}
      />
    </div>
  );
}

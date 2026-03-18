import { useEffect, useRef } from "react";
import type { ApplicationListItem, DeleteMode, SystemEvent } from "../types";
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

type ApplicationDetailViewProps = {
  application: ApplicationListItem | null;
  events: SystemEvent[];
  loading: boolean;
  logs: DetailLogState;
  deleteMode: DeleteMode;
  deleteConfirmText: string;
  onBackToApplications: () => void;
  onRestart: (applicationId: string, applicationName: string) => void;
  onRebuild: (applicationId: string, applicationName: string) => void;
  onCheckUpdate: (applicationId: string, applicationName: string) => void;
  onApplyUpdate: (applicationId: string, applicationName: string) => void;
  onRollback: (applicationId: string, applicationName: string) => void;
  onOpenLogs: (application: ApplicationListItem) => void;
  onRefreshLogs: (service?: string, tail?: number) => void;
  onCloseLogs: () => void;
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
    events,
    loading,
    logs,
    deleteMode,
    deleteConfirmText,
    onBackToApplications,
    onRestart,
    onRebuild,
    onCheckUpdate,
    onApplyUpdate,
    onRollback,
    onOpenLogs,
    onRefreshLogs,
    onCloseLogs,
    onSetSelectedLogService,
    onSetLogTail,
    onSetAutoScroll,
    onDeleteModeChange,
    onDeleteConfirmChange,
    onDeleteSubmit
  } = props;
  const logViewerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!logs.opened || !logs.autoScroll || !logViewerRef.current) {
      return;
    }
    logViewerRef.current.scrollTop = logViewerRef.current.scrollHeight;
  }, [logs.autoScroll, logs.lines, logs.opened]);

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

  const recentEvents = events
    .filter((event) => event.application_id === application.application_id)
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .slice(0, 6);

  return (
    <div className="view-grid detail-view">
      <section className="panel-card">
        <div className="panel-head">
          <h2>{application.name}</h2>
          <button type="button" className="button secondary" onClick={onBackToApplications}>
            一覧へ戻る
          </button>
        </div>

        <div className="detail-summary">
          <p>
            状態: <span className={statusBadgeClass(application.status)}>{application.status}</span>
          </p>
          <p>
            公開先:{" "}
            <a href={`http://${application.hostname}`} target="_blank" rel="noreferrer">
              {application.hostname}
            </a>
          </p>
          <p>default branch: {application.default_branch}</p>
          <p>current: {shortCommit(application.current_commit)}</p>
          <p>previous: {shortCommit(application.previous_commit)}</p>
        </div>

        {application.latest_job_status || application.latest_job_message ? (
          <div className="detail-progress-card">
            <div className="panel-head compact">
              <h3>進行状況</h3>
              <span className={jobStatusBadgeClass(application.latest_job_status)}>
                {application.latest_job_type ?? "job"} / {application.latest_job_status ?? "unknown"}
              </span>
            </div>
            {application.latest_job_message ? <p className="detail-progress-message">{application.latest_job_message}</p> : null}
            <div className="detail-progress-meta">
              {application.latest_job_created_at ? <p>作成: {toLocale(application.latest_job_created_at)}</p> : null}
              {application.latest_job_started_at ? <p>開始: {toLocale(application.latest_job_started_at)}</p> : null}
              {application.latest_job_finished_at ? <p>終了: {toLocale(application.latest_job_finished_at)}</p> : null}
            </div>
            <p className="panel-sub">配備や更新が進むと、この表示は自動で更新されます。</p>
          </div>
        ) : null}

        {application.latest_error_title ? (
          <div className="detail-error-card">
            <strong>{application.latest_error_title}</strong>
            {application.latest_error_at ? <p>{toLocale(application.latest_error_at)}</p> : null}
            {application.latest_error_message ? <pre>{application.latest_error_message}</pre> : null}
          </div>
        ) : null}

        <div className="detail-actions">
          <button type="button" className="button tiny" onClick={() => onRestart(application.application_id, application.name)}>
            再起動
          </button>
          <button type="button" className="button tiny secondary" onClick={() => onRebuild(application.application_id, application.name)}>
            再ビルド
          </button>
          <button type="button" className="button tiny warn" onClick={() => onCheckUpdate(application.application_id, application.name)}>
            更新確認
          </button>
          <button type="button" className="button tiny warn" onClick={() => onApplyUpdate(application.application_id, application.name)}>
            更新適用
          </button>
          <button
            type="button"
            className="button tiny"
            onClick={() => onRollback(application.application_id, application.name)}
            disabled={!application.previous_commit}
            title={!application.previous_commit ? "ロールバック可能な1つ前コミットがありません" : ""}
          >
            ロールバック
          </button>
          {!logs.opened ? (
            <button type="button" className="button tiny secondary" onClick={() => onOpenLogs(application)}>
              ログを開く
            </button>
          ) : (
            <button type="button" className="button tiny secondary" onClick={onCloseLogs}>
              ログを閉じる
            </button>
          )}
        </div>
      </section>

      <section className="panel-card">
        <div className="panel-head">
          <h2>最近の進行イベント</h2>
          <p className="panel-sub">{recentEvents.length} 件</p>
        </div>
        {recentEvents.length === 0 ? (
          <p className="empty-message">このアプリに紐づくイベントはまだありません。</p>
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
      </section>

      {logs.opened ? (
        <section className="panel-card grow">
          <div className="panel-head">
            <h2>ログ確認</h2>
            <p className="panel-sub">最終取得: {logs.lastFetchedAt.length > 0 ? toLocale(logs.lastFetchedAt) : "未取得"}</p>
          </div>

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

          <div className="log-viewer" ref={logViewerRef}>
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
        </section>
      ) : null}

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
            <input placeholder={application.name} value={deleteConfirmText} onChange={(event) => onDeleteConfirmChange(event.target.value)} />
          </label>
        </div>
        <div className="delete-actions">
          <button type="button" className="button danger" onClick={onDeleteSubmit} disabled={loading}>
            削除ジョブを開始
          </button>
        </div>
      </section>
    </div>
  );
}

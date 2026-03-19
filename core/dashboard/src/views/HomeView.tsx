import type { ApplicationListItem, SystemEvent, SystemStatus } from "../types";
import { statusBadgeClass, toLocale } from "../ui";

type HomeViewProps = {
  system: SystemStatus | null;
  applications: ApplicationListItem[];
  events: SystemEvent[];
  onOpenApplications: () => void;
  onOpenDetail: (applicationId: string) => void;
};

export function HomeView(props: HomeViewProps) {
  const { system, applications, events, onOpenApplications, onOpenDetail } = props;

  const priorityApps = applications
    .filter((application) => application.status === "Failed" || application.status === "Degraded")
    .slice(0, 30);

  const recentEvents = [...events].sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 30);
  const dnsStatus = system?.dnsServer;
  const dnsListening = Boolean(dnsStatus?.udpListening || dnsStatus?.tcpListening);
  const relayHealthy = dnsStatus?.relay ? (dnsStatus.relay.udpReachable || dnsStatus.relay.tcpReachable) : true;

  return (
    <div className="view-grid home-view">
      <section className="metrics-grid">
        <article className="metric-card">
          <p>登録アプリ</p>
          <strong>{system?.applicationSummary.total ?? "-"}</strong>
        </article>
        <article className="metric-card">
          <p>稼働中</p>
          <strong>{system?.applicationSummary.running ?? "-"}</strong>
        </article>
        <article className="metric-card warn">
          <p>不安定</p>
          <strong>{system?.applicationSummary.degraded ?? "-"}</strong>
        </article>
        <article className="metric-card error">
          <p>失敗</p>
          <strong>{system?.applicationSummary.failed ?? "-"}</strong>
        </article>
      </section>

      <section className="quick-grid">
        <article className="quick-card">
          <h2>DNS サーバー</h2>
          <p>
            {dnsStatus?.enabled
              ? dnsListening
                ? dnsStatus.port === 53
                  ? `待受中: ${dnsStatus.bindHost}:${dnsStatus.port}`
                  : `待受中: ${dnsStatus.bindHost}:${dnsStatus.port} / 53番は yarn dev:dns`
                : `起動失敗: ${dnsStatus.lastError ?? "状態不明"}`
              : "無効化されています。"}
          </p>
          {dnsStatus?.relay?.required ? (
            <p className={relayHealthy ? "hint" : "hint warning"}>
              53番前段: {relayHealthy ? "到達可" : `未応答 (${dnsStatus.relay.lastError ?? "状態不明"})`} /{" "}
              {dnsStatus.relay.targetHost}:{dnsStatus.relay.targetPort}
            </p>
          ) : null}
          {dnsStatus?.enabled ? <p>DNS生成ファイル: {dnsStatus.hostsFilePath}</p> : null}
        </article>
      </section>

      <section className="split-grid home-split">
        <article className="panel-card scroll-panel">
          <div className="panel-head">
            <h2>注意が必要なアプリ</h2>
            <button type="button" className="button ghost" onClick={onOpenApplications}>
              全一覧
            </button>
          </div>
          <div className="panel-scroll">
            {priorityApps.length === 0 ? <p className="empty-message">現在、注意アプリはありません。</p> : null}
            <ul className="simple-list">
              {priorityApps.map((application) => (
                <li key={application.application_id} className="list-row">
                  <div>
                    <strong>{application.name}</strong>
                    <p>{application.hostname}</p>
                    {application.latest_error_title ? <p className="error-preview">{application.latest_error_title}</p> : null}
                  </div>
                  <div className="list-actions">
                    <span className={statusBadgeClass(application.status)}>{application.status}</span>
                    <button type="button" className="button tiny" onClick={() => onOpenDetail(application.application_id)}>
                      詳細へ
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </article>

        <article className="panel-card scroll-panel">
          <div className="panel-head">
            <h2>最近のイベント</h2>
          </div>
          <div className="panel-scroll">
            {recentEvents.length === 0 ? <p className="empty-message">イベントはまだありません。</p> : null}
            <ul className="event-list">
              {recentEvents.map((event) => (
                <li key={event.event_id} className={`event-item ${event.level}`}>
                  <div>
                    <strong>{event.title}</strong>
                    {event.application_name ? <p className="event-app">対象: {event.application_name}</p> : null}
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
          </div>
        </article>
      </section>
    </div>
  );
}

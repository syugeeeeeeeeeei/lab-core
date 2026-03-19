#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath } from "node:url";

const command = process.argv[2] ?? "init";
const thisFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(thisFile), "..", "..");
const envPath = path.join(rootDir, "core", "backend", ".env");

const presets = {
  local: {
    label: "ローカル開発（推奨）",
    values: {
      LAB_CORE_PORT: "7300",
      LAB_CORE_EXECUTION_MODE: "dry-run",
      LAB_CORE_DB_PATH: "./core/backend/data/database.sqlite",
      LAB_CORE_DOCKER_SOCKET: "/var/run/docker.sock",
      LAB_CORE_APPS_ROOT: "./runtime/apps",
      LAB_CORE_APPDATA_ROOT: "./runtime/appdata",
      LAB_CORE_MAIN_SERVICE_IP: "127.0.0.1",
      LAB_CORE_SSH_SERVICE_IP: "127.0.0.1",
      LAB_CORE_ROOT_DOMAIN: "lab.localhost",
      LAB_CORE_PROXY_CONFIG_PATH: "./core/backend/data/generated/Caddyfile",
      LAB_CORE_DNS_HOSTS_PATH: "./core/backend/data/generated/fukaya-sus.hosts",
      LAB_CORE_SYNC_DIR: "./core/backend/data/generated",
      LAB_CORE_DNS_SERVER_ENABLED: "true",
      LAB_CORE_DNS_BIND_HOST: "127.0.0.1",
      LAB_CORE_DNS_PORT: "1053",
      LAB_CORE_DNS_UPSTREAMS: ""
    }
  },
  lab: {
    label: "研究室運用",
    values: {
      LAB_CORE_PORT: "7300",
      LAB_CORE_EXECUTION_MODE: "execute",
      LAB_CORE_DB_PATH: "./core/backend/data/database.sqlite",
      LAB_CORE_DOCKER_SOCKET: "/var/run/docker.sock",
      LAB_CORE_APPS_ROOT: "/opt/lab-core/apps",
      LAB_CORE_APPDATA_ROOT: "/opt/lab-core/appdata",
      LAB_CORE_MAIN_SERVICE_IP: "192.168.11.224",
      LAB_CORE_SSH_SERVICE_IP: "192.168.11.225",
      LAB_CORE_ROOT_DOMAIN: "fukaya-sus.lab",
      LAB_CORE_PROXY_CONFIG_PATH: "/opt/lab-core/core/proxy/Caddyfile.generated",
      LAB_CORE_DNS_HOSTS_PATH: "/opt/lab-core/core/dns/fukaya-sus.hosts.generated",
      LAB_CORE_SYNC_DIR: "/opt/lab-core/core/generated",
      LAB_CORE_DNS_SERVER_ENABLED: "true",
      LAB_CORE_DNS_BIND_HOST: "0.0.0.0",
      LAB_CORE_DNS_PORT: "53",
      LAB_CORE_DNS_UPSTREAMS: ""
    }
  },
  vm: {
    label: "検証VM（本番近似）",
    values: {
      LAB_CORE_PORT: "7300",
      LAB_CORE_EXECUTION_MODE: "execute",
      LAB_CORE_DB_PATH: "./core/backend/data/database.sqlite",
      LAB_CORE_DOCKER_SOCKET: "/var/run/docker.sock",
      LAB_CORE_APPS_ROOT: "./runtime/apps",
      LAB_CORE_APPDATA_ROOT: "./runtime/appdata",
      LAB_CORE_MAIN_SERVICE_IP: "192.168.11.224",
      LAB_CORE_SSH_SERVICE_IP: "192.168.11.225",
      LAB_CORE_ROOT_DOMAIN: "fukaya-sus.lab",
      LAB_CORE_PROXY_CONFIG_PATH: "./core/backend/data/generated/Caddyfile",
      LAB_CORE_DNS_HOSTS_PATH: "./core/backend/data/generated/fukaya-sus.hosts",
      LAB_CORE_SYNC_DIR: "./core/backend/data/generated",
      LAB_CORE_DNS_SERVER_ENABLED: "true",
      LAB_CORE_DNS_BIND_HOST: "0.0.0.0",
      LAB_CORE_DNS_PORT: "53",
      LAB_CORE_DNS_UPSTREAMS: ""
    }
  }
};

const fieldDefinitions = [
  {
    key: "LAB_CORE_PORT",
    label: "API待受ポート",
    explanation:
      "この項目は、Dashboard からの API 通信を受け付ける機能に使われている、バックエンド待受ポートという役割を持つ値の番号を決定するための設定です。設定例: 7300, 8080",
    validate: (value) => {
      const num = Number(value);
      return Number.isInteger(num) && num >= 1 && num <= 65535;
    },
    error: "1〜65535 の整数を入力してください。"
  },
  {
    key: "LAB_CORE_EXECUTION_MODE",
    label: "実行モード",
    explanation:
      "この項目は、デプロイや再起動を本当に実行するかを制御する機能に使われている、実行モードという役割を持つ動作レベルを決定するための設定です。設定例: dry-run, execute",
    validate: (value) => value === "dry-run" || value === "execute",
    error: "dry-run または execute を入力してください。"
  },
  {
    key: "LAB_CORE_DB_PATH",
    label: "SQLite DBパス",
    explanation:
      "この項目は、アプリ登録情報やイベント履歴を保存する機能に使われている、状態保存DBという役割を持つ保存先を決定するための設定です。設定例: ./core/backend/data/database.sqlite, /opt/lab-core/core/database.sqlite",
    validate: (value) => value.trim().length > 0,
    error: "空ではないパスを入力してください。"
  },
  {
    key: "LAB_CORE_DOCKER_SOCKET",
    label: "Dockerソケット",
    explanation:
      "この項目は、コンテナ起動・停止コマンドを送る機能に使われている、Docker接続口という役割を持つソケット場所を決定するための設定です。設定例: /var/run/docker.sock, /run/user/1000/docker.sock",
    validate: (value) => value.trim().length > 0,
    error: "空ではないパスを入力してください。"
  },
  {
    key: "LAB_CORE_APPS_ROOT",
    label: "アプリソース配置先",
    explanation:
      "この項目は、Git から取得したアプリソースを保持する機能に使われている、ソース保管庫という役割を持つ配置ディレクトリを決定するための設定です。設定例: ./runtime/apps, /opt/lab-core/apps",
    validate: (value) => value.trim().length > 0,
    error: "空ではないパスを入力してください。"
  },
  {
    key: "LAB_CORE_APPDATA_ROOT",
    label: "アプリデータ配置先",
    explanation:
      "この項目は、アプリの永続データを保護する機能に使われている、データ保管庫という役割を持つ配置ディレクトリを決定するための設定です。設定例: ./runtime/appdata, /opt/lab-core/appdata",
    validate: (value) => value.trim().length > 0,
    error: "空ではないパスを入力してください。"
  },
  {
    key: "LAB_CORE_MAIN_SERVICE_IP",
    label: "公開先IP",
    explanation:
      "この項目は、アプリ公開ホスト名を名前解決する機能に使われている、メイン到達先IPという役割を持つ宛先を決定するための設定です。設定例: 127.0.0.1, 192.168.11.224",
    validate: (value) => /^\d{1,3}(\.\d{1,3}){3}$/.test(value),
    error: "IPv4 形式で入力してください（例: 127.0.0.1）。"
  },
  {
    key: "LAB_CORE_SSH_SERVICE_IP",
    label: "SSH用IP",
    explanation:
      "この項目は、ssh.<domain> を分離する機能に使われている、SSH到達先IPという役割を持つ宛先を決定するための設定です。設定例: 127.0.0.1, 192.168.11.225",
    validate: (value) => /^\d{1,3}(\.\d{1,3}){3}$/.test(value),
    error: "IPv4 形式で入力してください（例: 127.0.0.1）。"
  },
  {
    key: "LAB_CORE_ROOT_DOMAIN",
    label: "ルートドメイン",
    explanation:
      "この項目は、アプリ公開URLを生成する機能に使われている、ドメイン基底名という役割を持つ末尾ドメインを決定するための設定です。設定例: lab.localhost, fukaya-sus.lab",
    validate: (value) => /^[a-z0-9.-]+$/.test(value),
    error: "英小文字・数字・ドット・ハイフンのみで入力してください。"
  },
  {
    key: "LAB_CORE_PROXY_CONFIG_PATH",
    label: "Proxy生成ファイル出力先",
    explanation:
      "この項目は、Reverse Proxy の同期結果を書き出す機能に使われている、Caddy設定生成先という役割を持つファイルパスを決定するための設定です。設定例: ./core/backend/data/generated/Caddyfile, /opt/lab-core/core/proxy/Caddyfile.generated",
    validate: (value) => value.trim().length > 0,
    error: "空ではないパスを入力してください。"
  },
  {
    key: "LAB_CORE_DNS_HOSTS_PATH",
    label: "DNS生成ファイル出力先",
    explanation:
      "この項目は、DNS の同期結果を書き出す機能に使われている、hosts生成先という役割を持つファイルパスを決定するための設定です。設定例: ./core/backend/data/generated/fukaya-sus.hosts, /opt/lab-core/core/dns/fukaya-sus.hosts.generated",
    validate: (value) => value.trim().length > 0,
    error: "空ではないパスを入力してください。"
  },
  {
    key: "LAB_CORE_SYNC_DIR",
    label: "生成ディレクトリ",
    explanation:
      "この項目は、同期生成ファイルをまとめて管理する機能に使われている、生成物ルートという役割を持つディレクトリを決定するための設定です。設定例: ./core/backend/data/generated, /opt/lab-core/core/generated",
    validate: (value) => value.trim().length > 0,
    error: "空ではないパスを入力してください。"
  },
  {
    key: "LAB_CORE_DNS_SERVER_ENABLED",
    label: "内蔵DNS起動",
    explanation:
      "この項目は、Lab-Core 自身が DNS サーバーとして待ち受ける機能に使われている、DNS サーバー有効化という役割を持つ ON/OFF を決定するための設定です。設定例: true, false",
    validate: (value) => ["true", "false"].includes(value.trim().toLowerCase()),
    error: "true または false を入力してください。"
  },
  {
    key: "LAB_CORE_DNS_BIND_HOST",
    label: "DNS bind host",
    explanation:
      "この項目は、内蔵 DNS サーバーがどのアドレスで待ち受けるかを決める機能に使われている、DNS bind host という役割を持つ待受IPを決定するための設定です。設定例: 127.0.0.1, 0.0.0.0",
    validate: (value) => value.trim().length > 0,
    error: "空ではない値を入力してください。"
  },
  {
    key: "LAB_CORE_DNS_PORT",
    label: "DNS待受ポート",
    explanation:
      "この項目は、内蔵 DNS サーバーの待受ポートを決める機能に使われている、DNS待受ポートという役割を持つ値の番号を決定するための設定です。ローカル開発では 1053 と yarn dev:dns の組み合わせが安全です。設定例: 53, 1053",
    validate: (value) => {
      const num = Number(value);
      return Number.isInteger(num) && num >= 1 && num <= 65535;
    },
    error: "1〜65535 の整数を入力してください。"
  },
  {
    key: "LAB_CORE_DNS_UPSTREAMS",
    label: "DNS upstream",
    explanation:
      "この項目は、内蔵 DNS サーバーが不明なドメインを上位 DNS へ転送する機能に使われている、upstream DNS 一覧という役割を持つ問い合わせ先を決定するための設定です。空欄にすると自動検出を試みます。設定例: 1.1.1.1,8.8.8.8",
    validate: () => true,
    error: ""
  }
];

function nowStamp() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return `${y}${m}${d}${hh}${mm}${ss}`;
}

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function ask(rl, question, fallback) {
  const hint = fallback !== undefined ? ` [${fallback}]` : "";
  const answer = (await rl.question(`${question}${hint}: `)).trim();
  if (answer.length === 0 && fallback !== undefined) {
    return fallback;
  }
  return answer;
}

async function selectPreset(rl, modeName) {
  output.write("\nプロファイルを選択してください。\n");
  output.write("1) local  - ローカル開発（推奨）\n");
  output.write("2) lab    - 研究室運用\n");
  output.write("3) vm     - 検証VM（本番近似）\n");
  output.write("4) custom - 手動選択\n");

  while (true) {
    const selected = await ask(rl, `${modeName} で使うプロファイル番号`, "1");
    if (selected === "1") return "local";
    if (selected === "2") return "lab";
    if (selected === "3") return "vm";
    if (selected === "4") return "custom";
    output.write("有効な番号（1〜4）を入力してください。\n");
  }
}

function buildTemplate(profileName, values) {
  return `# Lab-Core backend runtime configuration
# generated_by: yarn config:${command}
# generated_at: ${new Date().toISOString()}
# profile: ${profileName}

LAB_CORE_PORT=${values.LAB_CORE_PORT}
LAB_CORE_EXECUTION_MODE=${values.LAB_CORE_EXECUTION_MODE}
LAB_CORE_DB_PATH=${values.LAB_CORE_DB_PATH}
LAB_CORE_DOCKER_SOCKET=${values.LAB_CORE_DOCKER_SOCKET}
LAB_CORE_APPS_ROOT=${values.LAB_CORE_APPS_ROOT}
LAB_CORE_APPDATA_ROOT=${values.LAB_CORE_APPDATA_ROOT}
LAB_CORE_MAIN_SERVICE_IP=${values.LAB_CORE_MAIN_SERVICE_IP}
LAB_CORE_SSH_SERVICE_IP=${values.LAB_CORE_SSH_SERVICE_IP}
LAB_CORE_ROOT_DOMAIN=${values.LAB_CORE_ROOT_DOMAIN}
LAB_CORE_PROXY_CONFIG_PATH=${values.LAB_CORE_PROXY_CONFIG_PATH}
LAB_CORE_DNS_HOSTS_PATH=${values.LAB_CORE_DNS_HOSTS_PATH}
LAB_CORE_SYNC_DIR=${values.LAB_CORE_SYNC_DIR}
LAB_CORE_DNS_SERVER_ENABLED=${values.LAB_CORE_DNS_SERVER_ENABLED}
LAB_CORE_DNS_BIND_HOST=${values.LAB_CORE_DNS_BIND_HOST}
LAB_CORE_DNS_PORT=${values.LAB_CORE_DNS_PORT}
LAB_CORE_DNS_UPSTREAMS=${values.LAB_CORE_DNS_UPSTREAMS}
`;
}

async function run() {
  const rl = readline.createInterface({ input, output });

  try {
    output.write(`\n=== Lab-Core 設定ウィザード (${command}) ===\n`);
    output.write(`対象ファイル: ${envPath}\n`);

    const fileExists = await exists(envPath);
    if (fileExists) {
      if (command === "init") {
        const overwrite = await ask(rl, ".env は既に存在します。上書きしますか？ (yes/no)", "no");
        if (!["yes", "y"].includes(overwrite.toLowerCase())) {
          output.write("中止しました。既存 .env は変更していません。\n");
          return;
        }
      } else {
        const proceed = await ask(rl, "現在の .env をリセットします。続けますか？ (yes/no)", "no");
        if (!["yes", "y"].includes(proceed.toLowerCase())) {
          output.write("中止しました。既存 .env は変更していません。\n");
          return;
        }
      }
    }

    const selectedProfile = await selectPreset(rl, command === "reset" ? "リセット後" : "初期値");
    let values = selectedProfile === "custom" ? { ...presets.local.values } : { ...presets[selectedProfile].values };

    for (const field of fieldDefinitions) {
      output.write(`\n[${field.key}] ${field.label}\n`);
      output.write(`${field.explanation}\n`);
      while (true) {
        const inputValue = await ask(rl, `${field.key} の値`, values[field.key]);
        if (field.validate(inputValue)) {
          values[field.key] = inputValue;
          break;
        }
        output.write(`${field.error}\n`);
      }
    }

    output.write("\n設定プレビュー:\n");
    for (const field of fieldDefinitions) {
      output.write(`- ${field.key}=${values[field.key]}\n`);
    }

    const confirm = await ask(rl, "この内容で保存しますか？ (yes/no)", "yes");
    if (!["yes", "y"].includes(confirm.toLowerCase())) {
      output.write("中止しました。ファイルは保存していません。\n");
      return;
    }

    await fs.mkdir(path.dirname(envPath), { recursive: true });
    if (fileExists) {
      const backupPath = `${envPath}.backup.${nowStamp()}`;
      await fs.copyFile(envPath, backupPath);
      output.write(`既存 .env をバックアップしました: ${backupPath}\n`);
    }

    const profileName = selectedProfile === "custom" ? "custom" : presets[selectedProfile].label;
    await fs.writeFile(envPath, buildTemplate(profileName, values), "utf8");

    output.write(`\n保存完了: ${envPath}\n`);
    output.write("次の手順:\n");
    output.write("1) yarn dev:backend\n");
    output.write("2) ダッシュボードで動作確認\n");
  } finally {
    rl.close();
  }
}

run().catch((error) => {
  console.error(`[config-wizard] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

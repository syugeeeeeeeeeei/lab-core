#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { confirm, input, select } from "@inquirer/prompts";
import { fileURLToPath } from "node:url";

const command = process.argv[2] ?? "init";
const thisFile = fileURLToPath(import.meta.url);
const rootDir = path.resolve(path.dirname(thisFile), "..", "..");
const envPath = path.join(rootDir, "core", "backend", ".env");

const presets = {
  local: {
    label: "ローカル開発",
    summary: "1台の開発機で dry-run 中心に確認する構成",
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
    summary: "192.168.11.224 / fukaya-sus.lab を前提にした本番運用向け構成",
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
    label: "検証VM",
    summary: "本番近似だがリポジトリ直下にデータを置く検証用構成",
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
    section: "runtime",
    key: "LAB_CORE_PORT",
    label: "API待受ポート",
    explanation: "Dashboard や proxy が到達する backend の待受ポートです。",
    examples: "例: 7300, 8080",
    validate: (value) => {
      const num = Number(value);
      return Number.isInteger(num) && num >= 1 && num <= 65535;
    },
    error: "1〜65535 の整数を入力してください。"
  },
  {
    section: "runtime",
    key: "LAB_CORE_EXECUTION_MODE",
    label: "実行モード",
    explanation: "dry-run は導線確認用、execute は Docker/Git を実行する実運用モードです。",
    examples: "例: dry-run, execute",
    validate: (value) => value === "dry-run" || value === "execute",
    error: "dry-run または execute を入力してください。"
  },
  {
    section: "storage",
    key: "LAB_CORE_DB_PATH",
    label: "SQLite DBパス",
    explanation: "アプリ登録情報やイベント履歴を保存する SQLite ファイルです。",
    examples: "例: ./core/backend/data/database.sqlite, /opt/lab-core/core/database.sqlite",
    validate: (value) => value.trim().length > 0,
    error: "空ではないパスを入力してください。"
  },
  {
    section: "storage",
    key: "LAB_CORE_DOCKER_SOCKET",
    label: "Dockerソケット",
    explanation: "backend が Docker Engine に接続するためのソケットパスです。",
    examples: "例: /var/run/docker.sock, /run/user/1000/docker.sock",
    validate: (value) => value.trim().length > 0,
    error: "空ではないパスを入力してください。"
  },
  {
    section: "storage",
    key: "LAB_CORE_APPS_ROOT",
    label: "アプリソース配置先",
    explanation: "Git clone したアプリソースを置くディレクトリです。",
    examples: "例: ./runtime/apps, /opt/lab-core/apps",
    validate: (value) => value.trim().length > 0,
    error: "空ではないパスを入力してください。"
  },
  {
    section: "storage",
    key: "LAB_CORE_APPDATA_ROOT",
    label: "アプリデータ配置先",
    explanation: "アプリの永続データを置くディレクトリです。",
    examples: "例: ./runtime/appdata, /opt/lab-core/appdata",
    validate: (value) => value.trim().length > 0,
    error: "空ではないパスを入力してください。"
  },
  {
    section: "network",
    key: "LAB_CORE_MAIN_SERVICE_IP",
    label: "公開先IP",
    explanation: "アプリ公開ホスト名を名前解決させる先の IP です。",
    examples: "例: 127.0.0.1, 192.168.11.224",
    validate: (value) => /^\d{1,3}(\.\d{1,3}){3}$/.test(value),
    error: "IPv4 形式で入力してください。"
  },
  {
    section: "network",
    key: "LAB_CORE_SSH_SERVICE_IP",
    label: "SSH用IP",
    explanation: "ssh.<rootDomain> に割り当てる IP です。",
    examples: "例: 127.0.0.1, 192.168.11.225",
    validate: (value) => /^\d{1,3}(\.\d{1,3}){3}$/.test(value),
    error: "IPv4 形式で入力してください。"
  },
  {
    section: "network",
    key: "LAB_CORE_ROOT_DOMAIN",
    label: "ルートドメイン",
    explanation: "dashboard / api / 各アプリのホスト名に使う基底ドメインです。",
    examples: "例: lab.localhost, fukaya-sus.lab",
    validate: (value) => /^[a-z0-9.-]+$/.test(value),
    error: "英小文字・数字・ドット・ハイフンのみで入力してください。"
  },
  {
    section: "generated",
    key: "LAB_CORE_PROXY_CONFIG_PATH",
    label: "Proxy生成ファイル出力先",
    explanation: "backend が生成する Caddy 設定ファイルの出力先です。",
    examples: "例: ./core/backend/data/generated/Caddyfile, /opt/lab-core/core/proxy/Caddyfile.generated",
    validate: (value) => value.trim().length > 0,
    error: "空ではないパスを入力してください。"
  },
  {
    section: "generated",
    key: "LAB_CORE_DNS_HOSTS_PATH",
    label: "DNS生成ファイル出力先",
    explanation: "backend が生成する hosts 形式の DNS レコード出力先です。",
    examples: "例: ./core/backend/data/generated/fukaya-sus.hosts, /opt/lab-core/core/dns/fukaya-sus.hosts.generated",
    validate: (value) => value.trim().length > 0,
    error: "空ではないパスを入力してください。"
  },
  {
    section: "generated",
    key: "LAB_CORE_SYNC_DIR",
    label: "生成ディレクトリ",
    explanation: "同期生成物をまとめて置くディレクトリです。",
    examples: "例: ./core/backend/data/generated, /opt/lab-core/core/generated",
    validate: (value) => value.trim().length > 0,
    error: "空ではないパスを入力してください。"
  },
  {
    section: "dns",
    key: "LAB_CORE_DNS_SERVER_ENABLED",
    label: "内蔵DNS起動",
    explanation: "Lab-Core 内蔵 DNS サーバーを有効にするかどうかです。",
    examples: "例: true, false",
    validate: (value) => ["true", "false"].includes(value.trim().toLowerCase()),
    error: "true または false を入力してください。"
  },
  {
    section: "dns",
    key: "LAB_CORE_DNS_BIND_HOST",
    label: "DNS bind host",
    explanation: "内蔵 DNS サーバーが待ち受ける IP です。",
    examples: "例: 127.0.0.1, 0.0.0.0",
    validate: (value) => value.trim().length > 0,
    error: "空ではない値を入力してください。"
  },
  {
    section: "dns",
    key: "LAB_CORE_DNS_PORT",
    label: "DNS待受ポート",
    explanation: "内蔵 DNS サーバーの待受ポートです。ローカルは 1053 が扱いやすいです。",
    examples: "例: 53, 1053",
    validate: (value) => {
      const num = Number(value);
      return Number.isInteger(num) && num >= 1 && num <= 65535;
    },
    error: "1〜65535 の整数を入力してください。"
  },
  {
    section: "dns",
    key: "LAB_CORE_DNS_UPSTREAMS",
    label: "DNS upstream",
    explanation: "不明なドメインを転送する上位 DNS 一覧です。空欄なら自動検出します。",
    examples: "例: 1.1.1.1,8.8.8.8",
    validate: () => true,
    error: ""
  }
];

const sections = [
  {
    id: "runtime",
    label: "基本設定",
    description: "待受ポートと実行モードを設定します。"
  },
  {
    id: "storage",
    label: "永続化・実行パス",
    description: "DB、Docker ソケット、アプリ配置先を設定します。"
  },
  {
    id: "network",
    label: "ネットワーク・ドメイン",
    description: "公開 IP とルートドメインを設定します。"
  },
  {
    id: "generated",
    label: "生成ファイル",
    description: "DNS / Proxy の生成物の出力先を設定します。"
  },
  {
    id: "dns",
    label: "内蔵DNS",
    description: "DNS サーバーの有効化と待受条件を設定します。"
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

async function exists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readEnvFile(filePath) {
  const content = await fs.readFile(filePath, "utf8");
  const entries = {};

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const normalized = line.startsWith("export ") ? line.slice("export ".length).trim() : line;
    const separatorIndex = normalized.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = normalized.slice(0, separatorIndex).trim();
    let value = normalized.slice(separatorIndex + 1).trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    }
    entries[key] = value;
  }

  return entries;
}

function summarizeValue(value) {
  const normalized = String(value ?? "").trim();
  if (normalized.length === 0) {
    return "(empty)";
  }
  return normalized.length > 56 ? `${normalized.slice(0, 53)}...` : normalized;
}

function profileLabel(profileKey) {
  return profileKey === "custom" ? "custom" : presets[profileKey].label;
}

function buildInitialValues(selectedProfile, existingValues) {
  if (selectedProfile === "custom") {
    return {
      ...presets.local.values,
      ...existingValues
    };
  }

  return {
    ...presets[selectedProfile].values
  };
}

function dashboardUrl(values) {
  return `http://dashboard.${values.LAB_CORE_ROOT_DOMAIN}/`;
}

function apiUrl(values) {
  return `http://api.${values.LAB_CORE_ROOT_DOMAIN}/api`;
}

function pickStartCommand(selectedProfile, values) {
  if (selectedProfile === "lab") {
    return "yarn lab:up";
  }
  if (selectedProfile === "local") {
    return "yarn dev";
  }
  if (values.LAB_CORE_MAIN_SERVICE_IP === "127.0.0.1" || values.LAB_CORE_ROOT_DOMAIN.endsWith(".localhost")) {
    return "yarn dev";
  }
  return "yarn lab:up";
}

function nextSteps(selectedProfile, values) {
  const startCommand = pickStartCommand(selectedProfile, values);
  const steps = [
    `1) ${startCommand}`,
    `2) ${dashboardUrl(values)} を開く`,
    `3) ${apiUrl(values)} を確認する`
  ];

  if (startCommand === "yarn lab:up") {
    steps.push(`4) クライアント側の DNS を ${values.LAB_CORE_MAIN_SERVICE_IP} へ向ける`);
  }

  return steps;
}

function fieldsForSection(sectionId) {
  return fieldDefinitions.filter((field) => field.section === sectionId);
}

function printFieldHelp(field, currentValue) {
  console.log(`\n[${field.key}] ${field.label}`);
  console.log(field.explanation);
  console.log(field.examples);
  console.log(`現在値: ${summarizeValue(currentValue)}`);
}

function printPreview(values) {
  console.log("\n設定プレビュー:");
  for (const section of sections) {
    console.log(`\n## ${section.label}`);
    for (const field of fieldsForSection(section.id)) {
      console.log(`- ${field.key}=${values[field.key]}`);
    }
  }
  console.log("");
}

async function selectProfile(fileExists, existingValues) {
  const customHint = fileExists && Object.keys(existingValues).length > 0
    ? "既存 .env を初期値として編集"
    : "local プロファイルを土台に手動調整";

  return select({
    message: "使用するプロファイルを選択してください",
    choices: [
      {
        name: `local  - ${presets.local.label} | ${presets.local.summary}`,
        value: "local"
      },
      {
        name: `lab    - ${presets.lab.label} | ${presets.lab.summary}`,
        value: "lab"
      },
      {
        name: `vm     - ${presets.vm.label} | ${presets.vm.summary}`,
        value: "vm"
      },
      {
        name: `custom - ${customHint}`,
        value: "custom"
      }
    ],
    pageSize: 8
  });
}

async function editField(field, values) {
  printFieldHelp(field, values[field.key]);

  const result = await input({
    message: `${field.label} (${field.key})`,
    default: values[field.key],
    validate: (value) => field.validate(value) || field.error
  });

  values[field.key] = result;
}

async function editSection(section, values) {
  let fieldIndex = 0;
  const sectionFields = fieldsForSection(section.id);

  while (fieldIndex >= 0 && fieldIndex < sectionFields.length) {
    const field = sectionFields[fieldIndex];
    await editField(field, values);

    if (sectionFields.length === 1) {
      break;
    }

    const action = await select({
      message: `${section.label}: 次の操作を選んでください`,
      choices: [
        {
          name: "次の項目へ進む",
          value: "next",
          disabled: fieldIndex === sectionFields.length - 1 ? "このセクションの最後です" : false
        },
        {
          name: "前の項目へ戻る",
          value: "prev",
          disabled: fieldIndex === 0 ? "このセクションの先頭です" : false
        },
        {
          name: "このセクションの一覧へ戻る",
          value: "menu"
        }
      ]
    });

    if (action === "next") {
      fieldIndex += 1;
      continue;
    }

    if (action === "prev") {
      fieldIndex -= 1;
      continue;
    }

    return;
  }
}

async function chooseSection(values) {
  return select({
    message: "修正したいセクションを選択してください",
    choices: sections.map((section, index) => ({
      name: `${index + 1}. ${section.label} | ${section.description}`,
      value: section.id
    }))
  });
}

async function confirmExistingFile(fileExists) {
  if (!fileExists) {
    return true;
  }

  if (command === "init") {
    return confirm({
      message: ".env は既に存在します。バックアップを取って上書きしますか？",
      default: false
    });
  }

  return confirm({
    message: "現在の .env を再作成します。バックアップを取って続行しますか？",
    default: false
  });
}

async function saveValues(fileExists, selectedProfile, values) {
  await fs.mkdir(path.dirname(envPath), { recursive: true });
  if (fileExists) {
    const backupPath = `${envPath}.backup.${nowStamp()}`;
    await fs.copyFile(envPath, backupPath);
    console.log(`既存 .env をバックアップしました: ${backupPath}`);
  }

  await fs.writeFile(envPath, buildTemplate(profileLabel(selectedProfile), values), "utf8");
  console.log(`\n保存完了: ${envPath}`);
  console.log("次の手順:");
  for (const step of nextSteps(selectedProfile, values)) {
    console.log(step);
  }
}

async function runWizard(fileExists, selectedProfile, values) {
  let sectionIndex = 0;

  while (true) {
    const section = sections[sectionIndex];
    console.log(`\n=== ${section.label} (${sectionIndex + 1}/${sections.length}) ===`);
    console.log(section.description);
    await editSection(section, values);

    const action = await select({
      message: "次の操作を選択してください",
      choices: [
        {
          name: "次のセクションへ進む",
          value: "next",
          disabled: sectionIndex === sections.length - 1 ? "最後のセクションです" : false
        },
        {
          name: "前のセクションへ戻る",
          value: "prev",
          disabled: sectionIndex === 0 ? "最初のセクションです" : false
        },
        {
          name: "任意のセクションを編集する",
          value: "jump"
        },
        {
          name: "設定プレビューを見る",
          value: "preview"
        },
        {
          name: "保存して終了する",
          value: "save"
        },
        {
          name: "中止する",
          value: "cancel"
        }
      ]
    });

    if (action === "next" && sectionIndex < sections.length - 1) {
      sectionIndex += 1;
      continue;
    }

    if (action === "prev" && sectionIndex > 0) {
      sectionIndex -= 1;
      continue;
    }

    if (action === "jump") {
      const targetSectionId = await chooseSection(values);
      sectionIndex = sections.findIndex((entry) => entry.id === targetSectionId);
      continue;
    }

    if (action === "preview") {
      printPreview(values);
      continue;
    }

    if (action === "save") {
      printPreview(values);
      const confirmed = await confirm({
        message: "この内容で保存しますか？",
        default: true
      });
      if (confirmed) {
        await saveValues(fileExists, selectedProfile, values);
        return;
      }
      continue;
    }

    console.log("中止しました。ファイルは保存していません。");
    return;
  }
}

async function run() {
  console.log(`\n=== Lab-Core 設定ウィザード (${command}) ===`);
  console.log(`対象ファイル: ${envPath}`);

  const fileExists = await exists(envPath);
  const existingValues = fileExists ? await readEnvFile(envPath) : {};

  const proceed = await confirmExistingFile(fileExists);
  if (!proceed) {
    console.log("中止しました。既存 .env は変更していません。");
    return;
  }

  const selectedProfile = await selectProfile(fileExists, existingValues);
  const values = buildInitialValues(selectedProfile, existingValues);

  console.log(`\n選択したプロファイル: ${profileLabel(selectedProfile)}`);
  console.log(`開始後は ${sections.length} セクションを上から順に編集できます。途中で戻る・飛ぶ・修正することもできます。`);

  await runWizard(fileExists, selectedProfile, values);
}

run().catch((error) => {
  if (error && typeof error === "object" && "name" in error && error.name === "ExitPromptError") {
    console.log("\nウィザードを終了しました。ファイルは保存していません。");
    process.exit(0);
  }

  console.error(`[config-wizard] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});

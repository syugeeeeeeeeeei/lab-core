#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: .env が見つかりません: ${ENV_FILE}" >&2
  exit 1
fi

set -a
source "${ENV_FILE}"
set +a

SUDO=""
if [[ "${EUID}" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
  else
    echo "ERROR: root 権限または sudo が必要です。" >&2
    exit 1
  fi
fi

run_root() {
  if [[ -n "${SUDO}" ]]; then
    ${SUDO} "$@"
  else
    "$@"
  fi
}

docker_cmd=()
compose_cmd=()

install_docker_if_needed() {
  if command -v docker >/dev/null 2>&1; then
    echo "[setup] Docker は既にインストール済みです。"
    return
  fi

  echo "[setup] Docker をインストールします。"
  run_root apt-get update
  run_root apt-get install -y ca-certificates curl gnupg
  run_root install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | run_root gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  run_root chmod a+r /etc/apt/keyrings/docker.gpg
  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
    $(. /etc/os-release && echo "${VERSION_CODENAME}") stable" | run_root tee /etc/apt/sources.list.d/docker.list >/dev/null
  run_root apt-get update
  run_root apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

prepare_docker_command() {
  if docker info >/dev/null 2>&1; then
    docker_cmd=(docker)
  else
    docker_cmd=(${SUDO} docker)
  fi

  if "${docker_cmd[@]}" compose version >/dev/null 2>&1; then
    compose_cmd=("${docker_cmd[@]}" compose)
  elif command -v docker-compose >/dev/null 2>&1; then
    compose_cmd=(docker-compose)
  else
    echo "ERROR: docker compose または docker-compose が見つかりません。" >&2
    exit 1
  fi
}

ensure_prerequisites() {
  run_root systemctl enable --now docker
  mkdir -p "${SCRIPT_DIR}/dnsmasq" "${SCRIPT_DIR}/data/npm" "${SCRIPT_DIR}/data/letsencrypt" "${SCRIPT_DIR}/data/dockge" "${SCRIPT_DIR}/stacks"
}

generate_dns_config() {
  cat > "${SCRIPT_DIR}/dnsmasq/lab.conf" <<EOF
domain-needed
bogus-priv
no-hosts
server=1.1.1.1
server=8.8.8.8
address=/${LAB_DOMAIN}/${SERVER_IP}
address=/.$LAB_DOMAIN/${SERVER_IP}
EOF
}

ensure_bridge_network() {
  if "${docker_cmd[@]}" network inspect "${LAB_BRIDGE_NAME}" >/dev/null 2>&1; then
    echo "[setup] Docker ネットワーク '${LAB_BRIDGE_NAME}' は既に存在します。"
  else
    echo "[setup] Docker ネットワーク '${LAB_BRIDGE_NAME}' を作成します。"
    "${docker_cmd[@]}" network create "${LAB_BRIDGE_NAME}"
  fi
}

start_stack() {
  echo "[setup] 基盤サービスを起動します。"
  "${compose_cmd[@]}" --env-file "${ENV_FILE}" -f "${SCRIPT_DIR}/compose.yml" up -d --build
}

print_summary() {
  cat <<EOF

[done] Lab-Core の起動が完了しました。
  - Nginx Proxy Manager: http://${SERVER_IP}:${NPM_ADMIN_PORT}
  - Dockge: http://${SERVER_IP}:${DOCKGE_PORT}
  - DNS wildcard: *.${LAB_DOMAIN} -> ${SERVER_IP}
EOF
}

install_docker_if_needed
prepare_docker_command
ensure_prerequisites
generate_dns_config
ensure_bridge_network
start_stack
print_summary

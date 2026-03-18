#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${1:-http://127.0.0.1:7300}"
TS="$(date +%Y%m%d%H%M%S)-$RANDOM"
ROOT_DOMAIN="$(
  curl -fsS "${BASE_URL}/api/system/status" \
    | node -e 'let data="";process.stdin.on("data",(chunk)=>data+=chunk);process.stdin.on("end",()=>{const parsed=JSON.parse(data);process.stdout.write(parsed.execution?.rootDomain ?? "lab.localhost");});'
)"

post_fixture() {
  local body="$1"
  curl -sS -X POST "${BASE_URL}/api/applications" \
    -H "Content-Type: application/json" \
    --data-binary "${body}"
  echo
  echo "----------------------------------------"
}

echo "[info] post fixtures to ${BASE_URL}"

post_fixture "{\"name\":\"oruca-test-${TS}\",\"description\":\"OruCa 構成を想定した登録テスト\",\"repositoryUrl\":\"https://github.com/example/oruca\",\"defaultBranch\":\"main\",\"composePath\":\"docker-compose.yml\",\"publicServiceName\":\"oruca-web\",\"publicPort\":80,\"hostname\":\"oruca-test-${TS}.${ROOT_DOMAIN}\",\"mode\":\"standard\",\"keepVolumesOnRebuild\":true,\"deviceRequirements\":[\"/dev/bus/usb\"]}"

post_fixture "{\"name\":\"homepage-test-${TS}\",\"description\":\"単体Webアプリの登録テスト\",\"repositoryUrl\":\"https://github.com/example/homepage\",\"defaultBranch\":\"main\",\"composePath\":\"docker-compose.yml\",\"publicServiceName\":\"web\",\"publicPort\":3000,\"hostname\":\"homepage-test-${TS}.${ROOT_DOMAIN}\",\"mode\":\"standard\",\"keepVolumesOnRebuild\":true,\"deviceRequirements\":[]}"

post_fixture "{\"name\":\"api-test-${TS}\",\"description\":\"Headless API サービス登録テスト\",\"repositoryUrl\":\"https://github.com/example/headless-api\",\"defaultBranch\":\"main\",\"composePath\":\"docker-compose.yml\",\"publicServiceName\":\"api\",\"publicPort\":8080,\"hostname\":\"api-test-${TS}.${ROOT_DOMAIN}\",\"mode\":\"headless\",\"keepVolumesOnRebuild\":true,\"deviceRequirements\":[]}"

echo "[done] fixtures posted"

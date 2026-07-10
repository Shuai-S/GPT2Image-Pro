#!/usr/bin/env bash

# Docker 发布 manifest 提升器。
#
# 使用方：`.github/workflows/docker-release.yml` 的 promote job。
# 关键依赖：Docker Buildx 已登录目标 registry；矩阵构建已把四个镜像写入同一
# run-scoped `sha-*` 源标签。脚本先完成全部 manifest、架构和 exact semver
# 预检，再把源 digest 提升为版本标签。预发布版本不会移动 major/minor/latest。

set -Eeuo pipefail

# 校验发布所需环境变量，空值直接失败，避免拼出错误 registry 路径。
require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "::error::缺少环境变量 $name"
    exit 1
  fi
}

# 从 `imagetools inspect` 文本中读取顶层 manifest digest。
extract_digest() {
  local inspect_file="$1"
  awk '$1 == "Digest:" { print $2; exit }' "$inspect_file"
}

# 获取已存在标签的 digest；标签不存在时返回失败，调用方据此区分首次发布。
read_existing_digest() {
  local image_ref="$1"
  local inspect_file="$2"
  if ! docker buildx imagetools inspect "$image_ref" > "$inspect_file" 2>/dev/null; then
    return 1
  fi
  extract_digest "$inspect_file"
}

require_env "IMAGE_NAMESPACE"
require_env "SOURCE_TAG"
require_env "GITHUB_REF_NAME"
require_env "RUNNER_TEMP"

IMAGE_NAMESPACE="${IMAGE_NAMESPACE,,}"
if [[ ! "$GITHUB_REF_NAME" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(alpha|beta|rc)\.(0|[1-9][0-9]*))?$ ]]; then
  echo "::error::非法版本 tag：$GITHUB_REF_NAME"
  exit 1
fi

version="${GITHUB_REF_NAME#v}"
exact_aliases=("$GITHUB_REF_NAME" "$version")
aliases=("${exact_aliases[@]}")
if [[ "$version" != *-* ]]; then
  IFS="." read -r major minor _patch <<< "$version"
  aliases+=("${major}.${minor}" "$major" "latest")
fi

images=(
  "gpt2image-pro-web"
  "gpt2image-pro-migrate"
  "gpt2image-pro-chatgpt-web-proxy"
  "gpt2image-pro-chatgpt-register"
)

declare -A source_digests=()
for image in "${images[@]}"; do
  source_ref="$IMAGE_NAMESPACE/$image:$SOURCE_TAG"
  inspect_file="$RUNNER_TEMP/$image.source.inspect"
  docker buildx imagetools inspect "$source_ref" > "$inspect_file"

  if ! grep -Eq 'Platform:[[:space:]]+linux/amd64' "$inspect_file"; then
    echo "::error::$source_ref 缺少 linux/amd64 manifest"
    exit 1
  fi
  if [[ "$image" != "gpt2image-pro-chatgpt-register" ]] && \
    ! grep -Eq 'Platform:[[:space:]]+linux/arm64' "$inspect_file"; then
    echo "::error::$source_ref 缺少 linux/arm64 manifest"
    exit 1
  fi

  digest="$(extract_digest "$inspect_file")"
  if [[ ! "$digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "::error::无法解析 $source_ref 的 manifest digest"
    exit 1
  fi
  source_digests["$image"]="$digest"
done

# exact semver 是不可变发布标识。全部镜像先检查完，冲突时不移动任何别名。
for image in "${images[@]}"; do
  repository="$IMAGE_NAMESPACE/$image"
  for alias in "${exact_aliases[@]}"; do
    inspect_file="$RUNNER_TEMP/$image.$alias.inspect"
    if existing_digest="$(read_existing_digest "$repository:$alias" "$inspect_file")"; then
      if [[ "$existing_digest" != "${source_digests[$image]}" ]]; then
        echo "::error::$repository:$alias 已指向其它 digest，拒绝覆盖"
        exit 1
      fi
    fi
  done
done

# OCI registry 不支持跨 repository 事务；单一 job 和完整预检保证构建失败时不触碰
# 可变标签，并把实际写入窗口收敛到这一个顺序步骤。
for image in "${images[@]}"; do
  repository="$IMAGE_NAMESPACE/$image"
  tag_args=()
  for alias in "${aliases[@]}"; do
    tag_args+=(--tag "$repository:$alias")
  done
  docker buildx imagetools create \
    "${tag_args[@]}" \
    "$repository@${source_digests[$image]}"
done

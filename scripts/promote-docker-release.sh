#!/usr/bin/env bash

# Docker 发布 manifest 提升器。
#
# 使用方：`.github/workflows/docker-release.yml` 的 promote job。
# 关键依赖：Docker Buildx 已登录目标 registry；矩阵构建已把四个镜像写入同一
# run-scoped `sha-*` 源标签。脚本只给组件写不可变 exact semver，并在独立
# `gpt2image-pro-release` 仓库发布带组件 digest 注解的 OCI descriptor。四个组件
# 与 descriptor exact 全部成功后，才单次移动 descriptor channel。

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

IMAGE_NAMESPACE="$(
  printf '%s' "$IMAGE_NAMESPACE" | tr '[:upper:]' '[:lower:]'
)"
if [[ ! "$GITHUB_REF_NAME" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-(alpha|beta|rc)\.(0|[1-9][0-9]*))?$ ]]; then
  echo "::error::非法版本 tag：$GITHUB_REF_NAME"
  exit 1
fi

version="${GITHUB_REF_NAME#v}"
exact_aliases=("$GITHUB_REF_NAME" "$version")
channel="latest"
if [[ "$version" == *-* ]]; then
  channel="prerelease"
fi

images=(
  "gpt2image-pro-web"
  "gpt2image-pro-migrate"
  "gpt2image-pro-chatgpt-web-proxy"
  "gpt2image-pro-chatgpt-register"
)
release_repository="$IMAGE_NAMESPACE/gpt2image-pro-release"
descriptor_source_ref="$release_repository:$SOURCE_TAG"

source_digests=()
for image_index in "${!images[@]}"; do
  image="${images[$image_index]}"
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
  source_digests[$image_index]="$digest"
done

# exact semver 是不可变发布标识。全部组件先检查完，冲突时不写任何发布标签。
for image_index in "${!images[@]}"; do
  image="${images[$image_index]}"
  repository="$IMAGE_NAMESPACE/$image"
  for alias in "${exact_aliases[@]}"; do
    inspect_file="$RUNNER_TEMP/$image.$alias.inspect"
    if existing_digest="$(read_existing_digest "$repository:$alias" "$inspect_file")"; then
      if [[ "$existing_digest" != "${source_digests[$image_index]}" ]]; then
        echo "::error::$repository:$alias 已指向其它 digest，拒绝覆盖"
        exit 1
      fi
    fi
  done
done

# descriptor 以 web 多架构索引为 OCI 载体，顶层注解记录版本与四组件 digest。
# run-scoped 标签只供本次发布预检，不是消费者使用的 channel。
descriptor_annotations=(
  --annotation "index:org.opencontainers.image.title=gpt2image-pro-release"
  --annotation "index:org.opencontainers.image.version=$version"
  --annotation "index:org.opencontainers.image.ref.name=$GITHUB_REF_NAME"
)
for image_index in "${!images[@]}"; do
  image="${images[$image_index]}"
  component="${image#gpt2image-pro-}"
  component_ref="$IMAGE_NAMESPACE/$image@${source_digests[$image_index]}"
  descriptor_annotations+=(
    --annotation "index:io.gpt2image.release.component.$component=$component_ref"
  )
done
docker buildx imagetools create \
  "${descriptor_annotations[@]}" \
  --tag "$descriptor_source_ref" \
  "$IMAGE_NAMESPACE/gpt2image-pro-web@${source_digests[0]}"

descriptor_inspect_file="$RUNNER_TEMP/gpt2image-pro-release.source.inspect"
docker buildx imagetools inspect \
  "$descriptor_source_ref" > "$descriptor_inspect_file"
descriptor_digest="$(extract_digest "$descriptor_inspect_file")"
if [[ ! "$descriptor_digest" =~ ^sha256:[0-9a-f]{64}$ ]]; then
  echo "::error::无法解析 $descriptor_source_ref 的 manifest digest"
  exit 1
fi

# descriptor exact 同样不可变，先完成冲突预检，避免覆盖既有发布定义。
for alias in "${exact_aliases[@]}"; do
  inspect_file="$RUNNER_TEMP/gpt2image-pro-release.$alias.inspect"
  if existing_digest="$(
    read_existing_digest "$release_repository:$alias" "$inspect_file"
  )"; then
    if [[ "$existing_digest" != "$descriptor_digest" ]]; then
      echo "::error::$release_repository:$alias 已指向其它 digest，拒绝覆盖"
      exit 1
    fi
  fi
done

# OCI registry 不支持跨 repository 事务。组件只写不可变 exact，因此中途失败
# 不会改变消费者入口；所有组件成功后再发布 descriptor exact。
for image_index in "${!images[@]}"; do
  image="${images[$image_index]}"
  repository="$IMAGE_NAMESPACE/$image"
  tag_args=()
  for alias in "${exact_aliases[@]}"; do
    tag_args+=(--tag "$repository:$alias")
  done
  docker buildx imagetools create \
    "${tag_args[@]}" \
    "$repository@${source_digests[$image_index]}"
done

descriptor_tag_args=()
for alias in "${exact_aliases[@]}"; do
  descriptor_tag_args+=(--tag "$release_repository:$alias")
done
docker buildx imagetools create \
  "${descriptor_tag_args[@]}" \
  "$release_repository@$descriptor_digest"

# 这是整次发布唯一的可变入口操作。预发布只移动独立 channel，不触碰 latest。
docker buildx imagetools create \
  --tag "$release_repository:$channel" \
  "$release_repository@$descriptor_digest"

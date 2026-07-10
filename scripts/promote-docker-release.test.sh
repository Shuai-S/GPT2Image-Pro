#!/usr/bin/env bash

# Docker 发布提升脚本的故障注入测试。
#
# 使用方：Docker release quality gate 与本地发布维护者。
# 关键依赖：仅需 Bash、awk 和临时目录；fake Docker 模拟 registry inspect/create，
# 验证 exact 冲突、组件写入失败和预发布 channel 的 fail-closed 边界。

set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROMOTE_SCRIPT="$ROOT_DIR/scripts/promote-docker-release.sh"
TEST_ROOT="$(mktemp -d)"
FAKE_BIN="$TEST_ROOT/bin"
IMAGE_NAMESPACE="ghcr.io/example"
SOURCE_TAG="sha-test-100-1"

# 删除测试创建的 fake Docker、调用日志和 inspect 临时文件。
cleanup() {
  rm -rf "$TEST_ROOT"
}
trap cleanup EXIT

mkdir -p "$FAKE_BIN"
cat > "$FAKE_BIN/docker" <<'FAKE_DOCKER'
#!/usr/bin/env bash

# Docker Buildx 测试替身：记录所有调用，并按环境变量注入冲突或写入失败。

set -Eeuo pipefail

{
  separator=""
  for argument in "$@"; do
    printf '%s%s' "$separator" "$argument"
    separator=$'\t'
  done
  printf '\n'
} >> "$FAKE_DOCKER_LOG"

if [[ "${1:-}" != "buildx" || "${2:-}" != "imagetools" ]]; then
  exit 90
fi

case "${3:-}" in
  inspect)
    image_ref="${4:-}"
    digest=""
    if [[ -n "${FAKE_CONFLICT_REF:-}" ]] && \
      [[ "$image_ref" == "$FAKE_CONFLICT_REF" ]]; then
      digest="${FAKE_CONFLICT_DIGEST:-}"
    else
      case "$image_ref" in
        "$IMAGE_NAMESPACE/gpt2image-pro-web:$SOURCE_TAG")
          digest="sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
          ;;
        "$IMAGE_NAMESPACE/gpt2image-pro-migrate:$SOURCE_TAG")
          digest="sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
          ;;
        "$IMAGE_NAMESPACE/gpt2image-pro-chatgpt-web-proxy:$SOURCE_TAG")
          digest="sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
          ;;
        "$IMAGE_NAMESPACE/gpt2image-pro-chatgpt-register:$SOURCE_TAG")
          digest="sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
          ;;
        "$IMAGE_NAMESPACE/gpt2image-pro-release:$SOURCE_TAG")
          digest="sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"
          ;;
        *)
          exit 1
          ;;
      esac
    fi

    printf 'Name: %s\n' "$image_ref"
    printf 'MediaType: application/vnd.oci.image.index.v1+json\n'
    printf 'Digest: %s\n' "$digest"
    printf '  Platform: linux/amd64\n'
    if [[ "$image_ref" != *"gpt2image-pro-chatgpt-register"* ]]; then
      printf '  Platform: linux/arm64\n'
    fi
    ;;
  create)
    for argument in "$@"; do
      if [[ -n "${FAKE_FAIL_CREATE_TAG:-}" ]] && \
        [[ "$argument" == "$FAKE_FAIL_CREATE_TAG" ]]; then
        exit 42
      fi
    done
    ;;
  *)
    exit 91
    ;;
esac
FAKE_DOCKER
chmod +x "$FAKE_BIN/docker"

# 立即终止测试并输出可定位的失败原因。
fail_test() {
  local message="$1"
  echo "测试失败：$message" >&2
  exit 1
}

# 运行一次隔离的 promotion；参数可指定组件写失败或 exact digest 冲突。
run_promotion() {
  local case_name="$1"
  local version_tag="$2"
  local fail_create_tag="${3:-}"
  local conflict_ref="${4:-}"
  local case_dir="$TEST_ROOT/$case_name"

  mkdir -p "$case_dir"
  : > "$case_dir/docker.log"
  env \
    PATH="$FAKE_BIN:$PATH" \
    IMAGE_NAMESPACE="$IMAGE_NAMESPACE" \
    SOURCE_TAG="$SOURCE_TAG" \
    GITHUB_REF_NAME="$version_tag" \
    RUNNER_TEMP="$case_dir" \
    FAKE_DOCKER_LOG="$case_dir/docker.log" \
    FAKE_FAIL_CREATE_TAG="$fail_create_tag" \
    FAKE_CONFLICT_REF="$conflict_ref" \
    FAKE_CONFLICT_DIGEST="sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff" \
    bash "$PROMOTE_SCRIPT" > "$case_dir/output.log" 2>&1
}

# 统计某个完整镜像标签作为 `--tag` 参数出现的 create 调用次数。
count_tag_calls() {
  local log_file="$1"
  local expected_tag="$2"
  awk -F '\t' -v expected_tag="$expected_tag" '
    $1 == "buildx" && $2 == "imagetools" && $3 == "create" {
      for (field_index = 4; field_index <= NF; field_index += 1) {
        if ($field_index == "--tag" && $(field_index + 1) == expected_tag) {
          count += 1
        }
      }
    }
    END { print count + 0 }
  ' "$log_file"
}

# 断言指定标签被写入恰好 expected 次，用于区分 exact 与 mutable channel。
assert_tag_call_count() {
  local log_file="$1"
  local image_tag="$2"
  local expected="$3"
  local actual
  actual="$(count_tag_calls "$log_file" "$image_tag")"
  if [[ "$actual" != "$expected" ]]; then
    fail_test "$image_tag 写入次数应为 $expected，实际为 $actual"
  fi
}

# 断言调用日志包含 descriptor 注解或 digest，避免只验证调用次数却漏掉内容。
assert_log_contains() {
  local log_file="$1"
  local expected="$2"
  if ! grep -Fq -- "$expected" "$log_file"; then
    fail_test "调用日志缺少：$expected"
  fi
}

# 统计所有 imagetools create 调用，冲突预检必须在首次写入前终止。
count_create_calls() {
  local log_file="$1"
  awk -F '\t' '
    $1 == "buildx" && $2 == "imagetools" && $3 == "create" {
      count += 1
    }
    END { print count + 0 }
  ' "$log_file"
}

# 验证正式版：四组件与 descriptor 只写 exact，stable channel 只移动一次。
test_stable_release() {
  local case_name="stable-success"
  local log_file="$TEST_ROOT/$case_name/docker.log"
  local image

  if ! run_promotion "$case_name" "v1.2.3"; then
    cat "$TEST_ROOT/$case_name/output.log" >&2
    fail_test "正式版 promotion 应成功"
  fi

  for image in \
    "gpt2image-pro-web" \
    "gpt2image-pro-migrate" \
    "gpt2image-pro-chatgpt-web-proxy" \
    "gpt2image-pro-chatgpt-register"; do
    assert_tag_call_count "$log_file" "$IMAGE_NAMESPACE/$image:v1.2.3" 1
    assert_tag_call_count "$log_file" "$IMAGE_NAMESPACE/$image:1.2.3" 1
    assert_tag_call_count "$log_file" "$IMAGE_NAMESPACE/$image:1.2" 0
    assert_tag_call_count "$log_file" "$IMAGE_NAMESPACE/$image:1" 0
    assert_tag_call_count "$log_file" "$IMAGE_NAMESPACE/$image:latest" 0
  done

  assert_tag_call_count \
    "$log_file" "$IMAGE_NAMESPACE/gpt2image-pro-release:v1.2.3" 1
  assert_tag_call_count \
    "$log_file" "$IMAGE_NAMESPACE/gpt2image-pro-release:1.2.3" 1
  assert_tag_call_count \
    "$log_file" "$IMAGE_NAMESPACE/gpt2image-pro-release:latest" 1
  assert_tag_call_count \
    "$log_file" "$IMAGE_NAMESPACE/gpt2image-pro-release:prerelease" 0
  assert_log_contains \
    "$log_file" "index:org.opencontainers.image.version=1.2.3"
  assert_log_contains \
    "$log_file" \
    "index:io.gpt2image.release.component.web=$IMAGE_NAMESPACE/gpt2image-pro-web@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  assert_log_contains \
    "$log_file" \
    "index:io.gpt2image.release.component.migrate=$IMAGE_NAMESPACE/gpt2image-pro-migrate@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
  assert_log_contains \
    "$log_file" \
    "index:io.gpt2image.release.component.chatgpt-web-proxy=$IMAGE_NAMESPACE/gpt2image-pro-chatgpt-web-proxy@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
  assert_log_contains \
    "$log_file" \
    "index:io.gpt2image.release.component.chatgpt-register=$IMAGE_NAMESPACE/gpt2image-pro-chatgpt-register@sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd"
}

# 验证任一组件 exact 写失败后，不发布 descriptor exact，也不移动任何 channel。
test_component_failure_is_fail_closed() {
  local case_name="component-failure"
  local log_file="$TEST_ROOT/$case_name/docker.log"
  local failed_tag="$IMAGE_NAMESPACE/gpt2image-pro-chatgpt-web-proxy:v1.2.4"

  if run_promotion "$case_name" "v1.2.4" "$failed_tag"; then
    fail_test "组件 exact 写入失败时 promotion 不应成功"
  fi

  assert_tag_call_count \
    "$log_file" "$IMAGE_NAMESPACE/gpt2image-pro-release:v1.2.4" 0
  assert_tag_call_count \
    "$log_file" "$IMAGE_NAMESPACE/gpt2image-pro-release:latest" 0
  assert_tag_call_count \
    "$log_file" "$IMAGE_NAMESPACE/gpt2image-pro-release:prerelease" 0
}

# 验证 exact 标签指向不同 digest 时，在任何 registry create 前 fail-closed。
test_exact_conflict_is_fail_closed() {
  local case_name="exact-conflict"
  local log_file="$TEST_ROOT/$case_name/docker.log"
  local conflict_ref="$IMAGE_NAMESPACE/gpt2image-pro-migrate:1.2.5"
  local create_count

  if run_promotion "$case_name" "v1.2.5" "" "$conflict_ref"; then
    fail_test "exact digest 冲突时 promotion 不应成功"
  fi

  create_count="$(count_create_calls "$log_file")"
  if [[ "$create_count" != "0" ]]; then
    fail_test "exact 冲突后 create 次数应为 0，实际为 $create_count"
  fi
}

# 验证预发布仅移动 prerelease channel，stable latest 保持不变。
test_prerelease_channel_is_isolated() {
  local case_name="prerelease-success"
  local log_file="$TEST_ROOT/$case_name/docker.log"
  local image

  if ! run_promotion "$case_name" "v1.3.0-rc.1"; then
    cat "$TEST_ROOT/$case_name/output.log" >&2
    fail_test "预发布 promotion 应成功"
  fi

  assert_tag_call_count \
    "$log_file" "$IMAGE_NAMESPACE/gpt2image-pro-release:prerelease" 1
  assert_tag_call_count \
    "$log_file" "$IMAGE_NAMESPACE/gpt2image-pro-release:latest" 0
  for image in \
    "gpt2image-pro-web" \
    "gpt2image-pro-migrate" \
    "gpt2image-pro-chatgpt-web-proxy" \
    "gpt2image-pro-chatgpt-register"; do
    assert_tag_call_count "$log_file" "$IMAGE_NAMESPACE/$image:latest" 0
  done
}

test_stable_release
test_component_failure_is_fail_closed
test_exact_conflict_is_fail_closed
test_prerelease_channel_is_isolated

echo "Docker 发布提升测试通过"

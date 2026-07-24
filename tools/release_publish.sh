#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# release_publish.sh
# Quy trình phát hành hoàn chỉnh cho Firefox ChatAI Assistant:
#   1. Build release archive (web-ext build qua release_firefox_addon.py)
#   2. Đóng gói artifact vào dist/releases/<version>/
#   3. Tạo git tag v<version> (annotated tag)
#   4. Commit manifest + release artifacts (nếu được track)
#   5. Push commits + tag lên remote
#
# Người dùng cuối có thể tải file .zip trực tiếp từ GitHub Releases
# mà không cần build lại.
# ---------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

# ---- màu sắc terminal ----
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'

info()    { printf "${CYAN}[INFO]${RESET}  %s\n" "$*"; }
success() { printf "${GREEN}[OK]${RESET}    %s\n" "$*"; }
warn()    { printf "${YELLOW}[WARN]${RESET}  %s\n" "$*"; }
error()   { printf "${RED}[LỖI]${RESET}  %s\n" "$*" >&2; }
die()     { error "$*"; exit 1; }

# ---- kiểm tra công cụ ----
command -v git    >/dev/null 2>&1 || die "Không tìm thấy git."
command -v python3 >/dev/null 2>&1 || die "Không tìm thấy python3."

cd "$PROJECT_ROOT"

# ---- đảm bảo là git repo ----
git rev-parse --is-inside-work-tree >/dev/null 2>&1 || die "Thư mục này không phải git repository."

# ---- đọc version từ manifest ----
MANIFEST="${PROJECT_ROOT}/extension/manifest.json"
[[ -f "$MANIFEST" ]] || die "Không tìm thấy extension/manifest.json"
VERSION="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1], encoding="utf-8"))["version"])' "$MANIFEST")"
[[ -n "$VERSION" ]] || die "Không đọc được version từ manifest.json"
TAG="v${VERSION}"

printf "\n${BOLD}=== Firefox ChatAI Assistant — Release ${VERSION} ===${RESET}\n\n"

# ---- kiểm tra tag chưa tồn tại ----
if git tag --list "$TAG" | grep -q "^${TAG}$"; then
    warn "Git tag '${TAG}' đã tồn tại."
    printf "Bạn muốn xóa và tạo lại tag này không? [y/N]: "
    IFS= read -r confirm_retag
    case "${confirm_retag,,}" in
        y|yes)
            git tag -d "$TAG"
            if git ls-remote --tags origin "refs/tags/${TAG}" | grep -q "$TAG"; then
                warn "Đang xóa tag '${TAG}' trên remote..."
                git push origin ":refs/tags/${TAG}"
            fi
            ;;
        *)
            die "Hủy: tag '${TAG}' đã tồn tại. Hãy bump version trước khi release."
            ;;
    esac
fi

# ======================================================================
# BƯỚC 1 — BUILD RELEASE ARCHIVE
# ======================================================================
printf "\n${BOLD}[Bước 1/4] Build release archive...${RESET}\n"

RELEASE_ARGS=(--overwrite)
if [[ "${SKIP_TESTS:-0}" == "1" ]]; then
    warn "Bỏ qua tests (SKIP_TESTS=1)"
    RELEASE_ARGS+=(--skip-tests)
fi

python3 "${SCRIPT_DIR}/release_firefox_addon.py" "${RELEASE_ARGS[@]}"
success "Build artifact hoàn tất."

# ---- xác định đường dẫn artifact ----
RELEASES_DIR="${PROJECT_ROOT}/dist/releases/${VERSION}"
ARTIFACT="${RELEASES_DIR}/firefox-chat-ai-assistant-${VERSION}-unsigned.zip"
[[ -f "$ARTIFACT" ]] || die "Không tìm thấy artifact: ${ARTIFACT}"

# ======================================================================
# BƯỚC 2 — KIỂM TRA TRẠNG THÁI GIT VÀ XÁC NHẬN
# ======================================================================
printf "\n${BOLD}[Bước 2/4] Kiểm tra trạng thái git...${RESET}\n"
git status --short --branch

CHANGED="$(git status --porcelain=v1 2>/dev/null)"
STAGED="$(git diff --cached --name-only 2>/dev/null)"

# Hỏi commit message
DEFAULT_MSG="chore: release ${VERSION}"
printf "\nNhập commit message [%s]: " "$DEFAULT_MSG"
IFS= read -r COMMIT_MSG
COMMIT_MSG="${COMMIT_MSG:-$DEFAULT_MSG}"

# Hỏi release notes cho tag
DEFAULT_NOTES="Release ${VERSION} — Firefox ChatAI Assistant"
printf "Nhập nội dung release notes (tag annotation) [%s]: " "$DEFAULT_NOTES"
IFS= read -r TAG_MSG
TAG_MSG="${TAG_MSG:-$DEFAULT_NOTES}"

# ======================================================================
# BƯỚC 3 — COMMIT (nếu có thay đổi)
# ======================================================================
printf "\n${BOLD}[Bước 3/4] Commit thay đổi...${RESET}\n"

if [[ -n "$CHANGED" || -n "$STAGED" ]]; then
    # Thêm manifest (version đã bump) và các file release có thể được track
    git add -A
    if ! git diff --cached --quiet; then
        git commit -m "$COMMIT_MSG"
        success "Commit: $(git rev-parse --short HEAD) — ${COMMIT_MSG}"
    else
        info "Không có file nào staged để commit."
    fi
else
    info "Không có thay đổi nào, bỏ qua commit."
fi

# ======================================================================
# BƯỚC 4 — TẠO GIT TAG VÀ PUSH
# ======================================================================
printf "\n${BOLD}[Bước 4/4] Tạo git tag '${TAG}' và push lên remote...${RESET}\n"

git tag -a "$TAG" -m "$TAG_MSG"
success "Đã tạo annotated tag: ${TAG}"

# Xác định remote và branch hiện tại
CURRENT_BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
[[ -n "$CURRENT_BRANCH" ]] || die "Repository đang ở detached HEAD. Tag đã tạo nhưng chưa push."

REMOTE="${GIT_REMOTE:-origin}"
if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
    die "Không tìm thấy remote '${REMOTE}'. Tag đã tạo nhưng chưa push."
fi

# Push commits (nếu branch có upstream)
if git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1; then
    info "Pushing commits lên ${REMOTE}/${CURRENT_BRANCH}..."
    git push "$REMOTE" "$CURRENT_BRANCH"
else
    info "Branch '${CURRENT_BRANCH}' chưa có upstream. Thiết lập ${REMOTE}/${CURRENT_BRANCH}..."
    git push --set-upstream "$REMOTE" "$CURRENT_BRANCH"
fi

# Push tag
info "Pushing tag '${TAG}' lên ${REMOTE}..."
git push "$REMOTE" "$TAG"

# ======================================================================
# KẾT QUẢ
# ======================================================================
printf "\n${GREEN}${BOLD}=====================================================${RESET}\n"
printf "${GREEN}${BOLD}  RELEASE THÀNH CÔNG: Firefox ChatAI Assistant ${VERSION}${RESET}\n"
printf "${GREEN}${BOLD}=====================================================${RESET}\n"
printf "  Git tag   : %s\n" "$TAG"
printf "  Commit    : %s\n" "$(git rev-parse --short HEAD)"
printf "  Artifact  : %s\n" "$ARTIFACT"
printf "  SHA-256   : %s\n" "$(cat "${RELEASES_DIR}/SHA256SUMS" 2>/dev/null | awk '{print $1}')"
printf "\nNgười dùng có thể tải file .zip từ GitHub Releases:\n"
REMOTE_URL="$(git remote get-url "$REMOTE" 2>/dev/null || echo '(unknown)')"
printf "  %s (tag: %s)\n\n" "$REMOTE_URL" "$TAG"

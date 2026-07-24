#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# release_publish.sh
# Quy trình phát hành hoàn chỉnh cho Firefox ChatAI Assistant:
#   1. Build release archive (web-ext build qua release_firefox_addon.py)
#   2. Đóng gói artifact vào dist/releases/<version>/
#   3. Tạo git tag v<version> (annotated tag)
#   4. Commit + push commits và tag lên remote
#   5. Tạo GitHub Release qua gh CLI và upload .zip để người dùng tải về
#
# Yêu cầu cho bước 5: cài GitHub CLI (gh) và đã xác thực (gh auth login).
#   https://cli.github.com/
#
# Biến môi trường tùy chỉnh:
#   SKIP_TESTS=1        — bỏ qua tests khi build
#   GIT_REMOTE=<name>   — chỉ định remote (mặc định: origin)
#   SKIP_GH_RELEASE=1   — bỏ qua bước tạo GitHub Release
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

# ---- kiểm tra công cụ bắt buộc ----
command -v git     >/dev/null 2>&1 || die "Không tìm thấy git."
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

# ---- kiểm tra gh CLI (tùy chọn) ----
GH_AVAILABLE=0
if [[ "${SKIP_GH_RELEASE:-0}" != "1" ]]; then
    if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
        GH_AVAILABLE=1
        info "GitHub CLI (gh) sẵn sàng — sẽ tạo GitHub Release sau khi push."
    else
        warn "GitHub CLI (gh) chưa cài hoặc chưa đăng nhập."
        warn "Bước tạo GitHub Release sẽ bị bỏ qua."
        warn "Cài đặt: https://cli.github.com/ rồi chạy: gh auth login"
    fi
fi

# ---- kiểm tra tag chưa tồn tại ----
if git tag --list "$TAG" | grep -q "^${TAG}$"; then
    warn "Git tag '${TAG}' đã tồn tại."
    printf "Bạn muốn xóa và tạo lại tag + GitHub Release này không? [y/N]: "
    IFS= read -r confirm_retag
    case "${confirm_retag,,}" in
        y|yes)
            git tag -d "$TAG"
            REMOTE="${GIT_REMOTE:-origin}"
            if git ls-remote --tags "$REMOTE" "refs/tags/${TAG}" | grep -q "$TAG"; then
                warn "Đang xóa tag '${TAG}' trên remote..."
                git push "$REMOTE" ":refs/tags/${TAG}"
            fi
            # Xóa GitHub Release cũ nếu tồn tại
            if [[ "$GH_AVAILABLE" == "1" ]]; then
                if gh release view "$TAG" >/dev/null 2>&1; then
                    warn "Đang xóa GitHub Release '${TAG}'..."
                    gh release delete "$TAG" --yes
                fi
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
printf "\n${BOLD}[Bước 1/5] Build release archive...${RESET}\n"

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
RELEASE_NOTES_FILE="${RELEASES_DIR}/RELEASE_NOTES.md"
SHA256_FILE="${RELEASES_DIR}/SHA256SUMS"
[[ -f "$ARTIFACT" ]] || die "Không tìm thấy artifact: ${ARTIFACT}"

# ======================================================================
# BƯỚC 2 — KIỂM TRA TRẠNG THÁI GIT VÀ XÁC NHẬN
# ======================================================================
printf "\n${BOLD}[Bước 2/5] Kiểm tra trạng thái git...${RESET}\n"
git status --short --branch

CHANGED="$(git status --porcelain=v1 2>/dev/null)"
STAGED="$(git diff --cached --name-only 2>/dev/null)"

# Hỏi commit message
DEFAULT_MSG="chore: release ${VERSION}"
printf "\nNhập commit message [%s]: " "$DEFAULT_MSG"
IFS= read -r COMMIT_MSG
COMMIT_MSG="${COMMIT_MSG:-$DEFAULT_MSG}"

# Hỏi release notes cho tag annotation và GitHub Release
DEFAULT_NOTES="Release ${VERSION} — Firefox ChatAI Assistant"
printf "Nhập tiêu đề release notes [%s]: " "$DEFAULT_NOTES"
IFS= read -r TAG_MSG
TAG_MSG="${TAG_MSG:-$DEFAULT_NOTES}"

# ======================================================================
# BƯỚC 3 — COMMIT (nếu có thay đổi)
# ======================================================================
printf "\n${BOLD}[Bước 3/5] Commit thay đổi...${RESET}\n"

if [[ -n "$CHANGED" || -n "$STAGED" ]]; then
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
printf "\n${BOLD}[Bước 4/5] Tạo git tag '${TAG}' và push lên remote...${RESET}\n"

git tag -a "$TAG" -m "$TAG_MSG"
success "Đã tạo annotated tag: ${TAG}"

REMOTE="${GIT_REMOTE:-origin}"
if ! git remote get-url "$REMOTE" >/dev/null 2>&1; then
    die "Không tìm thấy remote '${REMOTE}'. Tag đã tạo nhưng chưa push."
fi

CURRENT_BRANCH="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
[[ -n "$CURRENT_BRANCH" ]] || die "Repository đang ở detached HEAD. Tag đã tạo nhưng chưa push."

# Push commits
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
success "Tag '${TAG}' đã được push lên ${REMOTE}."

# ======================================================================
# BƯỚC 5 — TẠO GITHUB RELEASE VÀ UPLOAD ARTIFACT
# ======================================================================
printf "\n${BOLD}[Bước 5/5] Tạo GitHub Release và upload artifact...${RESET}\n"

if [[ "$GH_AVAILABLE" != "1" ]]; then
    warn "Bỏ qua: gh CLI không khả dụng."
    warn "Để tạo GitHub Release thủ công, vào: Settings > Releases > Draft a new release"
    warn "Chọn tag '${TAG}' rồi upload file: ${ARTIFACT}"
else
    # Xây dựng release notes: ưu tiên RELEASE_NOTES.md từ release_firefox_addon.py
    GH_NOTES_ARGS=()
    if [[ -f "$RELEASE_NOTES_FILE" ]]; then
        GH_NOTES_ARGS+=(--notes-file "$RELEASE_NOTES_FILE")
    else
        GH_NOTES_ARGS+=(--notes "$TAG_MSG")
    fi

    # Danh sách file đính kèm
    UPLOAD_FILES=("$ARTIFACT")
    [[ -f "$SHA256_FILE" ]] && UPLOAD_FILES+=("$SHA256_FILE")

    info "Đang tạo GitHub Release '${TAG}'..."
    gh release create "$TAG" \
        --title "$TAG_MSG" \
        "${GH_NOTES_ARGS[@]}" \
        "${UPLOAD_FILES[@]}"

    success "GitHub Release '${TAG}' đã được tạo thành công!"

    # Lấy URL trang release
    RELEASE_URL="$(gh release view "$TAG" --json url --jq '.url' 2>/dev/null || echo '')"
fi

# ======================================================================
# KẾT QUẢ
# ======================================================================
printf "\n${GREEN}${BOLD}=====================================================${RESET}\n"
printf "${GREEN}${BOLD}  RELEASE THÀNH CÔNG: Firefox ChatAI Assistant ${VERSION}${RESET}\n"
printf "${GREEN}${BOLD}=====================================================${RESET}\n"
printf "  Git tag   : %s\n" "$TAG"
printf "  Commit    : %s\n" "$(git rev-parse --short HEAD)"
printf "  Artifact  : %s\n" "$ARTIFACT"
printf "  SHA-256   : %s\n" "$(awk '{print $1}' "${SHA256_FILE}" 2>/dev/null || echo 'N/A')"
if [[ "$GH_AVAILABLE" == "1" ]]; then
    printf "\n  📦 GitHub Release (người dùng tải tại đây):\n"
    printf "     %s\n\n" "${RELEASE_URL:-"$(git remote get-url "$REMOTE" 2>/dev/null)/releases/tag/${TAG}"}"
else
    REMOTE_URL="$(git remote get-url "$REMOTE" 2>/dev/null || echo '(unknown)')"
    printf "\n  ⚠️  GitHub Release chưa được tạo tự động.\n"
    printf "  Tạo thủ công tại: %s/releases\n\n" "$REMOTE_URL"
fi

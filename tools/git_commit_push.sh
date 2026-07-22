#!/usr/bin/env bash

set -u

readonly SCRIPT_NAME="$(basename "$0")"

print_error() {
    printf 'LỖI: %s\n' "$*" >&2
}

exit_on_failure() {
    local exit_code=$1
    shift
    if (( exit_code != 0 )); then
        print_error "$*"
        exit "$exit_code"
    fi
}

if ! command -v git >/dev/null 2>&1; then
    print_error "Không tìm thấy lệnh git."
    exit 127
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    print_error "Thư mục hiện tại không nằm trong Git repository."
    exit 1
fi

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root" || {
    print_error "Không thể chuyển tới repository: $repo_root"
    exit 1
}

printf 'Repository: %s\n\n' "$repo_root"
printf '%s\n' 'Git status:'
git status --short --branch
status_code=$?
exit_on_failure "$status_code" "Không thể đọc git status."

if [[ -z "$(git status --porcelain=v1 --untracked-files=all)" ]]; then
    printf '\nKhông có file nào thay đổi.\n'
    exit 0
fi

printf '\n%s\n' 'Danh sách file thay đổi:'
git status --short
status_code=$?
exit_on_failure "$status_code" "Không thể lấy danh sách file thay đổi."

printf '\nCó add toàn bộ thay đổi, commit và push không? [y/N]: '
IFS= read -r confirm
case "${confirm,,}" in
    y|yes)
        ;;
    *)
        printf 'Đã hủy. Không có thay đổi nào được add hoặc commit.\n'
        exit 0
        ;;
esac

default_message="Update project $(date '+%Y-%m-%d %H:%M:%S')"
printf 'Nhập commit message [%s]: ' "$default_message"
IFS= read -r commit_message
commit_message="${commit_message:-$default_message}"

git add -A
status_code=$?
exit_on_failure "$status_code" "git add -A thất bại."

if git diff --cached --quiet; then
    printf 'Không có thay đổi nào để commit sau khi chạy git add -A.\n'
    exit 0
fi

git commit -m "$commit_message"
status_code=$?
exit_on_failure "$status_code" "git commit thất bại."

current_branch="$(git symbolic-ref --quiet --short HEAD 2>/dev/null || true)"
if [[ -z "$current_branch" ]]; then
    print_error "Repository đang ở detached HEAD. Commit đã tạo nhưng chưa push."
    exit 1
fi

if git rev-parse --abbrev-ref --symbolic-full-name '@{upstream}' >/dev/null 2>&1; then
    git push
    status_code=$?
    exit_on_failure "$status_code" "git push thất bại. Commit đã được tạo cục bộ."
else
    if ! git remote get-url origin >/dev/null 2>&1; then
        print_error "Branch '$current_branch' chưa có upstream và repository không có remote 'origin'. Commit đã tạo nhưng chưa push."
        exit 1
    fi

    printf "Branch '%s' chưa có upstream. Đang thiết lập origin/%s...\n" "$current_branch" "$current_branch"
    git push --set-upstream origin "$current_branch"
    status_code=$?
    exit_on_failure "$status_code" "Không thể thiết lập upstream hoặc push. Commit đã được tạo cục bộ."
fi

printf '\nHoàn tất: đã add, commit và push thành công.\n'
printf 'Commit: %s\n' "$(git rev-parse --short HEAD)"

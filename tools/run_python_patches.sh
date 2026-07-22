#!/usr/bin/env bash
set -u
set -o pipefail

# Python patch runner mini-AI v3.
#
# Expected location:
#   <project>/tools/run_python_patches.sh
#
# Supported patch inputs in <project>/patchs:
#   - standalone Python patch: *.py
#   - ZIP package           : *.zip
#   - tar.gz package        : *.tar.gz or *.tgz
#
# Archive workflow:
#   - safely extract to patchs/.patch_runner_tmp/
#   - execute patch_*.py recursively in deterministic order
#   - if no patch_*.py exists, execute every *.py recursively
#   - remove the extracted temporary files
#   - optionally move only the original archive to patchs/patched/
#
# Standalone Python patches are also optionally moved to patchs/patched/
# after execution. Existing files in patched/ are never overwritten.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PATCH_DIR="${PROJECT_ROOT}/patchs"
PATCHED_DIR="${PATCH_DIR}/patched"
TEMP_ROOT="${PATCH_DIR}/.patch_runner_tmp"
TOOLS_DIR="${PROJECT_ROOT}/tools"
PATCH_HELPER="${TOOLS_DIR}/python_patch_utils.py"
CURRENT_TEMP_DIR=""

if command -v python3 >/dev/null 2>&1; then
    PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
    PYTHON_BIN="python"
else
    echo "ERROR: Cannot find python3 or python in PATH."
    exit 1
fi

if [ ! -d "${PATCH_DIR}" ]; then
    echo "ERROR: Patch directory not found: ${PATCH_DIR}"
    echo "Create it first, for example:"
    echo "  mkdir -p patchs"
    exit 1
fi

if [ ! -d "${TOOLS_DIR}" ]; then
    echo "ERROR: Tools directory not found: ${TOOLS_DIR}"
    exit 1
fi

mkdir -p -- "${PATCHED_DIR}" "${TEMP_ROOT}"

cleanup_current_temp() {
    if [ -n "${CURRENT_TEMP_DIR}" ] && [ -d "${CURRENT_TEMP_DIR}" ]; then
        case "${CURRENT_TEMP_DIR}" in
            "${TEMP_ROOT}"/*)
                rm -rf -- "${CURRENT_TEMP_DIR}"
                ;;
            *)
                echo "WARNING: Refusing to remove unexpected temp path: ${CURRENT_TEMP_DIR}" >&2
                ;;
        esac
    fi
    CURRENT_TEMP_DIR=""
}

trap cleanup_current_temp EXIT
trap 'cleanup_current_temp; exit 130' INT TERM HUP

mapfile -d '' -t PATCH_ITEMS < <(
    find "${PATCH_DIR}" -maxdepth 1 -type f \
        \( -iname "*.py" -o -iname "*.zip" -o -iname "*.tar.gz" -o -iname "*.tgz" \) \
        -print0 | sort -z
)

if [ "${#PATCH_ITEMS[@]}" -eq 0 ]; then
    echo "No patch files found in: ${PATCH_DIR}"
    echo "Supported formats: .py, .zip, .tar.gz, .tgz"
    exit 0
fi

ask_yes_no() {
    local prompt="$1"
    local answer

    while true; do
        read -r -p "${prompt} [Y/n]: " answer
        case "${answer}" in
            y|Y|yes|YES|Yes|"") return 0 ;;
            n|N|no|NO|No) return 1 ;;
            *) echo "Please answer y or n." ;;
        esac
    done
}

relative_to_project() {
    local path="$1"
    if [[ "${path}" == "${PROJECT_ROOT}/"* ]]; then
        printf '%s' "${path#${PROJECT_ROOT}/}"
    else
        printf '%s' "${path}"
    fi
}

archive_kind() {
    local lower_name="${1,,}"
    case "${lower_name}" in
        *.zip) printf '%s' "zip" ;;
        *.tar.gz|*.tgz) printf '%s' "tar.gz" ;;
        *) printf '%s' "" ;;
    esac
}

allocate_patched_target() {
    local source_file="$1"
    local base target stem ext timestamp counter

    base="$(basename -- "${source_file}")"
    target="${PATCHED_DIR}/${base}"
    if [ ! -e "${target}" ]; then
        printf '%s' "${target}"
        return 0
    fi

    case "${base,,}" in
        *.tar.gz)
            stem="${base:0:${#base}-7}"
            ext="${base: -7}"
            ;;
        *.tgz)
            stem="${base:0:${#base}-4}"
            ext="${base: -4}"
            ;;
        *.*)
            stem="${base%.*}"
            ext=".${base##*.}"
            ;;
        *)
            stem="${base}"
            ext=""
            ;;
    esac

    timestamp="$(date +%Y%m%d_%H%M%S)"
    target="${PATCHED_DIR}/${stem}.${timestamp}${ext}"
    counter=2
    while [ -e "${target}" ]; do
        target="${PATCHED_DIR}/${stem}.${timestamp}.${counter}${ext}"
        counter=$((counter + 1))
    done
    printf '%s' "${target}"
}

move_original_to_patched() {
    local source_file="$1"
    local source_rel target target_rel

    source_rel="$(relative_to_project "${source_file}")"
    target="$(allocate_patched_target "${source_file}")"
    target_rel="$(relative_to_project "${target}")"

    if ! mv -- "${source_file}" "${target}"; then
        echo "ERROR: Could not move ${source_rel} to ${target_rel}" >&2
        return 1
    fi
    echo "Moved: ${source_rel} -> ${target_rel}"
}

extract_archive_safely() {
    local archive_file="$1"
    local destination="$2"

    "${PYTHON_BIN}" - "${archive_file}" "${destination}" <<'PY'
from __future__ import annotations

from pathlib import Path
import inspect
import os
import stat
import sys
import tarfile
import zipfile


def _clean_excepthook(exc_type, exc, traceback):
    print(f"ERROR: {exc}", file=sys.stderr)


sys.excepthook = _clean_excepthook

archive = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
destination.mkdir(parents=True, exist_ok=True)

MAX_MEMBERS = 10000
MAX_TOTAL_SIZE = 1024 * 1024 * 1024  # 1 GiB after extraction


def safe_target(member_name: str) -> Path:
    # ZIP and TAR member names use POSIX-style separators. Backslashes remain
    # ordinary filename characters on Linux and cannot escape destination.
    target = (destination / member_name).resolve()
    try:
        common = os.path.commonpath((str(destination), str(target)))
    except ValueError as exc:
        raise RuntimeError(f"invalid archive path: {member_name!r}") from exc
    if common != str(destination):
        raise RuntimeError(f"unsafe path traversal in archive: {member_name!r}")
    return target


def check_limits(count: int, total_size: int) -> None:
    if count > MAX_MEMBERS:
        raise RuntimeError(f"archive contains too many members ({count} > {MAX_MEMBERS})")
    if total_size > MAX_TOTAL_SIZE:
        raise RuntimeError(
            f"archive expands beyond safety limit ({total_size} > {MAX_TOTAL_SIZE} bytes)"
        )


lower = archive.name.lower()
if lower.endswith(".zip"):
    with zipfile.ZipFile(archive, "r") as zf:
        members = zf.infolist()
        check_limits(len(members), sum(info.file_size for info in members))
        for info in members:
            safe_target(info.filename)
            unix_mode = (info.external_attr >> 16) & 0xFFFF
            if unix_mode and stat.S_ISLNK(unix_mode):
                raise RuntimeError(f"symbolic links are not allowed: {info.filename!r}")
        for info in members:
            zf.extract(info, destination)
elif lower.endswith((".tar.gz", ".tgz")):
    with tarfile.open(archive, "r:gz") as tf:
        members = tf.getmembers()
        check_limits(len(members), sum(member.size for member in members if member.isfile()))
        for member in members:
            safe_target(member.name)
            if member.issym() or member.islnk():
                raise RuntimeError(f"links are not allowed: {member.name!r}")
            if not (member.isdir() or member.isfile()):
                raise RuntimeError(f"special archive member is not allowed: {member.name!r}")
        extract_kwargs = {}
        if "filter" in inspect.signature(tf.extract).parameters:
            extract_kwargs["filter"] = "data"
        for member in members:
            tf.extract(member, destination, **extract_kwargs)
else:
    raise RuntimeError(f"unsupported archive type: {archive.name}")
PY
}

run_python_file() {
    local patch_file="$1"
    local display_name="$2"
    local extra_pythonpath="${3:-}"
    local effective_pythonpath exit_code

    echo
    echo "============================================================"
    echo "Running: ${display_name}"
    echo "Working directory: ${PROJECT_ROOT}"
    echo "Python: ${PYTHON_BIN}"
    echo "Patch helper: $(relative_to_project "${PATCH_HELPER}")"
    echo "============================================================"

    if [ ! -f "${PATCH_HELPER}" ]; then
        echo "NOTE: $(relative_to_project "${PATCH_HELPER}") not found."
        echo "      Patch can still run if it embeds its own helper code."
    fi

    effective_pythonpath="${TOOLS_DIR}"
    if [ -n "${extra_pythonpath}" ]; then
        effective_pythonpath="${extra_pythonpath}:${effective_pythonpath}"
    fi

    (
        cd "${PROJECT_ROOT}" || exit 1
        PYTHONPATH="${effective_pythonpath}${PYTHONPATH:+:${PYTHONPATH}}" \
            "${PYTHON_BIN}" "${patch_file}"
    )
    exit_code=$?

    echo
    if [ "${exit_code}" -eq 0 ]; then
        echo "DONE: ${display_name}"
    else
        echo "FAILED: ${display_name} exited with code ${exit_code}"
    fi

    return "${exit_code}"
}

run_standalone_patch() {
    local patch_file="$1"
    local rel_file exit_code

    rel_file="$(relative_to_project "${patch_file}")"
    run_python_file "${patch_file}" "${rel_file}"
    exit_code=$?

    if ask_yes_no "Move this executed patch to patchs/patched: ${rel_file}?"; then
        if ! move_original_to_patched "${patch_file}"; then
            [ "${exit_code}" -ne 0 ] || exit_code=1
        fi
    else
        echo "Kept: ${rel_file}"
    fi

    return "${exit_code}"
}

collect_archive_patch_files() {
    local extracted_dir="$1"
    local -n output_array="$2"

    mapfile -d '' -t output_array < <(
        find "${extracted_dir}" -type f -iname "patch_*.py" -print0 | sort -z
    )

    if [ "${#output_array[@]}" -eq 0 ]; then
        mapfile -d '' -t output_array < <(
            find "${extracted_dir}" -type f -iname "*.py" -print0 | sort -z
        )
    fi
}

run_archive_patch() {
    local archive_file="$1"
    local archive_rel archive_type archive_base
    local extract_dir final_exit code internal_rel display_name
    local -a internal_patch_files=()
    local index

    archive_rel="$(relative_to_project "${archive_file}")"
    archive_type="$(archive_kind "${archive_file}")"
    archive_base="$(basename -- "${archive_file}")"
    final_exit=0

    CURRENT_TEMP_DIR="$(mktemp -d "${TEMP_ROOT}/archive.XXXXXX")"
    extract_dir="${CURRENT_TEMP_DIR}/content"
    mkdir -p -- "${extract_dir}"

    echo
    echo "============================================================"
    echo "Extracting patch package: ${archive_rel}"
    echo "Archive type: ${archive_type}"
    echo "Temporary directory: $(relative_to_project "${extract_dir}")"
    echo "============================================================"

    if ! extract_archive_safely "${archive_file}" "${extract_dir}"; then
        code=$?
        # The command is under !, so $? is the inverted status. Preserve a
        # stable non-zero result for the package.
        final_exit=1
        echo "FAILED: Could not safely extract ${archive_rel}"
    else
        collect_archive_patch_files "${extract_dir}" internal_patch_files

        if [ "${#internal_patch_files[@]}" -eq 0 ]; then
            echo "FAILED: No Python patch files found inside ${archive_rel}"
            final_exit=1
        else
            echo "Patch scripts inside package:"
            for index in "${!internal_patch_files[@]}"; do
                internal_rel="${internal_patch_files[$index]#${extract_dir}/}"
                printf "  %2d) %s\n" "$((index + 1))" "${internal_rel}"
            done

            for index in "${!internal_patch_files[@]}"; do
                internal_rel="${internal_patch_files[$index]#${extract_dir}/}"
                display_name="${archive_rel}::${internal_rel}"

                run_python_file "${internal_patch_files[$index]}" "${display_name}" "${extract_dir}"
                code=$?
                if [ "${code}" -ne 0 ]; then
                    final_exit="${code}"
                    if [ "$((index + 1))" -lt "${#internal_patch_files[@]}" ]; then
                        if ! ask_yes_no "Continue with next patch inside ${archive_base}?"; then
                            break
                        fi
                    fi
                fi
            done
        fi
    fi

    cleanup_current_temp
    echo "Removed extracted temporary files for: ${archive_rel}"

    if ask_yes_no "Move this processed patch package to patchs/patched: ${archive_rel}?"; then
        if ! move_original_to_patched "${archive_file}"; then
            [ "${final_exit}" -ne 0 ] || final_exit=1
        fi
    else
        echo "Kept: ${archive_rel}"
    fi

    return "${final_exit}"
}

run_one_item() {
    local item="$1"
    local kind

    kind="$(archive_kind "${item}")"
    if [ -n "${kind}" ]; then
        run_archive_patch "${item}"
    else
        run_standalone_patch "${item}"
    fi
}

echo "Python patch runner mini-AI v3"
echo "Project root : ${PROJECT_ROOT}"
echo "Patch folder : ${PATCH_DIR}"
echo "Patched files: ${PATCHED_DIR}"
echo "Tools folder : ${TOOLS_DIR}"
if [ -f "${PATCH_HELPER}" ]; then
    echo "Patch helper : ${PATCH_HELPER}"
else
    echo "Patch helper : not found"
fi
echo

echo "Available patch files/packages:"
for i in "${!PATCH_ITEMS[@]}"; do
    item="${PATCH_ITEMS[$i]}"
    kind="$(archive_kind "${item}")"
    if [ -n "${kind}" ]; then
        printf "  %2d) %s  [%s]\n" "$((i + 1))" "$(relative_to_project "${item}")" "${kind}"
    else
        printf "  %2d) %s  [python]\n" "$((i + 1))" "$(relative_to_project "${item}")"
    fi
done
echo "   a) Run all"
echo "   q) Quit"
echo

read -r -p "Choose a patch number, 'a' for all, or 'q' to quit: [a] " choice

case "${choice}" in
    q|Q)
        echo "Cancelled."
        exit 0
        ;;
    ''|a|A|all|ALL|All)
        final_exit=0

        for item in "${PATCH_ITEMS[@]}"; do
            # A prior item may have moved a file with the same path only in
            # unusual user-driven situations. Skip it rather than failing.
            if [ ! -f "${item}" ]; then
                continue
            fi

            run_one_item "${item}"
            code=$?

            if [ "${code}" -ne 0 ]; then
                final_exit="${code}"

                if ! ask_yes_no "Continue with next patch file/package?"; then
                    exit "${final_exit}"
                fi
            fi
        done

        exit "${final_exit}"
        ;;
    *[!0-9]*)
        echo "ERROR: Invalid choice: ${choice}"
        exit 1
        ;;
    *)
        index=$((choice - 1))

        if [ "${index}" -lt 0 ] || [ "${index}" -ge "${#PATCH_ITEMS[@]}" ]; then
            echo "ERROR: Choice out of range: ${choice}"
            exit 1
        fi

        run_one_item "${PATCH_ITEMS[$index]}"
        exit $?
        ;;
esac

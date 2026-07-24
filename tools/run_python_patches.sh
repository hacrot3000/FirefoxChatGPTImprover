#!/usr/bin/env bash
set -u
set -o pipefail

TOOL_VERSION="4.0.0"

# Python patch runner mini-AI v4.
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
RUN_MODE="interactive"
PATCH_SELECTOR=""
MOVE_MODE="ask"
ASSUME_YES=0
PATCH_CLI_ARGS=()

usage() {
    cat <<'EOF'
Usage: ./tools/run_python_patches.sh [OPTIONS] [PATCH]

Run Python patch scripts or compressed patch packages from patchs/.
Without arguments, the runner keeps the interactive selection workflow.

Selection:
  -a, --all                    Run all patch files/packages
  -p, --patch PATCH            Run one patch by number, basename, relative path,
                               or absolute path
  -l, --list                   List available patches and exit
      PATCH                    Positional alias for --patch PATCH

Confirmation control:
  -y, --yes                    Fully non-interactive defaults: run all when no
                               patch is selected, move successful inputs, and
                               create/keep a failed-files ZIP on failure
      --move                   Move successful input to patchs/patched/
      --keep, --no-move        Keep successful input in patchs/

Failed-file ZIP options passed to helper-based Python patches:
      --zip-failed             Create failed-files ZIP without asking
      --no-zip-failed          Never create failed-files ZIP
      --delete-failed-zip      Delete generated failed-files ZIP
      --keep-failed-zip        Keep generated failed-files ZIP

Other:
  -h, --help                   Show this help and exit

Behavior:
  Any failed patch stops the runner immediately. Failed inputs are kept in
  patchs/ and are never moved to patchs/patched/.

Examples:
  ./tools/run_python_patches.sh --all --move
  ./tools/run_python_patches.sh -y
  ./tools/run_python_patches.sh --patch 2 --keep
  ./tools/run_python_patches.sh patch_feature.zip --move
  ./tools/run_python_patches.sh --all --zip-failed --keep-failed-zip --move
EOF
}

set_patch_cli_flag() {
    local positive="$1"
    local negative="$2"
    local requested="$3"
    local existing

    for existing in "${PATCH_CLI_ARGS[@]}"; do
        if [ "${existing}" = "${positive}" ] || [ "${existing}" = "${negative}" ]; then
            echo "ERROR: Conflicting patch option: ${existing} and ${requested}" >&2
            exit 2
        fi
    done
    PATCH_CLI_ARGS+=("${requested}")
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        -h|--help)
            usage
            exit 0
            ;;
        -a|--all)
            if [ "${RUN_MODE}" = "one" ]; then
                echo "ERROR: --all cannot be combined with --patch." >&2
                exit 2
            fi
            RUN_MODE="all"
            ;;
        -p|--patch)
            if [ "$#" -lt 2 ]; then
                echo "ERROR: $1 requires a patch selector." >&2
                exit 2
            fi
            if [ "${RUN_MODE}" = "all" ] || [ "${RUN_MODE}" = "one" ]; then
                echo "ERROR: Only one patch selection mode may be used." >&2
                exit 2
            fi
            RUN_MODE="one"
            PATCH_SELECTOR="$2"
            shift
            ;;
        --patch=*)
            if [ "${RUN_MODE}" = "all" ] || [ "${RUN_MODE}" = "one" ]; then
                echo "ERROR: Only one patch selection mode may be used." >&2
                exit 2
            fi
            RUN_MODE="one"
            PATCH_SELECTOR="${1#*=}"
            ;;
        -l|--list)
            if [ "${RUN_MODE}" != "interactive" ]; then
                echo "ERROR: --list cannot be combined with a run selection." >&2
                exit 2
            fi
            RUN_MODE="list"
            ;;
        -y|--yes)
            ASSUME_YES=1
            ;;
        --move)
            if [ "${MOVE_MODE}" = "keep" ]; then
                echo "ERROR: --move conflicts with --keep/--no-move." >&2
                exit 2
            fi
            MOVE_MODE="move"
            ;;
        --keep|--no-move)
            if [ "${MOVE_MODE}" = "move" ]; then
                echo "ERROR: --keep/--no-move conflicts with --move." >&2
                exit 2
            fi
            MOVE_MODE="keep"
            ;;
        --zip-failed)
            set_patch_cli_flag "--zip-failed" "--no-zip-failed" "$1"
            ;;
        --no-zip-failed)
            set_patch_cli_flag "--zip-failed" "--no-zip-failed" "$1"
            ;;
        --delete-failed-zip)
            set_patch_cli_flag "--delete-failed-zip" "--keep-failed-zip" "$1"
            ;;
        --keep-failed-zip)
            set_patch_cli_flag "--delete-failed-zip" "--keep-failed-zip" "$1"
            ;;
        --)
            shift
            if [ "$#" -gt 1 ]; then
                echo "ERROR: Only one positional patch selector is supported." >&2
                exit 2
            fi
            if [ "$#" -eq 1 ]; then
                if [ "${RUN_MODE}" != "interactive" ]; then
                    echo "ERROR: Positional PATCH conflicts with another selection mode." >&2
                    exit 2
                fi
                RUN_MODE="one"
                PATCH_SELECTOR="$1"
            fi
            break
            ;;
        -*)
            echo "ERROR: Unknown option: $1" >&2
            echo "Use --help for usage." >&2
            exit 2
            ;;
        *)
            if [ "${RUN_MODE}" != "interactive" ]; then
                echo "ERROR: Positional PATCH conflicts with another selection mode." >&2
                exit 2
            fi
            RUN_MODE="one"
            PATCH_SELECTOR="$1"
            ;;
    esac
    shift
done

if [ "${ASSUME_YES}" -eq 1 ]; then
    if [ "${RUN_MODE}" = "interactive" ]; then
        RUN_MODE="all"
    fi
    if [ "${MOVE_MODE}" = "ask" ]; then
        MOVE_MODE="move"
    fi

    has_zip_choice=0
    has_delete_choice=0
    for patch_arg in "${PATCH_CLI_ARGS[@]}"; do
        case "${patch_arg}" in
            --zip-failed|--no-zip-failed) has_zip_choice=1 ;;
            --delete-failed-zip|--keep-failed-zip) has_delete_choice=1 ;;
        esac
    done
    if [ "${has_zip_choice}" -eq 0 ]; then
        PATCH_CLI_ARGS+=("--zip-failed")
    fi
    if [ "${has_delete_choice}" -eq 0 ]; then
        PATCH_CLI_ARGS+=("--keep-failed-zip")
    fi
fi

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

    if [ "${ASSUME_YES}" -eq 1 ]; then
        echo "${prompt} [Y/n]: Y (--yes)"
        return 0
    fi

    while true; do
        read -r -p "${prompt} [Y/n]: " answer
        case "${answer}" in
            y|Y|yes|YES|Yes|"") return 0 ;;
            n|N|no|NO|No) return 1 ;;
            *) echo "Please answer y or n." ;;
        esac
    done
}

should_move_successful_input() {
    local prompt="$1"
    case "${MOVE_MODE}" in
        move) return 0 ;;
        keep) return 1 ;;
        ask) ask_yes_no "${prompt}" ;;
        *)
            echo "ERROR: Invalid internal MOVE_MODE: ${MOVE_MODE}" >&2
            return 1
            ;;
    esac
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

    # Project tools must be first. A patch package may contain an old
    # python_patch_utils.py for historical reasons; it must never override the
    # canonical helper installed in <project>/tools/.
    effective_pythonpath="${TOOLS_DIR}"
    if [ -n "${extra_pythonpath}" ]; then
        effective_pythonpath="${effective_pythonpath}:${extra_pythonpath}"
    fi

    (
        cd "${PROJECT_ROOT}" || exit 1
        # Running `python patch.py` puts the archive directory at sys.path[0].
        # Execute through runpy so project tools/python_patch_utils.py remains
        # authoritative, while package sibling modules stay importable.
        export PYTHON_PATCH_PROJECT_TOOLS="${TOOLS_DIR}"
        export PYTHONPATH="${effective_pythonpath}${PYTHONPATH:+:${PYTHONPATH}}"
        "${PYTHON_BIN}" - "${patch_file}" "${PATCH_CLI_ARGS[@]}" <<'PY_PATCH_RUNNER'
import os
from pathlib import Path
import runpy
import sys

patch_file = str(Path(sys.argv[1]).resolve())
patch_args = sys.argv[2:]
tools_dir = str(Path(os.environ["PYTHON_PATCH_PROJECT_TOOLS"]).resolve())


def normalized(path_entry):
    if path_entry == "":
        return str(Path.cwd().resolve())
    try:
        return str(Path(path_entry).resolve())
    except Exception:
        return path_entry


sys.path = [tools_dir] + [
    entry for entry in sys.path if normalized(entry) != tools_dir
]
sys.argv = [patch_file, *patch_args]
runpy.run_path(patch_file, run_name="__main__")
PY_PATCH_RUNNER
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

    if [ "${exit_code}" -ne 0 ]; then
        echo "Kept failed patch: ${rel_file}"
        return "${exit_code}"
    fi

    if should_move_successful_input "Move this executed patch to patchs/patched: ${rel_file}?"; then
        if ! move_original_to_patched "${patch_file}"; then
            exit_code=1
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
                    echo "Stopping package after failed patch: ${internal_rel}"
                    break
                fi
            done
        fi
    fi

    cleanup_current_temp
    echo "Removed extracted temporary files for: ${archive_rel}"

    if [ "${final_exit}" -ne 0 ]; then
        echo "Kept failed patch package: ${archive_rel}"
        return "${final_exit}"
    fi

    if should_move_successful_input "Move this processed patch package to patchs/patched: ${archive_rel}?"; then
        if ! move_original_to_patched "${archive_file}"; then
            final_exit=1
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

print_patch_list() {
    echo "Available patch files/packages:"
    for i in "${!PATCH_ITEMS[@]}"; do
        local item kind
        item="${PATCH_ITEMS[$i]}"
        kind="$(archive_kind "${item}")"
        if [ -n "${kind}" ]; then
            printf "  %2d) %s  [%s]\n" "$((i + 1))" "$(relative_to_project "${item}")" "${kind}"
        else
            printf "  %2d) %s  [python]\n" "$((i + 1))" "$(relative_to_project "${item}")"
        fi
    done
}

resolve_patch_selector() {
    local selector="$1"
    local -n output_item="$2"
    local candidate rel base index matches=0

    if [[ "${selector}" =~ ^[0-9]+$ ]]; then
        index=$((selector - 1))
        if [ "${index}" -lt 0 ] || [ "${index}" -ge "${#PATCH_ITEMS[@]}" ]; then
            echo "ERROR: Patch number out of range: ${selector}" >&2
            return 1
        fi
        output_item="${PATCH_ITEMS[$index]}"
        return 0
    fi

    for candidate in "${PATCH_ITEMS[@]}"; do
        rel="$(relative_to_project "${candidate}")"
        base="$(basename -- "${candidate}")"
        if [ "${selector}" = "${candidate}" ] || [ "${selector}" = "${rel}" ] || [ "${selector}" = "${base}" ]; then
            output_item="${candidate}"
            matches=$((matches + 1))
        fi
    done

    if [ "${matches}" -eq 1 ]; then
        return 0
    fi
    if [ "${matches}" -gt 1 ]; then
        echo "ERROR: Patch selector is ambiguous: ${selector}" >&2
    else
        echo "ERROR: Patch not found: ${selector}" >&2
    fi
    return 1
}

run_all_items() {
    local item code
    for item in "${PATCH_ITEMS[@]}"; do
        if [ ! -f "${item}" ]; then
            continue
        fi
        run_one_item "${item}"
        code=$?
        if [ "${code}" -ne 0 ]; then
            echo "Stopping after failed patch file/package."
            return "${code}"
        fi
    done
    return 0
}

echo "Python patch runner mini-AI v4 (${TOOL_VERSION})"
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

case "${RUN_MODE}" in
    list)
        print_patch_list
        exit 0
        ;;
    all)
        print_patch_list
        echo
        run_all_items
        exit $?
        ;;
    one)
        selected_item=""
        if ! resolve_patch_selector "${PATCH_SELECTOR}" selected_item; then
            print_patch_list
            exit 1
        fi
        run_one_item "${selected_item}"
        exit $?
        ;;
    interactive)
        print_patch_list
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
                run_all_items
                exit $?
                ;;
            *)
                selected_item=""
                if ! resolve_patch_selector "${choice}" selected_item; then
                    exit 1
                fi
                run_one_item "${selected_item}"
                exit $?
                ;;
        esac
        ;;
    *)
        echo "ERROR: Invalid internal RUN_MODE: ${RUN_MODE}" >&2
        exit 2
        ;;
esac

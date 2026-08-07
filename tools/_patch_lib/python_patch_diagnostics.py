#!/usr/bin/env python3
"""Smart diagnostics, secure log filtering, and AI handoff bundles for Patch Tool v5.16.

The module is deliberately standard-library-only.  It keeps complete raw command
output, emits a compact console stream, extracts source locations from common
build systems, and builds bounded source-context bundles suitable for sending to
an AI without pasting large console logs.
"""
from __future__ import annotations

from collections import deque
from dataclasses import asdict, dataclass
import ast
import codecs
import difflib
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
from typing import Any, Callable, Iterable, Optional
import zipfile

TOOL_VERSION = "5.16.0"
OPS_NAME = "PATCH_TOOL_OPS.json"
ANSI_RE = re.compile(r"\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))")
SOURCE_SUFFIXES = {
    ".c", ".cc", ".cpp", ".cxx", ".h", ".hh", ".hpp", ".hxx", ".ino",
    ".py", ".pyi", ".js", ".jsx", ".ts", ".tsx", ".java", ".kt", ".kts",
    ".go", ".rs", ".swift", ".m", ".mm", ".cs", ".sh", ".bash", ".zsh",
    ".cmake", ".mk", ".gradle", ".xml", ".json", ".yaml", ".yml", ".toml",
    ".md", ".html", ".css", ".scss", ".sql", ".proto",
}
SOURCE_BASENAMES = {"CMakeLists.txt", "Dockerfile", "Makefile", "meson.build", "Kconfig"}
SECRET_BASENAMES = {
    ".env", ".npmrc", ".pypirc", ".netrc", "id_rsa", "id_ed25519",
    "credentials", "credentials.json", "service-account.json",
}


SECRET_VALUE_PATTERNS: tuple[tuple[str, re.Pattern[str], str], ...] = (
    ("authorization", re.compile(r"(?i)(authorization\s*[:=]\s*(?:bearer|basic)\s+)([^\s,;]+)"), r"\1<REDACTED>"),
    ("cookie", re.compile(r"(?i)((?:set-)?cookie\s*[:=]\s*)([^\r\n]+)"), r"\1<REDACTED>"),
    ("jwt", re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b"), "<REDACTED:JWT>"),
    ("github_token", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b"), "<REDACTED:GITHUB_TOKEN>"),
    ("gitlab_token", re.compile(r"\bglpat-[A-Za-z0-9_-]{20,}\b"), "<REDACTED:GITLAB_TOKEN>"),
    ("slack_token", re.compile(r"\bxox[baprs]-[A-Za-z0-9-]{10,}\b"), "<REDACTED:SLACK_TOKEN>"),
    ("aws_access_key", re.compile(r"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"), "<REDACTED:AWS_ACCESS_KEY>"),
    ("private_key", re.compile(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----.*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----", re.S), "<REDACTED:PRIVATE_KEY>"),
    ("url_credentials", re.compile(r"(?i)(https?://)([^/@:\s]+):([^/@\s]+)@"), r"\1<REDACTED>:<REDACTED>@"),
    ("key_value", re.compile(r"(?i)\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|secret[_-]?key|password|passwd|pwd|wifi[_-]?password)\s*[:=]\s*)([\"']?)([^\s,;\"']{6,})([\"']?)"), r"\1<REDACTED>"),
)


def redact_secrets(text: str) -> tuple[str, dict[str, Any]]:
    """Redact common credentials from logs/code and return auditable counts."""
    value = text
    counts: dict[str, int] = {}
    for name, pattern, replacement in SECRET_VALUE_PATTERNS:
        value, count = pattern.subn(replacement, value)
        if count:
            counts[name] = counts.get(name, 0) + count
    return value, {"total": sum(counts.values()), "types": counts}

ERROR_RE = re.compile(
    r"(?i)(?:^|\b)(fatal(?: error)?|error|failed|failure|exception|traceback|panic|"
    r"undefined reference|multiple definition|duplicate case|redefinition|assert(?:ion)?|"
    r"segmentation fault|core dumped|permission denied|no such file|not found|timed? out|"
    r"killed|out of memory|no space left|cannot locate|anchor.{0,30}not found|"
    r"expected .{0,100} found [^1]|ninja: build stopped|failed to solve)(?:\b|:)"
)
WARNING_RE = re.compile(r"(?i)(?:^|\b)(warning|deprecated|deprecation|unsafe|note:)(?:\b|:)")
PASS_RE = re.compile(r"(?i)(?:^|\b)(pass(?:ed)?|success(?:ful(?:ly)?)?|built target|build complete|tests? passed)(?:\b|:)" )
MILESTONE_RE = re.compile(
    r"(?i)^(?:-- |configure|configuring|generating|linking|building|compiling|installing|"
    r"running|executing|uploading|flashing|writing|verifying|download(?:ing)?|"
    r"test session starts|collected \d+ items?|patched:|created:|backup\s*:|unchanged/check:|"
    r"={3,}|\[patch tool|git )"
)

# Lines that are normally high-volume and low-value. Error/warning matching always wins.
NOISE_PATTERNS: dict[str, tuple[re.Pattern[str], ...]] = {
    "generic": (
        re.compile(r"^\s*$"),
        re.compile(r"^\s*[.]+\s*$"),
    ),
    "c-build": (
        re.compile(r"^\[\s*\d+%\]\s+(?:Building|Generating|Linking|Built target)"),
        re.compile(r"^\[\d+/\d+\]\s+(?:Building|Generating|Linking|Compiling)"),
        re.compile(r"^\s*(?:CC|CXX|AR|LD)\s+\S+"),
        re.compile(r"^Scanning dependencies of target "),
    ),
    "esp-idf": (
        re.compile(r"^\[\d+/\d+\]\s+(?:Building|Generating|Linking|Compiling)"),
        re.compile(r"^Executing action: (?:all|build)$"),
        re.compile(r"^Running ninja in directory "),
        re.compile(r"^Executing \"ninja .*\"\.\.\.$"),
        re.compile(r"^-- Components: "),
        re.compile(r"^-- Component paths: "),
    ),
    "docker": (
        re.compile(r"^#\d+\s+\[(?:internal|\d+/\d+|auth)"),
        re.compile(r"^#\d+\s+(?:transferring|extracting|downloading|waiting|pull complete|download complete)"),
        re.compile(r"^#\d+\s+(?:CACHED|DONE)\b"),
        re.compile(r"^\s*=>\s+(?:CACHED|transferring context|exporting layers)"),
    ),
    "gradle": (
        re.compile(r"^> Task :.*(?:UP-TO-DATE|NO-SOURCE|FROM-CACHE)$"),
        re.compile(r"^Downloading https?://"),
    ),
    "node": (
        re.compile(r"^(?:npm|pnpm|yarn) (?:notice|http fetch)"),
        re.compile(r"^\s*added \d+ packages"),
        re.compile(r"^\s*\d+ packages are looking for funding"),
    ),
    "rust": (
        re.compile(r"^\s*Compiling \S+ v[\d.]"),
        re.compile(r"^\s*Checking \S+ v[\d.]"),
    ),
    "python": (
        re.compile(r"^collecting \.{2,}"),
        re.compile(r"^\s*\d+%\s*\|"),
    ),
    "go": (
        re.compile(r"^\?\s+\S+\s+\[no test files\]$"),
        re.compile(r"^ok\s+\S+\s+[\d.]+s$"),
    ),
    "dotnet": (
        re.compile(r"^\s*Determining projects to restore"),
        re.compile(r"^\s*Restored \S+"),
        re.compile(r"^\s*\S+ -> \S+$"),
    ),
    "bazel": (
        re.compile(r"^\[\d+ / \d+\]"),
        re.compile(r"^INFO: From "),
    ),
    "maven": (
        re.compile(r"^\[INFO\] Download(?:ing|ed) from "),
        re.compile(r"^Progress \("),
    ),
}


@dataclass
class Diagnostic:
    severity: str
    kind: str
    message: str
    file: str = ""
    line: int = 0
    column: int = 0
    source: str = ""
    suggestion: str = ""
    evidence: str = ""

    def key(self) -> tuple[Any, ...]:
        return (self.severity, self.kind, self.message, self.file, self.line, self.column)


def strip_ansi(text: str) -> str:
    return ANSI_RE.sub("", text).replace("\x00", "")


def detect_profile(command: Iterable[str]) -> str:
    joined = " ".join(str(part).lower() for part in command)
    first = Path(next(iter(command), "")).name.lower() if command else ""
    if "idf.py" in joined or "esp-idf" in joined:
        return "esp-idf"
    if first in {"docker", "docker-compose", "podman"} or "docker build" in joined or "buildx" in joined:
        return "docker"
    if first in {"cmake", "ninja", "make", "gmake", "meson"} or any(x in joined for x in (" cmake ", " ninja ")):
        return "c-build"
    if first in {"gradle", "gradlew", "./gradlew"} or "gradlew" in joined:
        return "gradle"
    if first in {"cargo", "rustc"}:
        return "rust"
    if first in {"go", "gofmt", "golangci-lint"}:
        return "go"
    if first in {"dotnet", "msbuild", "csc"}:
        return "dotnet"
    if first in {"bazel", "bazelisk"}:
        return "bazel"
    if first in {"mvn", "mvnw", "./mvnw"}:
        return "maven"
    if first in {"npm", "npx", "yarn", "pnpm", "node", "tsc"}:
        return "node"
    if first.startswith("python") or any(x in joined for x in ("pytest", "unittest", "compileall")):
        return "python"
    return "generic"


def _is_noise(line: str, profile: str) -> bool:
    patterns = NOISE_PATTERNS["generic"] + NOISE_PATTERNS.get(profile, ())
    return any(pattern.search(line) for pattern in patterns)


def _benign_zero_status(line: str) -> bool:
    lower = line.lower().strip()
    return bool(re.fullmatch(r"(?:errors?|failed|failures?)\s*:?\s*0", lower))


def _diagnostic_meta_noise(line: str) -> bool:
    lower = line.lower().strip()
    return bool(
        re.fullmatch(r"(?:errors?|failed|failures?)\s*:?\s*\d+", lower)
        or lower in {"failed files:", "patch completed with errors."}
        or lower.startswith("zip failed files:")
        or lower.startswith("use --zip-failed")
    )


def _severity(line: str) -> str:
    if ERROR_RE.search(line) and not _benign_zero_status(line):
        return "error"
    if WARNING_RE.search(line):
        return "warning"
    if PASS_RE.search(line):
        return "pass"
    if MILESTONE_RE.search(line):
        return "milestone"
    return "normal"


class SmartLogCapture:
    """Capture complete raw output and emit only useful lines to the parent logger."""

    def __init__(
        self,
        *,
        command: list[str],
        raw_path: Path,
        important_path: Path,
        emit: Callable[[str, bool], None],
        console_mode: str = "smart",
        context_before: int = 2,
        context_after: int = 2,
        failure_tail_lines: int = 80,
        max_raw_bytes: int = 256 * 1024 * 1024,
        max_important_lines: int = 4000,
        redact_secret_values: bool = True,
        max_line_chars: int = 20000,
    ) -> None:
        self.command = command
        self.profile = detect_profile(command)
        self.raw_path = raw_path
        self.important_path = important_path
        self.raw_path.parent.mkdir(parents=True, exist_ok=True)
        self.important_path.parent.mkdir(parents=True, exist_ok=True)
        self.raw = raw_path.open("wb")
        self.emit = emit
        self.console_mode = console_mode
        self.context_before = max(0, int(context_before))
        self.context_after = max(0, int(context_after))
        self.failure_tail_lines = max(0, int(failure_tail_lines))
        self.max_raw_bytes = max(0, int(max_raw_bytes))
        self.max_important_lines = max(1, int(max_important_lines))
        self.redact_secret_values = bool(redact_secret_values)
        self.max_line_chars = max(1000, int(max_line_chars))
        self.redaction_counts: dict[str, int] = {}
        self.line_truncations = 0
        self.in_private_key_block = False
        self.decoder = codecs.getincrementaldecoder("utf-8")("replace")
        self.pending = ""
        self.raw_bytes = 0
        self.raw_lines = 0
        self.raw_truncated = False
        self.before: deque[tuple[int, str]] = deque(maxlen=self.context_before)
        self.tail: deque[tuple[int, str]] = deque(maxlen=self.failure_tail_lines)
        self.important: list[tuple[int, str, str]] = []
        self.emitted_line_numbers: set[int] = set()
        self.after_remaining = 0
        self.last_clean = ""
        self.repeat_count = 0
        self.suppressed_noise = 0

    def _write_raw_line(self, line: str) -> None:
        data = (line + "\n").encode("utf-8", errors="replace")
        if self.max_raw_bytes == 0 or self.raw.tell() < self.max_raw_bytes:
            allowed = len(data) if self.max_raw_bytes == 0 else min(len(data), self.max_raw_bytes - self.raw.tell())
            if allowed > 0:
                self.raw.write(data[:allowed])
        if self.max_raw_bytes and self.raw.tell() >= self.max_raw_bytes:
            self.raw_truncated = True

    def feed(self, data: bytes) -> None:
        if not data:
            return
        self.raw_bytes += len(data)
        text = self.decoder.decode(data)
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        self.pending += text
        parts = self.pending.split("\n")
        self.pending = parts.pop()
        for line in parts:
            self._line(line)

    def _append_important(self, number: int, line: str, severity: str, *, emit_live: bool = True) -> None:
        if number in self.emitted_line_numbers or len(self.important) >= self.max_important_lines:
            return
        self.emitted_line_numbers.add(number)
        self.important.append((number, line, severity))
        if emit_live and self.console_mode == "smart":
            self.emit(line, severity == "error")

    def _flush_repeat_marker(self, number: int) -> None:
        if self.repeat_count > 2:
            marker = f"[filtered repeated line x{self.repeat_count - 1}] {self.last_clean[:300]}"
            self._append_important(number, marker, "milestone")
        self.repeat_count = 0

    def _line(self, raw_line: str) -> None:
        self.raw_lines += 1
        number = self.raw_lines
        clean = strip_ansi(raw_line).rstrip()
        if len(clean) > self.max_line_chars:
            clean = clean[: self.max_line_chars] + " ... [line truncated]"
            self.line_truncations += 1
        if self.redact_secret_values:
            if re.search(r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----", clean):
                self.in_private_key_block = True
                clean = "<REDACTED:PRIVATE_KEY_BLOCK>"
                self.redaction_counts["private_key"] = self.redaction_counts.get("private_key", 0) + 1
            elif self.in_private_key_block:
                if re.search(r"-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----", clean):
                    self.in_private_key_block = False
                clean = "<REDACTED:PRIVATE_KEY_BLOCK_CONTINUATION>"
            else:
                clean, redaction = redact_secrets(clean)
                for key, count in redaction.get("types", {}).items():
                    self.redaction_counts[key] = self.redaction_counts.get(key, 0) + int(count)
        self._write_raw_line(clean)
        self.tail.append((number, clean))
        if self.console_mode == "full":
            self.emit(clean, _severity(clean) == "error")

        if clean == self.last_clean and clean:
            self.repeat_count += 1
            if self.repeat_count > 2:
                self.suppressed_noise += 1
                return
        else:
            self._flush_repeat_marker(number)
            self.last_clean = clean
            self.repeat_count = 1

        severity = _severity(clean)
        important_now = severity in {"error", "warning", "pass", "milestone"}
        if important_now:
            for prev_number, prev_line in list(self.before):
                self._append_important(prev_number, prev_line, "context")
            self._append_important(number, clean, severity)
            self.after_remaining = self.context_after
        elif self.after_remaining > 0:
            self._append_important(number, clean, "context")
            self.after_remaining -= 1
        elif _is_noise(clean, self.profile):
            self.suppressed_noise += 1
        self.before.append((number, clean))

    def close(self, *, exit_code: int, timed_out: bool) -> dict[str, Any]:
        tail_text = self.decoder.decode(b"", final=True)
        if tail_text:
            self.pending += tail_text
        if self.pending:
            self._line(self.pending)
            self.pending = ""
        self._flush_repeat_marker(self.raw_lines + 1)
        if exit_code != 0 or timed_out:
            tail_items = list(self.tail)
            last_numbers = {number for number, _ in tail_items[-12:]}
            for number, line in tail_items:
                if number in last_numbers or not _is_noise(line, self.profile):
                    self._append_important(number, line, "failure_tail", emit_live=False)
        if self.raw_truncated:
            marker = b"\n[PATCH TOOL V5.2] RAW LOG TRUNCATED AT CONFIGURED LIMIT\n"
            try:
                self.raw.write(marker)
            except Exception:
                pass
        self.raw.flush()
        self.raw.close()
        self.important.sort(key=lambda item: item[0])
        header = [
            f"PROFILE: {self.profile}",
            f"COMMAND: {redact_secrets(' '.join(self.command))[0]}",
            f"EXIT_CODE: {exit_code}",
            f"TIMED_OUT: {str(bool(timed_out)).lower()}",
            f"RAW_LINES: {self.raw_lines}",
            f"IMPORTANT_LINES: {len(self.important)}",
            f"SUPPRESSED_NOISE_LINES: {self.suppressed_noise}",
            f"SECRET_REDACTIONS: {sum(self.redaction_counts.values())}",
            f"TRUNCATED_LONG_LINES: {self.line_truncations}",
            "",
        ]
        width = len(str(max(1, self.raw_lines)))
        body = [f"L{number:>{width}} [{severity}] {line}" for number, line, severity in self.important]
        self.important_path.write_text("\n".join(header + body) + "\n", encoding="utf-8")
        ratio = 0.0 if self.raw_lines == 0 else 1.0 - (len(self.important) / self.raw_lines)
        return {
            "profile": self.profile,
            "raw_log": str(self.raw_path),
            "important_log": str(self.important_path),
            "raw_bytes_seen": self.raw_bytes,
            "raw_bytes_stored": self.raw_path.stat().st_size if self.raw_path.exists() else 0,
            "raw_truncated": self.raw_truncated,
            "raw_lines": self.raw_lines,
            "important_lines": len(self.important),
            "suppressed_noise_lines": self.suppressed_noise,
            "reduction_ratio": round(ratio, 4),
            "secret_redactions": sum(self.redaction_counts.values()),
            "secret_redaction_types": dict(sorted(self.redaction_counts.items())),
            "truncated_long_lines": self.line_truncations,
        }


# Common diagnostic locations from GCC/Clang, Python, CMake, MSVC, Rust, Java/TS, Docker.
LOCATION_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("compiler", re.compile(r"^(?P<file>.+?):(?P<line>\d+):(?P<col>\d+):\s*(?P<sev>fatal error|error|warning|note):\s*(?P<msg>.*)$", re.I)),
    ("compiler", re.compile(r"^(?P<file>.+?):(?P<line>\d+):\s*(?P<sev>fatal error|error|warning|note):\s*(?P<msg>.*)$", re.I)),
    ("msvc", re.compile(r"^(?P<file>.+?)\((?P<line>\d+)(?:,(?P<col>\d+))?\):\s*(?P<sev>fatal error|error|warning)\s+[^:]+:\s*(?P<msg>.*)$", re.I)),
    ("python", re.compile(r"^\s*File \"(?P<file>[^\"]+)\", line (?P<line>\d+)(?:, in .*)?$")),
    ("cmake", re.compile(r"^CMake (?P<sev>Error|Warning) at (?P<file>.+?):(?P<line>\d+) \([^)]*\):?\s*(?P<msg>.*)$", re.I)),
    ("rust", re.compile(r"^\s*-->\s+(?P<file>.+?):(?P<line>\d+):(?P<col>\d+)\s*$")),
    ("java", re.compile(r"^(?P<file>.+?\.(?:java|kt|kts|ts|tsx|js|jsx)):(?P<line>\d+):(?:\d+:)?\s*(?P<sev>error|warning)?\s*:?(?P<msg>.*)$", re.I)),
    ("docker", re.compile(r"^(?P<file>Dockerfile):(?P<line>\d+)(?::(?P<col>\d+))?\s*$", re.I)),
    ("go", re.compile(r"^(?P<file>.+?\.go):(?P<line>\d+):(?P<col>\d+):\s*(?P<msg>.*)$", re.I)),
    ("dotnet", re.compile(r"^(?P<file>.+?\.(?:cs|fs|vb))\((?P<line>\d+),(?P<col>\d+)\):\s*(?P<sev>error|warning)\s+[^:]+:\s*(?P<msg>.*)$", re.I)),
    ("shell", re.compile(r"^(?P<file>.+?\.(?:sh|bash|zsh)):\s*line\s+(?P<line>\d+):\s*(?P<msg>.*)$", re.I)),
)


def suggestion_for(message: str, kind: str = "") -> str:
    lower = message.lower()
    if "undefined reference" in lower:
        return "Linker failure: verify the defining source/library is linked and symbol signatures match."
    if "multiple definition" in lower or "redefinition" in lower or "duplicate case" in lower:
        return "Duplicate declaration/definition: inspect nearby duplicate blocks and stale patch insertion."
    if "no such file" in lower or "cannot find" in lower:
        return "Verify the path/include, generated-file step, working directory, and case sensitivity."
    if "undeclared" in lower or "not declared" in lower or "cannot find symbol" in lower:
        return "Check spelling, required include/import, feature guards, and code version drift."
    if "expected" in lower and ("found 0" in lower or "not found" in lower or "anchor" in lower or "locate" in lower):
        return "Likely stale patch anchor: use the CODE_CONTEXT ZIP to update old/anchor text against current source."
    if "syntax" in lower or "expected" in lower or "unterminated" in lower:
        return "Inspect this line and the preceding logical statement for missing delimiters, quotes, commas, or colons."
    if "permission denied" in lower:
        return "Check executable bit, ownership, mount options, and write permission for the target path."
    if "no space left" in lower:
        return "Free disk/inode space, then rerun; build caches and Docker layers are common causes."
    if "killed" in lower or "out of memory" in lower:
        return "Likely resource exhaustion: inspect OOM logs and reduce parallel build jobs or memory use."
    if "timed out" in lower or "timeout" in lower:
        return "Check for a hung subprocess/device/network dependency and increase timeout only after confirming progress."
    if "ninja: build stopped" in lower or "failed to solve" in lower:
        return "This is usually a final wrapper error; inspect the earlier primary error retained in important_log.txt."
    if kind == "python":
        return "Inspect the traceback's final exception and the referenced source context."
    return "Inspect the referenced code context and the first preceding error; later failures may be cascading."


def parse_diagnostics_from_text(text: str, *, source: str = "") -> list[Diagnostic]:
    clean_lines = [strip_ansi(line.rstrip()) for line in text.replace("\r", "\n").splitlines()]
    diagnostics: list[Diagnostic] = []
    seen: set[tuple[Any, ...]] = set()
    pending_rust: Optional[tuple[str, int, int]] = None
    for index, line in enumerate(clean_lines):
        matched = False
        for kind, pattern in LOCATION_PATTERNS:
            match = pattern.match(line)
            if not match:
                continue
            groups = match.groupdict()
            file_name = (groups.get("file") or "").strip()
            line_no = int(groups.get("line") or 0)
            col = int(groups.get("col") or 0)
            sev = (groups.get("sev") or ("error" if ERROR_RE.search(line) else "warning" if WARNING_RE.search(line) else "info")).lower()
            msg = (groups.get("msg") or "").strip()
            if kind == "rust" and not msg:
                pending_rust = (file_name, line_no, col)
                matched = True
                break
            if not msg and index + 1 < len(clean_lines):
                msg = clean_lines[index + 1].strip()
            diag = Diagnostic(
                severity="error" if "error" in sev or "fatal" in sev else "warning" if "warn" in sev else "info",
                kind=kind,
                message=msg or line.strip(),
                file=file_name,
                line=line_no,
                column=col,
                source=source,
                suggestion=suggestion_for(msg or line, kind),
                evidence=line[:1000],
            )
            if diag.key() not in seen:
                diagnostics.append(diag)
                seen.add(diag.key())
            matched = True
            break
        if matched:
            continue
        if pending_rust and re.match(r"^\s*(?:error|warning)(?:\[[^]]+\])?:", line, re.I):
            file_name, line_no, col = pending_rust
            diag = Diagnostic(
                severity="error" if line.lstrip().lower().startswith("error") else "warning",
                kind="rust",
                message=line.strip(), file=file_name, line=line_no, column=col,
                source=source, suggestion=suggestion_for(line, "rust"), evidence=line[:1000],
            )
            if diag.key() not in seen:
                diagnostics.append(diag); seen.add(diag.key())
            pending_rust = None
            continue
        if ERROR_RE.search(line) and not _benign_zero_status(line) and not _diagnostic_meta_noise(line):
            # Keep high-value location-less errors, but avoid summaries that only repeat the failure count.
            diag = Diagnostic(
                severity="error", kind="log", message=line.strip()[:1200], source=source,
                suggestion=suggestion_for(line), evidence=line[:1200],
            )
            if diag.key() not in seen:
                diagnostics.append(diag); seen.add(diag.key())
        if len(diagnostics) >= 200:
            break
    return diagnostics


def syntax_diagnostic(path: Path, exc: SyntaxError, *, display_path: str = "") -> tuple[Diagnostic, str]:
    line_no = int(exc.lineno or 0)
    col = int(exc.offset or 0)
    message = exc.msg or "invalid syntax"
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception:
        lines = []
    start = max(1, line_no - 5)
    end = min(len(lines), line_no + 5)
    width = len(str(max(1, end)))
    context: list[str] = []
    for number in range(start, end + 1):
        marker = ">" if number == line_no else " "
        context.append(f"{marker} L{number:>{width}}: {lines[number - 1]}")
        if number == line_no and col > 0:
            prefix = len(f"{marker} L{number:>{width}}: ")
            context.append(" " * (prefix + max(0, col - 1)) + "^")
    lower = message.lower()
    hints: list[str] = []
    if "expected ':'" in lower:
        hints.append("Add ':' after the preceding def/class/if/for/while/try/with/match/case statement.")
    if "was never closed" in lower or "unexpected eof" in lower:
        hints.append("A bracket, parenthesis, brace, string, or triple-quoted block was probably left open above this line.")
    if "unterminated string" in lower or "eol while scanning string" in lower:
        hints.append("Check quote pairing and embedded backslashes on this and the preceding line.")
    if "indent" in lower or "unindent" in lower:
        hints.append("Normalize indentation and avoid mixing tabs with spaces in the surrounding block.")
    if "f-string" in lower:
        hints.append("Check braces and quote nesting inside the f-string expression.")
    if not hints:
        hints.append("The parser often points after the real problem; inspect this line and the preceding logical statement.")
    suggestion = " ".join(hints)
    diag = Diagnostic(
        severity="error", kind="python_syntax", message=message,
        file=display_path or str(path), line=line_no, column=col,
        source="preflight", suggestion=suggestion,
        evidence="\n".join(context),
    )
    report = (
        f"PYTHON SYNTAX ERROR\nFile: {diag.file}\nLine: {line_no}\nColumn: {col}\n"
        f"Message: {message}\nSuggestion: {suggestion}\n\n" + "\n".join(context) + "\n"
    )
    return diag, report


def _safe_project_path(project_root: Path, value: str) -> Optional[Path]:
    raw = strip_ansi(value.strip().strip("'\"`()[]{}<>.,;"))
    if not raw or raw.startswith(("http://", "https://")):
        return None
    candidate = Path(raw)
    if not candidate.is_absolute():
        candidate = project_root / candidate
    try:
        resolved = candidate.resolve(strict=False)
        resolved.relative_to(project_root.resolve())
    except Exception:
        return None
    return resolved


def _looks_source(path: Path) -> bool:
    return path.suffix.lower() in SOURCE_SUFFIXES or path.name in SOURCE_BASENAMES


def _is_sensitive(path: Path) -> bool:
    lower_parts = {part.lower() for part in path.parts}
    if path.name.lower() in SECRET_BASENAMES:
        return True
    if lower_parts & {".git", ".ssh", "secrets", "credentials"}:
        return True
    return False


def _text_file(path: Path) -> bool:
    try:
        sample = path.read_bytes()[:8192]
    except Exception:
        return False
    return b"\x00" not in sample


def extract_referenced_paths_from_python(script: Path) -> set[str]:
    result: set[str] = set()
    try:
        tree = ast.parse(script.read_text(encoding="utf-8", errors="replace"), filename=str(script))
    except Exception:
        return result
    for node in ast.walk(tree):
        if isinstance(node, ast.Dict):
            for key, value in zip(node.keys, node.values):
                if isinstance(key, ast.Constant) and key.value == "file" and isinstance(value, ast.Constant) and isinstance(value.value, str):
                    result.add(value.value)
        elif isinstance(node, ast.Constant) and isinstance(node.value, str):
            text = node.value.strip()
            if "\n" not in text and 1 < len(text) < 500:
                p = PurePosixPath(text.replace("\\", "/"))
                if p.suffix.lower() in SOURCE_SUFFIXES or p.name in SOURCE_BASENAMES:
                    result.add(text)
    return result


def extract_ops_paths(ops_data: Any) -> set[str]:
    result: set[str] = set()
    def walk(value: Any) -> None:
        if isinstance(value, dict):
            file_value = value.get("file")
            if isinstance(file_value, str):
                result.add(file_value)
            for child in value.values():
                walk(child)
        elif isinstance(value, list):
            for child in value:
                walk(child)
    walk(ops_data)
    return result


def _line_context(path: Path, line_numbers: Iterable[int], context_lines: int) -> str:
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except Exception as exc:
        return f"Cannot read {path}: {exc}\n"
    wanted: set[int] = set()
    for line_no in line_numbers:
        if line_no <= 0:
            continue
        wanted.update(range(max(1, line_no - context_lines), min(len(lines), line_no + context_lines) + 1))
    if not wanted:
        wanted.update(range(1, min(len(lines), context_lines * 2 + 1) + 1))
    output: list[str] = []
    previous = 0
    width = len(str(max(wanted) if wanted else 1))
    marked = set(line_numbers)
    for number in sorted(wanted):
        if previous and number > previous + 1:
            output.append("...")
        marker = ">" if number in marked else " "
        output.append(f"{marker} L{number:>{width}}: {lines[number - 1]}")
        previous = number
    return "\n".join(output) + "\n"


def _nearest_windows(text: str, expected: str, *, limit: int = 3) -> list[tuple[float, int, str]]:
    expected_lines = expected.splitlines()
    actual_lines = text.splitlines()
    if not expected_lines or not actual_lines:
        return []
    window_size = max(1, min(len(expected_lines), 80))
    needle = "\n".join(expected_lines[:window_size])
    step = 1 if len(actual_lines) < 5000 else max(1, window_size // 3)
    scored: list[tuple[float, int, str]] = []
    for start in range(0, max(1, len(actual_lines) - window_size + 1), step):
        window = "\n".join(actual_lines[start:start + window_size])
        ratio = difflib.SequenceMatcher(None, needle, window, autojunk=False).ratio()
        if ratio >= 0.25:
            scored.append((ratio, start + 1, window))
    scored.sort(key=lambda item: item[0], reverse=True)
    return scored[:limit]


def build_stale_anchor_report(project_root: Path, helper_results: list[dict[str, Any]]) -> str:
    sections: list[str] = []
    for helper in helper_results:
        for failure in helper.get("failures", []) if isinstance(helper, dict) else []:
            if not isinstance(failure, dict):
                continue
            rel = str(failure.get("file", "")).strip()
            expected = str(failure.get("expected", "") or "")
            anchor = str(failure.get("anchor", "") or "")
            message = str(failure.get("message", "") or "")
            path = _safe_project_path(project_root, rel)
            sections.append(f"## {rel or '<unknown file>'}\n\nMessage: {message}\n")
            if not path or not path.is_file():
                sections.append("Current file is missing or outside the project root. Check rename/path drift.\n")
                continue
            text = path.read_text(encoding="utf-8", errors="replace")
            sections.append(f"Current size: {len(text.encode('utf-8'))} bytes\n")
            if anchor:
                count = text.count(anchor)
                sections.append(f"Anchor exact count: {count}\n")
                index = text.find(anchor)
                if index >= 0:
                    line = text[:index].count("\n") + 1
                    sections.append("\nAnchor context:\n\n```text\n" + _line_context(path, [line], 8) + "```\n")
            if expected:
                exact = text.count(expected)
                normalized = re.sub(r"\s+", " ", text).count(re.sub(r"\s+", " ", expected))
                sections.append(f"Expected block exact count: {exact}\nExpected block whitespace-normalized count: {normalized}\n")
                if exact == 0:
                    nearest = _nearest_windows(text, expected)
                    if nearest:
                        sections.append("\nNearest current blocks (use these to update the patch):\n")
                        for score, line, block in nearest:
                            sections.append(f"\n### Similarity {score:.1%}, starting near line {line}\n\n```text\n{block[:12000]}\n```\n")
            sections.append("\nRecommended action: refresh the patch's `old`/`anchor` from the current file; do not weaken uniqueness checks blindly.\n")
    return "\n".join(sections).strip() + ("\n" if sections else "")


def _normalized_source_text(text: str) -> str:
    return "\n".join(line.rstrip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")).strip() + "\n"


def normalized_source_sha256(text: str) -> str:
    return hashlib.sha256(_normalized_source_text(text).encode("utf-8")).hexdigest()


def _stream_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _generic_symbol_start(lines: list[str], index: int, symbol_hint: str = "") -> Optional[int]:
    control = re.compile(r"^\s*(?:if|for|while|switch|catch|else|do|try|with)\b")
    declarations = (
        re.compile(r"^\s*(?:class|struct|enum|union|interface|namespace)\s+(?P<name>[A-Za-z_$][\w$]*)[^;]*\{"),
        re.compile(r"^\s*(?:async\s+)?function\s+(?P<name>[A-Za-z_$][\w$]*)\s*\([^;]*\)[^{]*\{"),
        re.compile(r"^\s*(?:[\w:<>,~*&\[\]\s]+\s+)?(?P<name>[A-Za-z_$~][\w$:]*)\s*\([^;{}]*\)\s*(?:const\s*)?(?:noexcept\s*)?(?:->[^\{]+)?\{"),
        re.compile(r"^\s*(?:const|let|var)?\s*(?P<name>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{"),
    )
    lower_bound=max(0,index-800)
    candidates=[]
    for i in range(index, lower_bound-1, -1):
        probe=" ".join(lines[i:min(len(lines), i+4)])
        if "{" not in probe or control.match(lines[i]):
            continue
        for pattern in declarations:
            m=pattern.match(probe)
            if m:
                name=(m.groupdict().get('name') or '').split('::')[-1]
                score=0 if symbol_hint and symbol_hint not in {name, m.groupdict().get('name','')} else 10
                candidates.append((score, i))
                if score:
                    return i
                break
    return candidates[0][1] if candidates else None


def _brace_symbol_end(lines: list[str], start: int) -> int:
    depth=0
    opened=False
    in_block_comment=False
    for i in range(start, min(len(lines), start+5000)):
        line=lines[i]
        j=0
        quote=''
        escape=False
        while j < len(line):
            ch=line[j]
            nxt=line[j+1] if j+1 < len(line) else ''
            if in_block_comment:
                if ch=='*' and nxt=='/':
                    in_block_comment=False; j+=2; continue
                j+=1; continue
            if quote:
                if escape: escape=False
                elif ch=='\\': escape=True
                elif ch==quote: quote=''
                j+=1; continue
            if ch=='/' and nxt=='*': in_block_comment=True; j+=2; continue
            if ch=='/' and nxt=='/': break
            if ch in {'"', "'", '`'}: quote=ch; j+=1; continue
            if ch=='{': depth+=1; opened=True
            elif ch=='}' and opened:
                depth-=1
                if depth<=0: return i
            j+=1
    return min(len(lines)-1, start+399)


def extract_symbol_context(path: Path, *, line_hint: int = 0, symbol_hint: str = "", max_lines: int = 800) -> Optional[dict[str, Any]]:
    try:
        text=path.read_text(encoding='utf-8', errors='replace')
    except Exception:
        return None
    lines=text.splitlines()
    if not lines:
        return None
    suffix=path.suffix.lower()
    start=end=-1
    name=symbol_hint.strip()
    kind='symbol'
    if suffix in {'.py','.pyi'}:
        try:
            tree=ast.parse(text, filename=str(path))
            candidates=[]
            for node in ast.walk(tree):
                if isinstance(node,(ast.FunctionDef,ast.AsyncFunctionDef,ast.ClassDef)) and getattr(node,'end_lineno',None):
                    node_name=getattr(node,'name','')
                    contains=line_hint and node.lineno <= line_hint <= node.end_lineno
                    matches=name and node_name==name
                    if contains or matches:
                        span=node.end_lineno-node.lineno
                        candidates.append((0 if matches else 1, span, node))
            if candidates:
                node=sorted(candidates,key=lambda x:(x[0],x[1]))[0][2]
                start=node.lineno-1; end=node.end_lineno-1; name=getattr(node,'name',name)
                kind='class' if isinstance(node,ast.ClassDef) else 'function'
        except Exception:
            pass
    if start < 0:
        index=max(0,min(len(lines)-1,(line_hint or 1)-1))
        if name:
            for i,line in enumerate(lines):
                if re.search(rf'\b{re.escape(name)}\b',line):
                    index=i
                    candidate=_generic_symbol_start(lines,i,name)
                    if candidate is not None: start=candidate; break
        if start < 0:
            candidate=_generic_symbol_start(lines,index,name)
            if candidate is not None: start=candidate
        if start >= 0:
            end=_brace_symbol_end(lines,start)
            header=' '.join(lines[start:min(end+1,start+4)])
            if not name:
                m=re.search(r'(?:class|struct|enum|union|interface|function)\s+([A-Za-z_$][\w$]*)|([A-Za-z_$~][\w$:]*)\s*\(',header)
                if m: name=(m.group(1) or m.group(2) or '').split('::')[-1]
            kind='class' if re.search(r'\b(?:class|struct|interface)\b',header) else 'function'
    if start < 0 or end < start:
        return None
    original_end=end
    truncated=False
    if end-start+1 > max_lines:
        end=start+max_lines-1; truncated=True
    block='\n'.join(lines[start:end+1])+'\n'
    return {
        'name': name or '<anonymous>', 'kind': kind,
        'start_line': start+1, 'end_line': original_end+1,
        'included_end_line': end+1, 'truncated': truncated,
        'sha256': normalized_source_sha256('\n'.join(lines[start:original_end+1])+'\n'),
        'text': block,
    }


def analyze_source_drift(*, project_root: Path, baseline: Any, output_dir: Path, policy: dict[str, Any]) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    entries=[]
    diagnostics=[]
    files=[]
    if isinstance(baseline,dict): files=baseline.get('files',[]) or []
    enabled=bool(policy.get('enabled',True))
    fail_on_drift=bool(policy.get('fail_on_drift',True))
    allow_symbol_match=bool(policy.get('allow_file_hash_drift_when_symbol_matches',True))
    max_file_bytes=max(1,int(policy.get('max_file_bytes',64*1024*1024)))
    for raw in files if isinstance(files,list) else []:
        if not isinstance(raw,dict): continue
        rel=str(raw.get('file',''))
        path=_safe_project_path(project_root,rel)
        item={'file':rel,'expected_sha256':str(raw.get('sha256','')).lower(),'symbol':str(raw.get('symbol','')),
              'expected_symbol_sha256':str(raw.get('symbol_sha256','')).lower(),'line_hint':int(raw.get('line_hint',0) or 0)}
        if not path or not path.is_file():
            item.update(status='MISSING',drift=True,message='Baseline file is missing or outside the project root.')
        else:
            item['size']=path.stat().st_size
            if item['size'] > max_file_bytes:
                item.update(status='TOO_LARGE',drift=True,message=f"Baseline file exceeds trusted source_drift.max_file_bytes ({max_file_bytes} bytes).")
                entries.append(item)
                diagnostics.append({'severity':'error' if fail_on_drift else 'warning','kind':'source_drift','code':'PTV-SOURCE-DRIFT-002','message':f"{item['message']} ({rel})",'file':rel,'line':item.get('line_hint',0),'column':0,'source':'source_baseline','suggestion':'Raise the trusted project limit only when this large file is intentionally part of the patch baseline.','evidence':json.dumps(item,ensure_ascii=False)[:8000]})
                continue
            item['current_sha256']=_stream_sha256(path)
            file_match=not item['expected_sha256'] or item['expected_sha256']==item['current_sha256']
            item['file_hash_match']=file_match
            symbol=None
            if item['symbol'] or item['expected_symbol_sha256']:
                symbol=extract_symbol_context(path,line_hint=item['line_hint'],symbol_hint=item['symbol'])
                if symbol:
                    item['current_symbol']={k:v for k,v in symbol.items() if k!='text'}
                    item['symbol_hash_match']=not item['expected_symbol_sha256'] or item['expected_symbol_sha256']==symbol['sha256']
                else:
                    item['symbol_hash_match']=False
            if file_match:
                item.update(status='MATCH',drift=False,message='File baseline matches.')
            elif symbol and item.get('symbol_hash_match') and allow_symbol_match:
                item.update(status='FILE_DRIFT_SYMBOL_MATCH',drift=False,message='File changed, but the required symbol still matches its baseline.')
            elif symbol is None and (item['symbol'] or item['expected_symbol_sha256']):
                item.update(status='SYMBOL_MISSING',drift=True,message='Expected symbol could not be located in the current file.')
            else:
                item.update(status='DRIFT',drift=True,message='Current source no longer matches the patch baseline.')
        if item.get('drift'):
            diagnostics.append({
                'severity':'error' if fail_on_drift else 'warning','kind':'source_drift','code':'PTV-SOURCE-DRIFT-001',
                'message':f"{item['message']} ({rel})",'file':rel,'line':item.get('line_hint',0),'column':0,
                'source':'source_baseline','suggestion':'Regenerate the patch against the current file/symbol baseline before applying it.',
                'evidence':json.dumps({k:v for k,v in item.items() if k!='message'},ensure_ascii=False)[:8000],
            })
        entries.append(item)
    drifted=sum(1 for x in entries if x.get('drift'))
    result={'schema_version':1,'enabled':enabled,'provided':bool(files),'status':'NOT_PROVIDED' if not files else ('FAIL' if drifted and fail_on_drift else 'WARN' if drifted else 'PASS'),
            'checked':len(entries),'drifted':drifted,'blocking':bool(enabled and fail_on_drift and drifted),'entries':entries,'diagnostics':diagnostics}
    (output_dir/'source_drift.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    lines=['# Source drift analysis','',f"Status: **{result['status']}**",f"Checked: {len(entries)}",f"Drifted: {drifted}",'']
    if not files: lines.append('No `source_baseline.files` entries were supplied by the patch manifest.')
    for i,item in enumerate(entries,1):
        lines += [f"## {i}. `{item.get('file','')}` — {item.get('status','UNKNOWN')}",'',item.get('message',''),'',f"- Expected file SHA-256: `{item.get('expected_sha256') or 'not supplied'}`",f"- Current file SHA-256: `{item.get('current_sha256') or 'unavailable'}`"]
        if item.get('symbol') or item.get('expected_symbol_sha256'):
            lines += [f"- Symbol: `{item.get('symbol') or '<auto>'}`",f"- Expected symbol SHA-256: `{item.get('expected_symbol_sha256') or 'not supplied'}`",f"- Current symbol SHA-256: `{item.get('current_symbol',{}).get('sha256','unavailable')}`"]
        lines.append('')
    (output_dir/'source_drift.md').write_text('\n'.join(lines).rstrip()+'\n',encoding='utf-8')
    return result


_WRAPPER_ERROR_RE=re.compile(r'(?i)(ninja: build stopped|make(?:\[\d+\])?: \*\*\*|command failed with exit|subcommand failed|patch completed with errors|stopping package after failed|validation failed|process exited with code|package failed)')

def _diagnostic_code(diag: dict[str,Any]) -> str:
    kind=str(diag.get('kind',''))
    raw_message=str(diag.get('message',''))
    msg=raw_message.lower()
    explicit=re.search(r'\b(PTV-[A-Z0-9-]+-\d{3})\b', raw_message)
    if explicit: return explicit.group(1)
    if kind=='source_drift': return 'PTV-SOURCE-DRIFT-001'
    if kind=='python_syntax': return 'PTV-SYNTAX-001'
    if kind=='patch_anchor' or 'anchor' in msg or ('expected' in msg and 'found 0' in msg): return 'PTV-ANCHOR-001'
    if 'timeout' in msg or 'timed out' in msg: return 'PTV-PROCESS-TIMEOUT-001'
    return {'compiler':'PTV-BUILD-C-001','msvc':'PTV-BUILD-C-001','cmake':'PTV-BUILD-CMAKE-001','rust':'PTV-BUILD-RUST-001','java':'PTV-BUILD-JVM-001','docker':'PTV-BUILD-DOCKER-001','python':'PTV-RUNTIME-PYTHON-001','patch_operation':'PTV-PATCH-OP-001'}.get(kind,'PTV-RUNNER-001')


def cluster_root_causes(diagnostics: list[dict[str,Any]], *, max_root_causes: int = 8) -> dict[str,Any]:
    groups=[]; seen={}; duplicate_count=0
    for index,diag in enumerate(diagnostics):
        if str(diag.get('severity','')).lower()!='error': continue
        message=re.sub(r'\s+',' ',str(diag.get('message','')).strip())
        key=(str(diag.get('file','')),int(diag.get('line',0) or 0),str(diag.get('kind','')),message.lower())
        if key in seen:
            groups[seen[key]]['occurrences']+=1; duplicate_count+=1; continue
        wrapper=bool(_WRAPPER_ERROR_RE.search(message)) or str(diag.get('kind',''))=='package'
        score=(100 if diag.get('file') else 0)+(60 if diag.get('line') else 0)+(50 if str(diag.get('kind','')) in {'python_syntax','compiler','msvc','cmake','rust','java','docker','source_drift','patch_anchor','patch_operation'} else 0)-(120 if wrapper else 0)-index/1000
        item={'diagnostic_index':index+1,'code':_diagnostic_code(diag),'severity':'error','kind':diag.get('kind','unknown'),'message':message,'file':diag.get('file',''),'line':int(diag.get('line',0) or 0),'column':int(diag.get('column',0) or 0),'suggestion':diag.get('suggestion',''),'source':diag.get('source',''),'evidence':str(diag.get('evidence',''))[:2000],'wrapper_or_secondary':wrapper,'score':round(score,3),'occurrences':1}
        seen[key]=len(groups); groups.append(item)
    non_wrappers=[g for g in groups if not g['wrapper_or_secondary']]
    candidates=non_wrappers or groups
    roots=sorted(candidates,key=lambda x:(-x['score'],x['diagnostic_index']))[:max(1,int(max_root_causes))]
    for i,item in enumerate(roots,1): item['root_id']=f'ROOT-{i:02d}'
    root_keys={(x['diagnostic_index']) for x in roots}
    secondary=sum(x['occurrences'] for x in groups if x['diagnostic_index'] not in root_keys)
    return {'schema_version':1,'root_causes':roots,'root_cause_count':len(roots),'secondary_or_suppressed_count':secondary,'duplicate_count':duplicate_count,'total_error_occurrences':sum(x['occurrences'] for x in groups)}


def write_root_causes(output_dir: Path, result: dict[str,Any]) -> None:
    (output_dir/'root_causes.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    lines=['# Root-cause candidates','',f"Primary candidates: {result.get('root_cause_count',0)}",f"Secondary/duplicate failures suppressed: {result.get('secondary_or_suppressed_count',0)}",'']
    roots=result.get('root_causes',[])
    if not roots: lines.append('No structured root cause could be identified.')
    for item in roots:
        loc=str(item.get('file',''))
        if item.get('line'): loc+=f":{item['line']}"+(f":{item['column']}" if item.get('column') else '')
        lines += [f"## {item.get('root_id')} — `{item.get('code')}`",'',f"- Location: `{loc or '<not detected>'}`",f"- Message: {item.get('message','')}",f"- Suggested action: {item.get('suggestion','')}",f"- Repeated occurrences: {item.get('occurrences',1)}",'']
    (output_dir/'root_causes.md').write_text('\n'.join(lines).rstrip()+'\n',encoding='utf-8')


def collect_code_context(
    *,
    project_root: Path,
    output_dir: Path,
    diagnostics: list[dict[str, Any]],
    helper_results: list[dict[str, Any]],
    touched_paths: list[str],
    package_source_dir: Optional[Path],
    limits: dict[str, Any],
    source_drift: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    output_dir.mkdir(parents=True, exist_ok=True)
    max_files=max(1,int(limits.get('max_code_files',24))); max_total=max(1,int(limits.get('max_code_total_bytes',4*1024*1024)))
    full_max=max(1,int(limits.get('full_file_max_bytes',256*1024))); context_lines=max(1,int(limits.get('context_lines',20)))
    include_touched=bool(limits.get('include_touched_files',True)); max_symbols=max(1,int(limits.get('max_symbols',12)))
    max_symbol_lines=max(20,int(limits.get('max_symbol_lines',800))); max_symbol_bytes=max(1024,int(limits.get('max_symbol_bytes',512*1024)))
    candidate_lines={}; reasons={}; symbol_hints={}
    def add(path_value:str,reason:str,line:int=0,symbol:str='') -> None:
        path=_safe_project_path(project_root,path_value)
        if not path: return
        try: rel=path.relative_to(project_root.resolve()).as_posix()
        except Exception: return
        candidate_lines.setdefault(rel,set()); reasons.setdefault(rel,set()).add(reason)
        if line>0: candidate_lines[rel].add(int(line))
        if symbol: symbol_hints.setdefault(rel,set()).add(symbol)
    for diag in diagnostics:
        if isinstance(diag,dict) and diag.get('file'): add(str(diag['file']),'diagnostic',int(diag.get('line',0) or 0),str(diag.get('symbol','') or ''))
    for helper in helper_results:
        if not isinstance(helper,dict): continue
        for rel in helper.get('failed_files',[]) or []: add(str(rel),'patch_failure')
        for failure in helper.get('failures',[]) or []:
            if isinstance(failure,dict) and failure.get('file'):
                anchor=str(failure.get('anchor','') or '')
                m=re.search(r'\b([A-Za-z_$~][\w$:]*)\s*\(',anchor)
                add(str(failure['file']),'patch_failure',0,(m.group(1).split('::')[-1] if m else ''))
    if source_drift:
        for entry in source_drift.get('entries',[]) or []:
            if isinstance(entry,dict) and entry.get('file') and (entry.get('drift') or entry.get('status')=='FILE_DRIFT_SYMBOL_MATCH'):
                add(str(entry['file']),'source_drift',int(entry.get('line_hint',0) or 0),str(entry.get('symbol','') or ''))
    if include_touched:
        for rel in touched_paths: add(rel,'touched')
    if package_source_dir and package_source_dir.exists():
        for script in package_source_dir.rglob('*.py'):
            for rel in extract_referenced_paths_from_python(script): add(rel,'patch_reference')
        ops_path=package_source_dir/OPS_NAME
        if ops_path.exists():
            try:
                for rel in extract_ops_paths(json.loads(ops_path.read_text(encoding='utf-8'))): add(rel,'ops_reference')
            except Exception: pass
    selected=[]; symbols=[]; total=0; symbol_total=0
    ordered=sorted(candidate_lines,key=lambda v:('diagnostic' not in reasons[v],'patch_failure' not in reasons[v],'source_drift' not in reasons[v],v))
    for rel in ordered:
        if len(selected)>=max_files or total>=max_total: break
        path=project_root/rel
        if not path.is_file() or _is_sensitive(path) or not _looks_source(path) or not _text_file(path): continue
        lines_for_file=sorted(candidate_lines[rel]); hints=sorted(symbol_hints.get(rel,set()))
        attempts=[]
        if hints: attempts.extend((lines_for_file[0] if lines_for_file else 0,h) for h in hints)
        if lines_for_file: attempts.extend((line,'') for line in lines_for_file[:3])
        seen_symbol_ranges=set()
        for line,hint in attempts:
            if len(symbols)>=max_symbols or symbol_total>=max_symbol_bytes: break
            sym=extract_symbol_context(path,line_hint=line,symbol_hint=hint,max_lines=max_symbol_lines)
            if not sym: continue
            rng=(sym['start_line'],sym['end_line'])
            if rng in seen_symbol_ranges: continue
            seen_symbol_ranges.add(rng)
            data=sym['text'].encode('utf-8')
            if symbol_total+len(data)>max_symbol_bytes: continue
            safe=re.sub(r'[^A-Za-z0-9_.-]+','_',f"{rel}__{sym['name']}__L{sym['start_line']}")+'.symbol.txt'
            target=output_dir/'symbols'/safe; target.parent.mkdir(parents=True,exist_ok=True)
            header=f"FILE: {rel}\nSYMBOL: {sym['name']}\nKIND: {sym['kind']}\nLINES: {sym['start_line']}-{sym['end_line']}\nSHA256: {sym['sha256']}\nTRUNCATED: {sym['truncated']}\n\n"
            target.write_text(header+sym['text'],encoding='utf-8')
            symbol_total+=target.stat().st_size
            symbols.append({'path':rel,'symbol':sym['name'],'kind':sym['kind'],'start_line':sym['start_line'],'end_line':sym['end_line'],'sha256':sym['sha256'],'included_as':f'symbols/{safe}','bytes':target.stat().st_size,'truncated':sym['truncated']})
        size=path.stat().st_size; entry={'path':rel,'size':size,'reasons':sorted(reasons[rel]),'lines':lines_for_file,'symbol_hints':hints}
        if size<=full_max and total+size<=max_total:
            target=output_dir/'files'/rel; target.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(path,target)
            entry.update(included_as=f'files/{rel}',mode='full'); total+=size
        else:
            snippet=_line_context(path,lines_for_file,context_lines); data=snippet.encode('utf-8')
            if total+len(data)>max_total: snippet=data[:max(0,max_total-total)].decode('utf-8','ignore')+'\n[truncated]\n'; data=snippet.encode()
            safe=rel.replace('/','__')+'.context.txt'; target=output_dir/'snippets'/safe; target.parent.mkdir(parents=True,exist_ok=True); target.write_text(snippet,encoding='utf-8')
            entry.update(included_as=f'snippets/{safe}',mode='snippet'); total+=len(data)
        # Always create a compact snippet for the one-file AI handoff.
        compact=_line_context(path,lines_for_file,context_lines)
        compact_target=output_dir/'compact'/ (rel.replace('/','__')+'.context.txt'); compact_target.parent.mkdir(parents=True,exist_ok=True); compact_target.write_text(compact,encoding='utf-8')
        entry['compact_as']=f"compact/{compact_target.name}"
        selected.append(entry)
    stale_report=build_stale_anchor_report(project_root,helper_results)
    if stale_report: (output_dir/'STALE_ANCHOR_ANALYSIS.md').write_text(stale_report,encoding='utf-8')
    paths=[x['path'] for x in selected]
    if paths and (project_root/'.git').exists():
        parts=[]
        for cached in (False,True):
            cmd=['git','diff','--no-ext-diff','--no-color']+(['--cached'] if cached else [])+['--',*paths]
            cp=subprocess.run(cmd,cwd=project_root,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=False)
            if cp.stdout: parts.append(('# STAGED DIFF\n' if cached else '# WORKTREE DIFF\n')+cp.stdout)
        diff='\n'.join(parts); limit=max(1,int(limits.get('max_diff_bytes',1024*1024)))
        if len(diff.encode())>limit: diff=diff.encode()[:limit].decode('utf-8','ignore')+'\n[diff truncated]\n'
        if diff: (output_dir/'git_diff.patch').write_text(diff,encoding='utf-8')
    index={'schema_version':2,'selected_files':selected,'symbols':symbols,'candidate_count':len(candidate_lines),'included_count':len(selected),'included_bytes':total,'symbol_count':len(symbols),'symbol_bytes':symbol_total,
           'limits':{'max_code_files':max_files,'max_code_total_bytes':max_total,'full_file_max_bytes':full_max,'context_lines':context_lines,'max_symbols':max_symbols,'max_symbol_lines':max_symbol_lines,'max_symbol_bytes':max_symbol_bytes},'omitted_candidates':max(0,len(candidate_lines)-len(selected))}
    (output_dir/'CODE_CONTEXT_INDEX.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    return index

def write_diagnostics(output_dir: Path, diagnostics: list[dict[str, Any]]) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "diagnostics.json").write_text(json.dumps(diagnostics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    lines = ["# Diagnostics", ""]
    if not diagnostics:
        lines.append("No structured error or warning location was detected.")
    for index, diag in enumerate(diagnostics, 1):
        severity = str(diag.get("severity", "info")).upper()
        location = str(diag.get("file", ""))
        if diag.get("line"):
            location += f":{diag['line']}"
            if diag.get("column"):
                location += f":{diag['column']}"
        lines += [
            f"## {index}. {severity} — {diag.get('kind', 'unknown')}", "",
            f"- Location: `{location or '<not detected>'}`",
            f"- Message: {diag.get('message', '')}",
            f"- Suggested next check: {diag.get('suggestion', '')}",
            f"- Source: `{diag.get('source', '')}`", "",
        ]
        if diag.get("evidence"):
            lines += ["```text", str(diag["evidence"])[:8000], "```", ""]
    (output_dir / "diagnostics.md").write_text("\n".join(lines).rstrip() + "\n", encoding="utf-8")


def collect_environment_fingerprint(project_root: Path, output_dir: Path) -> dict[str, Any]:
    """Collect a minimal, redacted, portable environment fingerprint.

    Slow tool-version probes are cached locally for 24 hours. Git HEAD/branch/dirty
    state is refreshed for every report and the cache is never treated as source truth.
    """
    import platform
    import time as _time
    cache_path = project_root / "patchs" / "reports" / ".environment_fingerprint_cache.json"
    cached: dict[str, Any] = {}
    try:
        if cache_path.is_file() and (_time.time() - cache_path.stat().st_mtime) < 86400:
            loaded = json.loads(cache_path.read_text(encoding="utf-8"))
            if isinstance(loaded, dict) and loaded.get("tool_version") == TOOL_VERSION:
                cached = loaded
    except Exception:
        cached = {}
    result: dict[str, Any] = {
        "schema_version": 1, "tool_version": TOOL_VERSION,
        "os": cached.get("os") or {"system": platform.system(), "release": platform.release(), "machine": platform.machine()},
        "python": cached.get("python") or platform.python_version(),
        "tools": cached.get("tools") if isinstance(cached.get("tools"), dict) else {},
        "git": {"head": "", "branch": "", "dirty": None},
        "path_policy": "PROJECT_RELATIVE_ONLY",
        "tool_probe_cache_used": bool(cached),
    }
    if not cached:
        commands = [
            ("python", [sys.executable, "--version"]), ("git", ["git", "--version"]),
            ("cmake", ["cmake", "--version"]), ("ninja", ["ninja", "--version"]),
            ("gcc", ["gcc", "--version"]), ("clang", ["clang", "--version"]),
            ("node", ["node", "--version"]), ("go", ["go", "version"]),
            ("rustc", ["rustc", "--version"]), ("java", ["java", "-version"]),
            ("docker", ["docker", "--version"]), ("dotnet", ["dotnet", "--version"]),
            ("idf.py", ["idf.py", "--version"]),
        ]
        for name, command in commands:
            if not shutil.which(command[0]) and command[0] != sys.executable:
                continue
            try:
                completed = subprocess.run(command, cwd=project_root, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=1.5, check=False)
                text, redaction = redact_secrets(completed.stdout or "")
                lines = [line.strip() for line in strip_ansi(text).splitlines() if line.strip()][:3]
                result["tools"][name] = {"exit_code": completed.returncode, "version": " | ".join(lines)[:1000], "redactions": redaction.get("total", 0)}
            except subprocess.TimeoutExpired:
                result["tools"][name] = {"error": "timeout"}
            except Exception as exc:
                result["tools"][name] = {"error": exc.__class__.__name__}
        try:
            cache_path.parent.mkdir(parents=True, exist_ok=True)
            cache_path.write_text(json.dumps({
                "tool_version": TOOL_VERSION, "os": result["os"], "python": result["python"], "tools": result["tools"]
            }, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        except Exception:
            pass
    if (project_root / ".git").exists() and shutil.which("git"):
        for key, command in (("head", ["git", "rev-parse", "--short=12", "HEAD"]), ("branch", ["git", "branch", "--show-current"]), ("status", ["git", "status", "--porcelain"])):
            try:
                completed = subprocess.run(command, cwd=project_root, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, timeout=1.5, check=False)
                value = (completed.stdout or "").strip()
                if key == "status": result["git"]["dirty"] = bool(value)
                else: result["git"][key] = value[:200]
            except Exception:
                pass
    output_dir.mkdir(parents=True, exist_ok=True)
    (output_dir / "environment_fingerprint.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    lines = ["# Environment fingerprint", "", f"- OS: `{result['os']['system']} {result['os']['release']} ({result['os']['machine']})`", f"- Python: `{result['python']}`", f"- Git HEAD: `{result['git'].get('head','')}`", f"- Git branch: `{result['git'].get('branch','')}`", f"- Dirty before report: `{result['git'].get('dirty')}`", f"- Tool probe cache used: `{result['tool_probe_cache_used']}`", "", "## Tools", ""]
    for name, value in sorted(result["tools"].items()):
        lines.append(f"- `{name}`: {value.get('version') or value.get('error') or 'unknown'}")
    (output_dir / "environment_fingerprint.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
    return result


def write_diagnostic_quality(output_dir: Path, *, diagnostics: list[dict[str, Any]], log_stats: dict[str, Any], root_causes: dict[str, Any]) -> dict[str, Any]:
    quality = {
        "schema_version": 1, "tool_version": TOOL_VERSION,
        "structured_diagnostic_count": len(diagnostics),
        "root_cause_count": int(root_causes.get("root_cause_count", 0)),
        "secondary_suppressed": int(root_causes.get("secondary_or_suppressed_count", 0)),
        "raw_lines": int(log_stats.get("raw_lines", 0)),
        "important_lines": int(log_stats.get("important_lines", 0)),
        "reduction_ratio": float(log_stats.get("reduction_ratio", 0)),
        "raw_truncated": bool(log_stats.get("raw_truncated", False)),
        "secret_redactions": int(log_stats.get("secret_redactions", 0)),
        "status": "COMPLETE" if root_causes.get("root_cause_count", 0) or not diagnostics else "PARTIAL",
    }
    (output_dir / "diagnostic_quality.json").write_text(json.dumps(quality, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (output_dir / "diagnostic_quality.md").write_text(
        "# Diagnostic quality\n\n" + "\n".join(f"- {k}: `{v}`" for k, v in quality.items() if k not in {"schema_version"}) + "\n", encoding="utf-8")
    return quality


def _iter_files(root: Path) -> list[Path]:
    return sorted(path for path in root.rglob("*") if path.is_file())


def _zip_selected(destination: Path, root: Path, relative_paths: Iterable[str]) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp = destination.with_suffix(destination.suffix + ".tmp")
    temp.unlink(missing_ok=True)
    try:
        with zipfile.ZipFile(temp, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
            seen: set[str] = set()
            for rel in relative_paths:
                rel = rel.replace("\\", "/")
                if rel in seen:
                    continue
                path = root / rel
                if path.is_file():
                    zf.write(path, arcname=rel)
                    seen.add(rel)
                elif path.is_dir():
                    for child in _iter_files(path):
                        child_rel = child.relative_to(root).as_posix()
                        if child_rel not in seen:
                            zf.write(child, arcname=child_rel)
                            seen.add(child_rel)
        os.replace(temp, destination)
    finally:
        temp.unlink(missing_ok=True)
    return destination


def _token_estimate(path: Path) -> int:
    try:
        with zipfile.ZipFile(path) as zf:
            total = 0
            for info in zf.infolist():
                if info.filename.lower().endswith((".txt", ".md", ".json", ".log", ".py", ".c", ".h", ".cpp", ".js", ".ts", ".patch")):
                    total += info.file_size
            return max(1, total // 4)
    except Exception:
        return max(1, path.stat().st_size // 4)


def _zip_mapped(destination: Path, entries: Iterable[tuple[Path, str]]) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp=destination.with_suffix(destination.suffix+'.tmp'); temp.unlink(missing_ok=True)
    try:
        with zipfile.ZipFile(temp,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as zf:
            seen=set()
            for path,arc in entries:
                if not path.is_file() or arc in seen: continue
                zf.write(path,arcname=arc); seen.add(arc)
        os.replace(temp,destination)
    finally: temp.unlink(missing_ok=True)
    return destination



def _text_token_estimate_bytes(size: int) -> int:
    return max(1, (max(0, int(size)) + 3) // 4)


def _read_text_best_effort(path: Path) -> Optional[str]:
    try:
        data = path.read_bytes()
    except Exception:
        return None
    if b"\x00" in data[:8192]:
        return None
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        return data.decode("utf-8", errors="replace")


def _semantic_compact_text(text: str, *, max_chars: int, label: str) -> str:
    """Compact text without cutting through a logical section when practical.

    Markdown is kept by whole heading sections. Other line-oriented diagnostics keep
    complete lines from the beginning and end. Source/patch payloads are intentionally
    not passed here: those are whole-or-omit to avoid cutting functions/scripts.
    """
    if len(text) <= max_chars:
        return text
    marker = f"\n\n[Patch Tool: compacted {label}; see DETAIL.zip for omitted text]\n\n"
    if label.lower().endswith((".md", ".markdown")):
        lines = text.splitlines(keepends=True)
        sections: list[str] = []
        current: list[str] = []
        for line in lines:
            if re.match(r"^#{1,6}\s+", line) and current:
                sections.append("".join(current)); current = [line]
            else:
                current.append(line)
        if current:
            sections.append("".join(current))
        if len(sections) > 1:
            out: list[str] = []
            used = 0
            reserve = min(max_chars // 4, 4000)
            for section in sections:
                if used + len(section) + len(marker) > max_chars - reserve:
                    break
                out.append(section); used += len(section)
            tail = sections[-1] if sections[-1] not in out else ""
            if tail and used + len(marker) + len(tail) <= max_chars:
                out.extend([marker, tail])
            else:
                out.append(marker)
            result = "".join(out)
            return result[:max_chars]
    lines = text.splitlines(keepends=True)
    if not lines:
        return marker[:max_chars]
    head_budget = max(256, (max_chars - len(marker)) * 2 // 3)
    tail_budget = max(128, max_chars - len(marker) - head_budget)
    head: list[str] = []; used = 0
    for line in lines:
        if used + len(line) > head_budget:
            break
        head.append(line); used += len(line)
    tail: list[str] = []; used = 0
    for line in reversed(lines):
        if used + len(line) > tail_budget:
            break
        tail.append(line); used += len(line)
    return ("".join(head) + marker + "".join(reversed(tail)))[:max_chars]


def _budgeted_zip_mapped(
    destination: Path,
    entries: Iterable[tuple[Path, str, int, bool]],
    *,
    max_tokens: int,
    per_text_file_max_tokens: int,
    deduplicate: bool,
    temp_root: Path,
) -> dict[str, Any]:
    """Build a bounded ZIP and return an auditable inclusion/omission plan."""
    max_chars = max(1024, int(max_tokens) * 4)
    per_file_chars = max(512, int(per_text_file_max_tokens) * 4)
    remaining = max_chars
    seen_hashes: set[str] = set()
    mapped: list[tuple[Path, str]] = []
    included: list[dict[str, Any]] = []
    omitted: list[dict[str, Any]] = []
    compacted: list[dict[str, Any]] = []
    temp_root.mkdir(parents=True, exist_ok=True)
    for path, arc, priority, allow_compact in sorted(entries, key=lambda row: (row[2], row[1])):
        if not path.is_file():
            continue
        # Machine-readable JSON must stay valid. If it does not fit whole, omit it
        # and record the omission instead of truncating it into malformed JSON.
        if arc.lower().endswith(".json"):
            allow_compact = False
        # Machine-readable JSON must remain parseable. If it cannot fit whole, omit it
        # and record the omission instead of truncating it into invalid JSON.
        if arc.lower().endswith(".json"):
            allow_compact = False
        try:
            digest = sha256_path(path)
            size = path.stat().st_size
        except Exception as exc:
            omitted.append({"path": arc, "reason": f"stat/hash failed: {exc.__class__.__name__}"})
            continue
        if deduplicate and digest in seen_hashes:
            omitted.append({"path": arc, "reason": "duplicate_content", "sha256": digest})
            continue
        text = _read_text_best_effort(path)
        token_est = _text_token_estimate_bytes(size if text is None else len(text.encode("utf-8")))
        if text is None:
            # AI bundles are text-oriented. Binary evidence stays in DETAIL.
            omitted.append({"path": arc, "reason": "binary_or_non_text", "bytes": size, "sha256": digest})
            continue
        char_cost = len(text)
        if char_cost <= remaining and char_cost <= per_file_chars:
            mapped.append((path, arc)); remaining -= char_cost; seen_hashes.add(digest)
            included.append({"path": arc, "bytes": size, "estimated_tokens": token_est, "mode": "full", "sha256": digest})
            continue
        if allow_compact and remaining >= 512:
            limit = min(remaining, per_file_chars)
            compact = _semantic_compact_text(text, max_chars=limit, label=arc)
            compact_bytes = compact.encode("utf-8")
            if compact.strip() and len(compact_bytes) <= remaining:
                safe = hashlib.sha256((arc + digest).encode("utf-8")).hexdigest()[:12] + ".txt"
                tmp = temp_root / safe
                tmp.write_text(compact, encoding="utf-8")
                mapped.append((tmp, arc)); remaining -= len(compact_bytes); seen_hashes.add(digest)
                row={"path": arc, "original_bytes": size, "included_bytes": len(compact_bytes), "estimated_tokens": _text_token_estimate_bytes(len(compact_bytes)), "mode": "semantic_compact", "sha256": digest}
                included.append(row); compacted.append(row)
                continue
        omitted.append({"path": arc, "reason": "token_budget", "bytes": size, "estimated_tokens": token_est, "sha256": digest})
    _zip_mapped(destination, mapped)
    actual_tokens = _token_estimate(destination)
    return {
        "path": str(destination), "bytes": destination.stat().st_size,
        "estimated_text_tokens": actual_tokens, "max_tokens": int(max_tokens),
        "included": included, "omitted": omitted, "compacted": compacted,
        "deduplicated_count": sum(1 for row in omitted if row.get("reason") == "duplicate_content"),
        "within_budget": actual_tokens <= int(max_tokens) + 8,
    }


def _write_ai_budget_report(report_dir: Path, result: dict[str, Any]) -> None:
    (report_dir / "ai_handoff_budget.json").write_text(json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    lines=["# AI handoff token budget", "", f"- Policy: `{result.get('policy','BOUNDED')}`"]
    for name in ("handoff","summary","code"):
        row=result.get(name,{})
        lines += [f"- {name.upper()}: `{row.get('estimated_text_tokens',0)}` / `{row.get('max_tokens',0)}` estimated tokens; omitted `{len(row.get('omitted',[]))}`; compacted `{len(row.get('compacted',[]))}`"]
    lines += ["", "DETAIL.zip remains the complete redacted evidence archive and is intentionally not token-bounded.", "If HANDOFF omits required evidence, send DETAIL only when the AI asks for the omitted raw material."]
    (report_dir / "ai_handoff_budget.md").write_text("\n".join(lines)+"\n", encoding="utf-8")


def create_ai_bundles(*, report_dir: Path, reports_dir: Path, base_name: str, status: str, allocate: Callable[[Path], Path], config: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    """Create bounded AI bundles while preserving the v5.16 compatibility layout.

    HANDOFF is the normal AI input and is source-aware/token-bounded. SUMMARY and
    CODE retain the historical file names/layout for tools that still inspect them.
    DETAIL remains complete redacted evidence and is intentionally not bounded.
    """
    reports_dir.mkdir(parents=True, exist_ok=True)
    cfg = config if isinstance(config, dict) else {}
    handoff_budget = max(4000, int(cfg.get("handoff_max_tokens", 24000)))
    summary_budget = max(2000, int(cfg.get("summary_max_tokens", 10000)))
    code_budget = max(4000, int(cfg.get("code_max_tokens", 28000)))
    per_file = max(500, int(cfg.get("per_text_file_max_tokens", 6000)))
    dedup = bool(cfg.get("deduplicate_by_sha256", True))
    split = bool(cfg.get("split_compatibility_bundles", True))

    summary_path = allocate(reports_dir / f"{base_name}_{status}_SUMMARY.zip")
    detail_path = allocate(reports_dir / f"{base_name}_{status}_DETAIL.zip")
    code_path = allocate(reports_dir / f"{base_name}_{status}_CODE.zip")
    handoff_path = allocate(reports_dir / f"{base_name}_{status}_HANDOFF.zip")

    # Historical v5.16 summary content. Priority decides what survives a tight
    # budget, but small machine-readable JSON remains available for compatibility.
    common_spec: list[tuple[str, int, bool]] = [
        ("AI_README.md", 0, True), ("START_HERE.md", 0, True),
        ("NEXT_AI_ACTION.md", 0, True), ("AI_REQUEST_TEMPLATE.txt", 0, True),
        ("summary.txt", 3, True), ("summary.json", 4, True),
        ("root_causes.md", 5, True), ("root_causes.json", 6, True),
        ("failure_delta.md", 7, True), ("failure_delta.json", 8, True),
        ("diagnostic_quality.md", 9, True), ("diagnostic_quality.json", 10, True),
        ("source_drift.md", 11, True), ("source_drift.json", 12, True),
        ("validation_selection.md", 13, True), ("validation_selection.json", 14, True),
        ("multi_machine_context.md", 15, True), ("multi_machine_context.json", 16, True),
        ("diagnostics.md", 17, True), ("diagnostics.json", 18, True),
        ("important_log.txt", 20, True), ("worktree_touched_paths.txt", 22, True),
        ("environment_fingerprint.md", 24, True), ("environment_fingerprint.json", 25, True),
        ("security_redaction.json", 26, True), ("transaction/transaction.json", 28, True),
        ("manifest.json", 30, False), ("package_inventory.txt", 32, True),
        ("REPORT_INDEX.json", 40, True),
    ]
    summary_entries: list[tuple[Path, str, int, bool]] = []
    for rel, pri, compact in common_spec:
        path = report_dir / rel
        if path.is_file():
            summary_entries.append((path, rel, pri, compact))

    # Compatibility CODE bundle keeps historical paths so older analysis/tests
    # do not need to understand the focused HANDOFF layout.
    code_entries: list[tuple[Path, str, int, bool]] = list(summary_entries)
    cc = report_dir / "code_context"
    if cc.exists():
        for path in _iter_files(cc):
            rel = path.relative_to(report_dir).as_posix()
            whole = "/symbols/" in f"/{rel}" or rel.endswith((".c", ".h", ".cpp", ".py", ".js", ".ts", ".patch"))
            code_entries.append((path, rel, 20 if whole else 25, not whole))
    package = report_dir / "package_source"
    if package.exists():
        for path in _iter_files(package):
            rel = path.relative_to(report_dir).as_posix()
            code_entries.append((path, rel, 18, False))
    tx_after = report_dir / "transaction" / "sandbox_after"
    if tx_after.exists():
        for path in _iter_files(tx_after):
            rel = path.relative_to(report_dir).as_posix()
            code_entries.append((path, rel, 35, False))

    # HANDOFF is a focused union. PASS needs proof/summary only. FAIL adds
    # payload and focused code context. The exact omission plan is audited.
    status_upper = str(status).upper()
    evidence_level = "COMPACT_PASS" if status_upper.endswith("PASS") and "FAIL" not in status_upper else "FOCUSED_FAILURE"
    handoff_entries: list[tuple[Path, str, int, bool]] = []
    root_names = {"START_HERE.md", "NEXT_AI_ACTION.md", "AI_REQUEST_TEMPLATE.txt"}
    for path, arc, pri, compact in summary_entries:
        handoff_arc = arc if arc in root_names else "AI_SUMMARY/" + arc
        handoff_entries.append((path, handoff_arc, pri, compact))

    if evidence_level == "FOCUSED_FAILURE":
        # Patch payload is whole-or-omit; never cut a script/operation halfway.
        if package.exists():
            for path in _iter_files(package):
                handoff_entries.append((path, "PATCH_PAYLOAD/" + path.relative_to(package).as_posix(), 28, False))
        if cc.exists():
            allowed_roots = {"symbols", "compact"}
            allowed_files = {"CODE_CONTEXT_INDEX.json", "STALE_ANCHOR_ANALYSIS.md", "git_diff.patch"}
            for path in _iter_files(cc):
                rel = path.relative_to(cc)
                if rel.parts and (rel.parts[0] in allowed_roots or rel.as_posix() in allowed_files):
                    whole = rel.parts[0] == "symbols" or rel.suffix.lower() in {".c", ".h", ".cpp", ".py", ".js", ".ts", ".patch"}
                    handoff_entries.append((path, "CODE_CONTEXT/" + rel.as_posix(), 30 if whole else 34, not whole))
        transaction = report_dir / "transaction" / "transaction.json"
        if transaction.is_file():
            handoff_entries.append((transaction, "TRANSACTION/transaction.json", 38, True))

    detail_index = report_dir / "DETAIL_INDEX.md"
    if detail_index.is_file():
        handoff_entries.append((detail_index, "DETAIL_INDEX.md", 90, True))

    empty_result = lambda path, max_tokens: {
        "path": "", "bytes": 0, "estimated_text_tokens": 0, "max_tokens": max_tokens,
        "included": [], "omitted": [], "compacted": [], "deduplicated_count": 0,
        "within_budget": True,
    }
    temp_root = reports_dir / ".patch_tool_ai_bundle_tmp" / base_name
    if temp_root.exists():
        shutil.rmtree(temp_root, ignore_errors=True)
    try:
        summary_result = (
            _budgeted_zip_mapped(summary_path, summary_entries, max_tokens=summary_budget,
                                 per_text_file_max_tokens=per_file, deduplicate=dedup,
                                 temp_root=temp_root / "summary")
            if split else empty_result(summary_path, summary_budget)
        )
        code_result = (
            _budgeted_zip_mapped(code_path, code_entries, max_tokens=code_budget,
                                 per_text_file_max_tokens=per_file, deduplicate=dedup,
                                 temp_root=temp_root / "code")
            if split else empty_result(code_path, code_budget)
        )
        handoff_result = _budgeted_zip_mapped(
            handoff_path, handoff_entries, max_tokens=handoff_budget,
            per_text_file_max_tokens=per_file, deduplicate=dedup,
            temp_root=temp_root / "handoff",
        )
        budget_report = {
            "schema_version": 1, "tool_version": TOOL_VERSION,
            "policy": "TOKEN_BOUNDED_SEMANTIC_SAFE", "evidence_level": evidence_level,
            "handoff": handoff_result, "summary": summary_result, "code": code_result,
            "detail": {"bounded": False},
            "configuration": {
                "handoff_max_tokens": handoff_budget, "summary_max_tokens": summary_budget,
                "code_max_tokens": code_budget, "per_text_file_max_tokens": per_file,
                "deduplicate_by_sha256": dedup, "split_compatibility_bundles": split,
            },
        }
        _write_ai_budget_report(report_dir, budget_report)

        # Include the small budget audit itself and rebuild once under the same cap.
        budget_md = report_dir / "ai_handoff_budget.md"
        if budget_md.is_file():
            handoff_entries.append((budget_md, "AI_SUMMARY/ai_handoff_budget.md", 2, True))
        handoff_result = _budgeted_zip_mapped(
            handoff_path, handoff_entries, max_tokens=handoff_budget,
            per_text_file_max_tokens=per_file, deduplicate=dedup,
            temp_root=temp_root / "handoff2",
        )
        budget_report["handoff"] = handoff_result
        _write_ai_budget_report(report_dir, budget_report)

        detail_rel = [
            path.relative_to(report_dir).as_posix() for path in _iter_files(report_dir)
            if not path.relative_to(report_dir).as_posix().startswith("code_context/")
        ]
        _zip_selected(detail_path, report_dir, detail_rel)
        detail_result = {
            "path": str(detail_path), "bytes": detail_path.stat().st_size,
            "estimated_text_tokens": _token_estimate(detail_path), "max_tokens": 0,
            "within_budget": True,
        }
        return {
            "handoff": handoff_result, "summary": summary_result,
            "detail": detail_result, "code": code_result, "budget": budget_report,
        }
    finally:
        shutil.rmtree(temp_root, ignore_errors=True)
        try:
            parent = temp_root.parent
            if parent.exists() and not any(parent.iterdir()):
                parent.rmdir()
        except Exception:
            pass

def sha256_path(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def build_report_index(report_dir: Path, *, extra: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    files = []
    for path in _iter_files(report_dir):
        rel = path.relative_to(report_dir).as_posix()
        if rel == "REPORT_INDEX.json":
            continue
        files.append({"path": rel, "bytes": path.stat().st_size, "sha256": sha256_path(path)})
    result = {"schema_version": 1, "tool_version": TOOL_VERSION, "files": files}
    if extra:
        result.update(extra)
    (report_dir / "REPORT_INDEX.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return result

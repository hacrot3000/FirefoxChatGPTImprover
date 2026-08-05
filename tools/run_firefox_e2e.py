#!/usr/bin/env python3
"""Run FirefoxChatImprover against a real Firefox process.

The runner creates a temporary extension copy, exposes a narrow test hook from the
background closure, injects the production content scripts into a localhost
fixture, and waits for a JSON report posted by the test-only background driver.
No test hook or fixture is added to the production extension package.
"""
from __future__ import annotations

import argparse
import contextlib
import hashlib
import http.server
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
EXTENSION_DIR = ROOT / "extension"
FIXTURE_DIR = ROOT / "tests" / "e2e"
DEFAULT_TIMEOUT = 90
ADDON_ID = "firefox-chat-assistant@duongtc.local"


def parse_version(text: str) -> tuple[int, ...]:
    match = re.search(r"(\d+(?:\.\d+){0,3})", text)
    if not match:
        return ()
    return tuple(int(part) for part in match.group(1).split("."))


def find_firefox(explicit: str | None) -> Path:
    candidates: list[str] = []
    if explicit:
        candidates.append(explicit)
    for env_name in ("FIREFOX_BIN", "FIREFOX_BINARY"):
        value = os.environ.get(env_name)
        if value:
            candidates.append(value)
    for name in ("firefox", "firefox-esr", "firefox-developer-edition", "firefox.exe"):
        resolved = shutil.which(name)
        if resolved:
            candidates.append(resolved)
    if os.name == "nt":
        for root_name in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
            root = os.environ.get(root_name)
            if root:
                candidates.append(str(Path(root) / "Mozilla Firefox" / "firefox.exe"))
    for candidate in candidates:
        path = Path(os.path.expandvars(candidate)).expanduser().resolve()
        if path.is_file() and (os.name == "nt" or os.access(path, os.X_OK)):
            return path
    raise RuntimeError("Firefox binary was not found. Pass --firefox /absolute/path/to/firefox.")


def executable_command(executable: Path, *arguments: str) -> list[str]:
    if os.name == "nt" and executable.suffix.lower() in {".cmd", ".bat"}:
        command_processor = os.environ.get("COMSPEC") or "cmd.exe"
        command_line = subprocess.list2cmdline([str(executable), *arguments])
        return [command_processor, "/d", "/s", "/c", command_line]
    return [str(executable), *arguments]


def native_shell_test_command(marker: Path, platform_name: str | None = None) -> str:
    marker_text = str(marker.resolve())
    is_windows = (platform_name or os.name) in {"nt", "windows"}
    if is_windows:
        escaped = marker_text.replace("'", "''")
        return (
            f"Set-Content -LiteralPath '{escaped}' -Value 'firefox-e2e' -Encoding UTF8; "
            f"if (-not (Test-Path -LiteralPath '{escaped}' -PathType Leaf)) {{ exit 1 }}"
        )
    return f"printf 'firefox-e2e\n' > {json.dumps(marker_text)} && test -s {json.dumps(marker_text)}"


def find_web_ext(explicit: str | None) -> Path:
    candidates: list[str] = []
    if explicit:
        candidates.append(explicit)
    env_value = os.environ.get("WEB_EXT_BIN")
    if env_value:
        candidates.append(env_value)
    candidates.append(str(ROOT / ".firefox-dev-tools" / "node_modules" / ".bin" / "web-ext"))
    candidates.append(str(ROOT / ".firefox-dev-tools" / "node_modules" / ".bin" / "web-ext.cmd"))
    resolved = shutil.which("web-ext")
    if resolved:
        candidates.append(resolved)
    for candidate in candidates:
        path = Path(os.path.expandvars(candidate)).expanduser().resolve()
        if path.is_file() and (os.name == "nt" or os.access(path, os.X_OK)):
            probe = subprocess.run(executable_command(path, "--version"), text=True, capture_output=True, check=False)
            if probe.returncode == 0:
                return path
    raise RuntimeError(
        "A working web-ext executable was not found. Run ./tools/setup_firefox_addon_dev.sh or pass --web-ext."
    )


def firefox_version(binary: Path) -> tuple[str, tuple[int, ...]]:
    result = subprocess.run([str(binary), "--version"], text=True, capture_output=True, check=False)
    output = ((result.stdout or "") + (result.stderr or "")).strip()
    if result.returncode != 0 or not output:
        raise RuntimeError(f"Could not read Firefox version from {binary}: {output}")
    return output, parse_version(output)


def free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


class E2EState:
    def __init__(self, fixture_dir: Path, download_payload: bytes):
        self.fixture_dir = fixture_dir
        self.download_payload = download_payload
        self.report: dict[str, Any] | None = None
        self.events: list[dict[str, Any]] = []
        self.condition = threading.Condition()

    def set_report(self, value: dict[str, Any]) -> None:
        with self.condition:
            self.report = value
            self.condition.notify_all()

    def wait_report(self, timeout: float) -> dict[str, Any] | None:
        deadline = time.monotonic() + timeout
        with self.condition:
            while self.report is None:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    return None
                self.condition.wait(remaining)
            return self.report


def make_handler(state: E2EState):
    class Handler(http.server.BaseHTTPRequestHandler):
        server_version = "FCI-E2E/1"

        def log_message(self, _format: str, *_args: Any) -> None:
            return

        def _send(self, status: int, content_type: str, payload: bytes, headers: dict[str, str] | None = None) -> None:
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(payload)))
            self.send_header("Cache-Control", "no-store")
            for name, value in (headers or {}).items():
                self.send_header(name, value)
            self.end_headers()
            self.wfile.write(payload)

        def do_GET(self) -> None:  # noqa: N802
            parsed = urllib.parse.urlparse(self.path)
            if parsed.path in ("/", "/fixture.html"):
                payload = (state.fixture_dir / "fixture.html").read_bytes()
                self._send(200, "text/html; charset=utf-8", payload)
                return
            if parsed.path == "/fixture.js":
                payload = (state.fixture_dir / "fixture.js").read_bytes()
                self._send(200, "text/javascript; charset=utf-8", payload)
                return
            if parsed.path.startswith("/download/"):
                name = Path(urllib.parse.unquote(parsed.path)).name or "e2e.bin"
                self._send(
                    200,
                    "application/octet-stream",
                    state.download_payload,
                    {"Content-Disposition": f'attachment; filename="{name}"'},
                )
                return
            if parsed.path == "/health":
                self._send(200, "application/json", b'{"ok":true}')
                return
            self._send(404, "text/plain; charset=utf-8", b"not found")

        def do_POST(self) -> None:  # noqa: N802
            length = int(self.headers.get("Content-Length", "0") or 0)
            raw = self.rfile.read(length)
            try:
                value = json.loads(raw.decode("utf-8"))
            except Exception:
                self._send(400, "application/json", b'{"ok":false,"error":"invalid json"}')
                return
            if self.path == "/report":
                state.set_report(value if isinstance(value, dict) else {"value": value})
            elif self.path == "/event":
                state.events.append(value if isinstance(value, dict) else {"value": value})
            self._send(200, "application/json", b'{"ok":true}')

    return Handler


def inject_test_hooks(background_text: str) -> str:
    marker = "\n})();\n"
    if not background_text.endswith(marker):
        raise RuntimeError("Could not locate the background IIFE terminator for E2E hook injection.")
    hook = r'''

  // Test-only hook injected into a temporary E2E copy by tools/run_firefox_e2e.py.
  Object.defineProperty(globalThis, "__FCI_E2E_HOOKS", {
    configurable: true,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      activateTab,
      saveTabConfig,
      saveTabLocalActions,
      setVolatileLocalActionDraft,
      armDownloadCapture,
      dashboard,
      nativeDashboardState,
      stopTab,
      async runShellForTab(tabId, cwd, command) {
        const session = sessions.get(Number(tabId));
        if (!session) throw new Error("E2E shell tab is not activated.");
        const localStore = await loadLocalActionStore();
        const config = sessionLocalActionConfig(session, localStore);
        return startShellRunForSession(session, config, {
          tabId: Number(tabId), cwd: String(cwd), command: String(command), mode: "background", preset: null
        }, { source: "sidebar" });
      }
    })
  });
'''
    return background_text[: -len(marker)] + hook + marker


def driver_script(origin: str, work_dir: Path, require_native: bool) -> str:
    destination_a = str((work_dir / "downloads-a").resolve())
    destination_b = str((work_dir / "downloads-b").resolve())
    shell_marker_path = (work_dir / "shell-marker.txt").resolve()
    shell_marker = str(shell_marker_path)
    shell_command = native_shell_test_command(shell_marker_path)
    report_url = f"{origin}/report"
    fixture_a = f"{origin}/fixture.html?tab=A"
    fixture_b = f"{origin}/fixture.html?tab=B"
    constants = json.dumps(
        {
            "origin": origin,
            "reportUrl": report_url,
            "fixtureA": fixture_a,
            "fixtureB": fixture_b,
            "destinationA": destination_a,
            "destinationB": destination_b,
            "shellMarker": shell_marker,
            "shellCommand": shell_command,
            "requireNative": bool(require_native),
        },
        ensure_ascii=False,
    )
    return f'''(() => {{
  "use strict";
  const C = {constants};
  const Protocol = globalThis.FCI_PROTOCOL;
  const Settings = globalThis.FCI_SETTINGS;
  const LocalActions = globalThis.FCI_LOCAL_ACTIONS;
  const hooks = globalThis.__FCI_E2E_HOOKS;
  const results = [];

  function record(name, ok, detail = null, skipped = false) {{
    results.push({{ name, ok: Boolean(ok), skipped: Boolean(skipped), detail }});
    if (!ok && !skipped) throw new Error(`${{name}}: ${{detail || "failed"}}`);
  }}
  function sleep(ms) {{ return new Promise((resolve) => setTimeout(resolve, ms)); }}
  async function waitFor(label, predicate, timeoutMs = 15000, intervalMs = 100) {{
    const deadline = Date.now() + timeoutMs;
    let last = null;
    while (Date.now() < deadline) {{
      try {{ last = await predicate(); if (last) return last; }} catch (error) {{ last = error?.message || String(error); }}
      await sleep(intervalMs);
    }}
    throw new Error(`${{label}} timed out; last=${{JSON.stringify(last)}}`);
  }}
  async function tabReady(tabId) {{
    return waitFor(`tab ${{tabId}} complete`, async () => {{
      const tab = await browser.tabs.get(tabId);
      return tab.status === "complete" ? tab : null;
    }});
  }}
  async function status(tabId) {{
    return browser.tabs.sendMessage(tabId, {{ type: Protocol.MESSAGE.CONTENT_STATUS }});
  }}
  async function exec(tabId, fn, args = []) {{
    const values = await browser.scripting.executeScript({{ target: {{ tabId }}, func: fn, args }});
    return values?.[0]?.result;
  }}
  function buildConfig() {{
    const config = Settings.defaultConfig();
    const rule = config.rules[0];
    rule.monitor.selector = {{ tag: "div", kind: "id", value: "monitor", attributeName: "" }};
    rule.monitor.conditions = [{{ enabled: true, attribute: "data-state", operator: "equals", value: "ready", caseSensitive: true }}];
    rule.monitor.matchStableMs = 0;
    rule.monitor.resetStableMs = 0;
    rule.target.enabled = true;
    rule.target.selector = {{ tag: "button", kind: "class", value: "download-target", attributeName: "" }};
    rule.target.clickStrategy = "newest";
    rule.target.visibleOnly = true;
    rule.target.enabledOnly = true;
    rule.target.dryRun = false;
    rule.target.maxClicksPerCycle = 1;
    rule.target.fingerprintAttributes = ["data-e2e-target-id"];
    config.monitor = Settings.clone(rule.monitor);
    config.target = Settings.clone(rule.target);
    config.alerts.titleBlink = true;
    config.alerts.badge = true;
    config.alerts.notification = false;
    config.alerts.dismissOnUserActivity = false;
    config.alerts.activeTabTimeoutSeconds = 30;
    return config;
  }}
  function localConfig(destination) {{
    const config = LocalActions.defaultConfig();
    config.download.enabled = true;
    config.download.destinationDirectory = destination;
    config.download.captureWindowSeconds = 20;
    config.download.showCompletionDialog = false;
    config.download.shellExecutionMode = "disabled";
    config.download.executeShellAfterMove = false;
    config.shell.workingDirectory = destination;
    config.shell.command = "true";
    config.shell.mode = "background";
    return config;
  }}
  async function post(report) {{
    await fetch(C.reportUrl, {{ method: "POST", headers: {{ "Content-Type": "application/json" }}, body: JSON.stringify(report) }});
  }}

  async function run() {{
    if (!hooks) throw new Error("The E2E hook was not installed in the temporary background copy.");
    const tabA = await browser.tabs.create({{ url: C.fixtureA, active: true }});
    const tabB = await browser.tabs.create({{ url: C.fixtureB, active: false }});
    await Promise.all([tabReady(tabA.id), tabReady(tabB.id)]);
    await hooks.activateTab(await browser.tabs.get(tabA.id), "e2e");
    await hooks.activateTab(await browser.tabs.get(tabB.id), "e2e");
    const configA = buildConfig();
    const configB = buildConfig();
    await hooks.saveTabConfig(tabA.id, configA);
    await hooks.saveTabConfig(tabB.id, configB);
    await hooks.saveTabLocalActions(tabA.id, localConfig(C.destinationA));
    await hooks.saveTabLocalActions(tabB.id, localConfig(C.destinationB));

    await exec(tabA.id, () => window.FCI_E2E_FIXTURE.setMonitor("waiting"));
    await exec(tabB.id, () => window.FCI_E2E_FIXTURE.setMonitor("waiting"));
    await waitFor("both tabs waiting", async () => {{
      const [a, b] = await Promise.all([status(tabA.id), status(tabB.id)]);
      return a?.runtime?.monitorState === "waiting" && b?.runtime?.monitorState === "waiting";
    }});
    record("real Firefox activation and independent waiting state", true);

    await exec(tabA.id, () => window.FCI_E2E_FIXTURE.setMonitor("ready"));
    const matchedA = await waitFor("tab A matched", async () => {{
      const value = await status(tabA.id);
      return value?.runtime?.monitorState === "matched" ? value : null;
    }});
    const waitingB = await status(tabB.id);
    record("multi-tab monitor isolation", waitingB?.runtime?.monitorState === "waiting", waitingB?.runtime?.monitorState);
    const titleMatched = await exec(tabA.id, () => document.title);
    record("AI READY title on matched state", String(titleMatched).includes("AI READY"), titleMatched);
    const badgeMatched = await browser.action.getBadgeText({{ tabId: tabA.id }});
    record("browser action badge updated", ["!", "ON"].includes(badgeMatched), badgeMatched);

    await exec(tabA.id, () => window.FCI_E2E_FIXTURE.addTarget("first"));
    const clicks = await waitFor("target auto-click", async () => Number(await exec(tabA.id, () => document.documentElement.dataset.e2eClicks || 0)) >= 1);
    record("target auto-click in real Firefox DOM", Boolean(clicks));

    await exec(tabA.id, () => window.FCI_E2E_FIXTURE.setMonitor("waiting"));
    const waitingStatus = await waitFor("tab A rearmed", async () => {{
      const value = await status(tabA.id);
      return value?.runtime?.monitorState === "waiting" ? value : null;
    }});
    const waitingTitle = await exec(tabA.id, () => document.title);
    record("Running spinner only while waiting", Boolean(waitingStatus?.runtime?.monitorTitleSpinning) && !String(waitingTitle).includes("AI READY"), waitingTitle);

    const spaUrl = await exec(tabA.id, () => window.FCI_E2E_FIXTURE.spaNavigate("spa"));
    const spaStatus = await status(tabA.id);
    record("SPA navigation keeps content runtime", spaStatus?.mode === "active" && String(spaUrl).includes("spa=spa"), {{ spaUrl, mode: spaStatus?.mode }});

    await browser.tabs.update(tabA.id, {{ url: `${{C.origin}}/fixture.html?tab=A&full=1` }});
    await tabReady(tabA.id);
    const recovered = await waitFor("full navigation recovery", async () => {{
      const value = await status(tabA.id).catch(() => null);
      return value?.mode === "active" ? value : null;
    }}, 20000);
    record("full navigation recovery", recovered?.mode === "active", recovered?.runtime?.recoveryState || null);

    const dashboard = await hooks.dashboard();
    const publicA = dashboard.sessions.find((item) => item.tabId === tabA.id);
    const publicB = dashboard.sessions.find((item) => item.tabId === tabB.id);
    record(
      "tab-bound local-action destinations",
      publicA?.effectiveLocalActions?.download?.destinationDirectory === C.destinationA &&
      publicB?.effectiveLocalActions?.download?.destinationDirectory === C.destinationB,
      {{ a: publicA?.effectiveLocalActions?.download?.destinationDirectory, b: publicB?.effectiveLocalActions?.download?.destinationDirectory }}
    );

    let nativeAvailable = false;
    try {{
      const pingId = `e2e-ping-${{crypto.randomUUID()}}`;
      const native = await new Promise((resolve, reject) => {{
        const port = browser.runtime.connectNative("com.duongtc.firefox_chat_assistant");
        const timer = setTimeout(() => {{ try {{ port.disconnect(); }} catch (_error) {{}} reject(new Error("native ping timeout")); }}, 4000);
        port.onMessage.addListener((message) => {{
          if (message?.requestId === pingId || message?.event === "pong" || message?.hostVersion) {{
            clearTimeout(timer); try {{ port.disconnect(); }} catch (_error) {{}} resolve(message);
          }}
        }});
        port.onDisconnect.addListener(() => {{ if (browser.runtime.lastError) {{ clearTimeout(timer); reject(new Error(browser.runtime.lastError.message)); }} }});
        port.postMessage({{ action: "ping", requestId: pingId }});
      }});
      nativeAvailable = Boolean(native?.hostVersion || native?.event === "pong");
      record("Native Host detected", nativeAvailable, native?.hostVersion || native?.event || null, !nativeAvailable && !C.requireNative);
    }} catch (error) {{
      if (C.requireNative) throw error;
      record("Native Host detected", false, error?.message || String(error), true);
    }}

    if (nativeAvailable) {{
      await exec(tabA.id, (name) => window.FCI_E2E_FIXTURE.setDownload(name), ["real-firefox-e2e.bin"]);
      const current = await status(tabA.id);
      await hooks.armDownloadCapture(tabA.id, {{ ruleId: "rule-default", cycle: Number(current?.runtime?.cycle || 0), targetCount: 1 }});
      await exec(tabA.id, () => document.getElementById("download-link").click());
      const moved = await waitFor("managed download relocation", async () => {{
        const value = await hooks.dashboard();
        const item = value.nativeHost?.downloads?.find((job) => job.tabId === tabA.id);
        return item?.status === "completed" ? item : (item?.status === "failed" ? (() => {{ throw new Error(item.error || "download move failed"); }})() : null);
      }}, 30000);
      record("real Firefox managed download relocation", String(moved.destinationPath || "").startsWith(C.destinationA), moved.destinationPath || null);

      const shell = await hooks.runShellForTab(tabA.id, C.destinationA, `printf 'firefox-e2e\\n' > ${{JSON.stringify(C.shellMarker)}} && test -s ${{JSON.stringify(C.shellMarker)}}`);
      const finished = await waitFor("Native Host shell completion", async () => {{
        const value = await hooks.dashboard();
        const run = value.nativeHost?.runs?.find((item) => item.runId === shell.runId);
        return ["exited", "error"].includes(run?.status) ? run : null;
      }}, 30000);
      const markerExists = await fetch(`${{C.origin}}/health`).then(() => true).catch(() => false);
      record("real Firefox Native Host shell execution", finished.status === "exited" && Number(finished.returnCode) === 0 && markerExists, {{ status: finished.status, rc: finished.returnCode }});
    }} else {{
      record("real Firefox managed download relocation", false, "Native Host unavailable", true);
      record("real Firefox Native Host shell execution", false, "Native Host unavailable", true);
    }}

    await hooks.stopTab(tabA.id);
    await hooks.stopTab(tabB.id);
    return {{ ok: results.every((item) => item.ok || item.skipped), results, tabs: {{ a: tabA.id, b: tabB.id }}, nativeAvailable }};
  }}

  void run().then((report) => post(report)).catch(async (error) => {{
    results.push({{ name: "uncaught E2E failure", ok: false, skipped: false, detail: error?.stack || error?.message || String(error) }});
    try {{ await post({{ ok: false, results }}); }} catch (_postError) {{ console.error("FCI E2E report failed", _postError); }}
  }});
}})();
'''


def prepare_extension(temp_root: Path, origin: str, require_native: bool) -> Path:
    target = temp_root / "extension"
    shutil.copytree(EXTENSION_DIR, target)
    background = target / "background" / "background.js"
    background.write_text(inject_test_hooks(background.read_text(encoding="utf-8")), encoding="utf-8")
    e2e_dir = target / "e2e"
    e2e_dir.mkdir(parents=True, exist_ok=True)
    (e2e_dir / "background_driver.js").write_text(driver_script(origin, temp_root, require_native), encoding="utf-8")

    manifest_path = target / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    scripts = list(manifest.get("background", {}).get("scripts", []))
    scripts.append("e2e/background_driver.js")
    manifest.setdefault("background", {})["scripts"] = scripts
    permissions = list(manifest.get("permissions", []))
    manifest["permissions"] = list(dict.fromkeys(permissions + ["scripting", "tabs", "downloads", "nativeMessaging"]))
    host_permissions = list(manifest.get("host_permissions", []))
    host_permissions.append(f"{origin}/*")
    manifest["host_permissions"] = list(dict.fromkeys(host_permissions))
    manifest["content_scripts"] = [
        {
            "matches": [f"{origin}/*"],
            "js": [
                "shared/protocol.js",
                "shared/settings.js",
                "content/monitor.js",
                "content/target.js",
                "content/alert.js",
                "content/rules.js",
                "content/activation.js",
            ],
            "run_at": "document_idle",
        }
    ]
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return target


def build_web_ext_command(web_ext: Path, firefox: Path, extension: Path, origin: str, profile: Path) -> list[str]:
    help_result = subprocess.run(executable_command(web_ext, "run", "--help"), text=True, capture_output=True, check=False)
    help_text = (help_result.stdout or "") + (help_result.stderr or "")
    arguments = [
        "run",
        "--source-dir",
        str(extension),
        "--firefox",
        str(firefox),
        "--firefox-profile",
        str(profile),
        "--profile-create-if-missing",
        "--keep-profile-changes",
        "--no-reload",
        "--start-url",
        f"{origin}/health",
    ]
    if "--headless" in help_text:
        arguments.append("--headless")
    elif "--args" in help_text:
        arguments.extend(["--args", "-headless"])
    return executable_command(web_ext, *arguments)


def terminate_process(process: subprocess.Popen[str]) -> None:
    if process.poll() is not None:
        return
    process.terminate()
    try:
        process.wait(timeout=8)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)


def run(args: argparse.Namespace) -> dict[str, Any]:
    firefox = find_firefox(args.firefox)
    web_ext = find_web_ext(args.web_ext)
    version_text, version = firefox_version(firefox)
    manifest = json.loads((EXTENSION_DIR / "manifest.json").read_text(encoding="utf-8"))
    minimum_text = str(manifest.get("browser_specific_settings", {}).get("gecko", {}).get("strict_min_version", "0"))
    minimum = parse_version(minimum_text)
    if version and minimum and version < minimum:
        raise RuntimeError(f"{version_text} is below manifest strict_min_version {minimum_text}.")

    port = free_port()
    origin = f"http://127.0.0.1:{port}"
    payload = b"FirefoxChatImprover real Firefox E2E payload\n"
    state = E2EState(FIXTURE_DIR, payload)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), make_handler(state))
    thread = threading.Thread(target=server.serve_forever, name="fci-e2e-http", daemon=True)
    thread.start()

    keep_path: Path | None = None
    temp_context = tempfile.TemporaryDirectory(prefix="fci-firefox-e2e-")
    temp_root = Path(temp_context.name)
    process: subprocess.Popen[str] | None = None
    try:
        extension = prepare_extension(temp_root, origin, args.require_native)
        profile = temp_root / "firefox-profile"
        profile.mkdir(parents=True, exist_ok=True)
        command = build_web_ext_command(web_ext, firefox, extension, origin, profile)
        log_path = temp_root / "web-ext.log"
        log_handle = log_path.open("w", encoding="utf-8")
        process = subprocess.Popen(
            command,
            cwd=ROOT,
            stdout=log_handle,
            stderr=subprocess.STDOUT,
            text=True,
            env={**os.environ, "MOZ_HEADLESS": "1"},
        )
        report = state.wait_report(args.timeout)
        terminate_process(process)
        log_handle.close()
        log_text = log_path.read_text(encoding="utf-8", errors="replace")
        if report is None:
            raise RuntimeError(f"Firefox E2E timed out after {args.timeout}s. web-ext output:\n{log_text[-6000:]}")
        report.update(
            {
                "firefox": str(firefox),
                "firefoxVersion": version_text,
                "webExt": str(web_ext),
                "addonVersion": manifest.get("version"),
                "strictMinVersion": minimum_text,
                "temporaryExtensionSha256": hashlib.sha256(
                    (extension / "manifest.json").read_bytes()
                ).hexdigest(),
            }
        )
        if args.keep_workdir:
            keep_path = Path(args.keep_workdir).expanduser().resolve()
            if keep_path.exists():
                shutil.rmtree(keep_path)
            shutil.copytree(temp_root, keep_path)
            report["keptWorkdir"] = str(keep_path)
        return report
    finally:
        if process is not None:
            terminate_process(process)
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
        temp_context.cleanup()


def main() -> int:
    parser = argparse.ArgumentParser(description="Run FirefoxChatImprover real-Firefox E2E tests.")
    parser.add_argument("--firefox", help="Absolute Firefox binary path.")
    parser.add_argument("--web-ext", help="Absolute web-ext executable path.")
    parser.add_argument("--timeout", type=int, default=DEFAULT_TIMEOUT)
    parser.add_argument("--require-native", action="store_true", help="Fail instead of skipping Native Host download/shell checks.")
    parser.add_argument("--json-report", help="Write the complete report to this path.")
    parser.add_argument("--keep-workdir", help="Copy the temporary E2E workspace to this path.")
    args = parser.parse_args()
    try:
        report = run(args)
    except Exception as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 1
    if args.json_report:
        path = Path(args.json_report).expanduser().resolve()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for item in report.get("results", []):
        prefix = "SKIP" if item.get("skipped") else ("PASS" if item.get("ok") else "FAIL")
        detail = item.get("detail")
        print(f"{prefix}: {item.get('name')}" + (f" | {json.dumps(detail, ensure_ascii=False)}" if detail is not None else ""))
    print(
        f"{'PASS' if report.get('ok') else 'FAIL'}: real Firefox E2E | "
        f"{report.get('firefoxVersion')} | add-on {report.get('addonVersion')} | native={report.get('nativeAvailable')}"
    )
    return 0 if report.get("ok") else 1


if __name__ == "__main__":
    raise SystemExit(main())

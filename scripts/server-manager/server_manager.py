# -*- coding: utf-8 -*-
"""로컬 서버 상태 관리 · 켜기/끄기 · 모니터링 (poster 글작성 서버 제외)."""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from collections import defaultdict, deque
from datetime import datetime, timezone, timedelta
from pathlib import Path

HERE = Path(__file__).resolve().parent
CATALOG_PATH = HERE / "servers.json"
KST = timezone(timedelta(hours=9))
CREATE_NO_WINDOW = 0x08000000
HISTORY_LEN = 180
POLL_SEC = 2.0
SYSTEM_PORTS = {
    135, 139, 445, 3389, 5040, 5354, 5939, 6463, 9010, 9080,
    11434, 27015, 27036, 49664,
}

_proc_lock = threading.Lock()
_proc_cache = {"at": 0.0, "rows": []}


def kst_now():
    return datetime.now(KST)


def load_catalog():
    data = json.loads(CATALOG_PATH.read_text(encoding="utf-8"))
    data.setdefault("exclude_roots", [])
    data.setdefault("exclude_ports", [])
    data.setdefault("exclude_cmdline", [])
    data.setdefault("servers", [])
    return data


def _ps(script: str, timeout=20):
    return subprocess.run(
        [
            "powershell.exe",
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ],
        capture_output=True,
        text=True,
        timeout=timeout,
        encoding="utf-8",
        errors="replace",
        creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0,
    )


def list_processes(force=False):
    now = time.time()
    with _proc_lock:
        if not force and now - _proc_cache["at"] < 1.2:
            return list(_proc_cache["rows"])
    script = r"""
$ErrorActionPreference='SilentlyContinue'
Get-CimInstance Win32_Process |
  Where-Object { $_.Name -match '^(node|python|pythonw|cmd|cloudflared)\.exe$' } |
  ForEach-Object {
    [PSCustomObject]@{
      pid=$_.ProcessId; ppid=$_.ParentProcessId; name=$_.Name;
      cmd=$_.CommandLine; ws=[int64]$_.WorkingSetSize; created=$_.CreationDate
    }
  } | ConvertTo-Json -Compress
"""
    try:
        r = _ps(script)
        raw = (r.stdout or "").strip()
        rows = json.loads(raw) if raw else []
        if isinstance(rows, dict):
            rows = [rows]
    except Exception:
        rows = []
    with _proc_lock:
        _proc_cache["at"] = now
        _proc_cache["rows"] = rows
    return list(rows)


def listening_map():
    """port -> set(pid)"""
    out = {}
    try:
        r = subprocess.run(
            ["netstat", "-ano", "-p", "tcp"],
            capture_output=True,
            text=True,
            timeout=8,
            encoding="utf-8",
            errors="replace",
            creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0,
        )
    except Exception:
        return out
    for line in r.stdout.splitlines():
        if "LISTENING" not in line.upper():
            continue
        parts = line.split()
        if len(parts) < 5:
            continue
        addr, pid_s = parts[1], parts[-1]
        if ":" not in addr:
            continue
        try:
            port = int(addr.rsplit(":", 1)[-1])
            pid = int(pid_s)
        except ValueError:
            continue
        out.setdefault(port, set()).add(pid)
    return out


def _cmd_of(row):
    return str(row.get("cmd") or "")


def is_excluded(row, catalog):
    cmd = _norm(_cmd_of(row))
    if not cmd:
        return False
    for root in catalog.get("exclude_roots") or []:
        if _norm(root) and _norm(root) in cmd:
            return True
    for pat in catalog.get("exclude_cmdline") or []:
        if _norm(pat) and _norm(pat) in cmd:
            return True
    return False


def _norm(s):
    return str(s or "").lower().replace("\\", "/")


def match_server(row, srv, catalog):
    if is_excluded(row, catalog):
        return False
    cmd = _norm(_cmd_of(row))
    if not cmd:
        return False
    root = _norm(srv.get("root") or "")
    for needle in srv.get("needles") or []:
        n = _norm(needle)
        if n and n in cmd:
            return True
    if root and root in cmd and any(
        x in cmd for x in ("vite", "dev-server-guard", "server.mjs", "tunnel.mjs")
    ):
        return True
    return False


CLIMB_NAMES = {"node.exe", "cmd.exe", "conhost.exe", "cloudflared.exe"}
STOP_NAMES = {
    "explorer.exe", "services.exe", "svchost.exe", "wininit.exe",
    "lsass.exe", "winlogon.exe", "csrss.exe", "smss.exe",
}


def expand_related(found, rows, catalog):
    """포트에 붙은 프로세스의 부모(npm·가드)와 자식(vite·터널)까지 한 세트로 묶는다."""
    by_pid = {}
    children = defaultdict(list)
    for row in rows:
        pid = int(row.get("pid") or 0)
        if not pid:
            continue
        by_pid[pid] = row
        ppid = int(row.get("ppid") or 0)
        if ppid:
            children[ppid].append(pid)
    include = {int(r["pid"]) for r in found if r.get("pid")}
    stack = list(include)
    while stack:
        pid = stack.pop()
        for child in children.get(pid, []):
            row = by_pid.get(child)
            if not row or is_excluded(row, catalog):
                continue
            if child not in include:
                include.add(child)
                stack.append(child)
    for pid in list(include):
        cur = pid
        seen = set()
        while cur and cur not in seen:
            seen.add(cur)
            row = by_pid.get(cur)
            if not row:
                break
            parent = int(row.get("ppid") or 0)
            prow = by_pid.get(parent)
            if not prow or is_excluded(prow, catalog):
                break
            name = (prow.get("name") or "").lower()
            if name in STOP_NAMES or name not in CLIMB_NAMES:
                break
            include.add(parent)
            cur = parent
    return [by_pid[p] for p in sorted(include) if p in by_pid]


def pids_for(srv, catalog, rows=None, listening=None):
    rows = rows if rows is not None else list_processes()
    found = []
    seen = set()
    for row in rows:
        if match_server(row, srv, catalog):
            pid = int(row.get("pid") or 0)
            if pid and pid not in seen:
                found.append(row)
                seen.add(pid)
    listening = listening if listening is not None else listening_map()
    by_pid = {int(r["pid"]): r for r in rows if r.get("pid")}
    for pid in listening.get(int(srv["port"]), set()):
        if pid in seen:
            continue
        row = by_pid.get(pid)
        if not row or is_excluded(row, catalog):
            continue
        found.append(row)
        seen.add(pid)
    if not found:
        return []
    return expand_related(found, rows, catalog)


def fmt_uptime(started):
    if not started:
        return "—"
    secs = int((kst_now() - started).total_seconds())
    if secs < 0:
        secs = 0
    days, rem = divmod(secs, 86400)
    hours, rem = divmod(rem, 3600)
    mins, _ = divmod(rem, 60)
    if days:
        return f"{days}일 {hours}시간"
    if hours:
        return f"{hours}시간 {mins}분"
    return f"{mins}분"


def public_url_from(health):
    body = (health or {}).get("body") or ""
    try:
        data = json.loads(body)
    except Exception:
        return ""
    if isinstance(data, dict):
        return str(data.get("publicUrl") or "")
    return ""


def fmt_bytes(n):
    try:
        n = float(n)
    except (TypeError, ValueError):
        return "—"
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f}{unit}" if unit == "B" else f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}GB"


def proc_started_iso(created):
    if not created:
        return None
    s = str(created)
    # PowerShell ConvertTo-Json: /Date(milliseconds)/
    m = re.search(r"/Date\((\d+)", s)
    if m:
        try:
            return datetime.fromtimestamp(int(m.group(1)) / 1000, tz=KST)
        except (ValueError, OSError, OverflowError):
            return None
    m = re.match(r"^(\d{14})", s)
    if not m:
        return None
    try:
        return datetime.strptime(m.group(1), "%Y%m%d%H%M%S").replace(tzinfo=KST)
    except ValueError:
        return None


def http_probe(url, timeout=2.5, max_body=300):
    t0 = time.perf_counter()
    try:
        req = urllib.request.Request(url, method="GET", headers={"User-Agent": "server-manager"})
        with urllib.request.urlopen(req, timeout=timeout) as res:
            body = res.read(max(4000, int(max_body)))
            ms = int((time.perf_counter() - t0) * 1000)
            return {
                "ok": 200 <= res.status < 500,
                "status": res.status,
                "ms": ms,
                "body": body.decode("utf-8", "replace")[: int(max_body)],
            }
    except Exception as e:
        ms = int((time.perf_counter() - t0) * 1000)
        return {"ok": False, "status": None, "ms": ms, "error": str(e)}


def health_of(srv):
    port = int(srv["port"])
    base = (srv.get("url") or f"http://127.0.0.1:{port}").rstrip("/")
    last = {"ok": False, "status": None, "ms": 0, "url": None}
    for path in srv.get("health_paths") or ["/"]:
        url = base + path
        last = http_probe(url)
        last["url"] = url
        if last.get("ok"):
            return last
    # 포트만 열려 있는지
    try:
        last_root = http_probe(base + "/")
        last_root["url"] = base + "/"
        if last_root.get("ok"):
            return last_root
    except Exception:
        pass
    return last


def write_pause(srv, on: bool):
    path = Path(srv["pause_file"])
    if on:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(
            f"off {kst_now().isoformat()}\nserver-manager\n",
            encoding="utf-8",
        )
    elif path.exists():
        path.unlink()


def kill_pids(pids):
    killed = []
    for pid in sorted(set(int(p) for p in pids if int(p) > 0)):
        try:
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/T", "/F"],
                capture_output=True,
                text=True,
                timeout=12,
                creationflags=CREATE_NO_WINDOW if os.name == "nt" else 0,
            )
            killed.append(pid)
        except Exception:
            pass
    return killed


def free_port(port, except_pids=None):
    except_pids = set(except_pids or [])
    listening = listening_map()
    pids = [p for p in listening.get(int(port), set()) if p not in except_pids]
    return kill_pids(pids)


def spawn_start(srv):
    cmd = [str(x) for x in srv["start_cmd"]]
    cwd = srv.get("start_cwd") or srv.get("root")
    if cmd and cmd[0].lower().endswith((".cmd", ".bat")):
        cmd = ["cmd.exe", "/d", "/c", *cmd]
    flags = 0
    if os.name == "nt":
        flags = CREATE_NO_WINDOW | subprocess.CREATE_NEW_PROCESS_GROUP
    subprocess.Popen(
        cmd,
        cwd=cwd,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
        stdin=subprocess.DEVNULL,
        creationflags=flags,
        close_fds=True,
    )


def start_server(srv, catalog):
    if is_poster_guard(srv):
        return {"ok": False, "error": "poster 글작성 서버는 관리하지 않습니다"}
    rows = list_processes(force=True)
    listening = listening_map()
    procs = pids_for(srv, catalog, rows, listening)
    health = health_of(srv)
    if health.get("ok") and procs:
        write_pause(srv, False)
        return {"ok": True, "already": True, "pids": [int(p["pid"]) for p in procs]}
    if procs:
        write_pause(srv, True)
        kill_pids(int(p["pid"]) for p in procs if p.get("pid"))
        free_port(srv["port"])
        time.sleep(0.8)
    write_pause(srv, False)
    try:
        spawn_start(srv)
    except Exception as e:
        return {"ok": False, "error": str(e)}
    return {"ok": True, "started": True}


def is_poster_guard(srv):
    root = str(srv.get("root") or "").lower().replace("/", "\\")
    return "\\poster" in root or root.endswith("poster")


def stop_server(srv, catalog):
    if is_poster_guard(srv):
        return {"ok": False, "error": "poster 글작성 서버는 끄지 않습니다"}
    write_pause(srv, True)
    rows = pids_for(srv, catalog, list_processes(force=True), listening_map())
    pids = [int(r["pid"]) for r in rows if r.get("pid")]
    killed = kill_pids(pids)
    extra = free_port(srv["port"])
    time.sleep(0.6)
    return {"ok": True, "killed": killed + extra}


def restart_server(srv, catalog):
    stop_server(srv, catalog)
    time.sleep(1.0)
    return start_server(srv, catalog)


def snapshot(catalog, rows=None, listening=None):
    rows = rows if rows is not None else list_processes()
    listening = listening if listening is not None else listening_map()
    out = []
    used_pids = set()
    for srv in catalog["servers"]:
        procs = pids_for(srv, catalog, rows, listening)
        for p in procs:
            used_pids.add(int(p["pid"]))
        port = int(srv["port"])
        port_pids = listening.get(port, set())
        h = health_of(srv)
        ws = sum(int(p.get("ws") or 0) for p in procs)
        started = None
        for p in procs:
            dt = proc_started_iso(p.get("created"))
            if dt and (started is None or dt < started):
                started = dt
        paused = Path(srv["pause_file"]).exists()
        state = "down"
        if h.get("ok"):
            state = "up"
        elif procs or port_pids:
            state = "unhealthy"
        if paused and state != "up":
            state = "stopped"
        out.append(
            {
                "id": srv["id"],
                "name": srv["name"],
                "note": srv.get("note") or "",
                "port": port,
                "url": srv.get("url") or f"http://127.0.0.1:{port}",
                "state": state,
                "paused": paused,
                "health": h,
                "pids": [int(p["pid"]) for p in procs],
                "rss": ws,
                "started": started.isoformat() if started else None,
                "uptime": fmt_uptime(started) if started else "—",
                "public_url": public_url_from(h),
                "managed": True,
            }
        )
    extras = discover_extras(catalog, rows, listening, used_pids)
    return out, extras


def discover_extras(catalog, rows, listening, used_pids):
    exclude_ports = set(int(p) for p in catalog.get("exclude_ports") or []) | SYSTEM_PORTS
    managed_ports = {int(s["port"]) for s in catalog["servers"]}
    extras = []
    by_pid = {int(r["pid"]): r for r in rows if r.get("pid")}
    for port, pids in sorted(listening.items()):
        if port in exclude_ports or port in managed_ports or port >= 49600:
            continue
        hits = []
        for pid in pids:
            row = by_pid.get(pid)
            if not row:
                continue
            if is_excluded(row, catalog):
                continue
            if pid in used_pids:
                continue
            name = (row.get("name") or "").lower()
            if name not in ("node.exe", "python.exe", "pythonw.exe"):
                continue
            hits.append(row)
        if not hits:
            continue
        extras.append(
            {
                "id": f"extra-{port}",
                "name": f"기타 :{port}",
                "note": (hits[0].get("cmd") or "")[:120],
                "port": port,
                "url": f"http://127.0.0.1:{port}",
                "state": "up",
                "paused": False,
                "health": http_probe(f"http://127.0.0.1:{port}/"),
                "pids": [int(h["pid"]) for h in hits],
                "rss": sum(int(h.get("ws") or 0) for h in hits),
                "started": None,
                "managed": False,
            }
        )
    return extras


def read_logs(srv, n=40):
    chunks = []
    for p in srv.get("logs") or []:
        path = Path(p)
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        lines = text.splitlines()[-n:]
        if lines:
            chunks.append(f"── {path.name} ──")
            chunks.extend(lines)
    return "\n".join(chunks) if chunks else "(로그 없음)"


def find_srv(catalog, key):
    key = (key or "").strip().lower()
    for s in catalog["servers"]:
        if s["id"].lower() == key or s["name"].lower() == key:
            return s
        if key in s["id"].lower() or key in s["name"].lower():
            return s
    aliases = {
        "stock": "stock-web",
        "ystock": "stock-web",
        "웹": "stock-web",
        "kis": "kis-account",
        "잔고": "kis-account",
        "계좌": "kis-account",
    }
    aid = aliases.get(key)
    if aid:
        return next(s for s in catalog["servers"] if s["id"] == aid)
    return None


def print_status(items, extras):
    print(f"[{kst_now().strftime('%Y-%m-%d %H:%M:%S KST')}]")
    for it in items:
        h = it["health"]
        lat = f"{h.get('ms')}ms" if h.get("ms") is not None else "—"
        code = h.get("status") if h.get("status") is not None else "—"
        pids = ",".join(str(p) for p in it["pids"]) or "—"
        print(
            f"  {it['name']}  {it['state']}  :{it['port']}  "
            f"HTTP {code} {lat}  메모리 {fmt_bytes(it['rss'])}  "
            f"가동 {it.get('uptime') or '—'}  프로세스 {len(it['pids'])}개"
        )
        if it.get("note"):
            print(f"    {it['note']}  {it['url']}")
        if it.get("public_url"):
            print(f"    공개 {it['public_url']}")
    if extras:
        print("  ── 기타(poster·시스템 제외) ──")
        for it in extras:
            print(f"  {it['name']:16}  pid={it['pids']}  {it.get('note','')[:80]}")


def cmd_status(_args):
    catalog = load_catalog()
    items, extras = snapshot(catalog)
    print_status(items, extras)
    return 0


def cmd_action(args, action):
    catalog = load_catalog()
    targets = catalog["servers"]
    if args.target and args.target.lower() not in ("all", "모두", "*"):
        srv = find_srv(catalog, args.target)
        if not srv:
            print("대상을 찾을 수 없습니다:", args.target)
            print("가능:", ", ".join(s["id"] for s in catalog["servers"]))
            return 1
        targets = [srv]
    for srv in targets:
        if action == "start":
            r = start_server(srv, catalog)
        elif action == "stop":
            r = stop_server(srv, catalog)
        else:
            r = restart_server(srv, catalog)
        print(srv["name"], action, r)
    return 0


def cmd_monitor(args):
    catalog = load_catalog()
    try:
        while True:
            items, extras = snapshot(catalog, list_processes(force=True))
            os.system("cls" if os.name == "nt" else "clear")
            print_status(items, extras)
            print("Ctrl+C 종료")
            time.sleep(max(1.0, float(args.interval)))
    except KeyboardInterrupt:
        print()
        return 0


# ── GUI ──────────────────────────────────────────────────────────────────

class MonitorStore:
    def __init__(self):
        self.lock = threading.Lock()
        self.history = defaultdict(lambda: deque(maxlen=HISTORY_LEN))
        self.latest = {"items": [], "extras": [], "at": None, "logs": {}, "activity": {}}

    def push(self, items, extras, logs, activity=None):
        at = kst_now()
        with self.lock:
            self.latest = {
                "items": items,
                "extras": extras,
                "at": at,
                "logs": logs,
                "activity": activity or {},
            }
            for it in items:
                h = it.get("health") or {}
                self.history[it["id"]].append(
                    {
                        "t": at.timestamp(),
                        "ok": bool(h.get("ok")),
                        "ms": int(h.get("ms") or 0),
                        "state": it["state"],
                    }
                )

    def get(self):
        with self.lock:
            return {
                "items": list(self.latest["items"]),
                "extras": list(self.latest["extras"]),
                "at": self.latest["at"],
                "logs": dict(self.latest["logs"]),
                "activity": dict(self.latest.get("activity") or {}),
                "history": {k: list(v) for k, v in self.history.items()},
            }


def _hm(ms):
    try:
        return datetime.fromtimestamp(float(ms) / 1000, tz=KST).strftime("%H:%M")
    except (TypeError, ValueError, OSError, OverflowError):
        return "--:--"


def stock_telegram_text():
    path = Path(r"C:\Stock\server\.data\telegram-sent.json")
    if not path.exists():
        return "텔레그램 메시지\n보낸 기록 없음"
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception as e:
        return f"텔레그램 메시지\n읽기 실패 ({e})"
    if not isinstance(raw, dict):
        return "텔레그램 메시지\n기록 형식 아님"
    today = kst_now().strftime("%Y-%m-%d")
    rows = []
    for entry in raw.values():
        if not isinstance(entry, dict):
            continue
        at = entry.get("at") or 0
        try:
            dt = datetime.fromtimestamp(float(at) / 1000, tz=KST)
        except (TypeError, ValueError, OSError, OverflowError):
            continue
        if dt.strftime("%Y-%m-%d") != today:
            continue
        name = str(entry.get("name") or entry.get("symbol") or "").strip()
        symbol = str(entry.get("symbol") or "").strip()
        label = name if not symbol or symbol == name else f"{name} ({symbol})"
        rows.append((float(at), f"{dt.strftime('%H:%M')}  발송  {label}"))
    rows.sort(reverse=True)
    lines = [f"텔레그램 메시지  ·  오늘 {len(rows)}건"]
    lines.append("(오늘 발송 없음)" if not rows else "")
    lines.extend(text for _, text in rows[:12])
    return "\n".join(line for line in lines if line)


def _activity_block(rows, title, inbound, outbound):
    lines = [title]
    if not rows:
        lines.append("(아직 없음 — 다음 입력부터 여기 쌓입니다)")
        return "\n".join(lines)
    for row in rows[:12]:
        if not isinstance(row, dict):
            continue
        arrow = outbound if row.get("dir") == "out" else inbound
        flag = "" if row.get("ok", True) else " 실패"
        text = str(row.get("text") or "").replace("\n", " ")
        if len(text) > 90:
            text = text[:90] + "…"
        lines.append(f"{_hm(row.get('at'))}  {arrow}{flag}  {text}")
    return "\n".join(lines)


def _won(n):
    try:
        v = int(round(float(n)))
    except (TypeError, ValueError):
        return "—"
    sign = "-" if v < 0 else ""
    return f"{sign}{abs(v):,}원"


def _rate(n):
    try:
        v = float(n)
    except (TypeError, ValueError):
        return "—"
    return f"{v:+.2f}%"


def kis_account_text():
    probed = http_probe("http://127.0.0.1:3780/api/account/brief", timeout=2.0, max_body=20000)
    if not probed.get("ok"):
        err = probed.get("error") or probed.get("status") or "응답 없음"
        return f"계좌 상태\n불러오지 못함 ({err})"
    try:
        data = json.loads(probed.get("body") or "{}")
    except Exception:
        return "계좌 상태\n읽지 못했습니다"
    if not isinstance(data, dict):
        return "계좌 상태\n읽지 못했습니다"
    s = data.get("summary") or {}
    q = data.get("quotes") or {}
    status = str(data.get("status") or "")
    labels = {"ok": "정상", "starting": "조회 중", "error": "오류"}
    state = "정상" if data.get("ok") else labels.get(status, status or "확인 중")
    if not data.get("fetchedAt"):
        account = data.get("account") or ""
        err = str(data.get("error") or "").strip()
        line = f"계좌 상태  ·  {state}" + (f"  ·  {account}" if account else "")
        return line + (f"\n{err[:120]}" if err else "")
    fetched = _hm(data.get("fetchedAt")) if data.get("fetchedAt") else "—"
    lines = [
        f"계좌 상태  ·  {state}  ·  {data.get('account') or '계좌 없음'}  ·  {fetched}",
        f"총자산 {_won(s.get('totalAssets'))}   주문가능 {_won(s.get('orderableCash')) if s.get('orderableCash') is not None else '—'}",
        f"예수금 {_won(s.get('cash'))}   주식평가 {_won(s.get('stockEval'))}",
        f"평가손익 {_won(s.get('pnl'))} ({_rate(s.get('pnlRate'))})",
        f"국내 {_won(s.get('domesticEval'))}   해외 {_won(s.get('overseasEval'))}",
    ]
    if data.get("error"):
        lines.append(str(data.get("error"))[:120])
    holdings = data.get("holdings") or []
    count = data.get("holdingCount")
    if count:
        lines.append(f"보유 {count}종목")
    for row in holdings[:6]:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip() or "종목"
        lines.append(
            f"  {name}  {row.get('qty') or 0}주  {_won(row.get('evalAmt'))}  {_rate(row.get('pnlRate'))}"
        )
    kospi = q.get("kospi")
    kosdaq = q.get("kosdaq")
    usd = q.get("usdkrw")
    if kospi or kosdaq or usd:
        def idx(n):
            try:
                v = float(n)
            except (TypeError, ValueError):
                return "—"
            return f"{v:,.2f}" if v else "—"
        lines.append(f"코스피 {idx(kospi)}  코스닥 {idx(kosdaq)}  원/달러 {idx(usd)}")
    return "\n".join(lines)


def kis_activity_text():
    probed = http_probe("http://127.0.0.1:3780/api/activity", timeout=2.0, max_body=50000)
    if not probed.get("ok"):
        err = probed.get("error") or probed.get("status") or "응답 없음"
        return f"챗봇 입력\n불러오지 못함 ({err})\n\n텔레그램 메시지\n불러오지 못함"
    try:
        data = json.loads(probed.get("body") or "{}")
    except Exception:
        return "챗봇·텔레그램 현황을 읽지 못했습니다"
    if not isinstance(data, dict):
        return "챗봇·텔레그램 현황을 읽지 못했습니다"
    chat = _activity_block(data.get("chatbot") or [], "챗봇 입력", "입력", "응답")
    tg = _activity_block(data.get("telegram") or [], "텔레그램 메시지", "수신", "발송")
    return chat + "\n\n" + tg


def _when_full(ms):
    try:
        return datetime.fromtimestamp(float(ms) / 1000, tz=KST).strftime("%Y-%m-%d %H:%M:%S")
    except (TypeError, ValueError, OSError, OverflowError):
        return "—"


def stock_telegram_rows():
    path = Path(r"C:\Stock\server\.data\telegram-sent.json")
    if not path.is_file():
        return []
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(raw, dict):
        return []
    rows = []
    for entry in raw.values():
        if not isinstance(entry, dict):
            continue
        at = entry.get("at") or 0
        name = str(entry.get("name") or entry.get("symbol") or "").strip()
        symbol = str(entry.get("symbol") or "").strip()
        label = name if not symbol or symbol == name else f"{name} ({symbol})"
        who = str(entry.get("who") or entry.get("user") or entry.get("chat") or "").strip()
        if not who or who.lower() in {"ystock", "healthcheck", "probe", "카카오", "연결점검"}:
            continue
        if who.replace(" ", "") == "연결점검":
            continue
        rows.append(
            {
                "at": at,
                "who": who,
                "dir": "out",
                "ok": True,
                "text": f"발송 {label}",
                "error": "",
            }
        )
    return rows


def load_message_feeds():
    chat, tg = [], []
    probed = http_probe("http://127.0.0.1:3780/api/activity", timeout=2.0, max_body=80000)
    if probed.get("ok"):
        try:
            data = json.loads(probed.get("body") or "{}")
        except Exception:
            data = {}
        if isinstance(data, dict):
            chat = [r for r in (data.get("chatbot") or []) if isinstance(r, dict)]
            tg = [r for r in (data.get("telegram") or []) if isinstance(r, dict)]
    stock = stock_telegram_rows()
    chat.sort(key=lambda r: float(r.get("at") or 0), reverse=True)
    tg.sort(key=lambda r: float(r.get("at") or 0), reverse=True)
    stock.sort(key=lambda r: float(r.get("at") or 0), reverse=True)
    return chat[:40], tg[:40], stock[:40]


def activity_text_for(srv_id):
    if srv_id == "stock-web":
        return "이 서버가 보낸 텔레그램은 아래 목록"
    if srv_id == "kis-account":
        return kis_account_text()
    return ""


def poller_loop(store: MonitorStore, stop_evt: threading.Event):
    catalog = load_catalog()
    while not stop_evt.is_set():
        try:
            items, extras = snapshot(catalog)
            logs = {}
            activity = {}
            for s in catalog["servers"]:
                try:
                    activity[s["id"]] = activity_text_for(s["id"])
                except Exception as e:
                    activity[s["id"]] = f"현황을 만들지 못했습니다\n{e}"
                logs[s["id"]] = read_logs(s, 24)
            try:
                chat_rows, kis_tg, stock_tg = load_message_feeds()
            except Exception as e:
                chat_rows, kis_tg, stock_tg = [], [], [{"at": 0, "who": "—", "dir": "out", "ok": False, "text": "기록을 읽지 못했습니다", "error": str(e)}]
            activity["chatbot"] = chat_rows
            activity["telegram:kis-account"] = kis_tg
            activity["telegram:stock-web"] = stock_tg
            store.push(items, extras, logs, activity)
        except Exception as e:
            store.push([], [], {"error": str(e)}, {})
        stop_evt.wait(POLL_SEC)


def launch_gui():
    import tkinter as tk
    from tkinter import ttk, messagebox

    catalog = load_catalog()
    store = MonitorStore()
    stop_evt = threading.Event()
    threading.Thread(target=poller_loop, args=(store, stop_evt), daemon=True).start()

    root = tk.Tk()
    root.title("서버 관리 — YSTOCK · 한국투자 잔고")
    root.geometry("1240x900")
    root.minsize(1040, 760)
    bg, card, fg, muted = "#12161c", "#1c232d", "#e8eef6", "#8b97a8"
    up_c, down_c, bad_c, acc = "#3dd68c", "#ff6b6b", "#f5c84c", "#6ea8fe"
    root.configure(bg=bg)
    style = ttk.Style()
    try:
        style.theme_use("clam")
    except Exception:
        pass
    style.configure("TFrame", background=bg)
    style.configure("Card.TFrame", background=card)
    style.configure("TLabel", background=bg, foreground=fg)
    style.configure("Card.TLabel", background=card, foreground=fg)
    style.configure("Muted.TLabel", background=card, foreground=muted)
    style.configure("TButton", padding=6)

    header = tk.Frame(root, bg=bg)
    header.pack(fill="x", padx=16, pady=(14, 6))
    tk.Label(
        header,
        text="로컬 서버 관리",
        bg=bg,
        fg=fg,
        font=("Segoe UI", 18, "bold"),
    ).pack(side="left")
    clock = tk.Label(header, text="", bg=bg, fg=muted, font=("Segoe UI", 10))
    clock.pack(side="right")
    tk.Label(
        header,
        text="poster 글작성 서버는 제외 · 2초마다 갱신",
        bg=bg,
        fg=muted,
        font=("Segoe UI", 9),
    ).pack(side="right", padx=16)

    body = tk.Frame(root, bg=bg)
    body.pack(fill="both", expand=True, padx=16, pady=8)

    cards_fr = tk.Frame(body, bg=bg)
    cards_fr.pack(fill="x")

    logs_row = tk.Frame(body, bg=bg)
    logs_row.pack(fill="both", expand=True, pady=(12, 0))
    log_boxes = {}
    for i, srv in enumerate(catalog["servers"]):
        pane = tk.Frame(logs_row, bg=card, highlightbackground="#2a3442", highlightthickness=1)
        pane.pack(side="left", fill="both", expand=True, padx=(0, 0 if i == len(catalog["servers"]) - 1 else 10))
        tk.Label(
            pane,
            text=f"{srv['name']}  ·  현황",
            bg=card,
            fg=fg,
            font=("Segoe UI", 11, "bold"),
        ).pack(anchor="w", padx=12, pady=(10, 4))
        status = tk.Text(
            pane,
            height=6,
            bg="#0e1318",
            fg="#e8eef6",
            insertbackground=fg,
            relief="flat",
            font=("Consolas", 10),
            wrap="word",
        )
        status.pack(fill="x", padx=10, pady=(0, 6))
        chat_tree = None
        if srv["id"] == "kis-account":
            tk.Label(pane, text="챗봇 입력", bg=card, fg=muted, font=("Segoe UI", 9)).pack(anchor="w", padx=12)
            chat_wrap = tk.Frame(pane, bg=card)
            chat_wrap.pack(fill="both", expand=True, padx=10, pady=(0, 6))
            chat_tree = ttk.Treeview(chat_wrap, columns=("when", "who", "kind", "result", "text"), show="headings", height=6)
            for col, label, width in (
                ("when", "날짜", 128),
                ("who", "보낸 사람", 72),
                ("kind", "구분", 48),
                ("result", "결과", 48),
                ("text", "내용", 180),
            ):
                chat_tree.heading(col, text=label)
                chat_tree.column(col, width=width, anchor="w")
            chat_scroll = tk.Scrollbar(chat_wrap, command=chat_tree.yview, width=14)
            chat_tree.configure(yscrollcommand=chat_scroll.set)
            chat_scroll.pack(side="right", fill="y")
            chat_tree.pack(side="left", fill="both", expand=True)
        tk.Label(pane, text="텔레그램", bg=card, fg=muted, font=("Segoe UI", 9)).pack(anchor="w", padx=12)
        tg_wrap = tk.Frame(pane, bg=card)
        tg_wrap.pack(fill="both", expand=True, padx=10, pady=(0, 6))
        tg_cols = ("when", "who", "kind", "result", "text")
        tg_tree = ttk.Treeview(tg_wrap, columns=tg_cols, show="headings", height=6)
        for col, label, width in (
            ("when", "날짜", 128),
            ("who", "보낸 사람", 72),
            ("kind", "구분", 48),
            ("result", "결과", 48),
            ("text", "내용", 180),
        ):
            tg_tree.heading(col, text=label)
            tg_tree.column(col, width=width, anchor="w")
        tg_scroll = tk.Scrollbar(tg_wrap, command=tg_tree.yview, width=14)
        tg_tree.configure(yscrollcommand=tg_scroll.set)
        tg_scroll.pack(side="right", fill="y")
        tg_tree.pack(side="left", fill="both", expand=True)
        tk.Label(pane, text="로그", bg=card, fg=muted, font=("Segoe UI", 9)).pack(anchor="w", padx=12)
        log_wrap = tk.Frame(pane, bg=card)
        log_wrap.pack(fill="both", expand=True, padx=10, pady=(0, 10))
        box = tk.Text(
            log_wrap,
            height=8,
            bg="#0e1318",
            fg="#8b97a8",
            insertbackground=fg,
            relief="flat",
            font=("Consolas", 9),
            wrap="word",
        )
        scroll = tk.Scrollbar(log_wrap, command=box.yview, width=14)
        box.configure(yscrollcommand=scroll.set)
        scroll.pack(side="right", fill="y")
        box.pack(side="left", fill="both", expand=True)
        log_boxes[srv["id"]] = {
            "widget": box,
            "text": "",
            "status": status,
            "status_text": "",
            "tg": tg_tree,
            "tg_sig": "",
            "chat": chat_tree,
            "chat_sig": "",
        }

    widgets = {}

    def do_action(srv_id, action):
        srv = next(s for s in catalog["servers"] if s["id"] == srv_id)

        def work():
            try:
                if action == "start":
                    r = start_server(srv, catalog)
                elif action == "stop":
                    r = stop_server(srv, catalog)
                else:
                    r = restart_server(srv, catalog)
                msg = json.dumps(r, ensure_ascii=False)
            except Exception as e:
                msg = str(e)
            root.after(0, lambda: messagebox.showinfo("서버 관리", f"{srv['name']} {action}\n{msg}"))

        threading.Thread(target=work, daemon=True).start()

    def make_card(parent, srv):
        fr = tk.Frame(parent, bg=card, highlightbackground="#2a3442", highlightthickness=1)
        fr.pack(side="left", fill="both", expand=True, padx=(0, 10))
        top = tk.Frame(fr, bg=card)
        top.pack(fill="x", padx=14, pady=(12, 4))
        name = tk.Label(top, text=srv["name"], bg=card, fg=fg, font=("Segoe UI", 14, "bold"))
        name.pack(side="left")
        badge = tk.Label(top, text="  확인 중  ", bg="#3a4454", fg=fg, font=("Segoe UI", 9, "bold"))
        badge.pack(side="right")
        tk.Label(fr, text=srv.get("note") or "", bg=card, fg=muted, font=("Segoe UI", 9)).pack(
            anchor="w", padx=14
        )
        info = tk.Label(
            fr, text="", bg=card, fg=fg, font=("Segoe UI", 10), justify="left", wraplength=420
        )
        info.pack(anchor="w", padx=14, pady=8)
        spark = tk.Canvas(fr, height=44, bg="#0e1318", highlightthickness=0)
        spark.pack(fill="x", padx=14, pady=(0, 8))
        btns = tk.Frame(fr, bg=card)
        btns.pack(fill="x", padx=14, pady=(0, 14))
        tk.Button(
            btns, text="켜기", command=lambda: do_action(srv["id"], "start"), bg="#1f6f4a", fg="white",
            relief="flat", padx=12, pady=4,
        ).pack(side="left", padx=(0, 6))
        tk.Button(
            btns, text="끄기", command=lambda: do_action(srv["id"], "stop"), bg="#8a2f2f", fg="white",
            relief="flat", padx=12, pady=4,
        ).pack(side="left", padx=6)
        tk.Button(
            btns, text="재시작", command=lambda: do_action(srv["id"], "restart"), bg="#2f4a7a", fg="white",
            relief="flat", padx=12, pady=4,
        ).pack(side="left", padx=6)
        widgets[srv["id"]] = {"badge": badge, "info": info, "spark": spark, "fr": fr}

    for srv in catalog["servers"]:
        make_card(cards_fr, srv)

    extras_lbl = tk.Label(body, text="", bg=bg, fg=muted, font=("Segoe UI", 9), justify="left")
    extras_lbl.pack(anchor="w", pady=(8, 0))

    state_ko = {"up": "실행 중", "down": "꺼짐", "unhealthy": "비정상", "stopped": "중지됨"}
    state_bg = {"up": up_c, "down": down_c, "unhealthy": bad_c, "stopped": "#6b7280"}

    def draw_spark(canvas, hist):
        canvas.delete("all")
        w = max(canvas.winfo_width(), 120)
        h = 44
        canvas.create_rectangle(0, 0, w, h, fill="#0e1318", outline="")
        if not hist:
            return
        ms_vals = [max(1, x["ms"]) for x in hist]
        mx = max(ms_vals) or 1
        n = len(hist)
        for i, pt in enumerate(hist):
            x = int(i * (w - 4) / max(n - 1, 1)) + 2
            y = h - 4 - int((pt["ms"] / mx) * (h - 10))
            col = up_c if pt["ok"] else down_c
            canvas.create_oval(x - 1, y - 1, x + 2, y + 2, fill=col, outline="")

    def paint_log(sid, snap):
        box = log_boxes.get(sid)
        if not box:
            return
        item = next((x for x in snap["items"] if x["id"] == sid), None)
        hist = snap["history"].get(sid) or []
        head = []
        if item:
            h = item["health"]
            head.append(f"{state_ko.get(item['state'], item['state'])}  {item['url']}")
            head.append(
                f"HTTP {h.get('status') or '—'}  {h.get('ms')}ms  "
                f"{'OK' if h.get('ok') else h.get('error') or 'fail'}"
            )
            if hist:
                oks = sum(1 for p in hist if p["ok"])
                head.append(f"최근 {len(hist)}회 중 정상 {oks}회 ({oks * 100 // len(hist)}%)")
        status_text = (snap.get("activity") or {}).get(sid) or "(현황 없음)"
        if status_text != box["status_text"]:
            stw = box["status"]
            stw.delete("1.0", "end")
            stw.insert("1.0", status_text)
            stw.see("1.0")
            box["status_text"] = status_text
        head.append("")
        head.append(snap["logs"].get(sid, ""))
        text = "\n".join(head)
        if text == box["text"]:
            return
        widget = box["widget"]
        y = widget.yview()
        widget.delete("1.0", "end")
        widget.insert("1.0", text)
        box["text"] = text
        if y and y[1] >= 0.95:
            widget.see("end")
        else:
            try:
                widget.yview_moveto(y[0])
            except Exception:
                pass

    def paint_tree(tree, rows, inbound, outbound, holder, sig_key):
        rows = rows if isinstance(rows, list) else []
        sig = json.dumps(rows, ensure_ascii=False, default=str)
        if sig == holder.get(sig_key):
            return
        tree.delete(*tree.get_children())
        if not rows:
            tree.insert("", "end", values=("—", "—", "—", "—", "아직 기록 없음"))
        for row in rows:
            if not isinstance(row, dict):
                continue
            kind = outbound if row.get("dir") == "out" else inbound
            ok = row.get("ok", True)
            result = "정상" if ok else "실패"
            err = str(row.get("error") or "").strip()
            text = str(row.get("text") or "").replace("\n", " ")
            if err:
                text = f"{text}  ({err})"
            tree.insert(
                "",
                "end",
                values=(
                    _when_full(row.get("at")),
                    str(row.get("who") or "—"),
                    kind,
                    result,
                    text[:180],
                ),
            )
        holder[sig_key] = sig

    def refresh_ui():
        snap = store.get()
        at = snap["at"]
        clock.config(text=at.strftime("%Y-%m-%d %H:%M:%S") if at else "…")
        for it in snap["items"]:
            wdg = widgets.get(it["id"])
            if not wdg:
                continue
            st = it["state"]
            wdg["badge"].config(text=f"  {state_ko.get(st, st)}  ", bg=state_bg.get(st, "#3a4454"), fg="#111")
            h = it["health"]
            pub = it.get("public_url") or ""
            brief = ""
            if it["id"] == "kis-account":
                act = (snap.get("activity") or {}).get("kis-account") or ""
                lines = [ln for ln in act.splitlines() if ln.strip()][:4]
                if lines:
                    brief = "\n" + "\n".join(lines)
            wdg["info"].config(
                text=(
                    f"포트 {it['port']}   프로세스 {len(it['pids'])}개\n"
                    f"메모리 {fmt_bytes(it['rss'])}   가동 {it.get('uptime') or '—'}\n"
                    f"응답 {h.get('status') or '—'}  {h.get('ms')}ms"
                    + (f"\n{pub}" if pub else "")
                    + brief
                )
            )
            draw_spark(wdg["spark"], snap["history"].get(it["id"]) or [])
        for sid in log_boxes:
            paint_log(sid, snap)
        act = snap.get("activity") or {}
        for sid, box in log_boxes.items():
            if box.get("chat") is not None:
                paint_tree(box["chat"], act.get("chatbot") or [], "입력", "응답", box, "chat_sig")
            paint_tree(box["tg"], act.get(f"telegram:{sid}") or [], "수신", "발송", box, "tg_sig")
        extra_lines = []
        for ex in snap["extras"]:
            extra_lines.append(f"{ex['name']}  pid={ex['pids']}  {ex.get('note','')[:90]}")
        extras_lbl.config(
            text=("기타 발견: " + " | ".join(extra_lines)) if extra_lines else "기타 사용자 서버 없음 (poster 제외)"
        )
        root.after(1000, refresh_ui)

    def on_close():
        stop_evt.set()
        root.destroy()

    root.protocol("WM_DELETE_WINDOW", on_close)
    root.after(400, refresh_ui)
    root.lift()
    root.attributes("-topmost", True)
    root.after(1200, lambda: root.attributes("-topmost", False))
    root.mainloop()


def _utf8_stdio():
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass


def main(argv=None):
    _utf8_stdio()
    parser = argparse.ArgumentParser(description="로컬 서버 관리 (poster 제외)")
    sub = parser.add_subparsers(dest="cmd")
    sub.add_parser("status", help="현재 상태")
    p_start = sub.add_parser("start", help="켜기")
    p_start.add_argument("target", nargs="?", default="all")
    p_stop = sub.add_parser("stop", help="끄기")
    p_stop.add_argument("target", nargs="?", default="all")
    p_rs = sub.add_parser("restart", help="재시작")
    p_rs.add_argument("target", nargs="?", default="all")
    p_mon = sub.add_parser("monitor", help="콘솔 모니터링")
    p_mon.add_argument("--interval", default=2.0)
    sub.add_parser("gui", help="창으로 열기")
    args = parser.parse_args(argv)
    if not args.cmd or args.cmd == "gui":
        launch_gui()
        return 0
    if args.cmd == "status":
        return cmd_status(args)
    if args.cmd == "monitor":
        return cmd_monitor(args)
    return cmd_action(args, args.cmd)


if __name__ == "__main__":
    sys.exit(main())

#!/usr/bin/env python3
"""
Signal group messages -> AscentBot's memory. Runs on the office Mac mini.

Reads a COPY of Signal Desktop's encrypted database, keeps the chats the
allowlist names, appends them to a monthly CSV backup, and POSTs the new ones
to the Companion's /api/google-chat/signal-import. The Companion skips any
message it already holds, so a re-sent batch is harmless.

    signal_sync.py --list-chats   every Signal chat, to fill chats.json
    signal_sync.py --dry-run      what it would send; sends nothing
    signal_sync.py                send

Files, all under ~/.ascent-signal/:
    chats.json   the allowlist. A chat not named here never leaves the Mac.
                 { "Smith Kitchen": {"jobId": "22N...", "jobName": "Smith - Kitchen"},
                   "Ascent Crew":   "office",
                   "Mom":           "skip" }
    secret       SIGNAL_IMPORT_SECRET (chmod 600)
    config.json  optional: {"url": "https://.../api/google-chat/signal-import"}
    state.json   per-chat cursor (Signal's received_at), moved only after a 200
    archive/     YYYY-MM.csv, every message sent

Never opens Signal's own database file for writing. Never prints the key or
the secret.
"""

import argparse
import csv
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HOME = Path.home()
# The two overrides exist for testing against a fake database.
SIGNAL_DIR = Path(os.environ.get("ASCENT_SIGNAL_APP_DIR") or HOME / "Library" / "Application Support" / "Signal")
STATE_DIR = Path(os.environ.get("ASCENT_SIGNAL_STATE_DIR") or HOME / ".ascent-signal")
DEFAULT_URL = "https://assistant.ascentbuildingco.com/api/google-chat/signal-import"
BATCH = 200
# Message types that are people talking. Everything else (group changes,
# safety-number changes, timers, calls) is skipped.
TALK_TYPES = ("incoming", "outgoing")


def log(msg):
    print(f"{datetime.now().strftime('%Y-%m-%d %H:%M:%S')} {msg}", flush=True)


# --- the database key -------------------------------------------------------

def signal_key():
    """Signal's SQLCipher key, hex. New installs keep it wrapped by the Keychain."""
    cfg = json.loads((SIGNAL_DIR / "config.json").read_text())
    if cfg.get("key"):
        return cfg["key"]
    wrapped = bytes.fromhex(cfg["encryptedKey"])
    if not wrapped.startswith(b"v10"):
        raise SystemExit("Signal's encryptedKey is in a format this script does not know.")
    password = subprocess.run(
        ["security", "find-generic-password", "-ws", "Signal Safe Storage"],
        check=True, capture_output=True, text=True,
    ).stdout.strip()
    return unwrap_key(wrapped, password)


def unwrap_key(wrapped, password):
    from cryptography.hazmat.primitives import padding
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

    # Chromium safe storage on macOS: PBKDF2-SHA1, 1003 rounds, AES-128-CBC.
    aes = hashlib.pbkdf2_hmac("sha1", password.encode(), b"saltysalt", 1003, 16)
    dec = Cipher(algorithms.AES(aes), modes.CBC(b" " * 16)).decryptor()
    padded = dec.update(wrapped[3:]) + dec.finalize()
    unpad = padding.PKCS7(128).unpadder()
    return (unpad.update(padded) + unpad.finalize()).decode()


def open_copy(tmp):
    """Open a copy of Signal's database, so Signal's own file is never touched."""
    from sqlcipher3 import dbapi2 as sqlcipher

    src = SIGNAL_DIR / "sql" / "db.sqlite"
    for suffix in ("", "-wal", "-shm"):
        f = Path(str(src) + suffix)
        if f.exists():
            shutil.copy2(f, Path(tmp) / ("db.sqlite" + suffix))
    db = sqlcipher.connect(str(Path(tmp) / "db.sqlite"))
    db.execute(f"PRAGMA key = \"x'{signal_key()}'\"")
    db.execute("PRAGMA query_only = ON")
    db.execute("SELECT count(*) FROM sqlite_master").fetchone()  # fails here on a wrong key
    return db


def columns(db, table):
    return {r[1] for r in db.execute(f"PRAGMA table_info({table})")}


# --- reading ----------------------------------------------------------------

def load_people(db):
    """Conversation id -> display name, and service id -> display name."""
    cols = columns(db, "conversations")
    sid = "serviceId" if "serviceId" in cols else "uuid"
    by_conv, by_sid = {}, {}
    for cid, ctype, name, prof_full, prof, e164, service_id in db.execute(
        f"SELECT id, type, name, profileFullName, profileName, e164, {sid} FROM conversations"
    ):
        label = name or prof_full or prof or e164 or ""
        by_conv[cid] = (ctype, label)
        if service_id:
            by_sid[service_id] = prof_full or name or prof or e164 or ""
    return by_conv, by_sid


def my_name(db, by_sid):
    """The name on this Signal account, for messages sent from it."""
    try:
        row = db.execute("SELECT json FROM items WHERE id = 'uuid_id'").fetchone()
        aci = json.loads(row[0])["value"].split(".")[0] if row else ""
        return by_sid.get(aci) or "Me"
    except Exception:
        return "Me"


def message_text(body, raw_json):
    """The words, plus a note per attachment. "" for an erased message."""
    try:
        meta = json.loads(raw_json or "{}")
    except ValueError:
        meta = {}
    if meta.get("isErased") or meta.get("deletedForEveryone"):
        return ""
    parts = [(body or "").strip()]
    for a in meta.get("attachments") or []:
        kind = (a.get("contentType") or "").split("/")[0]
        name = a.get("fileName") or ""
        parts.append("[photo]" if kind == "image" else "[video]" if kind == "video" else f"[file: {name}]" if name else "[file]")
    return " ".join(p for p in parts if p)


def chat_counts(db, by_conv):
    out = {}
    for cid, n, last in db.execute(
        "SELECT conversationId, count(*), max(sent_at) FROM messages "
        f"WHERE type IN {TALK_TYPES} GROUP BY conversationId"
    ):
        ctype, label = by_conv.get(cid, ("?", ""))
        if label:
            out[label] = (ctype, n, last)
    return out


def new_messages(db, by_conv, by_sid, me, chats, state):
    """Messages after each allowed chat's cursor, oldest first."""
    mcols = columns(db, "messages")
    src = "sourceServiceId" if "sourceServiceId" in mcols else "sourceUuid"
    wanted = {}
    for cid, (_ctype, label) in by_conv.items():
        rule = chats.get(label)
        if isinstance(rule, dict) and rule.get("jobId"):
            wanted[cid] = (label, rule["jobId"])
        elif rule == "office":
            wanted[cid] = (label, "")
    out = []
    unmapped = {label for label in chat_counts(db, by_conv) if label not in chats}
    for cid, (label, job_id) in wanted.items():
        since = int(state.get(label, 0))
        for mid, body, raw, typ, sender, sent_at, received_at in db.execute(
            f"SELECT id, body, json, type, {src}, sent_at, received_at FROM messages "
            f"WHERE conversationId = ? AND received_at > ? AND type IN {TALK_TYPES} "
            "ORDER BY received_at",
            (cid, since),
        ):
            text = message_text(body, raw)
            if not text:
                continue
            author = me if typ == "outgoing" else (by_sid.get(sender) or "Someone")
            at = datetime.fromtimestamp((sent_at or 0) / 1000, tz=timezone.utc).isoformat()
            out.append({"id": mid, "chat": label, "jobId": job_id, "author": author, "text": text,
                        "at": at, "_received": received_at})
    out.sort(key=lambda m: m["_received"] or 0)
    return out, sorted(unmapped)


# --- sending ----------------------------------------------------------------

def post(url, secret, batch):
    body = json.dumps({"messages": [{k: v for k, v in m.items() if not k.startswith("_")} for m in batch]}).encode()
    req = urllib.request.Request(url, data=body, method="POST", headers={
        "Content-Type": "application/json", "Authorization": f"Bearer {secret}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read() or b"{}")


def archive(batch):
    folder = STATE_DIR / "archive"
    folder.mkdir(parents=True, exist_ok=True)
    by_month = {}
    for m in batch:
        by_month.setdefault(m["at"][:7], []).append(m)
    for month, rows in by_month.items():
        f = folder / f"{month}.csv"
        new = not f.exists()
        with f.open("a", newline="") as fh:
            w = csv.writer(fh)
            if new:
                w.writerow(["at", "chat", "jobId", "author", "text", "id"])
            for m in rows:
                w.writerow([m["at"], m["chat"], m["jobId"], m["author"], m["text"], m["id"]])


def read_json(path, default):
    try:
        return json.loads(path.read_text())
    except FileNotFoundError:
        return default


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list-chats", action="store_true", help="print every chat and stop")
    ap.add_argument("--dry-run", action="store_true", help="print what would be sent; send nothing")
    args = ap.parse_args()

    chats = read_json(STATE_DIR / "chats.json", {})
    state = read_json(STATE_DIR / "state.json", {})
    url = read_json(STATE_DIR / "config.json", {}).get("url") or DEFAULT_URL

    with tempfile.TemporaryDirectory() as tmp:
        db = open_copy(tmp)
        by_conv, by_sid = load_people(db)

        if args.list_chats:
            for label, (ctype, n, last) in sorted(chat_counts(db, by_conv).items(), key=lambda kv: -kv[1][2]):
                when = datetime.fromtimestamp(last / 1000).strftime("%Y-%m-%d")
                rule = chats.get(label, "(not in chats.json)")
                print(f"{ctype:8} {n:6} msgs  last {when}  {label!r:40} {rule if isinstance(rule, str) else 'job ' + rule.get('jobId', '?')}")
            return

        msgs, unmapped = new_messages(db, by_conv, by_sid, my_name(db, by_sid), chats, state)
        db.close()

    if unmapped:
        log(f"unmapped (skipped, add to chats.json to keep or skip): {len(unmapped)} chats")
    if not msgs:
        log("no new messages")
        return

    if args.dry_run:
        for m in msgs[-50:]:
            print(f"{m['at'][:16]}  [{m['chat']}{' / job ' + m['jobId'] if m['jobId'] else ' / office'}]  {m['author']}: {m['text'][:120]}")
        log(f"dry run: {len(msgs)} messages would be sent (last 50 shown)")
        return

    secret_file = STATE_DIR / "secret"
    if not secret_file.exists():
        raise SystemExit(f"No secret at {secret_file}. See README.md.")
    secret = secret_file.read_text().strip()

    stored = skipped = 0
    for i in range(0, len(msgs), BATCH):
        batch = msgs[i:i + BATCH]
        try:
            r = post(url, secret, batch)
        except urllib.error.HTTPError as e:
            log(f"import refused: HTTP {e.code} {e.read()[:200]!r}. Cursor not moved.")
            sys.exit(1)
        except urllib.error.URLError as e:
            log(f"import unreachable: {e.reason}. Cursor not moved.")
            sys.exit(1)
        stored += r.get("stored", 0)
        skipped += r.get("skipped", 0)
        archive(batch)
        for m in batch:
            state[m["chat"]] = max(int(state.get(m["chat"], 0)), int(m["_received"] or 0))
        (STATE_DIR / "state.json").write_text(json.dumps(state, indent=2))

    log(f"sent {len(msgs)}: {stored} stored, {skipped} already kept")


if __name__ == "__main__":
    main()

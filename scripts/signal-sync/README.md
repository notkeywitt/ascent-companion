# Signal → AscentBot memory

Runs on the office Mac mini at 7 AM and 5 PM. It copies new messages from the
Signal chats you allow into AscentBot's memory. AscentBot then finds them:

- **Job groups** (one group = one job): `search_job_memory`, like that job's Google Chat space.
- **Office groups** (crew-wide chats): `search_team_chat`, by words such as "Smith tile".

A chat not named in `chats.json` never leaves the Mac.

## What it needs

- Signal Desktop, linked to the phone, open at login (System Settings → General →
  Login Items). It only holds messages from the day it was linked.
- The Mac logged in. The job runs in your session so it can open the Keychain.

## Set up (once)

1. **Secret.** Make a random value: `openssl rand -base64 32`.
   - Vercel → ascent-companion → Settings → Environment Variables:
     `SIGNAL_IMPORT_SECRET` = that value (Production). Redeploy.
   - On the Mac: `mkdir -p ~/.ascent-signal && pbpaste > ~/.ascent-signal/secret && chmod 600 ~/.ascent-signal/secret`
     (copy the value first).
2. **Install.** `sh scripts/signal-sync/install.sh` from the `ascent-companion` folder.
   It makes the venv (a private Python package folder), `~/.ascent-signal/` and the
   twice-a-day launchd job (the macOS scheduler).
3. **List your chats.** `~/.ascent-signal/venv/bin/python ~/.ascent-signal/signal_sync.py --list-chats`
   The first run asks for Keychain access to "Signal Safe Storage". Enter the Mac
   password and click **Always Allow**, or the 7 AM run cannot read Signal.
4. **Fill the allowlist** `~/.ascent-signal/chats.json`, using the names exactly as listed:
   ```json
   {
     "Smith Kitchen": { "jobId": "22NxxxxXXXX", "jobName": "Smith - Kitchen" },
     "Ascent Crew":   "office",
     "Mom":           "skip"
   }
   ```
   The job id is the one in the job's JobTread link. `"skip"` just keeps the chat
   out of the "unmapped" count in the log.
5. **Check.** Run it with `--dry-run`. Read the last 50 lines it prints.
6. **First send.** Run it with no flag. A newly added chat sends its whole history once.

## Day to day

- Log: `~/Library/Logs/ascent-signal-sync.log`.
- Backup: `~/.ascent-signal/archive/YYYY-MM.csv`, every message sent.
- Run now: `launchctl kickstart gui/$(id -u)/com.ascent.signal-sync`.
- Stop: `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.ascent.signal-sync.plist`.
- A new job group: add it to `chats.json`. The next run sends its history.
- After a change to `signal_sync.py` in the repo, run `install.sh` again. It keeps
  `chats.json`, `secret` and `state.json`.

## When it fails

| Log says | Fix |
|---|---|
| `import refused: HTTP 401` | The secret on the Mac and in Vercel differ. |
| `import unreachable` | No internet. The next run sends the backlog. |
| `security: ... could not be found` | Signal Desktop's Keychain item is gone. Open Signal once, then run again. |
| `file is not a database` | The key is wrong, or Signal changed its format. Run by hand and read the error. |

A failed run moves no cursor (the per-chat "sent up to here" mark), so nothing is lost.
The Companion skips a message it already holds, so a repeat send is harmless.

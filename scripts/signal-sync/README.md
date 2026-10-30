# Signal → AscentBot memory

Runs on the office Mac mini at 7 AM and 5 PM. Each run:

1. Sends the Ascent app the list of Signal chats on this Mac: names, message counts and
   last message dates. It sends no messages in this step.
2. Gets back what the **AscentBot page** says for each chat, then sends the new messages
   of the chats set to a job or the office.

Assign chats on the Ascent app → **AscentBot** → **Signal chats**:

| Choice | What AscentBot does |
|---|---|
| A job | Files its messages under that job. `search_job_memory` finds them. |
| Office group | Keeps them with no job. `search_team_chat` finds them by words, such as "Smith tile". |
| Don't send | Nothing. Choosing this for a chat already sent removes its messages from AscentBot. |
| Not set | Nothing. Every new chat starts here and shows up after the Mac's next run. |

Assigning a chat sends its whole history on the next run. Changing a chat to another job
moves the messages already sent.

## What it needs

- Signal Desktop, linked to the phone, open at login (System Settings → General →
  Login Items). It only holds messages from the day it was linked.
- The Mac logged in. The job runs in your session so it can open the Keychain.

## Set up (once)

1. **Secret.** Copy `SIGNAL_IMPORT_SECRET` from Vercel (ascent-companion → Settings →
   Environment Variables), then run:
   `pbpaste | tr -d '\n' > ~/.ascent-signal/secret && chmod 600 ~/.ascent-signal/secret`
2. **Install.** `sh scripts/signal-sync/install.sh` from the `ascent-companion` folder.
   It makes the venv (a private Python package folder), `~/.ascent-signal/` and the
   twice-a-day launchd job (the macOS scheduler).
3. **First run.** `~/.ascent-signal/venv/bin/python ~/.ascent-signal/signal_sync.py --dry-run`
   The first run asks for Keychain access to "Signal Safe Storage". Enter the Mac
   password and click **Always Allow**, or the 7 AM run cannot read Signal.
   The dry run sends the chat list only, so the chats appear on the AscentBot page.
4. **Assign the chats** on the AscentBot page.
5. **Send.** Run it with no flag, or wait for the next scheduled run.

## Day to day

- Log: `~/Library/Logs/ascent-signal-sync.log`.
- Backup: `~/.ascent-signal/archive/YYYY-MM.csv`, every message sent.
- Run now: `launchctl kickstart gui/$(id -u)/com.ascent.signal-sync`.
- Stop: `launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.ascent.signal-sync.plist`.
- After a change to `signal_sync.py` in the repo, run `install.sh` again. It keeps the secret.

## When it fails

| Log says | Fix |
|---|---|
| `import refused: HTTP 401` | The secret on the Mac and in Vercel differ. |
| `import unreachable` | No internet. The next run sends the backlog. |
| `security: ... could not be found` | Signal Desktop's Keychain item is gone. Open Signal once, then run again. |
| `file is not a database` | The key is wrong, or Signal changed its format. Run by hand and read the error. |

The Companion keeps each chat's cursor (the "sent up to here" mark) and moves it only
when messages are stored, so a failed run loses nothing. It skips a message it already
holds, so a repeat send is harmless.

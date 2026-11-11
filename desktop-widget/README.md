# Ascent Widget (Mac desktop panel)

A small panel on the Mac desktop that shows the Assistant's `/widget` page:
the billing month, the queue counts, the job board and the Office to-dos.

- It sits under every normal window, on every Space (desktop).
- A menu bar mountain icon holds Reload, Open Ascent Assistant, Show / Hide,
  Keep on Top and Quit.
- It reloads every 5 minutes.
- A tap on a link opens that page in the default browser. The panel stays on
  the widget.
- Home has an **Open desktop widget** button (desktop only). It starts the
  panel or brings it forward. On a Mac without it, the button shows a line to
  paste into Terminal (`public/widget-install.sh`). `./build.sh` rebuilds
  `public/AscentWidget.zip`, which that line downloads. Commit the zip after
  each rebuild.
- Drag it by any empty spot. Resize from an edge. It remembers both.

## Install

Needs the Command Line Tools (`xcode-select --install`). Xcode is not needed.

```
cd desktop-widget
./build.sh            # build, install in ~/Applications, open
./build.sh --login    # the same, and start it at every login
```

The first open shows the Assistant's sign-in. Sign in with Google once. The
panel keeps the session like a browser does.

## Change it

- What the panel shows: `src/app/widget/WidgetView.tsx`. It reuses the Home
  components, so each piece self-gates on its own view.
- The panel itself: `AscentWidget.swift`. Rebuild with `./build.sh`.
- A test deploy: `defaults write com.ascentbuildingco.widget baseURL https://…`
  then Reload. `defaults delete com.ascentbuildingco.widget baseURL` undoes it.

## Remove it

```
launchctl bootout gui/$(id -u) ~/Library/LaunchAgents/com.ascentbuildingco.widget.plist
rm ~/Library/LaunchAgents/com.ascentbuildingco.widget.plist
rm -rf ~/Applications/"Ascent Widget.app"
```

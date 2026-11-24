**English** | [日本語 (README-JA.md)](README-JA.md)

# spotify in roblox

Control your **Spotify Desktop App** directly from **Roblox** (using Obsidian UI) via a local Spicetify HTTP Bridge — **no Spotify Developer app or OAuth login required**.

---

## Features

- **Now Playing**: Track title, artist, album, liked status, progress bar, and **album artwork thumbnail**
- **Playback Controls**: Play / Pause, Next, Previous, Seek, Volume, Shuffle, Repeat, Like
- **Search & Queue**: Search tracks inside Roblox, play immediately, or add to queue & view Up Next
- **Background Autostart**: Runs silently in the background on Windows login (no need to run `npm start` every time)

---

## Requirements (Windows)

1. **Spotify Desktop App** (installed from [spotify.com](https://www.spotify.com/download/windows/), not Microsoft Store version)
2. **Node.js** (LTS): [nodejs.org](https://nodejs.org/)
3. **Spicetify CLI**: If not installed yet, run this in PowerShell:
   ```powershell
   iwr -useb https://raw.githubusercontent.com/spicetify/cli/main/install.ps1 | iex
   ```

---

## Quick Install (3 Steps)

### Step 1: Download this repository
Open **PowerShell** and run:
```powershell
git clone https://github.com/wploits/spotify-in-roblox.git
cd spotify-in-roblox
```
*(Or click **Code → Download ZIP**, extract it, and open PowerShell inside the extracted folder.)*

### Step 2: Run the one-click setup
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force
.\setup.ps1
```
This automatically:
- Installs dependencies (`npm install`)
- Copies & applies the Spicetify extension (`spotify-http-bridge.js`)
- Registers background autostart on Windows login
- Starts the local bridge server silently in the background

### Step 3: Run in Roblox
Execute this single line:
```lua
loadstring(game:HttpGet("https://raw.githubusercontent.com/wploits/spotify-in-roblox/main/roblox/spotify-player.lua"))()
```

---

## Troubleshooting

- **"Bridge / Spotify offline" in Roblox**
  - Make sure the Spotify desktop app is open.
  - Check `http://127.0.0.1:8765/health` in your browser. If it doesn't load, double-click `start-bridge-hidden.vbs` or run `npm start`.
- **Spicetify says backup is needed**
  - Run `spicetify backup apply` once in PowerShell, then run `.\setup.ps1` again.
- **Uninstall autostart**
  - Run `.\install-autostart.ps1 -Uninstall` in PowerShell.

---

## HTTP API Endpoints (For Custom Tools)

The local bridge listens on `http://127.0.0.1:8765` (and `0.0.0.0:8765` for LAN):

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `GET` | `/health` | Bridge & Spotify connection status |
| `GET` | `/now-playing` | Current track, playback state, volume, progress |
| `GET` | `/artwork` | Current track's album cover image (JPEG/PNG) |
| `GET` | `/search?q=...&limit=10` | Search tracks, albums, artists, playlists |
| `POST\|GET` | `/play` | Resume, or play by `uri` or `query` (`?q=...`) |
| `POST\|GET` | `/pause` | Pause playback (alias `/stop`) |
| `POST\|GET` | `/toggle` | Toggle play / pause |
| `POST\|GET` | `/next` / `/prev` | Skip to next / previous track |
| `POST\|GET` | `/seek` | Seek (`seconds` or `positionMs`) |
| `POST\|GET` | `/volume` | Get or set volume (`0`–`100`) |
| `POST\|GET` | `/shuffle` / `/repeat` / `/like` | Toggle shuffle, cycle repeat, toggle like |
| `GET` | `/queue` | Get upcoming queue tracks |
| `POST\|GET` | `/queue/add` | Add track (`uri` or `query`) to queue |

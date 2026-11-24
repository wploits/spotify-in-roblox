[English (README.md)](README.md) | **日本語**

# spotify in roblox

**Roblox（Obsidian UI）** から **Spotify デスクトップアプリ** を直接操作できるツールです。  
Spicetify 拡張機能とローカル HTTP ブリッジを使うため、**Spotify Developer 登録や OAuth ログインは一切不要**です。

---

## 主な機能

- **Now Playing**: 曲名・アーティスト・アルバム・いいね状態・進捗バー・**ジャケットサムネイル表示**
- **再生コントロール**: 再生 / 一時停止、次の曲 / 前の曲、シーク、音量調整、シャッフル、リピート、いいね
- **検索 & キュー**: Roblox 内から曲を検索して即再生、キューへの追加、次の曲リスト（Up Next）表示
- **裏起動（自動常駐）**: Windows ログイン時にコンソール画面なしで自動起動（毎回 `npm start` を打つ必要はありません）

---

## 事前に必要なもの（Windows）

1. **Spotify デスクトップ版**（Microsoft Store 版ではなく [公式サイト](https://www.spotify.com/download/windows/) からインストールしたもの）
2. **Node.js**（LTS 版）：[nodejs.org](https://nodejs.org/)
3. **Spicetify CLI**（未導入の場合は PowerShell で以下を実行）：
   ```powershell
   iwr -useb https://raw.githubusercontent.com/spicetify/cli/main/install.ps1 | iex
   ```

---

## かんたんインストール（3 ステップ）

### ステップ 1：ダウンロード
**PowerShell** を開いて以下を実行します：
```powershell
git clone https://github.com/wploits/spotify-in-roblox.git
cd spotify-in-roblox
```
※ Git がない場合は、GitHub ページの **Code → Download ZIP** からダウンロード・解凍し、そのフォルダ内で PowerShell を開いてください。

### ステップ 2：自動セットアップを実行
```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned -Force
.\setup.ps1
```
これだけで以下がすべて自動で完了します：
- 必要なパッケージのインストール（`npm install`）
- Spicetify 拡張機能（`spotify-http-bridge.js`）の導入と適用
- Windows ログイン時のバックグラウンド自動起動登録
- ローカルブリッジサーバーの裏起動

### ステップ 3：Roblox でスクリプトを実行
Roblox 側で以下の 1 行を実行するだけで使えます：
```lua
loadstring(game:HttpGet("https://raw.githubusercontent.com/wploits/spotify-in-roblox/main/roblox/spotify-player.lua"))()
```

---

## トラブルシューティング

- **Roblox 側で「Bridge / Spotify offline」と表示される**
  - Spotify デスクトップアプリが起動しているか確認してください。
  - ブラウザで `http://127.0.0.1:8765/health` を開いて確認してください。開けない場合は `start-bridge-hidden.vbs` をダブルクリック（または `npm start`）してください。
- **Spicetify で backup が必要と言われた**
  - PowerShell で一度 `spicetify backup apply` を実行してから、もう一度 `.\setup.ps1` を実行してください。
- **自動起動を解除したい**
  - PowerShell で `.\install-autostart.ps1 -Uninstall` を実行してください。

---

## HTTP API エンドポイント一覧（外部ツール連携用）

ローカルブリッジは `http://127.0.0.1:8765`（LAN 内からは `0.0.0.0:8765`）で待ち受けます：

| メソッド | エンドポイント | 説明 |
| :--- | :--- | :--- |
| `GET` | `/health` | ブリッジと Spotify の接続状態 |
| `GET` | `/now-playing` | 再生中の曲・状態・音量・進捗 |
| `GET` | `/artwork` | 再生中の曲のジャケット画像（JPEG/PNG） |
| `GET` | `/search?q=...&limit=10` | 曲・アルバム・アーティスト・プレイリスト検索 |
| `POST\|GET` | `/play` | 再生再開、または `uri` / `query`（`?q=...`）指定で再生 |
| `POST\|GET` | `/pause` | 一時停止（エイリアス `/stop`） |
| `POST\|GET` | `/toggle` | 再生 / 一時停止トグル |
| `POST\|GET` | `/next` / `/prev` | 次の曲 / 前の曲 |
| `POST\|GET` | `/seek` | シーク（`seconds` または `positionMs`） |
| `POST\|GET` | `/volume` | 音量取得 / 設定（`0`〜`100`） |
| `POST\|GET` | `/shuffle` / `/repeat` / `/like` | シャッフル・リピート・いいね切り替え |
| `GET` | `/queue` | 次の再生キュー取得 |
| `POST\|GET` | `/queue/add` | キューに追加（`uri` または `query`） |

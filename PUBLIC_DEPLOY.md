# Kendo Virtual Coach 公開メモ

## 目的

まずは App Store ではなく、URLで開けるWebアプリ/PWAとして公開する。
先生、部員、道場仲間にすぐ共有し、実際の稽古動画で精度検証するため。

## 推奨公開先

### 第一候補: Cloudflare Pages

このフォルダーをそのままGitHubリポジトリに入れて、Cloudflare Pagesで公開する。

- Build command: 空欄
- Build output directory: `.`
- Headers: `_headers` を使用
- 公開後URL例: `https://kendo-virtual-coach.pages.dev`

### 第二候補: Netlify

このフォルダーをそのままNetlifyに接続する。

- Build command: 空欄
- Publish directory: `.`
- Headers: `_headers` と `netlify.toml` を使用

## 重要な理由

カメラを使うには、ブラウザ上でHTTPSまたはlocalhostの安全な環境が必要。
公開URLでリアルタイム分析を使うなら、HTTPS配信が必須。

MediaPipe Tasks / WASMを安定させるため、`_headers` で以下を設定している。

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`
- `Cross-Origin-Resource-Policy: same-origin`
- `Permissions-Policy: camera=(self), microphone=(self)`

## 公開後の確認項目

1. `https://.../index.html` を開ける
2. `稽古開始` を押してカメラ許可が出る
3. カメラ映像が表示される
4. ステータスが `計測中 / Pose Landmarker` または `計測中 / Legacy Pose` になる
5. 動画解析でiPhone動画を読み込める
6. PWAとしてスマホのホーム画面に追加できる

## 注意

現在の正式測定は、リアルタイムより動画解析を推奨する。
リアルタイムは練習中の即時フィードバック、動画解析は打突時間・速度・角度の正式確認用。

YouTubeページURLは直接解析できない。
権利のある動画をmp4/movファイルとして保存し、動画ファイル読み込みから解析する。

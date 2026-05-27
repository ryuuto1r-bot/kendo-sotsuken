# 剣道卒研アプリ GitHub整理メモ

このフォルダは、剣道素振り・打突動作解析アプリを他の人へ共有するためのGitHub管理用構成です。

## 推奨リポジトリ名

- `kendo-sotsuken`
- `kendo-virtual-coach`
- `kendo-suburi-analysis`

表示名は日本語で `剣道卒研 打突動作解析アプリ` としてください。URLやコマンドで扱いやすいので、リポジトリ名は英数字がおすすめです。

## GitHubに入れる主なファイル

- `index.html`: 本採用のMediaPipe版アプリ
- `research/`: 卒研情報センター
- `vendor/`: 外部ライブラリ同梱版
- `models/`: 将来比較用モデル
- `manifest.webmanifest`, `sw.js`, `icon.svg`: PWA用
- `PUBLIC_DEPLOY.md`: Cloudflare Pages / Netlify公開メモ
- `GITHUB_SETUP.md`: このファイル

## GitHubに入れないもの

`.gitignore` で以下を除外しています。

- `AGENTS.md`: Codex用の内部指示
- `卒研プロジェクト/`: 別チャット引き継ぎ用の内部メモ
- `*.zip`: 配布用ZIP
- `.DS_Store`: Macの管理ファイル
- `__pycache__/`: Python実行キャッシュ
- `*.before-*.html`: 復元用バックアップHTML
- `sw 2.js`: 古いService Workerコピー
- `.env*`: 秘密情報

## 公開先の考え方

### 実利用向け

実際にカメラやMediaPipe WASMを安定して使わせるなら、第一候補はCloudflare PagesまたはNetlifyです。

理由:

- HTTPSが自動で使える
- `_headers` や `netlify.toml` でカメラ・WASM向けのヘッダーを設定できる
- 先生や部員にURLで共有しやすい

### GitHub Pages

GitHub Pagesでも静的ページとして公開できます。
ただし、GitHub PagesはCloudflare PagesやNetlifyほど自由にHTTPヘッダーを設定できないため、カメラ・WASM・Pose Landmarkerの実機安定性は本番公開前に確認してください。

GitHub Pagesは以下に向いています。

- 卒研資料の共有
- コード履歴の管理
- 先生への進捗説明
- 研究用デモURL

## 作成手順

GitHub上で新規リポジトリを作る場合:

1. GitHubで新規リポジトリを作成
2. Repository name: `kendo-sotsuken`
3. Visibility: 最初は `Private` 推奨
4. ローカルでこのフォルダをGit管理
5. `main` ブランチへpush
6. GitHub Pagesを使う場合は `Settings > Pages > Source` を `Deploy from a branch` にする
7. Branch は `main`、Folder は `/ (root)` を選ぶ

ローカルからpushするコマンド例:

```sh
cd /Users/user/Documents/Codex/2026-04-27/files-mentioned-by-the-user-4211725
git init -b main
git add index.html research vendor models manifest.webmanifest sw.js icon.svg README.md SECURITY.md PUBLIC_DEPLOY.md GITHUB_SETUP.md _headers netlify.toml robots.txt .nojekyll .gitignore yolo.html yolo-worker.js serve-kendo.py start-kendo-camera.command start-yolo-mirror.command
git commit -m "initial kendo thesis app"
git remote add origin https://github.com/USER/kendo-sotsuken.git
git push -u origin main
```

## 公開前チェック

- `http://127.0.0.1:4175/index.html` で動画解析が開ける
- `index.html` が本採用版になっている
- `yolo.html` は比較用として扱う
- ZIPやバックアップHTMLがGitに入っていない
- `research/` が先生向け説明として読める
- READMEに「正式測定は動画解析推奨」と書かれている
- 公開URLでカメラ許可が出る
- iPhone動画を読み込んで解析できる

## 共有時の説明文

このアプリは、剣道の自主練で素振り・打突動作を映像から解析する卒業研究用ツールです。
リアルタイム分析は練習中の目安、動画解析は打突時間・速度・角度の正式確認として使います。
現段階では測定器ではなく、カメラ映像に基づく推定値として扱います。

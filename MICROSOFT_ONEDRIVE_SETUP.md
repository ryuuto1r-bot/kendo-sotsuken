# OneDrive Excel 同期の初回設定

Kendo Virtual Coach が生成する研究用Excelを、OneDrive上の同じファイルへ更新するための設定です。

## 1. Microsoft Entraへアプリを登録

1. [Microsoft Entra 管理センター](https://entra.microsoft.com/)を開く。
2. `アプリケーション` → `アプリの登録` → `新規登録`を開く。
3. 名前を `Kendo Virtual Coach` にする。
4. 個人Microsoftアカウントでも使う場合は、組織アカウントと個人アカウントの両方を選ぶ。
5. 登録後に表示される `アプリケーション (クライアント) ID` を控える。

## 2. SPAリダイレクトURI

`認証` → `プラットフォームの追加` → `シングルページアプリケーション` を選び、アプリのOneDrive設定欄に表示されたURLを登録します。

公開版:

```text
https://ryuuto1r-bot.github.io/kendo-sotsuken/index.html
```

localhostで検証する場合は、実際に開いているlocalhost URLも追加します。URLは完全一致が必要です。

## 3. Microsoft Graph権限

`APIのアクセス許可` → `アクセス許可の追加` → `Microsoft Graph` → `委任されたアクセス許可` から、次を追加します。

- `User.Read`
- `Files.ReadWrite`

クライアントシークレットは作成しません。ブラウザアプリはPKCE認証を使用します。

## 4. アプリから接続

1. Kendo Virtual Coachの `データ` を開く。
2. `OneDrive Excel同期` にクライアントIDを入力する。
3. `Microsoftに接続` を押す。
4. Microsoft公式画面でアクセスを許可する。
5. `Excelを作成・更新` を押す。
6. `記録保存時にOneDriveのExcelを自動更新` を有効にする。

OneDriveのルートへ `Kendo_Research_Data.xlsx` が作成されます。Excelアプリ、Excel for the web、iPhone版Excelから同じファイルを開けます。

## 共有

`閲覧リンクを作成` は読み取り専用リンクを作ります。匿名共有が管理者によって禁止されている場合は、組織内共有リンクを作成します。

被験者IDを匿名化し、氏名や個人を直接特定できる情報をExcelへ保存しないでください。

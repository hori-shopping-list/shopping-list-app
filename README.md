# 買い物リスト

個人用の買い物リストPWA（Androidのホーム画面に追加して使う）。仕様は [shopping-list-app-spec.md](shopping-list-app-spec.md) を参照。

- HTML / CSS / JavaScript のみ（フレームワーク、ビルドツール、外部ライブラリなし）
- データは端末内（IndexedDB `shoppinglist-db`）にだけ保存し、外部へは送らない
- Service Worker により、2回目以降は電波がなくても動く

## ファイル構成

| ファイル | 役割 |
|---|---|
| `index.html` | 画面の入れ物 |
| `style.css` | 見た目。配色と文字サイズは先頭の `:root` で変える |
| `app.js` | 画面と操作 |
| `db.js` | IndexedDB の読み書き |
| `util.js` | 品名の正規化、日付の処理 |
| `version.js` | アプリのバージョン（キャッシュ名に使う） |
| `sw.js` | Service Worker（オフライン対応） |
| `manifest.webmanifest` | ホーム画面に追加するための情報 |
| `icons/` | アイコン（`tools/make_icons.py` で生成） |

## ローカルでの確認

```bash
python -m http.server 8000
```

ブラウザで `http://localhost:8000/` を開く。Chrome DevTools の Application タブで、次を確認できる。

- Service Worker が登録されている
- Cache Storage に `shoppinglist-v1` がある
- IndexedDB に `shoppinglist-db` がある
- Network タブで「Offline」にしても動く

## 公開（GitHub Pages）

1. GitHub に Public リポジトリを作り、このフォルダの中身を push する
2. GitHub の Settings → Pages で、公開するブランチ（例：`main` の `/ (root)`）を設定する
3. Android の Chrome で公開URL（`https://<ユーザー名>.github.io/<リポジトリ名>/`）を開き、「アプリをインストール」または「ホーム画面に追加」を行う

## 更新の手順（重要）

アプリのファイルを変更したら、**必ず `version.js` のバージョンを上げてから** push する。

```js
self.SHOPPINGLIST_VERSION = 'v2'; // v1 → v2 → v3 …
```

- バージョンを上げないと、端末は古いキャッシュを使い続け、変更が反映されない
- 新しい版は、push 後にアプリを開いたときに裏で読み込まれ、**その次の起動時**に反映される（入力中の内容が消えないよう、自動では再読み込みしない）
- 古いキャッシュは、`shoppinglist-` で始まるものだけが削除される。同じオリジンにあるジム記録アプリのキャッシュ（`gym-weight-` など）には触れない
- 新しいファイルを追加した場合は、`sw.js` の `ASSETS` にも追加する
- IndexedDB のDB名 `shoppinglist-db` は変更しない。データの形を変えるときは、`db.js` の `DB_VERSION` を上げ、`onupgradeneeded` で既存データを移行する

アイコンを作り直すときは、次を実行する。

```bash
python tools/make_icons.py
```

## バックアップ（定期的に行うこと）

Chrome の「サイトデータを削除」はオリジン（`https://<ユーザー名>.github.io`）単位で行われるため、**このアプリとジム記録アプリのデータが同時に消える**。端末の故障や機種変更にも備え、アプリ右上の「バックアップ」から定期的にエクスポートしておくこと。

- エクスポート：全データを `shoppinglist-backup-YYYYMMDD.json` として保存する
- インポート：バックアップファイルを読み込み、いまのデータを**すべて置き換える**（マージはしない）
- 最後のバックアップから30日以上たつと、「バックアップ」ボタンに黄色の印が付く

## 注意

- リポジトリに、個人情報や買い物データ（バックアップファイルを含む）を入れない
- 外部への通信（アクセス解析、Webフォント、CDNなど）は追加しない

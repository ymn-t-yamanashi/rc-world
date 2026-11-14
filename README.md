# XRift RC World

VDO.Ninjaの視聴映像をWebRTCで直接受信し、空間内の3Dモニターに表示するXRiftワールドです。

PC上のElixir WSサーバーを経由して、XIAO ESP32-S3に接続した左右2モーターを操作できます。ワールド内の席に座ると、WASDまたはカーソル操作ボタンを使えます。

## 開発

```bash
npm install
npm run dev
```

ワールド内のURL入力欄をクリックし、`https://vdo.ninja/?view=...` 形式の視聴用URLを入力して接続します。ローカル開発ではブラウザーの入力ダイアログを使います。XRift上では `TextInput` の入力UIを使います。

接続できない場合は、視聴用URLの `view` と `room`、パスワード設定、送信側の配信状態を確認してください。初回は単一の視聴映像を受信し、音声は受信しません。

```bash
npm run typecheck
npm run build
```

WS接続先は`VITE_RC_WS_URL`で変更できます。未設定時は`ws://localhost:4000/ws`です。

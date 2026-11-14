# XRift RC World

VDO.Ninjaの視聴映像をWebRTCで直接受信し、空間内の3Dモニターに表示するXRiftワールドです。

PC上のElixir WSサーバーを経由して、XIAO ESP32-S3に接続した左右2モーターを操作できます。ワールド内の席に座ると、WASDまたはカーソル操作ボタンを使えます。

## 3つのPJの関係

このPJは、車体を操作するXRift側のワールドです。

- [`rc-world`](https://github.com/ymn-t-yamanashi/rc-world)（このPJ）：着席中のWASD・カーソル操作を`motor_set`として送信し、車体状態を表示します。
- [`ws-server`](https://github.com/ymn-t-yamanashi/rc-ws-server)：PC上でXRiftとAtomVMのWebSocketを中継します。
- [`atomvm-rc-car`](https://github.com/ymn-t-yamanashi/atomvm-rc-car)：XIAO ESP32-S3上で受信した命令をGPIOへ反映し、L298N経由で左右モーターを動かします。

通信経路は次のとおりです。

```text
rc-world（XRift） ⇄ WebSocket /ws ⇄ ws-server（PC） ⇄ WebSocket ⇄ atomvm-rc-car（XIAO）
```

基本的な起動順は、`ws-server`、AtomVM、`rc-world`です。WS接続先は`VITE_RC_WS_URL`で指定し、開発時は`ws://`、公開XRiftからは`wss://`を使用します。

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

# ble-controller

A desktop app (Electron + React) to control a Magic Lantern Bluetooth LED strip.

## Run the app

```sh
npm install
npm run dev
```

Press **Scan**, pick the strip (devices advertising service FFF0 get an *LED* tag), then set a color and brightness.
Close Magic Lantern on your phone first.

On macOS, `npm install` adds a Bluetooth usage description to the dev Electron.app, because macOS kills apps that use
Bluetooth without one. If the app still crashes on scan, rerun `npm install` and check that your terminal has
Bluetooth permission in System Settings → Privacy & Security → Bluetooth.

### Layout

| Path | Runs in | Job |
| --- | --- | --- |
| `src/shared/protocol.ts` | anywhere | Command bytes. No Node imports, so Android can reuse it. |
| `src/shared/ipc.ts` | anywhere | IPC channel names and types. |
| `src/main/ble.ts` | main | Owns noble: scan, connect, and a latest-wins write queue. |
| `src/main/index.ts` | main | Window and IPC handlers. |
| `src/preload/index.ts` | preload | Exposes `window.led` to the UI. |
| `src/renderer/` | renderer | React UI. |

## Phase 1: prove the connection

`npm run probe` is the bare Node script used to verify the bytes; it is still handy for testing raw commands.
Needs Node 22+ and Bluetooth turned on. On macOS, grant Bluetooth access to your terminal app when it asks.

```sh
npm install
npm run probe -- scan                         # find the strip, note its name or id
npm run probe -- inspect <device>             # list its services and characteristics
npm run probe -- color <device> ff0000        # should turn the strip red
npm run probe -- brightness <device> 30
npm run probe -- raw <device> "7e 07 05 03 00 ff 00 10 ef"
```

`<device>` can be the id, the MAC address, or part of the name shown by `scan`.
Close the Magic Lantern app on your phone first: most strips accept only one connection.

The command bytes live in `src/shared/protocol.ts`, a plain TypeScript module with no Node imports so the Android app can reuse it.
Color and brightness are verified on the real strip (macOS). Power, mode and speed are not known yet.

### If the bytes don't work

1. Run `inspect` and check that service `fff0` and characteristic `fff3` exist and that `fff3` is writable.
2. Capture what the stock app sends: turn on *Bluetooth HCI snoop log* in Android developer options, use Magic Lantern
   (set a color, change brightness, toggle power), then pull the log with `adb bugreport` and open `btsnoop_hci.log`
   in Wireshark with the filter `btatt.opcode == 0x52 || btatt.opcode == 0x12`. The values written to `fff3` are the commands.
3. Replay a captured command with `npm run probe -- raw <device> "<bytes>"` before adding it to `protocol.ts`.

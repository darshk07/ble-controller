# ble-controller

A desktop app (Electron + React, coming in phase 2) to control a Magic Lantern Bluetooth LED strip.

## Phase 1: prove the connection

Needs Node 20+ and Bluetooth turned on. On macOS, grant Bluetooth access to your terminal app when it asks.

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
They come from a Home Assistant issue and have not been checked on this strip yet.

### If the bytes don't work

1. Run `inspect` and check that service `fff0` and characteristic `fff3` exist and that `fff3` is writable.
2. Capture what the stock app sends: turn on *Bluetooth HCI snoop log* in Android developer options, use Magic Lantern
   (set a color, change brightness, toggle power), then pull the log with `adb bugreport` and open `btsnoop_hci.log`
   in Wireshark with the filter `btatt.opcode == 0x52 || btatt.opcode == 0x12`. The values written to `fff3` are the commands.
3. Replay a captured command with `npm run probe -- raw <device> "<bytes>"` before adding it to `protocol.ts`.

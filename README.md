# Pocket Cricket 🏏

A small, playable arcade cricket game for desktop and mobile browsers. Watch the incoming ball and time your swing. No build tools, account, database, or paid backend required.

## Play

- **Bat:** press **Space**, tap the field, or tap **Swing the bat** when the ball arrives at the bat. The green timing zone helps. Perfect timing hits six; good contact hits four. Early or late shots can be caught or bowled.
- **Aim:** use **← / →** or the two arrow buttons to direct the shot away from fielders.
- **Bowl:** choose **Pace**, **Spin**, or **Yorker**. Each changes the ball speed and timing window.
- **Match:** two innings, 3 wickets per team, and your choice of 1, 2, or 5 overs. Six balls per over. A chase ends immediately when the target is reached; equal final scores are a tie.
- **Solo:** bat and bowl against the computer.
- **2 players:** take turns batting on one device against automatic deliveries; pass the device at the innings break.
- **Online:** create a room, share the invite/code, and join from another browser or device. The host starts the match. One player bowls while the other bats, then roles switch. Both players must request a rematch. Keep both tabs open; refreshing or closing a tab ends the connection.

## Run locally

```sh
python serve.py
```

Open **http://localhost:8000**. Or open `index.html` directly to play offline. All scripts, the field artwork, and sounds are local. The game caches itself for offline use after a first successful visit over HTTPS or localhost. Offline matches can be resumed, and your best score and wins are stored on your device.

## Online architecture

The site is static, so it can run on GitHub Pages. PeerJS 1.5.5 uses its public signaling service to connect two browsers through WebRTC data channels. The game shares delivery type, seed and swing timing; both browsers calculate the same result. Internet access is required for online rooms. Availability depends on the public signaling/ICE services and network firewall restrictions. Offline modes remain available if online connections fail. This is a casual game; a modified client is not protected by an authoritative tournament server.

## GitHub Pages

Publish the repository's `main` branch, root folder, under **Settings → Pages → Deploy from a branch**. The `.nojekyll` file enables plain static hosting. All asset paths are relative, including the offline cache and share links.

## Files

`index.html` interface · `styles.css` styling · `pitch.js` animated field · `engine.js` match rules · `app.js` controls and computer · `online.js` multiplayer · `sw.js` offline cache · `serve.py` optional Python server.

The bundled PeerJS library is MIT licensed; its license is included in `peerjs.LICENSE`.


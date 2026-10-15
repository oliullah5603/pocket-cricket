# Pocket Cricket 🏏

A fullscreen arcade cricket game for desktop and mobile browsers. The stadium fills the viewport; match settings, scorecard, help and multiplayer rooms open as in-game overlays. No build tools, account, database, or paid backend required.

The compact scoreboard and controls fit the visible browser viewport, including mobile browser bars. The Match and Controls tabs keep setup and instructions inside the stadium. The perspective canvas uses a camera behind the bowler while bowling, a camera behind the striker while batting, and a wider field camera after contact. Characters have front, back and profile poses, faces and equipment; fielders face the striking end until chasing a ball.

## Play

- **Aim:** move the mouse around the batter. The direction from the bat to your cursor chooses any shot angle around the field. The arrow and reticle preview it. On touch screens, tap your target on the field. **← / →** also rotate your aim.
- **Power:** cursor distance from the bat sets power. Close targets make safer grounded drives or cuts; distant targets make stronger lofted shots. Power comes directly from cursor distance; no hold-to-charge step.
- **Bat:** click once or press Space as the ball arrives at the bat. The green timing zone helps. Timing, power, direction and actual fielders determine runs, boundaries and catches. A weak shot cannot become six just because it is perfectly timed.
- **Bowl:** tap a **Bouncer**, **Spin**, or **Yorker** delivery card to start the run-up. Bouncer uses the pace delivery with a short landing length. You can first aim the landing target on the pitch; drag downward for more speed and release to bowl directly. **Space** or **BOWL** also delivers to the current target; arrow keys adjust line and length. Delivery type, target and power affect bounce, movement, timing and whether a missed ball threatens the stumps.
- **Match:** two innings, 3 wickets per team, and your choice of 1, 2, or 5 overs. Six balls per over. A chase ends immediately when the target is reached; equal final scores are a tie.
- **Game menu:** press **Escape** or the menu icon. Settings, new matches, rooms, save/resume, help, sound and scorecards stay inside the game. The page has no outside links or scrolling. **P** pauses offline play, including an incoming ball. Offline play pauses while a menu/scorecard is open or the tab is hidden; online matches keep running for both players. The fullscreen icon uses browser fullscreen when supported.
- **Solo:** bat and bowl against the computer.
- **2 players:** take turns batting on one device against automatic deliveries; pass the device at the innings break.
- **Online:** create a room, share the invite/code, and join from another browser or device. The host starts the match. One player bowls while the other bats, then roles switch. Both players must request a rematch. Keep both tabs open; refreshing or closing a tab ends the connection.

## Run locally

```sh
python serve.py
```

Open **http://localhost:8000**. Or open `index.html` directly to play offline. All scripts, the field artwork, and sounds are local. The game caches itself for offline use after a first successful visit over HTTPS or localhost. Offline matches can be resumed, and your best score and wins are stored on your device.

## Online architecture

The site is static, so it can run on GitHub Pages. PeerJS 1.5.5 uses its public signaling service to connect two browsers through WebRTC data channels. Protocol version 4 shares delivery type, line, length, speed, field seed, swing timing, full shot angle and power; both browsers calculate the same outcome and verify the score hash. Both players must load the current version before creating a room. Internet access is required for online rooms. Availability depends on the public signaling/ICE services and network firewall restrictions. Offline modes remain available if online connections fail. This is a casual game; a modified client is not protected by an authoritative tournament server.

## GitHub Pages

Publish the repository's `main` branch, root folder, under **Settings → Pages → Deploy from a branch**. The `.nojekyll` file enables plain static hosting. All asset paths are relative, including the offline cache and share links.

## Files

`index.html` interface · `styles.css` styling · `pitch.js` delivery animation · `presentation.js` perspective camera and directional characters · `engine.js` match rules · `app.js` controls and computer · `online.js` multiplayer · `sw.js` offline cache · `serve.py` optional Python server.

The bundled PeerJS library is MIT licensed; its license is included in `peerjs.LICENSE`.


### Continuous batting and contact
After Ready to bat, deliveries continue automatically with a short pause between balls. Move the cursor to aim and set power, then click once or press Space to hit. Menu, Pause and backgrounding stop offline play safely. The striker, bat, ball and aim arrow share the same contact point. Bowling uses a fixed camera; field view transitions smoothly after a successful hit. Shot direction locks when hit. Bowling cards and pitch targeting remain available when you bowl.

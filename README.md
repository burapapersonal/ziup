# CyberQuiz Live 🛡️

A live, Kahoot-style quiz that runs as a static site (GitHub Pages works). Players scan a QR code from their phones to join the same room, from anywhere online.

## How to use
**Host (on the projector screen)**
1. Open the website → **Create room / manage questions (host)** (สร้างห้อง / จัดการคำถาม)
2. Edit questions (saved automatically in this browser; import/export as JSON) → **▶ Open room** (เปิดห้อง)
3. The screen shows a **QR code + 6-digit PIN**. Players scan it and enter a nickname.
4. Click **Start game** (เริ่มเกม). Shortcut: `Space` / `Enter` = next step.
5. During the game, use the buttons at the bottom right:
   - **QR**: show the QR again so latecomers can join mid-game
   - **👥**: player list (online/offline status, score, who has answered, kick)
   - **Monitor**: opens the PM page (use it on a second screen or another device; it needs the PM passcode)
6. At the end: podium and confetti 🎉, download results as CSV, or play again in the same room.

**Players (phone)**: scan the QR → enter a nickname → tap the colored answer. If the connection drops, tap "Reconnect" (เชื่อมต่อใหม่). Your score is kept.

## PM monitor, real names and reports
- **Players must enter their real first and last name** (validated on the form and by the host). The nickname is optional and is what the projector shows; reports use the real name. Department is optional.
- **PM page** (`monitor.html`): open it on any device, enter the Game PIN and the **PM passcode** (set on the host's question editor page, before you share your screen). From there the PM can:
  - watch every player live (online, answered this question, score, right/wrong per question)
  - kick players (they can't rejoin until allowed back), and approve or reject people waiting to join
  - keep a **participant list**; with "allow only listed names" on, anyone not on the list waits for approval, and approving adds them to the list
  - start the game, go to the next step, or end the current question
  - **export the session**: open the report, download Excel (CSV) or the HTML report (print it to PDF)
- PM traffic is gzip-compressed and **encrypted with AES-256-GCM**, keyed from the passcode and PIN (PBKDF2). The passcode never goes over the network, and people on the public broker can't read the player list or send commands. 5 wrong passcodes lock that connection.
- **Session records**: no database. The host's browser saves every session (who answered what, right/wrong, time, points) in localStorage, and the PM's browser keeps its own copy, synced from the host when the PM logs in. Reports are still available after the room closes. The 40 most recent sessions are kept.

## Screens
- **Projector**: lobby + QR → question (countdown ring, radar) → answer reveal → scoreboard after each question (top 5, rank changes, % correct, fastest answer, correct-answer card) → podium + confetti
- **Phone**: join → get ready (countdown ring) → answer → correct / wrong (shows the right answer next to yours) → your rank while the projector shows the scoreboard → final result
- `clickfix-demo.html`: animated ClickFix SAFE DEMO for the training (simulation only, no real commands)

## Scoring
Correct answer = 500–1000 points depending on speed, plus a streak bonus (+100 per consecutive correct answer, max +500).

## Deploying to GitHub Pages
```bash
git push origin main
# GitHub → Settings → Pages → Source: Deploy from a branch → main / (root)
```
The site will be at `https://<user>.github.io/<repo>/`

## Technical notes
- Realtime runs through free public MQTT brokers over secure WebSocket (EMQX `:8084` and HiveMQ `:8884`), see `net.js`. Host and players both connect out to a broker, so it works for online meetings where everyone is on a different network (home Wi‑Fi, 4G, office).
- **The host's browser is the game server.** It listens on both brokers at once, and each phone joins through whichever broker its network can reach.
- Keep the host tab open in the foreground for the whole game (refreshing ends the room).
- Messages pass through a public broker under a random room topic. Fine for a quiz (nicknames and answers only); don't put anything sensitive in the questions.
- A network that blocks ports 8084 and 8884 can't join. Phones can switch to 4G.
- Public brokers rate-limit each connection (EMQX drops above ~10 msg/s), so the host batches per-player messages into one packet every 250 ms and sends shared messages once. Message rate stays flat however many players join.
- Tested: 100 players (50 per broker) through all 9 questions with every answer and result delivered; plus real-browser runs and a player whose network blocks the first broker.

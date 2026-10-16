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
6. At the end: podium and confetti 🎉, download results as CSV, or play again in the same room.

**Players (phone)**: scan the QR → enter a nickname → tap the colored answer. If the connection drops, tap "Reconnect" (เชื่อมต่อใหม่). Your score is kept.

## Scoring
Correct answer = 500–1000 points depending on speed, plus a streak bonus (+100 per consecutive correct answer, max +500).

## Deploying to GitHub Pages
```bash
git push origin main
# GitHub → Settings → Pages → Source: Deploy from a branch → main / (root)
```
The site will be at `https://<user>.github.io/<repo>/`

## Technical notes
- Realtime runs over WebRTC (PeerJS): **the host's browser acts as the game server**. No backend is needed.
- Keep the host tab open in the foreground for the whole game (refreshing ends the room).
- Uses the free PeerJS cloud signaling server (0.peerjs.com).
- Tested with 1 host + 2 players across all 9 questions.

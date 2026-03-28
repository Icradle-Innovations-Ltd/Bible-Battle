# Bible Battle

A Kahoot-style Bible quiz MVP built for quick live demos.

## Run it

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Demo flow

1. Open one browser tab as the host and click `Start Host Room`.
2. Copy the join link or share the six-digit game PIN.
3. Open one or more extra tabs/devices and join as players.
4. Start the game, answer questions, and watch the leaderboard update live.

## What’s included

- Host lobby with launch controls
- Old Testament / New Testament category selection
- Player join by PIN and name
- 10 Bible multiple-choice questions
- Real-time answers over WebSockets
- Automatic scoring with Easy / Medium / Hard point weights plus speed bonus
- Visual hard-mode badges for standout scores on difficult questions
- Reveal screens with scripture references
- Final leaderboard and replay button

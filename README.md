# Amen Arena

Amen Arena is a live Bible quiz game inspired by Kahoot, built for fast, high-energy demos. A host launches the room, players join with a PIN, teams or solo players race through Bible questions, scores update instantly, and the match ends with a dramatic Final Boss Round.

## Pitch

### Product name

Amen Arena

### One-line idea

Amen Arena turns Bible knowledge into a fast, social, high-stakes live game students actually want to play.

### Short explanation

We wanted to build something that feels more exciting than a normal quiz app. Amen Arena blends real-time multiplayer gameplay, Bible trivia, team competition, sound design, badges, and a double-points final round into a product that feels lively, modern, and easy to demo in under three minutes.

### Why it stands out

- It is instantly understandable: host, join, answer, score, leaderboard.
- It feels social: live rooms, team mode, and visible momentum on the leaderboard.
- It feels polished: sound effects, badge rewards, mobile-friendly joining, and a strong final screen.
- It feels memorable: the Final Boss Round gives the demo a clear climax judges will remember.

## Demo script

### 2-3 minute live demo

1. Start on the home screen and say: "This is Amen Arena, a live Bible quiz built for energy, speed, and competition."
2. Show the host setup: pick a testament category and switch between `Solo Clash` and `Team Battle`.
3. Create a room and point out the join PIN and share link.
4. Join from one or two extra tabs or phones with different player names and squads.
5. In the lobby, highlight the live roster and team leaderboard.
6. Start the match and explain that scoring combines correctness, speed, and difficulty.
7. Answer one question and show the reveal screen with scripture reference and live leaderboard updates.
8. Mention the hard-mode badges and audio feedback as examples of game feel.
9. Jump to the final question and call out the `Final Boss Round` with double points.
10. End on the final leaderboard and say: "Amen Arena makes Bible trivia feel like a real campus game show."

### Judge-friendly talking points

- Functionality: real-time host/player gameplay loop works end to end.
- UI/UX: clean, mobile-friendly, easy to understand in seconds.
- Creativity: Bible theme is pushed beyond trivia into teams, rewards, and arena-style presentation.
- Fun factor: speed scoring, sound effects, badges, and a dramatic ending create excitement.
- Technical execution: lightweight multiplayer architecture using Node and WebSockets for fast live sync.

## AI help

### How AI helped us build

- AI accelerated brainstorming for the product concept, features, and competition strategy.
- AI helped scaffold and refine the real-time multiplayer structure and UI flow.
- AI sped up iteration on gameplay polish like category mode, team battle, badges, audio, and the Final Boss Round.
- AI also helped us tighten the pitch, demo order, and README so the product is easier to present clearly.

### What we still owned as a team

- Choosing the product direction and what to prioritize for judging.
- Deciding which features actually improved the demo instead of just adding complexity.
- Shaping the final game feel, story, and presentation around the audience.

## Run it

```bash
npm install
npm start
```

Then open `http://localhost:3000`.

## Demo flow

1. Open one browser tab as the host and click `Start Host Room`.
2. Choose a testament lane and either `Solo Clash` or `Team Battle`.
3. Share the six-digit PIN or copy the join link.
4. Join from one or more extra tabs/devices as players.
5. Start the game, answer questions, and watch both player and team leaderboards update live.
6. Finish on the Final Boss Round and final results screen.

## What’s included

- Host lobby with launch controls
- Old Testament / New Testament category selection
- Solo Clash and Team Battle modes
- Player join by PIN, name, and squad selection
- 10 Bible multiple-choice questions
- Real-time answers over WebSockets
- Automatic scoring with Easy / Medium / Hard point weights plus speed bonus
- Final Boss Round on the last question with double points and a dramatic finish
- Team Battle Mode with squad selection and live team leaderboards
- Visual hard-mode badges for standout scores on difficult questions
- Synthesized sound effects for correct answers, incorrect answers, and badge unlocks
- Game-event sounds for joining a lobby and launching a round
- Persistent sound toggle, fine-grained volume slider, and quick 25/50/75/100 presets
- Reveal screens with scripture references
- Final leaderboard and replay button

const QUESTION_DURATION_MS = 20_000;
const ANSWER_TONES = ["tone-a", "tone-b", "tone-c", "tone-d"];
const ANSWER_LABELS = ["A", "B", "C", "D"];
const RESUME_KEY = "bible-battle-resume";
const NAME_KEY = "bible-battle-last-name";
const CATEGORY_KEY = "bible-battle-last-category";
const PLAY_MODE_KEY = "bible-battle-last-play-mode";
const TEAM_KEY = "bible-battle-last-team";
const SOUND_MUTED_KEY = "bible-battle-sound-muted";
const SOUND_VOLUME_KEY = "bible-battle-sound-volume";
const DEFAULT_SOUND_VOLUME = 0.78;
const DEFAULT_PLAY_MODE = "solo";
const DEFAULT_TEAM_SELECTION = "auto";
const SOUND_PRESET_LEVELS = [25, 50, 75, 100];
const CATEGORY_OPTIONS = [
  {
    value: "mixed",
    label: "Mixed",
    description: "Blend Old and New Testament questions."
  },
  {
    value: "old",
    label: "Old Testament",
    description: "Creation, kings, prophets, and covenant stories."
  },
  {
    value: "new",
    label: "New Testament",
    description: "Jesus, disciples, Acts, and the early church."
  }
];
const PLAY_MODE_OPTIONS = [
  {
    value: "solo",
    label: "Solo Clash",
    description: "Classic every-player-for-themselves Amen Arena showdown."
  },
  {
    value: "team",
    label: "Team Battle",
    description: "Squads stack points together and race for the win."
  }
];
const TEAM_OPTIONS = [
  {
    value: "auto",
    label: "Auto Team",
    description: "Let Amen Arena place you on a balanced squad.",
    tone: "neutral"
  },
  {
    value: "david",
    label: "Team David",
    description: "Bold shots and giant-slayer energy.",
    tone: "coral"
  },
  {
    value: "esther",
    label: "Team Esther",
    description: "Calm courage under pressure.",
    tone: "gold"
  },
  {
    value: "paul",
    label: "Team Paul",
    description: "Fast answers and comeback pace.",
    tone: "sky"
  },
  {
    value: "deborah",
    label: "Team Deborah",
    description: "Wisdom, leadership, and clean sweeps.",
    tone: "mint"
  }
];

const app = document.getElementById("app");
const urlParams = new URLSearchParams(window.location.search);

function loadPlayModeSelection() {
  const storedValue = String(window.localStorage.getItem(PLAY_MODE_KEY) || "").trim().toLowerCase();
  return PLAY_MODE_OPTIONS.some((option) => option.value === storedValue)
    ? storedValue
    : DEFAULT_PLAY_MODE;
}

function loadTeamSelection() {
  const storedValue = String(window.localStorage.getItem(TEAM_KEY) || "").trim().toLowerCase();
  return TEAM_OPTIONS.some((option) => option.value === storedValue)
    ? storedValue
    : DEFAULT_TEAM_SELECTION;
}

function loadSoundMutedPreference() {
  return window.localStorage.getItem(SOUND_MUTED_KEY) === "true";
}

function loadSoundVolumePreference() {
  const storedValue = window.localStorage.getItem(SOUND_VOLUME_KEY);
  if (storedValue === null) {
    return DEFAULT_SOUND_VOLUME;
  }

  const rawValue = Number(storedValue);
  if (Number.isFinite(rawValue) && rawValue >= 0 && rawValue <= 1) {
    return rawValue;
  }

  return DEFAULT_SOUND_VOLUME;
}

const state = {
  socket: null,
  connected: false,
  role: "guest",
  session: null,
  audioContext: null,
  audioMasterGain: null,
  sound: {
    muted: loadSoundMutedPreference(),
    volume: loadSoundVolumePreference()
  },
  playedAnswerSignals: new Set(),
  playedEventSignals: new Set(),
  playedRewardSignals: new Set(),
  hostSetup: {
    categorySelection: window.localStorage.getItem(CATEGORY_KEY) || "mixed",
    playModeSelection: loadPlayModeSelection()
  },
  join: {
    pin: (urlParams.get("pin") || "").trim(),
    name: window.localStorage.getItem(NAME_KEY) || "",
    teamSelection: loadTeamSelection()
  },
  toast: null,
  lastToastAt: 0
};

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function loadResume() {
  try {
    const stored = window.sessionStorage.getItem(RESUME_KEY);
    if (!stored) {
      return null;
    }
    const parsed = JSON.parse(stored);
    if (!parsed?.pin || !parsed?.role || !parsed?.authKey) {
      return null;
    }
    return parsed;
  } catch (_error) {
    return null;
  }
}

function saveResume(payload) {
  if (!payload?.pin || !payload?.role || !payload?.authKey) {
    return;
  }
  window.sessionStorage.setItem(RESUME_KEY, JSON.stringify(payload));
}

function clearResume() {
  window.sessionStorage.removeItem(RESUME_KEY);
}

function saveCategorySelection(categorySelection) {
  state.hostSetup.categorySelection = categorySelection;
  window.localStorage.setItem(CATEGORY_KEY, categorySelection);
}

function savePlayModeSelection(playModeSelection) {
  state.hostSetup.playModeSelection = playModeSelection;
  window.localStorage.setItem(PLAY_MODE_KEY, playModeSelection);
}

function saveTeamSelection(teamSelection) {
  state.join.teamSelection = teamSelection;
  window.localStorage.setItem(TEAM_KEY, teamSelection);
}

function persistSoundPreferences() {
  window.localStorage.setItem(SOUND_MUTED_KEY, String(state.sound.muted));
  window.localStorage.setItem(SOUND_VOLUME_KEY, String(state.sound.volume));
}

function getEffectiveSoundVolume() {
  if (state.sound.muted) {
    return 0;
  }

  return Math.max(0, Math.min(1, state.sound.volume));
}

function syncAudioOutputLevel() {
  if (!state.audioContext || !state.audioMasterGain) {
    return;
  }

  state.audioMasterGain.gain.setValueAtTime(
    getEffectiveSoundVolume(),
    state.audioContext.currentTime
  );
}

function setSoundMuted(muted) {
  state.sound.muted = Boolean(muted);
  if (!state.sound.muted && state.sound.volume <= 0) {
    state.sound.volume = DEFAULT_SOUND_VOLUME;
  }
  persistSoundPreferences();
  syncAudioOutputLevel();
}

function setSoundVolume(volume) {
  const nextVolume = Math.max(0, Math.min(1, volume));
  state.sound.volume = nextVolume;
  persistSoundPreferences();
  syncAudioOutputLevel();
}

function unlockAudio() {
  const AudioContextConstructor = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextConstructor) {
    return null;
  }

  if (!state.audioContext) {
    state.audioContext = new AudioContextConstructor();
  }

  if (!state.audioMasterGain) {
    state.audioMasterGain = state.audioContext.createGain();
    state.audioMasterGain.connect(state.audioContext.destination);
  }

  syncAudioOutputLevel();

  if (state.audioContext.state === "suspended") {
    state.audioContext.resume().catch(() => {});
  }

  return state.audioContext;
}

function scheduleTone(audioContext, frequency, startTime, duration, peakGain, type = "triangle") {
  const oscillator = audioContext.createOscillator();
  const gainNode = audioContext.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, startTime);

  gainNode.gain.setValueAtTime(0.0001, startTime);
  gainNode.gain.linearRampToValueAtTime(peakGain, startTime + 0.03);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);

  oscillator.connect(gainNode);
  gainNode.connect(state.audioMasterGain || audioContext.destination);

  oscillator.start(startTime);
  oscillator.stop(startTime + duration);
}

function playBadgeEarnSound(unlockCount, startDelaySeconds = 0) {
  const audioContext = unlockAudio();
  if (!audioContext || audioContext.state !== "running") {
    return;
  }

  const fanfareNotes =
    unlockCount > 1
      ? [523.25, 659.25, 783.99, 1046.5]
      : [523.25, 659.25, 880];
  const startTime = audioContext.currentTime + 0.02 + startDelaySeconds;

  fanfareNotes.forEach((frequency, index) => {
    scheduleTone(audioContext, frequency, startTime + index * 0.11, 0.28, 0.04 + index * 0.01);
  });

  scheduleTone(audioContext, 261.63, startTime, 0.42, 0.03, "sine");
}

function playCorrectAnswerSound(startDelaySeconds = 0) {
  const audioContext = unlockAudio();
  if (!audioContext || audioContext.state !== "running") {
    return;
  }

  const startTime = audioContext.currentTime + 0.02 + startDelaySeconds;
  const notes = [523.25, 659.25, 783.99];

  notes.forEach((frequency, index) => {
    scheduleTone(audioContext, frequency, startTime + index * 0.08, 0.22, 0.035 + index * 0.008);
  });

  scheduleTone(audioContext, 261.63, startTime, 0.28, 0.025, "sine");
}

function playIncorrectAnswerSound(startDelaySeconds = 0) {
  const audioContext = unlockAudio();
  if (!audioContext || audioContext.state !== "running") {
    return;
  }

  const startTime = audioContext.currentTime + 0.02 + startDelaySeconds;
  scheduleTone(audioContext, 261.63, startTime, 0.18, 0.03, "square");
  scheduleTone(audioContext, 207.65, startTime + 0.1, 0.2, 0.026, "sawtooth");
  scheduleTone(audioContext, 164.81, startTime + 0.2, 0.24, 0.022, "triangle");
}

function playLobbyJoinSound(kind = "self", startDelaySeconds = 0) {
  const audioContext = unlockAudio();
  if (!audioContext || audioContext.state !== "running") {
    return;
  }

  const startTime = audioContext.currentTime + 0.02 + startDelaySeconds;

  if (kind === "host") {
    scheduleTone(audioContext, 392.0, startTime, 0.16, 0.022, "triangle");
    scheduleTone(audioContext, 523.25, startTime + 0.08, 0.18, 0.026, "sine");
    return;
  }

  const notes = [392.0, 523.25, 659.25];
  notes.forEach((frequency, index) => {
    scheduleTone(audioContext, frequency, startTime + index * 0.07, 0.2, 0.028 + index * 0.006);
  });
}

function playGameStartSound(startDelaySeconds = 0) {
  const audioContext = unlockAudio();
  if (!audioContext || audioContext.state !== "running") {
    return;
  }

  const startTime = audioContext.currentTime + 0.02 + startDelaySeconds;
  const notes = [261.63, 329.63, 392.0, 523.25];

  notes.forEach((frequency, index) => {
    scheduleTone(audioContext, frequency, startTime + index * 0.09, 0.24, 0.03 + index * 0.008);
  });

  scheduleTone(audioContext, 130.81, startTime, 0.34, 0.026, "sine");
}

function playFinalBossSound(startDelaySeconds = 0) {
  const audioContext = unlockAudio();
  if (!audioContext || audioContext.state !== "running") {
    return;
  }

  const startTime = audioContext.currentTime + 0.02 + startDelaySeconds;
  const riseNotes = [392.0, 523.25, 659.25, 783.99, 1046.5];

  scheduleTone(audioContext, 98.0, startTime, 0.54, 0.03, "sine");
  scheduleTone(audioContext, 130.81, startTime + 0.08, 0.46, 0.026, "triangle");

  riseNotes.forEach((frequency, index) => {
    scheduleTone(audioContext, frequency, startTime + index * 0.08, 0.26, 0.032 + index * 0.007);
  });
}

function handleGameEventSound(nextSession, previousSession, role) {
  if (!nextSession) {
    return;
  }

  const hasStoredResume = Boolean(loadResume());

  if (
    role === "player" &&
    nextSession.status === "lobby" &&
    nextSession.self?.id &&
    !hasStoredResume
  ) {
    const signal = `${nextSession.pin}:join-self:${nextSession.self.id}`;
    if (!state.playedEventSignals.has(signal)) {
      state.playedEventSignals.add(signal);
      playLobbyJoinSound("self");
    }
  }

  if (
    role === "host" &&
    nextSession.status === "lobby" &&
    previousSession?.pin === nextSession.pin &&
    nextSession.playerCount > previousSession.playerCount
  ) {
    const signal = `${nextSession.pin}:join-host:${nextSession.playerCount}`;
    if (!state.playedEventSignals.has(signal)) {
      state.playedEventSignals.add(signal);
      playLobbyJoinSound("host");
    }
  }

  if (previousSession?.status === "lobby" && nextSession.status === "question") {
    const signal = `${nextSession.pin}:game-start:${nextSession.questionNumber}`;
    if (!state.playedEventSignals.has(signal)) {
      state.playedEventSignals.add(signal);
      playGameStartSound();
    }
  }

  if (
    nextSession.status === "question" &&
    nextSession.question?.isFinalBoss &&
    previousSession?.pin === nextSession.pin &&
    previousSession.currentQuestionIndex !== nextSession.currentQuestionIndex
  ) {
    const signal = `${nextSession.pin}:final-boss:${nextSession.questionNumber}`;
    if (!state.playedEventSignals.has(signal)) {
      state.playedEventSignals.add(signal);
      playFinalBossSound();
    }
  }
}

function getRewardSignals(session) {
  if (!session?.players?.length) {
    return [];
  }

  return session.players.flatMap((player) =>
    (player.latestRewards || []).map(
      (reward) => `${session.pin}:${session.questionNumber}:${player.id}:${reward.id}`
    )
  );
}

function handleRewardSound(nextSession, previousSession, startDelaySeconds = 0) {
  const nextSignals = getRewardSignals(nextSession);
  if (!nextSignals.length) {
    return;
  }

  const previousSignals = new Set(getRewardSignals(previousSession));
  const unheardSignals = nextSignals.filter(
    (signal) => !previousSignals.has(signal) && !state.playedRewardSignals.has(signal)
  );

  if (!unheardSignals.length) {
    return;
  }

  unheardSignals.forEach((signal) => {
    state.playedRewardSignals.add(signal);
  });

  playBadgeEarnSound(unheardSignals.length, startDelaySeconds);
}

function getAnswerResultSignal(session) {
  if (
    session?.status !== "reveal" ||
    !session.self ||
    typeof session.self.lastAnswerCorrect !== "boolean"
  ) {
    return null;
  }

  return `${session.pin}:${session.questionNumber}:${session.self.id}:${session.self.lastAnswerCorrect ? "correct" : "incorrect"}`;
}

function handleAnswerResultSound(nextSession, previousSession, role) {
  if (role !== "player") {
    return false;
  }

  const nextSignal = getAnswerResultSignal(nextSession);
  if (!nextSignal) {
    return false;
  }

  const previousSignal = getAnswerResultSignal(previousSession);
  if (nextSignal === previousSignal || state.playedAnswerSignals.has(nextSignal)) {
    return false;
  }

  state.playedAnswerSignals.add(nextSignal);

  if (nextSession.self.lastAnswerCorrect) {
    playCorrectAnswerSound();
  } else {
    playIncorrectAnswerSound();
  }

  return true;
}

function showToast(message) {
  state.toast = message;
  state.lastToastAt = Date.now();
  render();
}

function maybeHideToast() {
  if (state.toast && Date.now() - state.lastToastAt > 3200) {
    state.toast = null;
    render();
  }
}

function connectSocket() {
  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  const socket = new WebSocket(`${protocol}://${window.location.host}`);
  state.socket = socket;

  socket.addEventListener("open", () => {
    state.connected = true;
    render();

    const resume = loadResume();
    if (resume) {
      sendMessage({
        type: "client:resume",
        pin: resume.pin,
        role: resume.role,
        authKey: resume.authKey
      });
    }
  });

  socket.addEventListener("close", () => {
    state.connected = false;
    render();
    window.setTimeout(() => {
      if (!state.connected) {
        connectSocket();
      }
    }, 1500);
  });

  socket.addEventListener("message", (event) => {
    let message = null;
    try {
      message = JSON.parse(event.data);
    } catch (_error) {
      return;
    }

    switch (message.type) {
      case "server:ready":
        render();
        break;
      case "session:state":
        handleGameEventSound(message.session, state.session, message.role);
        const playedAnswerSound = handleAnswerResultSound(message.session, state.session, message.role);
        handleRewardSound(message.session, state.session, playedAnswerSound ? 0.32 : 0);
        state.role = message.role;
        state.session = message.session;
        if (message.session?.selectedCategory) {
          saveCategorySelection(message.session.selectedCategory);
        }
        if (message.role === "host" && message.session?.playMode) {
          savePlayModeSelection(message.session.playMode);
        }
        saveResume(message.resume);
        render();
        break;
      case "session:error":
        showToast(message.message);
        break;
      case "session:ended":
        clearResume();
        state.role = "guest";
        state.session = null;
        showToast(message.message);
        render();
        break;
      case "session:clear-resume":
        clearResume();
        state.role = "guest";
        state.session = null;
        if (message.message) {
          showToast(message.message);
        }
        render();
        break;
      default:
        break;
    }
  });
}

function sendMessage(payload) {
  if (!state.socket || state.socket.readyState !== WebSocket.OPEN) {
    showToast("Connection dropped. Reconnecting now...");
    return;
  }
  state.socket.send(JSON.stringify(payload));
}

function leaveSession() {
  sendMessage({ type: "client:leave" });
  clearResume();
  state.role = "guest";
  state.session = null;
  render();
}

function formatTimeLeft() {
  if (!state.session?.timerEndsAt) {
    return { seconds: 0, percent: 0 };
  }
  const msLeft = Math.max(state.session.timerEndsAt - Date.now(), 0);
  return {
    seconds: Math.ceil(msLeft / 1000),
    percent: Math.max(0, Math.min(100, (msLeft / QUESTION_DURATION_MS) * 100))
  };
}

function ordinal(rank) {
  if (rank === 1) return "1st";
  if (rank === 2) return "2nd";
  if (rank === 3) return "3rd";
  return `${rank}th`;
}

function renderPointsText(question) {
  if (!question) {
    return "";
  }
  return `${question.basePoints}-${question.maxPoints} pts`;
}

function renderFinalBossBanner(question, context = "question") {
  if (!question?.isFinalBoss) {
    return "";
  }

  const copy =
    context === "final"
      ? "The crown was decided in a double-points finish built for dramatic comebacks."
      : context === "reveal"
        ? "The double-points finale just landed. Watch who stole the leaderboard swing."
        : question.roundDescription || "Last question. Double points. One final scripture swing for the crown.";

  return `
    <div class="final-boss-banner ${context}">
      <span class="final-boss-kicker">${escapeHtml(question.roundLabel || "Final Boss Round")}</span>
      <strong>${escapeHtml(question.roundSubtitle || "Sudden Glory Round")}</strong>
      <p>${escapeHtml(copy)}</p>
    </div>
  `;
}

function renderRewardBadges(rewards, compact = false) {
  if (!rewards?.length) {
    return "";
  }

  return `
    <div class="reward-strip ${compact ? "compact" : ""}">
      ${rewards
        .map(
          (reward) => `
            <span
              class="reward-badge tone-${escapeHtml(reward.tone)} ${compact ? "compact" : ""}"
              title="${escapeHtml(reward.description)}"
            >
              ${escapeHtml(reward.name)}
            </span>
          `
        )
        .join("")}
    </div>
  `;
}

function renderCategorySelector(selectedCategory) {
  return `
    <div class="category-selector">
      ${CATEGORY_OPTIONS.map((option) => {
        const activeClass = selectedCategory === option.value ? "active" : "";
        return `
          <button
            class="category-option ${activeClass}"
            data-action="select-category"
            data-category-selection="${option.value}"
            type="button"
          >
            <span class="category-option-title">${escapeHtml(option.label)}</span>
            <span class="category-option-copy">${escapeHtml(option.description)}</span>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderPlayModeSelector(selectedPlayMode) {
  return `
    <div class="mode-selector">
      ${PLAY_MODE_OPTIONS.map((option) => {
        const activeClass = selectedPlayMode === option.value ? "active" : "";
        return `
          <button
            class="mode-option ${activeClass}"
            data-action="select-play-mode"
            data-play-mode-selection="${option.value}"
            type="button"
          >
            <span class="mode-option-title">${escapeHtml(option.label)}</span>
            <span class="mode-option-copy">${escapeHtml(option.description)}</span>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderTeamSelector(selectedTeamSelection) {
  return `
    <div class="team-selector">
      ${TEAM_OPTIONS.map((option) => {
        const activeClass = selectedTeamSelection === option.value ? "active" : "";
        return `
          <button
            class="team-option tone-${escapeHtml(option.tone)} ${activeClass}"
            data-action="select-team"
            data-team-selection="${option.value}"
            type="button"
          >
            <span class="team-option-title">${escapeHtml(option.label)}</span>
            <span class="team-option-copy">${escapeHtml(option.description)}</span>
          </button>
        `;
      }).join("")}
    </div>
  `;
}

function renderTeamBadge(teamName, teamTone, compact = false) {
  if (!teamName) {
    return "";
  }

  return `
    <span class="team-badge tone-${escapeHtml(teamTone || "neutral")} ${compact ? "compact" : ""}">
      ${escapeHtml(teamName)}
    </span>
  `;
}

function getSelfTeam(session) {
  if (!session?.self?.teamId || !session?.teams?.length) {
    return null;
  }

  return session.teams.find((team) => team.id === session.self.teamId) || null;
}

function renderTeamRows(teams, emptyText) {
  if (!teams?.length) {
    return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  }

  return `
    <div class="leaderboard-list">
      ${teams
        .map(
          (team) => `
            <div class="leader-row team-row tone-${escapeHtml(team.tone || "neutral")}">
              <div class="leader-meta">
                <div class="stack-inline">
                  <span class="leader-name">#${team.rank}</span>
                  ${renderTeamBadge(team.name, team.tone, true)}
                </div>
                <span class="subtle">${team.connectedCount}/${team.memberCount} players live</span>
              </div>
              <strong>${team.score} pts</strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSoundControls() {
  const soundPercent = Math.round(state.sound.volume * 100);
  const soundStatus = state.sound.muted ? "Sound Off" : "Sound On";
  const soundActionLabel = state.sound.muted ? "Unmute game sounds" : "Mute game sounds";
  const activePreset = SOUND_PRESET_LEVELS.find((preset) => preset === soundPercent) ?? null;

  return `
    <div class="audio-control" role="group" aria-label="Game sound controls">
      <button
        class="audio-toggle ${state.sound.muted ? "muted" : ""}"
        data-action="toggle-sound"
        type="button"
        aria-pressed="${state.sound.muted ? "true" : "false"}"
        aria-label="${soundActionLabel}"
      >
        ${soundStatus}
      </button>
      <div class="audio-mixer">
        <label class="audio-slider" for="sound-volume">
          <span class="audio-slider-label">Volume</span>
          <input
            id="sound-volume"
            class="audio-range"
            name="sound-volume"
            type="range"
            min="0"
            max="100"
            step="5"
            value="${soundPercent}"
          />
        </label>
        <div class="audio-presets" role="group" aria-label="Quick volume presets">
          ${SOUND_PRESET_LEVELS.map((preset) => {
            const activeClass = activePreset === preset ? "active" : "";
            return `
              <button
                class="audio-preset ${activeClass}"
                data-action="set-sound-preset"
                data-sound-percent="${preset}"
                type="button"
                aria-pressed="${activePreset === preset ? "true" : "false"}"
              >
                ${preset}%
              </button>
            `;
          }).join("")}
        </div>
      </div>
    </div>
  `;
}

function renderHeader() {
  const liveText = state.connected ? "Live sync ready" : "Reconnecting...";
  const sessionPin = state.session?.pin
    ? `<span class="status-pill"><strong>PIN</strong> <span class="mono">${escapeHtml(state.session.pin)}</span></span>`
    : "";

  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">
          <img class="brand-logo" src="/logo.jpg" alt="Amen Arena logo" />
        </div>
        <div class="brand-copy">
          <h1>Amen Arena</h1>
          <p>Fast hands. Scripture smarts. Live leaderboard energy.</p>
        </div>
      </div>
      <div class="stats-row">
        ${sessionPin}
        ${renderSoundControls()}
        <span class="status-pill"><strong>Status</strong> ${escapeHtml(liveText)}</span>
      </div>
    </header>
  `;
}

function renderLanding() {
  return `
    <section class="hero-grid">
      <article class="panel hero-panel">
        <div>
          <span class="eyebrow">Campus quiz energy</span>
          <h2>Launch Amen Arena and light up the room in under a minute.</h2>
          <p class="hero-subtitle">
            Host a live Kahoot-style battle, let players join with a PIN, race through 10 Bible questions,
            and crown a winner with real-time scoring.
          </p>
          <div class="chip-row">
            <span class="chip">10 rotating questions</span>
            <span class="chip">Difficulty-weighted scoring</span>
            <span class="chip">Old + New Testament mix</span>
            <span class="chip">Mobile-ready join flow</span>
          </div>
          <div class="setup-block">
            <p class="muted">Choose the quiz lane before you host</p>
            ${renderCategorySelector(state.hostSetup.categorySelection)}
          </div>
          <div class="setup-block">
            <p class="muted">Choose how players compete</p>
            ${renderPlayModeSelector(state.hostSetup.playModeSelection)}
          </div>
        </div>
        <div class="hero-foot">
          <button class="button" data-action="create-session">Start Host Room</button>
          <button class="ghost-button" data-action="focus-join">Join With PIN</button>
        </div>
      </article>
      <aside class="panel join-panel">
        <div>
          <p class="muted">Player join</p>
          <h3 class="card-title">Jump into the battle</h3>
          <p class="panel-intro">Type the game PIN, add your name, and lock in your answers before time runs out.</p>
        </div>
        <form class="form-grid" data-form="join">
          <div class="field">
            <label for="pin">Game PIN</label>
            <input id="pin" name="pin" inputmode="numeric" maxlength="6" placeholder="123456" value="${escapeHtml(state.join.pin)}" />
          </div>
          <div class="field">
            <label for="name">Display name</label>
            <input id="name" name="name" maxlength="18" placeholder="Team Grace" value="${escapeHtml(state.join.name)}" />
          </div>
          <div class="field">
            <label>Squad pick</label>
            ${renderTeamSelector(state.join.teamSelection)}
          </div>
          <button class="button secondary" type="submit">Join Quiz Room</button>
          <p class="fine-print">Best demo setup: open one host tab and one or more player tabs, or share the LAN URL on the same Wi-Fi. Team picks are used instantly when the host enables Team Battle.</p>
        </form>
      </aside>
    </section>
  `;
}

function renderPlayers(players, emptyText, showTeams = false) {
  if (!players.length) {
    return `<div class="empty-state">${escapeHtml(emptyText)}</div>`;
  }

  return `
    <div class="player-list">
      ${players
        .map(
          (player) => `
            <div class="player-card ${player.connected ? "" : "offline"}">
              <div class="player-meta">
                <div class="stack-inline">
                  <span class="player-name">${escapeHtml(player.name)}</span>
                  ${showTeams ? renderTeamBadge(player.teamName, player.teamTone, true) : ""}
                </div>
                <span class="subtle">${player.connected ? "Ready to play" : "Offline"}</span>
              </div>
              <strong>${player.score} pts</strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderHostLobby(session) {
  const shareUrl = `${window.location.origin}/?pin=${encodeURIComponent(session.pin)}`;
  return `
    <section class="content-grid">
      <article class="panel room-panel span-7">
        <span class="eyebrow">Host mode</span>
        <h2>Room is live. Gather your players.</h2>
        <p class="panel-intro">
          Share the join link or game PIN, set the testament lane and competition mode for this room, then launch the battle.
        </p>
        <div class="setup-block">
          <p class="muted">Selected category</p>
          ${renderCategorySelector(session.selectedCategory)}
        </div>
        <div class="setup-block">
          <p class="muted">Competition mode</p>
          ${renderPlayModeSelector(session.playMode)}
        </div>
        <div class="session-pin">
          <div class="pin-box">
            <span class="pin-label">Game PIN</span>
            <span class="pin-value mono">${escapeHtml(session.pin)}</span>
          </div>
          <div class="spaced">
            <button class="ghost-button" data-action="copy-link" data-link="${escapeHtml(shareUrl)}">Copy Join Link</button>
            <button class="button" data-action="start-game" ${session.canStart ? "" : "disabled"}>${session.playMode === "team" ? "Start Team Battle" : "Start Amen Arena"}</button>
          </div>
        </div>
        <div class="chip-row">
          <span class="chip">${escapeHtml(session.categoryLabel)}</span>
          <span class="chip">${escapeHtml(session.playModeLabel)}</span>
          <span class="chip">10 questions</span>
          <span class="chip">20s timer</span>
          <span class="chip">Difficulty + speed scoring</span>
          <span class="chip">Live reveal screens</span>
        </div>
      </article>
      <aside class="panel leaderboard-panel span-5">
        ${
          session.playMode === "team"
            ? `
              <p class="muted">Team leaderboard</p>
              ${renderTeamRows(session.teams, "Teams appear here when players join.")}
            `
            : ""
        }
        <p class="muted">Lobby roster</p>
        <h3 class="card-title">${session.connectedCount} ready now</h3>
        ${renderPlayers(session.players, "Players who join will appear here.", session.playMode === "team")}
        <div class="align-end" style="margin-top:1rem">
          <button class="icon-button" data-action="leave-session">Close Room</button>
        </div>
      </aside>
    </section>
  `;
}

function renderPlayerLobby(session) {
  const selfTeam = getSelfTeam(session);
  return `
    <section class="content-grid">
      <article class="panel room-panel span-7">
        <span class="eyebrow">Player mode</span>
        <h2>You're in. Wait for the host to drop the first question.</h2>
        <p class="panel-intro">
          Answer quickly, answer accurately, and climb the leaderboard. Each correct answer earns points, and faster answers score higher.
        </p>
        <div class="session-pin">
          <div class="pin-box">
            <span class="pin-label">Joined as</span>
            <span class="pin-value" style="font-size:clamp(1.8rem,4vw,3rem);letter-spacing:0.03em">${escapeHtml(session.self?.name || "Player")}</span>
          </div>
          <div class="pin-box">
            <span class="pin-label">Game PIN</span>
            <span class="pin-value mono" style="font-size:clamp(1.8rem,4vw,3rem)">${escapeHtml(session.pin)}</span>
          </div>
          <div class="pin-box">
            <span class="pin-label">Category</span>
            <span class="pin-value" style="font-size:clamp(1.15rem,2.2vw,1.55rem);letter-spacing:0.03em">${escapeHtml(session.categoryLabel)}</span>
          </div>
          ${
            session.playMode === "team" && selfTeam
              ? `
                <div class="pin-box">
                  <span class="pin-label">Squad</span>
                  <span class="pin-value" style="font-size:clamp(1.1rem,2vw,1.45rem);letter-spacing:0.03em">${escapeHtml(selfTeam.name)}</span>
                </div>
              `
              : ""
          }
        </div>
        <div class="chip-row">
          <span class="chip">${escapeHtml(session.categoryLabel)}</span>
          <span class="chip">${escapeHtml(session.playModeLabel)}</span>
          <span class="chip">Rank updates after every question</span>
          <span class="chip">Scripture references on reveal</span>
          <span class="chip">Hosted live</span>
        </div>
      </article>
      <aside class="panel leaderboard-panel span-5">
        ${
          session.playMode === "team"
            ? `
              <p class="muted">Team leaderboard</p>
              ${renderTeamRows(session.teams, "Teams form once players lock in.")}
            `
            : ""
        }
        <p class="muted">Who is in the room?</p>
        <h3 class="card-title">${session.playerCount} players joined</h3>
        ${renderPlayers(session.players, "Waiting for the first player to join.", session.playMode === "team")}
        <div class="align-end" style="margin-top:1rem">
          <button class="icon-button" data-action="leave-session">Leave Room</button>
        </div>
      </aside>
    </section>
  `;
}

function renderTimer(question) {
  const { seconds, percent } = formatTimeLeft();
  return `
    <div class="timer-shell ${question?.isFinalBoss ? "final-boss" : ""}">
      <div class="timer-value mono">${seconds}s</div>
      <div class="timer-bar">
        <div class="timer-progress ${question?.isFinalBoss ? "final-boss" : ""}" style="width:${percent}%"></div>
      </div>
    </div>
  `;
}

function renderQuestionCard(session, isHost) {
  const question = session.question;
  const self = session.self;

  return `
    <article class="panel question-panel span-8 ${question.isFinalBoss ? "final-boss-panel" : ""}">
      ${renderFinalBossBanner(question)}
      <div class="question-header">
        <div>
          <span class="eyebrow">Question ${session.questionNumber} of ${session.totalQuestions}</span>
          <h2>${escapeHtml(question.prompt)}</h2>
          <div class="question-meta">
            ${question.isFinalBoss ? `<span class="chip final-boss-chip">2x Finale</span>` : ""}
            <span class="chip">${escapeHtml(question.testament)}</span>
            <span class="chip">${escapeHtml(question.category)}</span>
            <span class="chip">${escapeHtml(question.difficulty)}</span>
            <span class="chip">${escapeHtml(renderPointsText(question))}</span>
          </div>
        </div>
        ${renderTimer(question)}
      </div>
      <div class="answer-grid">
        ${question.choices
          .map((choice, index) => {
            const toneClass = ANSWER_TONES[index] || "";
            const selected = self?.selectedAnswerIndex === index ? "selected" : "";
            const disabled = isHost || self?.hasAnswered ? "disabled" : "";
            return `
              <button
                class="answer-button ${toneClass} ${selected}"
                data-action="answer"
                data-answer-index="${index}"
                ${disabled}
              >
                <span class="answer-badge">${ANSWER_LABELS[index] || index + 1}</span>
                <span class="answer-text">${escapeHtml(choice)}</span>
              </button>
            `;
          })
          .join("")}
      </div>
    </article>
  `;
}

function renderQuestionSidebar(session, isHost) {
  const self = session.self;
  const selfTeam = getSelfTeam(session);
  const statusText = isHost
    ? `${session.answeredCount}/${session.connectedCount} players have answered`
    : self?.hasAnswered
      ? "Answer locked in. Hold tight for the reveal."
      : "Choose your answer before the timer ends.";

  return `
    <aside class="panel insight-panel span-4 ${session.question.isFinalBoss ? "final-boss-panel" : ""}">
      <div class="metric">
        <span class="muted">${isHost ? "Live answer count" : "Your status"}</span>
        <strong>${escapeHtml(statusText)}</strong>
      </div>
      <div>
        <p class="muted">Category lane</p>
        <div class="chip-row">
          <span class="chip">${escapeHtml(session.categoryLabel)}</span>
          <span class="chip">${escapeHtml(session.playModeLabel)}</span>
        </div>
      </div>
      <div class="metric">
        <span class="muted">Round value</span>
        <strong>${escapeHtml(renderPointsText(session.question))}</strong>
      </div>
      <p class="fine-print" style="margin:0">Base ${session.question.basePoints} points for a correct answer, plus up to ${session.question.speedBonusPoints} speed bonus.</p>
      ${
        session.playMode === "team"
          ? `
            <div class="metric">
              <span class="muted">${isHost ? "Leading squad" : "Your squad"}</span>
              <strong>${escapeHtml((isHost ? session.winningTeam?.name : selfTeam?.name) || "Waiting on teams")}</strong>
            </div>
          `
          : ""
      }
      ${
        session.question.isFinalBoss
          ? `
            <div class="reward-card final-boss-card">
              <strong>${escapeHtml(session.question.roundSubtitle || "Sudden Glory Round")}</strong>
              <p class="fine-print" style="margin:0.45rem 0 0">${escapeHtml(session.question.roundDescription || "Last question. Double points. One final scripture swing for the crown.")}</p>
            </div>
          `
          : ""
      }
      ${
        session.question.difficulty === "Hard"
          ? `
            <div class="reward-card">
              <strong>Hard-mode rewards live</strong>
              <p class="fine-print" style="margin:0.45rem 0 0">High scores on this round unlock special badges that stay with you through the leaderboard and final screen.</p>
            </div>
          `
          : ""
      }
      ${
        isHost
          ? `
            <div class="metric">
              <span class="muted">Players in room</span>
              <strong>${session.playerCount}</strong>
            </div>
            <div class="metric">
              <span class="muted">Room code</span>
              <strong class="mono">${escapeHtml(session.pin)}</strong>
            </div>
          `
          : `
            <div class="metric">
              <span class="muted">Current score</span>
              <strong>${session.self?.score || 0} pts</strong>
            </div>
            <div class="metric">
              <span class="muted">Current rank</span>
              <strong>${ordinal(session.self?.rank || session.playerCount || 1)}</strong>
            </div>
          `
      }
      ${
        session.playMode === "team"
          ? `
            <div>
              <p class="muted">Team leaderboard</p>
              ${renderTeamRows(session.teams, "Teams will appear here once players join.")}
            </div>
          `
          : ""
      }
      <div>
        <p class="muted">Live leaderboard</p>
        <div class="leaderboard-list">
          ${session.players
            .slice(0, 5)
            .map(
              (player) => `
                <div class="leader-row ${player.connected ? "" : "offline"}">
                  <div class="leader-meta">
                    <div class="stack-inline">
                      <span class="leader-name">#${player.rank} ${escapeHtml(player.name)}</span>
                      ${session.playMode === "team" ? renderTeamBadge(player.teamName, player.teamTone, true) : ""}
                    </div>
                    <span class="subtle">${player.connected ? "In play" : "Disconnected"}</span>
                  </div>
                  <strong>${player.score}</strong>
                </div>
              `
            )
            .join("")}
        </div>
      </div>
      <div class="align-end">
        <button class="icon-button" data-action="leave-session">${isHost ? "Close Room" : "Leave Room"}</button>
      </div>
    </aside>
  `;
}

function renderRevealQuestion(question, self) {
  return `
    <div class="answer-grid">
      ${question.choices
        .map((choice, index) => {
          const toneClass = ANSWER_TONES[index] || "";
          const correctClass = index === question.answerIndex ? "correct" : "";
          const selectedClass = self?.selectedAnswerIndex === index ? "selected" : "";
          const incorrectClass =
            self?.selectedAnswerIndex === index && index !== question.answerIndex ? "incorrect" : "";
          return `
            <div class="answer-button ${toneClass} ${correctClass} ${incorrectClass} ${selectedClass}">
              <span class="answer-badge">${ANSWER_LABELS[index] || index + 1}</span>
              <span class="answer-text">${escapeHtml(choice)}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderBreakdown(session) {
  const totalAnswers = Math.max(session.answeredCount, 1);
  return `
    <div class="breakdown-list">
      ${session.question.choices
        .map((choice, index) => {
          const count = session.answerBreakdown?.[index] || 0;
          const percent = Math.round((count / totalAnswers) * 100);
          return `
            <div class="breakdown-row">
              <div class="spaced" style="justify-content:space-between">
                <span>${ANSWER_LABELS[index]} · ${escapeHtml(choice)}</span>
                <span>${count} vote${count === 1 ? "" : "s"}</span>
              </div>
              <div class="breakdown-bar">
                <div class="breakdown-fill" style="width:${percent}%"></div>
              </div>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderLeaderboardRows(players) {
  return `
    <div class="leaderboard-list">
      ${players
        .map(
          (player) => `
            <div class="leader-row ${player.connected ? "" : "offline"}">
              <div class="leader-meta">
                <div class="stack-inline">
                  <span class="leader-name">#${player.rank} ${escapeHtml(player.name)}</span>
                  ${renderTeamBadge(player.teamName, player.teamTone, true)}
                </div>
                ${renderRewardBadges(player.hardRewards, true)}
                <span class="subtle">${player.lastAnswerCorrect ? `+${player.lastDelta} this round` : player.lastAnswerCorrect === false ? "Missed or timed out" : "No round data"}</span>
              </div>
              <strong>${player.score} pts</strong>
            </div>
          `
        )
        .join("")}
    </div>
  `;
}

function renderReveal(session, isHost) {
  const self = session.self;
  const bannerClass = self?.lastAnswerCorrect ? "good" : "bad";
  const bannerText = self?.lastAnswerCorrect
    ? session.question.isFinalBoss
      ? `Final boss cracked! +${self.lastDelta} points`
      : `Correct! +${self.lastDelta} points`
    : self
      ? session.question.isFinalBoss
        ? "The final boss got away. Watch the reveal and see who stole the crown."
        : "Not this round. Watch the reference and bounce back."
      : `${session.answeredCount} players locked in answers`;
  const unlockedRewards =
    session.question.difficulty === "Hard" && self?.latestRewards?.length
      ? `
        <div class="reward-card reward-card-highlight">
          <strong>Hard-mode reward unlocked</strong>
          ${renderRewardBadges(self.latestRewards)}
          <p class="fine-print" style="margin:0">You crossed a badge threshold with that hard-question score.</p>
        </div>
      `
      : "";

  return `
    <section class="result-layout">
      <article class="panel question-panel span-7 ${session.question.isFinalBoss ? "final-boss-panel" : ""}">
        ${renderFinalBossBanner(session.question, "reveal")}
        <span class="eyebrow">Answer reveal</span>
        <h2>${escapeHtml(session.question.prompt)}</h2>
        <div class="chip-row" style="margin-bottom:1rem">
          ${session.question.isFinalBoss ? `<span class="chip final-boss-chip">2x Finale</span>` : ""}
          <span class="chip">${escapeHtml(session.question.difficulty)}</span>
          <span class="chip">${escapeHtml(renderPointsText(session.question))}</span>
        </div>
        ${!isHost ? `<div class="result-banner ${bannerClass}">${escapeHtml(bannerText)}</div>` : ""}
        ${!isHost ? unlockedRewards : ""}
        ${renderRevealQuestion(session.question, self)}
        <div class="scripture-card" style="margin-top:1rem">
          <strong>${escapeHtml(session.question.reference)}</strong>
          <p class="panel-intro" style="margin:0.55rem 0 0">${escapeHtml(session.question.explanation)}</p>
        </div>
      </article>
      <aside class="panel insight-panel span-5 ${session.question.isFinalBoss ? "final-boss-panel" : ""}">
        <div class="metric">
          <span class="muted">${session.playMode === "team" ? "Leading squad" : "Leaderboard"}</span>
          <strong>${session.playMode === "team" ? escapeHtml(session.winningTeam?.name || "No teams yet") : session.winner ? escapeHtml(session.winner.name) : "No players yet"}</strong>
        </div>
        <div class="chip-row">
          <span class="chip">${escapeHtml(session.categoryLabel)}</span>
          <span class="chip">${escapeHtml(session.playModeLabel)}</span>
        </div>
        ${session.playMode === "team" ? renderTeamRows(session.teams, "Teams will appear here once players join.") : ""}
        ${renderBreakdown(session)}
        ${renderLeaderboardRows(session.players)}
        ${
          isHost
            ? `<div class="align-end"><button class="button" data-action="next-round">${session.questionNumber === session.totalQuestions ? "Crown the Champion" : "Next Question"}</button></div>`
            : `<div class="align-end"><button class="icon-button" data-action="leave-session">Leave Room</button></div>`
        }
      </aside>
    </section>
  `;
}

function renderFinal(session, isHost) {
  const topThree = session.players.slice(0, 3);
  const self = session.self;
  const selfTeam = getSelfTeam(session);
  return `
    <section class="final-layout">
      <article class="panel winner-panel span-7 ${session.question?.isFinalBoss ? "final-boss-panel" : ""}">
        ${renderFinalBossBanner(session.question, "final")}
        <span class="eyebrow">Final results</span>
        <h2>${
          session.playMode === "team"
            ? session.winningTeam
              ? `${escapeHtml(session.winningTeam.name)} wins Team Battle`
              : "Team Battle finished"
            : session.winner
              ? `${escapeHtml(session.winner.name)} wins Amen Arena`
              : "Battle finished"
        }</h2>
        <p class="panel-intro">
          ${
            session.playMode === "team"
              ? session.winningTeam
                ? `${escapeHtml(session.winningTeam.name)} finished on top, while ${session.winner ? `${escapeHtml(session.winner.name)} was the highest-scoring player in the room.` : "the individual MVP race stayed wide open."}`
                : "No winning team was recorded for this session."
              : session.winner
                ? `${escapeHtml(session.winner.name)} led the room with ${session.winner.score} points.`
                : "No winner was recorded for this session."
          }
        </p>
        <div class="chip-row">
          <span class="winner-stat">${escapeHtml(session.categoryLabel)}</span>
          <span class="winner-stat">${escapeHtml(session.playModeLabel)}</span>
          ${session.question?.isFinalBoss ? `<span class="winner-stat">${escapeHtml(session.question.roundSubtitle || "Final Boss Round")} • ${session.question.pointsMultiplier}x points</span>` : ""}
          <span class="winner-stat">${session.playMode === "team" ? `Winning team score: ${session.winningTeam?.score || 0}` : `Champion score: ${session.winner?.score || 0}`}</span>
          ${
            self
              ? `<span class="winner-stat">${session.playMode === "team" && selfTeam ? `${escapeHtml(selfTeam.name)} • ` : ""}You placed ${ordinal(self.rank || 1)} with ${self.score} points</span>`
              : `<span class="winner-stat">${session.playerCount} total players</span>`
          }
        </div>
        ${session.winner?.hardRewards?.length ? renderRewardBadges(session.winner.hardRewards) : ""}
        <div class="podium-grid">
          ${topThree
            .map(
              (player) => `
                <div class="podium-card">
                  <span class="podium-rank">#${player.rank}</span>
                  <strong>${escapeHtml(player.name)}</strong>
                  <span class="subtle">${player.score} points</span>
                  ${renderRewardBadges(player.hardRewards, true)}
                </div>
              `
            )
            .join("")}
        </div>
      </article>
      <aside class="panel leaderboard-panel span-5">
        <p class="muted">${session.playMode === "team" ? "Team leaderboard" : "Full leaderboard"}</p>
        <h3 class="card-title">${session.playMode === "team" ? `${session.teams.length} squads battled` : `${session.playerCount} players battled`}</h3>
        ${session.playMode === "team" ? renderTeamRows(session.teams, "Teams will appear here once players join.") : ""}
        ${session.playMode === "team" ? `<p class="muted" style="margin-top:1rem">Individual leaderboard</p>` : ""}
        ${renderLeaderboardRows(session.players)}
        <div class="align-end" style="margin-top:1rem">
          ${
            isHost
              ? `<button class="button" data-action="restart">Play Again</button>`
              : `<button class="icon-button" data-action="leave-session">Leave Room</button>`
          }
        </div>
      </aside>
    </section>
  `;
}

function renderSession() {
  const session = state.session;
  const isHost = state.role === "host";

  if (session.status === "lobby") {
    return isHost ? renderHostLobby(session) : renderPlayerLobby(session);
  }

  if (session.status === "question") {
    return `
      <section class="question-layout">
        ${renderQuestionCard(session, isHost)}
        ${renderQuestionSidebar(session, isHost)}
      </section>
    `;
  }

  if (session.status === "reveal") {
    return renderReveal(session, isHost);
  }

  if (session.status === "final") {
    return renderFinal(session, isHost);
  }

  return "";
}

function renderFooterStatus() {
  if (!state.session) {
    return `
      <section class="panel status-panel" style="margin-top:1rem">
        <span class="muted">MVP stack: Node, WebSockets, responsive frontend, no external database needed.</span>
        <span class="subtle">Open the same URL on phones or extra tabs on your local network.</span>
      </section>
    `;
  }

  const hostStatus = state.session.hostConnected ? "Host is live" : "Host reconnecting...";
  return `
    <section class="panel status-panel" style="margin-top:1rem">
      <span class="muted">${escapeHtml(hostStatus)}</span>
      <span class="subtle">${escapeHtml(state.session.categoryLabel)} • ${escapeHtml(state.session.playModeLabel)} • ${state.session.playerCount} players • ${state.session.totalQuestions} questions</span>
    </section>
  `;
}

function render() {
  const titleSuffix = state.session?.pin ? ` | Room ${state.session.pin}` : "";
  document.title = `Amen Arena${titleSuffix}`;

  app.innerHTML = `
    <main class="app-shell">
      ${renderHeader()}
      ${state.session ? renderSession() : renderLanding()}
      ${renderFooterStatus()}
    </main>
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
  `;
}

app.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  if (target.name === "pin") {
    state.join.pin = target.value.replace(/\D+/g, "").slice(0, 6);
    target.value = state.join.pin;
  }

  if (target.name === "name") {
    state.join.name = target.value.slice(0, 18);
    window.localStorage.setItem(NAME_KEY, state.join.name);
  }

  if (target.name === "sound-volume") {
    setSoundVolume(Number(target.value) / 100);
  }
});

app.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) {
    return;
  }

  if (target.name === "sound-volume") {
    render();
  }
});

app.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  unlockAudio();

  if (form.dataset.form === "join") {
    event.preventDefault();
    sendMessage({
      type: "player:join",
      pin: state.join.pin,
      name: state.join.name,
      teamSelection: state.join.teamSelection
    });
  }
});

app.addEventListener("click", async (event) => {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) {
    return;
  }

  unlockAudio();

  const { action } = actionTarget.dataset;

  switch (action) {
    case "create-session":
      sendMessage({
        type: "host:create-session",
        categorySelection: state.hostSetup.categorySelection,
        playModeSelection: state.hostSetup.playModeSelection
      });
      break;
    case "select-category": {
      const categorySelection = actionTarget.dataset.categorySelection;
      if (!categorySelection) {
        break;
      }

      saveCategorySelection(categorySelection);
      if (state.role === "host" && state.session?.status === "lobby") {
        sendMessage({
          type: "host:update-category",
          categorySelection
        });
      } else {
        render();
      }
      break;
    }
    case "select-play-mode": {
      const playModeSelection = actionTarget.dataset.playModeSelection;
      if (!playModeSelection) {
        break;
      }

      savePlayModeSelection(playModeSelection);
      if (state.role === "host" && state.session?.status === "lobby") {
        sendMessage({
          type: "host:update-play-mode",
          playModeSelection
        });
      } else {
        render();
      }
      break;
    }
    case "select-team": {
      const teamSelection = actionTarget.dataset.teamSelection;
      if (!teamSelection) {
        break;
      }

      saveTeamSelection(teamSelection);
      render();
      break;
    }
    case "toggle-sound":
      setSoundMuted(!state.sound.muted);
      render();
      break;
    case "set-sound-preset": {
      const soundPercent = Number(actionTarget.dataset.soundPercent);
      if (!Number.isFinite(soundPercent)) {
        break;
      }

      setSoundVolume(soundPercent / 100);
      setSoundMuted(false);
      render();
      break;
    }
    case "focus-join": {
      const pinInput = document.getElementById("pin");
      pinInput?.focus();
      break;
    }
    case "start-game":
      sendMessage({ type: "host:start-game" });
      break;
    case "next-round":
      sendMessage({ type: "host:next-round" });
      break;
    case "restart":
      sendMessage({ type: "host:restart" });
      break;
    case "answer":
      if (state.role === "player" && state.session?.status === "question") {
        const answerIndex = Number(actionTarget.dataset.answerIndex);
        sendMessage({ type: "player:submit-answer", answerIndex });
      }
      break;
    case "leave-session":
      leaveSession();
      break;
    case "copy-link": {
      const link = actionTarget.dataset.link;
      if (!link) {
        break;
      }
      try {
        await navigator.clipboard.writeText(link);
        showToast("Join link copied.");
      } catch (_error) {
        showToast(link);
      }
      break;
    }
    default:
      break;
  }
});

window.setInterval(() => {
  if (state.session?.status === "question" || state.toast) {
    maybeHideToast();
    render();
  }
}, 250);

connectSocket();
render();

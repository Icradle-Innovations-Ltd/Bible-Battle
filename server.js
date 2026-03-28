const crypto = require("crypto");
const http = require("http");
const os = require("os");
const path = require("path");

const express = require("express");
const { WebSocketServer, WebSocket } = require("ws");

const PORT = Number(process.env.PORT) || 3000;
const QUESTION_DURATION_MS = 20_000;
const HOST_GRACE_MS = 15_000;
const MAX_PLAYERS = 40;
const SESSION_TTL_MS = 2 * 60 * 60 * 1000;
const QUESTIONS_PER_GAME = 10;
const DEFAULT_CATEGORY_SELECTION = "mixed";
const FINAL_BOSS_CONFIG = {
  multiplier: 2,
  label: "Final Boss Round",
  subtitle: "Sudden Glory Round",
  description: "Last question. Double points. One final scripture swing for the crown."
};
const DIFFICULTY_SCORING = {
  Easy: {
    basePoints: 500,
    speedBonusPoints: 300
  },
  Medium: {
    basePoints: 700,
    speedBonusPoints: 500
  },
  Hard: {
    basePoints: 1000,
    speedBonusPoints: 600
  }
};
const HARD_REWARD_TIERS = [
  {
    id: "lionheart-badge",
    name: "Lionheart Badge",
    minHardPoints: 1200,
    tone: "bronze",
    description: "Strong score on the toughest Bible rounds."
  },
  {
    id: "wisdom-crown",
    name: "Wisdom Crown",
    minHardPoints: 2500,
    tone: "gold",
    description: "Stacked major points on hard questions."
  },
  {
    id: "battle-throne",
    name: "Battle Throne",
    minHardPoints: 3800,
    tone: "sky",
    description: "Dominated the hardest scripture challenges."
  }
];
const CATEGORY_SELECTIONS = {
  mixed: {
    label: "Mixed Testament Showdown",
    testament: null
  },
  old: {
    label: "Old Testament Only",
    testament: "Old Testament"
  },
  new: {
    label: "New Testament Only",
    testament: "New Testament"
  }
};

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) => {
  res.json({ ok: true });
});
app.get("*", (_req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const sockets = new Map();
const sessions = new Map();
const roundTimers = new Map();

const questionBank = [
  {
    id: "genesis-creation",
    prompt: "How many days did God take to create the world according to Genesis?",
    choices: ["3 days", "5 days", "6 days", "7 days"],
    answerIndex: 2,
    reference: "Genesis 1:31; 2:2",
    testament: "Old Testament",
    category: "Creation",
    difficulty: "Easy",
    explanation: "God completed creation in six days and rested on the seventh."
  },
  {
    id: "ark-animals",
    prompt: "Who built the ark before the great flood?",
    choices: ["Moses", "Noah", "Abraham", "Elijah"],
    answerIndex: 1,
    reference: "Genesis 6:13-14",
    testament: "Old Testament",
    category: "Heroes",
    difficulty: "Easy",
    explanation: "Noah obeyed God's instruction and built the ark."
  },
  {
    id: "moses-sea",
    prompt: "Which sea did Moses part by God's power?",
    choices: ["Dead Sea", "Sea of Galilee", "Mediterranean Sea", "Red Sea"],
    answerIndex: 3,
    reference: "Exodus 14:21-22",
    testament: "Old Testament",
    category: "Miracles",
    difficulty: "Easy",
    explanation: "God parted the Red Sea so Israel could cross on dry ground."
  },
  {
    id: "goliath",
    prompt: "What weapon did David use to defeat Goliath?",
    choices: ["Sword", "Bow and arrow", "Sling and stone", "Spear"],
    answerIndex: 2,
    reference: "1 Samuel 17:49-50",
    testament: "Old Testament",
    category: "Heroes",
    difficulty: "Easy",
    explanation: "David struck Goliath with a sling and a stone."
  },
  {
    id: "proverbs-wisdom",
    prompt: "Which king is most famous for asking God for wisdom?",
    choices: ["Saul", "Solomon", "Hezekiah", "Josiah"],
    answerIndex: 1,
    reference: "1 Kings 3:9-12",
    testament: "Old Testament",
    category: "Wisdom",
    difficulty: "Medium",
    explanation: "Solomon asked for an understanding heart to lead the people well."
  },
  {
    id: "jonah-city",
    prompt: "To which city was Jonah sent to preach repentance?",
    choices: ["Jericho", "Bethlehem", "Nineveh", "Damascus"],
    answerIndex: 2,
    reference: "Jonah 1:1-2",
    testament: "Old Testament",
    category: "Prophets",
    difficulty: "Medium",
    explanation: "God sent Jonah to Nineveh, a great city known for its wickedness."
  },
  {
    id: "joseph-dreams",
    prompt: "Who interpreted Pharaoh's dreams in Egypt?",
    choices: ["Joseph", "Daniel", "Aaron", "Isaac"],
    answerIndex: 0,
    reference: "Genesis 41:15-16, 25",
    testament: "Old Testament",
    category: "Heroes",
    difficulty: "Medium",
    explanation: "God gave Joseph wisdom to interpret Pharaoh's dreams."
  },
  {
    id: "mount-sinai",
    prompt: "On which mountain did Moses receive the Ten Commandments?",
    choices: ["Carmel", "Zion", "Sinai", "Olivet"],
    answerIndex: 2,
    reference: "Exodus 19:20; 20:1",
    testament: "Old Testament",
    category: "Law",
    difficulty: "Easy",
    explanation: "Moses received the Ten Commandments from God on Mount Sinai."
  },
  {
    id: "queen-esther",
    prompt: "Which queen risked her life to save her people from destruction?",
    choices: ["Vashti", "Ruth", "Esther", "Miriam"],
    answerIndex: 2,
    reference: "Esther 4:14-16",
    testament: "Old Testament",
    category: "Heroes",
    difficulty: "Easy",
    explanation: "Esther bravely approached the king to plead for her people."
  },
  {
    id: "elijah-carmel",
    prompt: "Which prophet called down fire from heaven on Mount Carmel?",
    choices: ["Elijah", "Elisha", "Isaiah", "Jeremiah"],
    answerIndex: 0,
    reference: "1 Kings 18:36-38",
    testament: "Old Testament",
    category: "Prophets",
    difficulty: "Medium",
    explanation: "God answered Elijah with fire to show that the Lord is the true God."
  },
  {
    id: "nathan-david",
    prompt: "Which prophet confronted King David after his sin with Bathsheba?",
    choices: ["Nathan", "Gad", "Elisha", "Amos"],
    answerIndex: 0,
    reference: "2 Samuel 12:1-7",
    testament: "Old Testament",
    category: "Prophets",
    difficulty: "Hard",
    explanation: "Nathan confronted David with a parable that exposed his sin."
  },
  {
    id: "hilkiah-law",
    prompt: "Which high priest found the Book of the Law during King Josiah's reign?",
    choices: ["Abiathar", "Hilkiah", "Zadok", "Jehoiada"],
    answerIndex: 1,
    reference: "2 Kings 22:8",
    testament: "Old Testament",
    category: "Kings",
    difficulty: "Hard",
    explanation: "Hilkiah found the Book of the Law in the temple during Josiah's reforms."
  },
  {
    id: "beatitudes",
    prompt: "On what hill or setting did Jesus famously teach the Beatitudes?",
    choices: ["Mountainside", "Temple court", "Fishing boat", "Upper room"],
    answerIndex: 0,
    reference: "Matthew 5:1-3",
    testament: "New Testament",
    category: "Teachings of Jesus",
    difficulty: "Medium",
    explanation: "The Beatitudes are part of the Sermon on the Mount."
  },
  {
    id: "greatest-commandment",
    prompt: "According to Jesus, what is the greatest commandment?",
    choices: [
      "Love your neighbor as yourself",
      "Love the Lord your God with all your heart",
      "Honor your father and mother",
      "Do not worry about tomorrow"
    ],
    answerIndex: 1,
    reference: "Matthew 22:37-38",
    testament: "New Testament",
    category: "Teachings of Jesus",
    difficulty: "Medium",
    explanation: "Jesus said loving God fully is the first and greatest commandment."
  },
  {
    id: "paul-conversion",
    prompt: "What was Paul called before his conversion?",
    choices: ["Silas", "Barnabas", "Saul", "Stephen"],
    answerIndex: 2,
    reference: "Acts 9:1-4",
    testament: "New Testament",
    category: "Early Church",
    difficulty: "Easy",
    explanation: "Paul was first known as Saul before encountering Jesus on the road to Damascus."
  },
  {
    id: "fruit-spirit",
    prompt: "Which of these is listed as a fruit of the Spirit?",
    choices: ["Courage", "Patience", "Success", "Victory"],
    answerIndex: 1,
    reference: "Galatians 5:22-23",
    testament: "New Testament",
    category: "Christian Living",
    difficulty: "Easy",
    explanation: "Patience is one of the fruits of the Spirit named by Paul."
  },
  {
    id: "armor-of-god",
    prompt: "Which book contains the passage about the armor of God?",
    choices: ["Romans", "Ephesians", "Hebrews", "James"],
    answerIndex: 1,
    reference: "Ephesians 6:10-18",
    testament: "New Testament",
    category: "Christian Living",
    difficulty: "Medium",
    explanation: "Paul describes the armor of God in Ephesians chapter 6."
  },
  {
    id: "new-jerusalem",
    prompt: "In Revelation, what city comes down from heaven prepared like a bride?",
    choices: ["Nazareth", "Jerusalem", "New Jerusalem", "Bethany"],
    answerIndex: 2,
    reference: "Revelation 21:2",
    testament: "New Testament",
    category: "Prophecy",
    difficulty: "Hard",
    explanation: "John saw the New Jerusalem coming down out of heaven from God."
  },
  {
    id: "jesus-birth-town",
    prompt: "In which town was Jesus born?",
    choices: ["Bethany", "Bethlehem", "Nazareth", "Jericho"],
    answerIndex: 1,
    reference: "Luke 2:4-7",
    testament: "New Testament",
    category: "Life of Jesus",
    difficulty: "Easy",
    explanation: "Jesus was born in Bethlehem as foretold by the prophets."
  },
  {
    id: "water-to-wine",
    prompt: "What miracle did Jesus perform first in the Gospel of John?",
    choices: [
      "He healed a blind man",
      "He calmed the storm",
      "He multiplied bread",
      "He turned water into wine"
    ],
    answerIndex: 3,
    reference: "John 2:1-11",
    testament: "New Testament",
    category: "Miracles",
    difficulty: "Medium",
    explanation: "At Cana, Jesus turned water into wine as His first recorded sign in John's Gospel."
  },
  {
    id: "doubting-thomas",
    prompt: "Which disciple said he needed to see Jesus' wounds before believing?",
    choices: ["Peter", "Thomas", "Andrew", "Matthew"],
    answerIndex: 1,
    reference: "John 20:24-29",
    testament: "New Testament",
    category: "Disciples",
    difficulty: "Easy",
    explanation: "Thomas doubted at first, then confessed Jesus as Lord and God."
  },
  {
    id: "philip-eunuch",
    prompt: "Who explained Isaiah to the Ethiopian eunuch before baptizing him?",
    choices: ["Philip", "Peter", "Paul", "John Mark"],
    answerIndex: 0,
    reference: "Acts 8:30-38",
    testament: "New Testament",
    category: "Early Church",
    difficulty: "Medium",
    explanation: "Philip explained the Scriptures and then baptized the Ethiopian believer."
  },
  {
    id: "onesimus-letter",
    prompt: "To whom did Paul write about the runaway slave Onesimus?",
    choices: ["Titus", "Timothy", "Philemon", "Silas"],
    answerIndex: 2,
    reference: "Philemon 1:10-12",
    testament: "New Testament",
    category: "Letters",
    difficulty: "Hard",
    explanation: "Paul wrote to Philemon, asking him to welcome Onesimus as a brother in Christ."
  }
];

function randomChoiceId() {
  return crypto.randomUUID();
}

function normalizeCategorySelection(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return CATEGORY_SELECTIONS[normalized] ? normalized : DEFAULT_CATEGORY_SELECTION;
}

function getCategoryConfig(categorySelection) {
  return CATEGORY_SELECTIONS[normalizeCategorySelection(categorySelection)];
}

function getDifficultyScoring(difficulty) {
  return DIFFICULTY_SCORING[difficulty] || DIFFICULTY_SCORING.Medium;
}

function isFinalBossQuestion(session, questionIndex = session.currentQuestionIndex) {
  return questionIndex >= 0 && questionIndex === session.questions.length - 1;
}

function getRoundScoring(question, isFinalBoss = false) {
  const scoring = getDifficultyScoring(question.difficulty);
  const pointsMultiplier = isFinalBoss ? FINAL_BOSS_CONFIG.multiplier : 1;
  return {
    basePoints: scoring.basePoints * pointsMultiplier,
    speedBonusPoints: scoring.speedBonusPoints * pointsMultiplier,
    maxPoints: (scoring.basePoints + scoring.speedBonusPoints) * pointsMultiplier,
    pointsMultiplier
  };
}

function getUnlockedHardRewards(hardScore) {
  return HARD_REWARD_TIERS.filter((reward) => hardScore >= reward.minHardPoints);
}

function filterQuestionsByCategory(categorySelection) {
  const { testament } = getCategoryConfig(categorySelection);
  if (!testament) {
    return questionBank;
  }
  return questionBank.filter((question) => question.testament === testament);
}

function createQuestionSet(categorySelection = DEFAULT_CATEGORY_SELECTION) {
  const pool = filterQuestionsByCategory(categorySelection);
  if (pool.length < QUESTIONS_PER_GAME) {
    throw new Error("Not enough questions exist for that category selection.");
  }

  return shuffle(pool).slice(0, QUESTIONS_PER_GAME).map((question) => ({
    ...question,
    roundId: randomChoiceId()
  }));
}

function shuffle(items) {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[swapIndex]] = [copy[swapIndex], copy[index]];
  }
  return copy;
}

function generatePin() {
  let pin = "";
  do {
    pin = String(Math.floor(100_000 + Math.random() * 900_000));
  } while (sessions.has(pin));
  return pin;
}

function normalizeName(value) {
  const trimmed = String(value || "")
    .replace(/\s+/g, " ")
    .trim();
  return trimmed.slice(0, 18);
}

function buildPlayer(name) {
  return {
    id: crypto.randomUUID(),
    authKey: crypto.randomUUID(),
    name,
    score: 0,
    streak: 0,
    joinedAt: Date.now(),
    connected: true,
    hardScore: 0,
    hardCorrectCount: 0,
    hardRewards: [],
    latestRewards: [],
    lastDelta: 0,
    lastAnswerCorrect: null,
    selectedAnswerIndex: null
  };
}

function buildSession(categorySelection = DEFAULT_CATEGORY_SELECTION) {
  const selectedCategory = normalizeCategorySelection(categorySelection);
  return {
    pin: generatePin(),
    hostAuthKey: crypto.randomUUID(),
    hostSocketId: null,
    hostConnected: false,
    status: "lobby",
    createdAt: Date.now(),
    currentQuestionIndex: -1,
    questionStartedAt: null,
    timerEndsAt: null,
    hostGraceTimeout: null,
    answerBreakdown: null,
    roundAnswers: new Map(),
    players: new Map(),
    selectedCategory,
    questions: createQuestionSet(selectedCategory)
  };
}

function getSocket(socketId) {
  return sockets.get(socketId) || null;
}

function activePlayerCount(session) {
  return [...session.players.values()].filter((player) => player.connected).length;
}

function getSortedPlayers(session) {
  return [...session.players.values()]
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score;
      }
      return left.joinedAt - right.joinedAt;
    })
    .map((player, index) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      streak: player.streak,
      hardScore: player.hardScore,
      hardCorrectCount: player.hardCorrectCount,
      hardRewards: player.hardRewards,
      latestRewards: player.latestRewards,
      connected: player.connected,
      lastDelta: player.lastDelta,
      lastAnswerCorrect: player.lastAnswerCorrect,
      rank: index + 1
    }));
}

function getCurrentQuestion(session) {
  return session.questions[session.currentQuestionIndex] || null;
}

function sanitizeAnswerIndex(question, answerIndex) {
  const parsed = Number(answerIndex);
  if (!Number.isInteger(parsed)) {
    return null;
  }
  if (parsed < 0 || parsed >= question.choices.length) {
    return null;
  }
  return parsed;
}

function clearRoundTimer(pin) {
  const timeout = roundTimers.get(pin);
  if (timeout) {
    clearTimeout(timeout);
    roundTimers.delete(pin);
  }
}

function setSocketMeta(socket, meta) {
  socket.meta = {
    role: meta.role || "guest",
    pin: meta.pin || null,
    playerId: meta.playerId || null
  };
}

function send(socket, payload) {
  if (!socket || socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(payload));
}

function sendError(socket, message) {
  send(socket, { type: "session:error", message });
}

function clearResumeIfInvalid(socket, message) {
  send(socket, { type: "session:clear-resume", message });
}

function createSession(socket, categorySelection) {
  let session = null;
  try {
    session = buildSession(categorySelection);
  } catch (_error) {
    sendError(socket, "That testament category is not ready yet. Try another selection.");
    return;
  }
  session.hostSocketId = socket.id;
  session.hostConnected = true;
  sessions.set(session.pin, session);
  setSocketMeta(socket, { role: "host", pin: session.pin });
  broadcastSession(session);
}

function updateCategory(socket, categorySelection) {
  const session = sessions.get(socket.meta.pin);
  if (!session || socket.meta.role !== "host") {
    return;
  }

  if (session.status !== "lobby") {
    sendError(socket, "Change the testament category before the game starts.");
    return;
  }

  const normalizedCategory = normalizeCategorySelection(categorySelection);
  try {
    session.selectedCategory = normalizedCategory;
    session.questions = createQuestionSet(normalizedCategory);
  } catch (_error) {
    sendError(socket, "That testament category is not ready yet. Try another selection.");
    return;
  }

  broadcastSession(session);
}

function resumeSession(socket, pin, role, authKey) {
  const session = sessions.get(String(pin || "").trim());
  if (!session) {
    clearResumeIfInvalid(socket, "That game session is no longer available.");
    return;
  }

  if (role === "host") {
    if (session.hostAuthKey !== authKey) {
      clearResumeIfInvalid(socket, "We could not restore the host session.");
      return;
    }
    session.hostSocketId = socket.id;
    session.hostConnected = true;
    if (session.hostGraceTimeout) {
      clearTimeout(session.hostGraceTimeout);
      session.hostGraceTimeout = null;
    }
    setSocketMeta(socket, { role: "host", pin: session.pin });
    broadcastSession(session);
    return;
  }

  if (role === "player") {
    const player = [...session.players.values()].find((entry) => entry.authKey === authKey);
    if (!player) {
      clearResumeIfInvalid(socket, "We could not restore that player session.");
      return;
    }
    player.connected = true;
    setSocketMeta(socket, { role: "player", pin: session.pin, playerId: player.id });
    broadcastSession(session);
    return;
  }

  clearResumeIfInvalid(socket, "That session could not be restored.");
}

function joinSession(socket, requestedPin, requestedName) {
  const pin = String(requestedPin || "").trim();
  const session = sessions.get(pin);
  if (!session) {
    sendError(socket, "Game PIN not found. Double-check and try again.");
    return;
  }

  if (session.status !== "lobby") {
    sendError(socket, "This quiz has already started. Ask the host for the next round.");
    return;
  }

  if (session.players.size >= MAX_PLAYERS) {
    sendError(socket, "This room is full.");
    return;
  }

  const name = normalizeName(requestedName);
  if (!name) {
    sendError(socket, "Enter a display name to join the game.");
    return;
  }

  const duplicate = [...session.players.values()].find(
    (player) => player.name.toLowerCase() === name.toLowerCase()
  );
  if (duplicate) {
    sendError(socket, "That player name is already taken in this room.");
    return;
  }

  const player = buildPlayer(name);
  session.players.set(player.id, player);
  setSocketMeta(socket, { role: "player", pin, playerId: player.id });
  broadcastSession(session);
}

function resetPlayerRoundState(player) {
  player.lastDelta = 0;
  player.lastAnswerCorrect = null;
  player.selectedAnswerIndex = null;
  player.latestRewards = [];
}

function beginQuestion(session, nextIndex) {
  clearRoundTimer(session.pin);
  session.currentQuestionIndex = nextIndex;
  session.status = "question";
  session.questionStartedAt = Date.now();
  session.timerEndsAt = session.questionStartedAt + QUESTION_DURATION_MS;
  session.answerBreakdown = null;
  session.roundAnswers = new Map();

  for (const player of session.players.values()) {
    resetPlayerRoundState(player);
  }

  roundTimers.set(
    session.pin,
    setTimeout(() => {
      revealQuestion(session.pin);
    }, QUESTION_DURATION_MS + 50)
  );

  broadcastSession(session);
}

function startGame(socket) {
  const session = sessions.get(socket.meta.pin);
  if (!session || socket.meta.role !== "host") {
    return;
  }
  if (activePlayerCount(session) < 1) {
    sendError(socket, "At least one connected player must be in the lobby to start.");
    return;
  }
  beginQuestion(session, 0);
}

function scoreAnswer(session, question, submittedAt) {
  const scoring = getRoundScoring(question, isFinalBossQuestion(session));
  const remaining = Math.max(session.timerEndsAt - submittedAt, 0);
  return scoring.basePoints + Math.round((remaining / QUESTION_DURATION_MS) * scoring.speedBonusPoints);
}

function awardHardRewards(player, pointsAwarded) {
  player.hardScore += pointsAwarded;
  player.hardCorrectCount += 1;

  const unlockedRewards = getUnlockedHardRewards(player.hardScore);
  const newRewards = unlockedRewards.filter(
    (reward) => !player.hardRewards.some((existingReward) => existingReward.id === reward.id)
  );

  if (newRewards.length > 0) {
    player.hardRewards = [...player.hardRewards, ...newRewards];
  }

  player.latestRewards = newRewards;
}

function revealQuestion(pin) {
  const session = sessions.get(pin);
  if (!session || session.status !== "question") {
    return;
  }

  clearRoundTimer(pin);
  const question = getCurrentQuestion(session);
  const breakdown = new Array(question.choices.length).fill(0);

  for (const player of session.players.values()) {
    const response = session.roundAnswers.get(player.id);
    if (!response) {
      player.lastDelta = 0;
      player.lastAnswerCorrect = false;
      player.selectedAnswerIndex = null;
      player.streak = 0;
      continue;
    }

    breakdown[response.answerIndex] += 1;
    player.lastDelta = response.pointsAwarded;
    player.lastAnswerCorrect = response.isCorrect;
    player.selectedAnswerIndex = response.answerIndex;
    player.streak = response.isCorrect ? player.streak + 1 : 0;
  }

  session.answerBreakdown = breakdown;
  session.status = "reveal";
  session.timerEndsAt = null;
  broadcastSession(session);
}

function finishGame(session) {
  clearRoundTimer(session.pin);
  session.status = "final";
  session.timerEndsAt = null;
  session.answerBreakdown = null;
  broadcastSession(session);
}

function advanceRound(socket) {
  const session = sessions.get(socket.meta.pin);
  if (!session || socket.meta.role !== "host") {
    return;
  }

  if (session.status === "reveal") {
    const hasNextQuestion = session.currentQuestionIndex < session.questions.length - 1;
    if (hasNextQuestion) {
      beginQuestion(session, session.currentQuestionIndex + 1);
      return;
    }
    finishGame(session);
  }
}

function restartGame(socket) {
  const session = sessions.get(socket.meta.pin);
  if (!session || socket.meta.role !== "host") {
    return;
  }

  clearRoundTimer(session.pin);
  session.questions = createQuestionSet(session.selectedCategory);
  session.status = "lobby";
  session.currentQuestionIndex = -1;
  session.questionStartedAt = null;
  session.timerEndsAt = null;
  session.answerBreakdown = null;
  session.roundAnswers = new Map();

  for (const player of session.players.values()) {
    player.score = 0;
    player.streak = 0;
    player.hardScore = 0;
    player.hardCorrectCount = 0;
    player.hardRewards = [];
    player.latestRewards = [];
    resetPlayerRoundState(player);
  }

  broadcastSession(session);
}

function submitAnswer(socket, answerIndex) {
  const session = sessions.get(socket.meta.pin);
  if (!session || socket.meta.role !== "player" || session.status !== "question") {
    return;
  }

  const player = session.players.get(socket.meta.playerId);
  if (!player) {
    return;
  }

  if (session.roundAnswers.has(player.id)) {
    return;
  }

  const question = getCurrentQuestion(session);
  const normalizedIndex = sanitizeAnswerIndex(question, answerIndex);
  if (normalizedIndex === null) {
    sendError(socket, "That answer could not be submitted.");
    return;
  }

  const submittedAt = Date.now();
  const isCorrect = normalizedIndex === question.answerIndex;
  const pointsAwarded = isCorrect ? scoreAnswer(session, question, submittedAt) : 0;

  player.score += pointsAwarded;
  if (isCorrect && question.difficulty === "Hard") {
    awardHardRewards(player, pointsAwarded);
  }
  session.roundAnswers.set(player.id, {
    answerIndex: normalizedIndex,
    isCorrect,
    submittedAt,
    pointsAwarded
  });

  broadcastSession(session);

  const connectedPlayers = activePlayerCount(session);
  if (connectedPlayers > 0 && session.roundAnswers.size >= connectedPlayers) {
    revealQuestion(session.pin);
  }
}

function removePlayer(session, playerId) {
  session.players.delete(playerId);
}

function endSession(session, reason) {
  clearRoundTimer(session.pin);
  if (session.hostGraceTimeout) {
    clearTimeout(session.hostGraceTimeout);
    session.hostGraceTimeout = null;
  }

  for (const socket of sockets.values()) {
    if (socket.meta?.pin === session.pin) {
      send(socket, { type: "session:ended", message: reason });
      setSocketMeta(socket, { role: "guest" });
    }
  }

  sessions.delete(session.pin);
}

function leaveSession(socket) {
  const { pin, role, playerId } = socket.meta || {};
  if (!pin) {
    return;
  }

  const session = sessions.get(pin);
  if (!session) {
    setSocketMeta(socket, { role: "guest" });
    return;
  }

  if (role === "host") {
    endSession(session, "The host closed this game room.");
    return;
  }

  if (role === "player") {
    removePlayer(session, playerId);
    setSocketMeta(socket, { role: "guest" });
    broadcastSession(session);
  }
}

function buildQuestionState(session) {
  const question = getCurrentQuestion(session);
  if (!question) {
    return null;
  }

  const isFinalBoss = isFinalBossQuestion(session);
  const scoring = getRoundScoring(question, isFinalBoss);

  const base = {
    id: question.id,
    prompt: question.prompt,
    choices: question.choices,
    category: question.category,
    difficulty: question.difficulty,
    testament: question.testament,
    basePoints: scoring.basePoints,
    speedBonusPoints: scoring.speedBonusPoints,
    maxPoints: scoring.maxPoints,
    pointsMultiplier: scoring.pointsMultiplier,
    isFinalBoss,
    roundLabel: isFinalBoss ? FINAL_BOSS_CONFIG.label : null,
    roundSubtitle: isFinalBoss ? FINAL_BOSS_CONFIG.subtitle : null,
    roundDescription: isFinalBoss ? FINAL_BOSS_CONFIG.description : null
  };

  if (session.status === "question") {
    return base;
  }

  return {
    ...base,
    answerIndex: question.answerIndex,
    reference: question.reference,
    explanation: question.explanation
  };
}

function buildPayloadForSocket(session, socket) {
  const players = getSortedPlayers(session);
  const selfPlayer = socket.meta.role === "player" ? session.players.get(socket.meta.playerId) : null;
  const selfRank = selfPlayer
    ? players.find((player) => player.id === selfPlayer.id)?.rank || null
    : null;

  return {
    type: "session:state",
    role: socket.meta.role,
    resume: {
      role: socket.meta.role,
      pin: session.pin,
      authKey:
        socket.meta.role === "host"
          ? session.hostAuthKey
          : selfPlayer
            ? selfPlayer.authKey
            : null
    },
    session: {
      pin: session.pin,
      status: session.status,
      hostConnected: session.hostConnected,
      selectedCategory: session.selectedCategory,
      categoryLabel: getCategoryConfig(session.selectedCategory).label,
      totalQuestions: session.questions.length,
      currentQuestionIndex: session.currentQuestionIndex,
      questionNumber: session.currentQuestionIndex + 1,
      isFinalBossRound: isFinalBossQuestion(session),
      timerEndsAt: session.timerEndsAt,
      playerCount: session.players.size,
      connectedCount: activePlayerCount(session),
      answeredCount: session.roundAnswers.size,
      canStart: activePlayerCount(session) > 0,
      players,
      question: buildQuestionState(session),
      answerBreakdown: session.status === "reveal" ? session.answerBreakdown : null,
      winner: players[0] || null,
      self: selfPlayer
        ? {
            id: selfPlayer.id,
            name: selfPlayer.name,
            score: selfPlayer.score,
            hardScore: selfPlayer.hardScore,
            hardCorrectCount: selfPlayer.hardCorrectCount,
            hardRewards: selfPlayer.hardRewards,
            latestRewards: selfPlayer.latestRewards,
            rank: selfRank,
            hasAnswered: session.roundAnswers.has(selfPlayer.id),
            selectedAnswerIndex:
              session.roundAnswers.get(selfPlayer.id)?.answerIndex ?? selfPlayer.selectedAnswerIndex,
            lastDelta: selfPlayer.lastDelta,
            lastAnswerCorrect: selfPlayer.lastAnswerCorrect
          }
        : null
    }
  };
}

function broadcastSession(session) {
  for (const socket of sockets.values()) {
    if (socket.meta?.pin !== session.pin) {
      continue;
    }
    send(socket, buildPayloadForSocket(session, socket));
  }
}

function scheduleHostGracePeriod(session) {
  if (session.hostGraceTimeout) {
    clearTimeout(session.hostGraceTimeout);
  }
  session.hostGraceTimeout = setTimeout(() => {
    const activeSession = sessions.get(session.pin);
    if (activeSession && !activeSession.hostConnected) {
      endSession(activeSession, "The host disconnected and the room closed.");
    }
  }, HOST_GRACE_MS);
}

function handleSocketClose(socket) {
  const meta = socket.meta || {};
  const session = meta.pin ? sessions.get(meta.pin) : null;
  sockets.delete(socket.id);

  if (!session) {
    return;
  }

  if (meta.role === "host") {
    session.hostConnected = false;
    scheduleHostGracePeriod(session);
    broadcastSession(session);
    return;
  }

  if (meta.role === "player") {
    const player = session.players.get(meta.playerId);
    if (!player) {
      return;
    }

    player.connected = false;
    if (session.status === "lobby") {
      player.lastDelta = 0;
    }

    const connectedPlayers = activePlayerCount(session);
    if (session.status === "question" && connectedPlayers > 0 && session.roundAnswers.size >= connectedPlayers) {
      revealQuestion(session.pin);
      return;
    }

    broadcastSession(session);
  }
}

function pruneSessions() {
  const now = Date.now();
  for (const session of sessions.values()) {
    const isExpired = now - session.createdAt > SESSION_TTL_MS;
    if (isExpired) {
      endSession(session, "This room expired.");
    }
  }
}

wss.on("connection", (socket) => {
  socket.id = crypto.randomUUID();
  setSocketMeta(socket, { role: "guest" });
  sockets.set(socket.id, socket);

  send(socket, { type: "server:ready" });

  socket.on("message", (rawMessage) => {
    let message = null;
    try {
      message = JSON.parse(String(rawMessage));
    } catch (_error) {
      sendError(socket, "We couldn't read that message.");
      return;
    }

    switch (message.type) {
      case "host:create-session":
        createSession(socket, message.categorySelection);
        break;
      case "host:update-category":
        updateCategory(socket, message.categorySelection);
        break;
      case "host:start-game":
        startGame(socket);
        break;
      case "host:next-round":
        advanceRound(socket);
        break;
      case "host:restart":
        restartGame(socket);
        break;
      case "player:join":
        joinSession(socket, message.pin, message.name);
        break;
      case "player:submit-answer":
        submitAnswer(socket, message.answerIndex);
        break;
      case "client:resume":
        resumeSession(socket, message.pin, message.role, message.authKey);
        break;
      case "client:leave":
        leaveSession(socket);
        break;
      default:
        sendError(socket, "Unsupported action.");
        break;
    }
  });

  socket.on("close", () => {
    handleSocketClose(socket);
  });
});

setInterval(pruneSessions, 5 * 60 * 1000);

function getLocalIps() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter(Boolean)
    .filter((entry) => entry.family === "IPv4" && !entry.internal)
    .map((entry) => entry.address);
}

server.listen(PORT, "0.0.0.0", () => {
  const ips = getLocalIps();
  console.log(`Bible Battle running at http://localhost:${PORT}`);
  if (ips.length > 0) {
    console.log(`LAN access: ${ips.map((ip) => `http://${ip}:${PORT}`).join(" | ")}`);
  }
});

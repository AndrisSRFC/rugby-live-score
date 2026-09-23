const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";
const MATCH_CONTROL_PIN = process.env.MATCH_CONTROL_PIN || "5678";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const TEAM_CONFIG = [
  { key: "U13", id: 1, label: "U13's" },
  { key: "U14", id: 2, label: "U14's" },
  { key: "U15", id: 3, label: "U15's" },
  { key: "U16", id: 4, label: "U16's" },
  { key: "Colts", id: 5, label: "Colts" },
  { key: "1st XV", id: 6, label: "1st XV" },
  { key: "2nd XV", id: 7, label: "2nd XV" }
];

const TEAM_IDS = Object.fromEntries(TEAM_CONFIG.map(team => [team.key, team.id]));
const TEAM_KEYS = TEAM_CONFIG.map(team => team.key);

const TEAM_ALIASES = {
  "1stXV": "1st XV",
  "2ndXV": "2nd XV",
  "1STXV": "1st XV",
  "2NDXV": "2nd XV"
};

const defaultState = {
  homeName: "Team 1",
  awayName: "Team 2",
  homeScore: 0,
  awayScore: 0,
  half: 1,
  elapsedSeconds: 0,
  running: false,
  startedAt: null,
  matchLive: false,
  message: "No match in progress",
  ageGroup: "U13",
  matchType: "Friendly",
  nextLive: null,
  nextHome: "",
  nextAway: "",
  nextAge: "",
  nextType: "Friendly"
};

function normalizeTeamKey(value) {
  const raw = String(value || "U13").trim();
  const key = TEAM_ALIASES[raw] || raw;
  return TEAM_IDS[key] ? key : "U13";
}

function createDefaultState(teamKey) {
  return { ...defaultState, ageGroup: teamKey };
}

let matchStates = Object.fromEntries(
  TEAM_KEYS.map(teamKey => [teamKey, createDefaultState(teamKey)])
);
const viewerCounts = Object.fromEntries(TEAM_KEYS.map(teamKey => [teamKey, 0]));

function emitViewerCounts() {
  io.emit("viewerCounts", { ...viewerCounts });
}

function getState(teamKey) {
  return matchStates[normalizeTeamKey(teamKey)];
}

function halfStartSeconds(teamKey) {
  const minutes = {
    U13: 25,
    U14: 25,
    U15: 30,
    U16: 35,
    Colts: 40,
    "1st XV": 40,
    "2nd XV": 40
  };
  return (minutes[normalizeTeamKey(teamKey)] || 40) * 60;
}

async function saveState(teamKey, stateToSave = getState(teamKey)) {
  const key = normalizeTeamKey(teamKey);
  await pool.query(
    `
    INSERT INTO rugby_state (id, data)
    VALUES ($1, $2::jsonb)
    ON CONFLICT (id)
    DO UPDATE SET data = EXCLUDED.data
    `,
    [TEAM_IDS[key], JSON.stringify(stateToSave)]
  );
}

function currentState(teamKey) {
  const key = normalizeTeamKey(teamKey);
  const copy = { ...getState(key), ageGroup: key };

  if (copy.running && copy.startedAt) {
    const elapsedSinceStart = Math.floor(
      (Date.now() - copy.startedAt) / 1000
    );
    copy.elapsedSeconds += elapsedSinceStart;
  }

  copy.remainingSeconds = copy.elapsedSeconds;
  copy.teamKey = key;
  return copy;
}

function commitClock(teamKey) {
  const key = normalizeTeamKey(teamKey);
  const wasRunning = getState(key).running;
  matchStates[key] = currentState(key);
  matchStates[key].startedAt = wasRunning ? Date.now() : null;
}

function broadcast(teamKey) {
  const key = normalizeTeamKey(teamKey);
  io.to(key).emit("state", currentState(key));
}

async function initDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rugby_state (
      id INTEGER PRIMARY KEY,
      data JSONB NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS nld_history (
      id SERIAL PRIMARY KEY,
      generation TEXT NOT NULL,
      opponent TEXT NOT NULL,
      wins INTEGER NOT NULL DEFAULT 0,
      draws INTEGER NOT NULL DEFAULT 0,
      losses INTEGER NOT NULL DEFAULT 0
    )
  `);

  const result = await pool.query(
    "SELECT id, data FROM rugby_state ORDER BY id"
  );

  const rowsById = new Map(
    result.rows.map(row => [Number(row.id), row])
  );

  // Migrate the old single-state row if it was saved with a different age group.
  const legacyRow = rowsById.get(1);
  if (legacyRow?.data?.ageGroup) {
    const legacyTeam = normalizeTeamKey(legacyRow.data.ageGroup);

    if (legacyTeam !== "U13" && !rowsById.has(TEAM_IDS[legacyTeam])) {
      await pool.query(
        "UPDATE rugby_state SET id = $1 WHERE id = 1",
        [TEAM_IDS[legacyTeam]]
      );
      rowsById.delete(1);
      rowsById.set(TEAM_IDS[legacyTeam], {
        ...legacyRow,
        id: TEAM_IDS[legacyTeam]
      });
    }
  }

  for (const team of TEAM_CONFIG) {
    const row = rowsById.get(team.id);

    matchStates[team.key] = {
      ...createDefaultState(team.key),
      ...(row?.data || {}),
      ageGroup: team.key
    };

    if (!row) {
      await saveState(team.key);
    }
  }

  console.log(`Loaded \${TEAM_CONFIG.length} independent rugby match states`);
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/teams", (req, res) => {
  res.json(
    TEAM_CONFIG.map(team => ({
      key: team.key,
      label: team.label,
      matchLive: getState(team.key).matchLive,
      viewers: viewerCounts[team.key] || 0
    }))
  );
});

app.get("/api/state", (req, res) => {
  res.json(currentState(req.query.team));
});

app.post("/api/admin", async (req, res) => {
  const { pin, action, payload = {}, team } = req.body || {};

  if (
    String(pin) !== String(ADMIN_PIN) &&
    String(pin) !== String(MATCH_CONTROL_PIN)
  ) {
    return res.status(401).json({ error: "Incorrect PIN" });
  }

  const teamKey = normalizeTeamKey(team);

  try {
    commitClock(teamKey);
    let selectedState = getState(teamKey);

    switch (action) {
      case "score":
        if (payload.team === "home") {
          selectedState.homeScore = Math.max(
            0,
            selectedState.homeScore + Number(payload.delta || 0)
          );
        }
        if (payload.team === "away") {
          selectedState.awayScore = Math.max(
            0,
            selectedState.awayScore + Number(payload.delta || 0)
          );
        }
        break;

      case "setNames":
        if (typeof payload.homeName === "string") {
          selectedState.homeName = payload.homeName.trim() || "Team 1";
        }
        if (typeof payload.awayName === "string") {
          selectedState.awayName = payload.awayName.trim() || "Team 2";
        }
        break;

      case "toggleClock":
        if (selectedState.running) {
          selectedState.running = false;
          selectedState.startedAt = null;
        } else {
          selectedState.running = true;
          selectedState.startedAt = Date.now();
        }
        break;

      case "resetClock":
        selectedState.running = false;
        selectedState.startedAt = null;
        selectedState.elapsedSeconds =
          selectedState.half === 2 ? halfStartSeconds(teamKey) : 0;
        break;

      case "setClock":
        selectedState.running = false;
        selectedState.startedAt = null;
        selectedState.elapsedSeconds = Math.max(
          0,
          Number(payload.seconds || 0)
        );
        break;

      case "setHalf":
        selectedState.running = false;
        selectedState.startedAt = null;
        if (Number(payload.half) === 2) {
          selectedState.half = 2;
          selectedState.elapsedSeconds = halfStartSeconds(teamKey);
        } else {
          selectedState.half = 1;
          selectedState.elapsedSeconds = 0;
        }
        break;

      case "setAgeGroup":
        // Compatibility with older control pages: team selection now chooses the state.
        selectedState.ageGroup = teamKey;
        break;

      case "setMatchType":
        selectedState.matchType = String(payload.matchType || "Friendly");
        break;

      case "startMatch":
        selectedState.matchLive = true;
        selectedState.message = "";
        break;

      case "endMatch":
        selectedState.matchLive = false;
        selectedState.running = false;
        selectedState.startedAt = null;
        selectedState.message = "Full Time";
        break;

      case "newMatch":
        matchStates[teamKey] = {
          ...createDefaultState(teamKey),
          homeName: payload.homeName?.trim() || "Team 1",
          awayName: payload.awayName?.trim() || "Team 2",
          matchLive: true,
          message: ""
        };
        selectedState = matchStates[teamKey];
        break;

      case "setNextLive":
        selectedState.nextLive = String(payload.nextLive || "").trim();
        selectedState.nextHome = String(payload.nextHome || "").trim();
        selectedState.nextAway = String(payload.nextAway || "").trim();
        selectedState.nextAge = String(payload.nextAge || "").trim();
        selectedState.nextType = String(payload.nextType || "Friendly").trim();
        break;

      default:
        return res.status(400).json({ error: "Unknown action" });
    }

    selectedState.ageGroup = teamKey;
    await saveState(teamKey);
    broadcast(teamKey);

    res.json({
      ok: true,
      team: teamKey,
      state: currentState(teamKey)
    });
  } catch (error) {
    console.error("Admin action error:", error);
    res.status(500).json({ error: "Database error" });
  }
});

app.get("/api/history", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT * FROM nld_history ORDER BY id DESC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("History error:", error);
    res.status(500).json({ error: "Database error" });
  }
});

app.post("/api/history", async (req, res) => {
  try {
    const {
      generation,
      opponent,
      wins = 0,
      draws = 0,
      losses = 0
    } = req.body;

    const result = await pool.query(
      `
      INSERT INTO nld_history (generation, opponent, wins, draws, losses)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING *
      `,
      [generation, opponent, wins, draws, losses]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error("Add history error:", error);
    res.status(500).json({ error: "Database error" });
  }
});

io.on("connection", socket => {
  let teamKey = normalizeTeamKey(socket.handshake.query?.team);
  const role = String(socket.handshake.query?.role || "control");
  const isViewer = role === "viewer";

  if (role === "landing") {
    socket.emit("viewerCounts", { ...viewerCounts });
    return;
  }

  socket.join(teamKey);
  socket.emit("state", currentState(teamKey));

  if (isViewer) {
    viewerCounts[teamKey] = (viewerCounts[teamKey] || 0) + 1;
    io.to(teamKey).emit("viewerCount", viewerCounts[teamKey]);
    emitViewerCounts();
  }

  socket.on("selectTeam", requestedTeam => {
    const nextTeam = normalizeTeamKey(requestedTeam);
    if (nextTeam === teamKey) {
      socket.emit("state", currentState(teamKey));
      return;
    }

    if (isViewer) {
      viewerCounts[teamKey] = Math.max(0, (viewerCounts[teamKey] || 0) - 1);
      io.to(teamKey).emit("viewerCount", viewerCounts[teamKey]);
    }
    socket.leave(teamKey);
    teamKey = nextTeam;
    socket.join(teamKey);
    if (isViewer) {
      viewerCounts[teamKey] = (viewerCounts[teamKey] || 0) + 1;
      io.to(teamKey).emit("viewerCount", viewerCounts[teamKey]);
      emitViewerCounts();
    }
    socket.emit("state", currentState(teamKey));
  });

  socket.on("disconnect", () => {
    if (!isViewer) return;
    viewerCounts[teamKey] = Math.max(0, (viewerCounts[teamKey] || 0) - 1);
    io.to(teamKey).emit("viewerCount", viewerCounts[teamKey]);
    emitViewerCounts();
  });
});

setInterval(() => {
  for (const teamKey of TEAM_KEYS) {
    if (getState(teamKey).running) {
      broadcast(teamKey);
    }
  }
}, 1000);

async function startServer() {
  try {
    await initDatabase();

    server.listen(PORT, () => {
      console.log(`Rugby Live Score running on port \${PORT}`);
    });
  } catch (error) {
    console.error("Could not start Rugby Live Score:", error);
    process.exit(1);
  }
}

startServer();

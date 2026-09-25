const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const crypto = require("crypto");
const { Pool } = require("pg");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";

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

function secretHash(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function makeControlPin() {
  return String(crypto.randomInt(100000, 1000000));
}

function makeSessionToken() {
  return crypto.randomBytes(32).toString("hex");
}

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
    Colts: 35,
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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS season_matches (
      id SERIAL PRIMARY KEY,
      team_key TEXT NOT NULL,
      home_name TEXT NOT NULL,
      away_name TEXT NOT NULL,
      home_score INTEGER NOT NULL DEFAULT 0,
      away_score INTEGER NOT NULL DEFAULT 0,
      match_type TEXT NOT NULL DEFAULT 'Friendly',
      status TEXT NOT NULL DEFAULT 'pending',
      played_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      confirmed_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS match_control_access (
      team_key TEXT PRIMARY KEY,
      pin_hash TEXT,
      session_hash TEXT,
      pin_used BOOLEAN NOT NULL DEFAULT FALSE,
      revoked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
  const { pin, controlToken, action, payload = {}, team } = req.body || {};
  const teamKey = normalizeTeamKey(team);

  let authorized = String(pin) === String(ADMIN_PIN);
  if (!authorized && controlToken) {
    const access = await pool.query(
      "SELECT 1 FROM match_control_access WHERE team_key = $1 AND session_hash = $2 AND pin_used = TRUE AND revoked = FALSE",
      [teamKey, secretHash(controlToken)]
    );
    authorized = access.rowCount === 1;
  }
  if (!authorized) return res.status(401).json({ error: "Access expired or incorrect PIN" });

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

      case "stopLive":
        selectedState.matchLive = false;
        break;

      case "endMatch":
        await pool.query(
          `INSERT INTO season_matches (team_key,home_name,away_name,home_score,away_score,match_type,status)
           VALUES ($1,$2,$3,$4,$5,$6,'pending')`,
          [teamKey, selectedState.homeName, selectedState.awayName, selectedState.homeScore, selectedState.awayScore, selectedState.matchType]
        );
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
          matchLive: false,
          message: "No match in progress"
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
    if (action === "endMatch" && controlToken) {
      await pool.query("UPDATE match_control_access SET revoked=TRUE, session_hash=NULL WHERE team_key=$1", [teamKey]);
    }
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

app.post("/api/match-control/generate", async (req, res) => {
  const { pin, team } = req.body || {};
  if (String(pin) !== String(ADMIN_PIN)) return res.status(401).json({ error: "Incorrect Admin PIN" });
  const teamKey = normalizeTeamKey(team);
  const controlPin = makeControlPin();
  await pool.query(
    `INSERT INTO match_control_access (team_key, pin_hash, session_hash, pin_used, revoked, created_at)
     VALUES ($1,$2,NULL,FALSE,FALSE,NOW())
     ON CONFLICT (team_key) DO UPDATE SET pin_hash=EXCLUDED.pin_hash, session_hash=NULL, pin_used=FALSE, revoked=FALSE, created_at=NOW()`,
    [teamKey, secretHash(controlPin)]
  );
  res.json({ ok:true, team:teamKey, controlPin });
});

app.post("/api/match-control/verify", async (req, res) => {
  const { controlPin } = req.body || {};
  const pinHash = secretHash(controlPin || "");
  const found = await pool.query(
    "SELECT team_key FROM match_control_access WHERE pin_hash=$1 AND pin_used=FALSE AND revoked=FALSE",
    [pinHash]
  );
  if (found.rowCount !== 1) return res.status(401).json({ error:"PIN is incorrect, expired or already used" });
  const teamKey = found.rows[0].team_key;
  const token = makeSessionToken();
  const used = await pool.query(
    "UPDATE match_control_access SET pin_used=TRUE, session_hash=$1 WHERE team_key=$2 AND pin_hash=$3 AND pin_used=FALSE AND revoked=FALSE RETURNING team_key",
    [secretHash(token), teamKey, pinHash]
  );
  if (used.rowCount !== 1) return res.status(401).json({ error:"PIN already used" });
  res.json({ ok:true, team:teamKey, controlToken:token });
});

app.post("/api/match-control/revoke", async (req, res) => {
  const { pin, team } = req.body || {};
  if (String(pin) !== String(ADMIN_PIN)) return res.status(401).json({ error:"Incorrect Admin PIN" });
  const teamKey = normalizeTeamKey(team);
  await pool.query("UPDATE match_control_access SET revoked=TRUE, session_hash=NULL WHERE team_key=$1", [teamKey]);
  res.json({ ok:true, team:teamKey });
});

app.get("/api/season-stats", async (req, res) => {
  try {
    const teamKey = normalizeTeamKey(req.query.team);
    const result = await pool.query(
      "SELECT * FROM season_matches WHERE team_key=$1 AND status='confirmed' ORDER BY played_at DESC, id DESC",
      [teamKey]
    );
    let wins=0, draws=0, losses=0, pointsFor=0, pointsAgainst=0;
    const matches=result.rows.map(m => {
      const sleafordHome = String(m.home_name).toLowerCase().includes('sleaford');
      const pf = sleafordHome ? m.home_score : m.away_score;
      const pa = sleafordHome ? m.away_score : m.home_score;
      const opponent = sleafordHome ? m.away_name : m.home_name;
      pointsFor += pf; pointsAgainst += pa;
      const outcome = pf > pa ? 'W' : pf < pa ? 'L' : 'D';
      if(outcome==='W') wins++; else if(outcome==='D') draws++; else losses++;
      return {...m, opponent, pointsFor:pf, pointsAgainst:pa, outcome};
    });
    res.json({team:teamKey, played:matches.length, wins, draws, losses, pointsFor, pointsAgainst, matches});
  } catch(error) { console.error("Season stats error:",error); res.status(500).json({error:"Database error"}); }
});

app.get("/api/pending-results", async (req,res) => {
  if (String(req.query.pin) !== String(ADMIN_PIN)) return res.status(401).json({error:"Incorrect Admin PIN"});
  const teamKey=normalizeTeamKey(req.query.team);
  const result=await pool.query("SELECT * FROM season_matches WHERE team_key=$1 AND status='pending' ORDER BY played_at DESC,id DESC",[teamKey]);
  res.json(result.rows);
});

app.post("/api/results/confirm", async (req,res) => {
  if (String(req.body?.pin) !== String(ADMIN_PIN)) return res.status(401).json({error:"Incorrect Admin PIN"});
  const id=Number(req.body?.id);
  const result=await pool.query("UPDATE season_matches SET status='confirmed', confirmed_at=NOW() WHERE id=$1 AND status='pending' RETURNING *",[id]);
  if(!result.rowCount) return res.status(404).json({error:"Pending result not found"});
  res.json(result.rows[0]);
});

app.post("/api/results/edit", async (req,res) => {
  if (String(req.body?.pin) !== String(ADMIN_PIN)) return res.status(401).json({error:"Incorrect Admin PIN"});
  const {id,homeName,awayName,homeScore,awayScore,matchType}=req.body||{};
  const result=await pool.query(`UPDATE season_matches SET home_name=$2,away_name=$3,home_score=$4,away_score=$5,match_type=$6 WHERE id=$1 RETURNING *`,
    [Number(id),String(homeName||'').trim(),String(awayName||'').trim(),Math.max(0,Number(homeScore)||0),Math.max(0,Number(awayScore)||0),String(matchType||'Friendly')]);
  if(!result.rowCount) return res.status(404).json({error:"Result not found"});
  res.json(result.rows[0]);
});

app.post("/api/results/undo", async (req,res) => {
  if (String(req.body?.pin) !== String(ADMIN_PIN)) return res.status(401).json({error:"Incorrect Admin PIN"});
  const result=await pool.query("UPDATE season_matches SET status='pending',confirmed_at=NULL WHERE id=$1 RETURNING *",[Number(req.body?.id)]);
  if(!result.rowCount) return res.status(404).json({error:"Result not found"});
  res.json(result.rows[0]);
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

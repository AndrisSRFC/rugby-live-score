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

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

const defaultState = {
  homeName: "Team 1",
  awayName: "Team 2",
  homeScore: 0,
  awayScore: 0,
  half: 1,

  // Rugby clock counts UP.
  // 1st Half starts at 00:00.
  // 2nd Half starts at 40:00.
  elapsedSeconds: 0,
  running: false,
  startedAt: null,

  matchLive: false,
  message: "No match in progress",
  ageGroup: "U13",
  matchType: "Friendly",
  nextLive: null
};

let state = { ...defaultState };

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
    "SELECT data FROM rugby_state WHERE id = 1"
  );

  if (result.rows.length > 0) {
    state = {
      ...defaultState,
      ...result.rows[0].data
    };
    console.log("Saved match state loaded from database");
  } else {
    await saveState();
    console.log("New match state created in database");
  }
}

async function saveState() {
  await pool.query(
    `
    INSERT INTO rugby_state (id, data)
    VALUES (1, $1::jsonb)
    ON CONFLICT (id)
    DO UPDATE SET data = EXCLUDED.data
    `,
    [JSON.stringify(state)]
  );
}

function currentState() {
  const copy = { ...state };

  if (copy.running && copy.startedAt) {
    const elapsedSinceStart = Math.floor(
      (Date.now() - copy.startedAt) / 1000
    );

    copy.elapsedSeconds =
      copy.elapsedSeconds + elapsedSinceStart;
  }

  copy.remainingSeconds = copy.elapsedSeconds;
  return copy;
}

function commitClock() {
  state = currentState();
  state.startedAt = null;
  if (state.running) state.startedAt = Date.now();
}

function broadcast() {
  io.emit("state", currentState());
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/state", (req, res) => {
  res.json(currentState());
});

app.post("/api/admin", async (req, res) => {
  const { pin, action, payload = {} } = req.body || {};

  if (String(pin) !== String(ADMIN_PIN)) {
    return res.status(401).json({ error: "Incorrect PIN" });
  }

  try {
    commitClock();

    switch (action) {
      case "score":
        if (payload.team === "home") {
          state.homeScore = Math.max(
            0,
            state.homeScore + Number(payload.delta || 0)
          );
        }

        if (payload.team === "away") {
          state.awayScore = Math.max(
            0,
            state.awayScore + Number(payload.delta || 0)
          );
        }
        break;

      case "setNames":
        if (typeof payload.homeName === "string") {
          state.homeName =
            payload.homeName.trim() || "Team 1";
        }

        if (typeof payload.awayName === "string") {
          state.awayName =
            payload.awayName.trim() || "Team 2";
        }
        break;

      case "toggleClock":
        if (state.running) {
          state.running = false;
          state.startedAt = null;
        } else {
          state.running = true;
          state.startedAt = Date.now();
        }
        break;

      case "resetClock":
        state.running = false;
        state.startedAt = null;
        state.elapsedSeconds =
          state.elapsedSeconds =
  state.half === 2
    ? ({ U13:25, U14:25, U15:30, U16:35, Colts:40, "1st XV":40, "2nd XV":40 }[state.ageGroup] || 40) * 60
    : 0;
        break;

      case "setClock":
        state.running = false;
        state.startedAt = null;
        state.elapsedSeconds = Math.max(
          0,
          Number(payload.seconds || 0)
        );
        break;

      case "setHalf":
        state.running = false;
        state.startedAt = null;

        if (Number(payload.half) === 2) {
          state.half = 2;
          state.elapsedSeconds = ({ U13:25, U14:25, U15:30, U16:35, Colts:40, "1st XV":40, "2nd XV":40 }[state.ageGroup] || 40) * 60;
        } else {
          state.half = 1;
          state.elapsedSeconds = 0;
        }
        break;
        case "setAgeGroup":
  state.ageGroup = String(payload.ageGroup || "U13");
  break;
        case "setMatchType":
  state.matchType = String(payload.matchType || "Friendly");
  break;

      case "startMatch":
        state.matchLive = true;
        state.message = "";
        break;

      case "endMatch":
        state.matchLive = false;
        state.running = false;
        state.startedAt = null;
        state.message = "Full Time";
        break;

      case "newMatch":
        state = {
          ...defaultState,
          homeName:
            payload.homeName?.trim() || "Team 1",
          awayName:
            payload.awayName?.trim() || "Team 2",
          matchLive: true,
          message: ""
        };
        break;
case "setNextLive":
  state.nextLive = String(payload.nextLive || "").trim();
        state.nextHome = String(payload.nextHome || "").trim();
        state.nextAway = String(payload.nextAway || "").trim();
        state.nextAge = String(payload.nextAge || "").trim();
        state.nextType = String(payload.nextType || "").trim();
  break;
      default:
        return res
          .status(400)
          .json({ error: "Unknown action" });
    }

    await saveState();
    broadcast();

    res.json({
      ok: true,
      state: currentState()
    });
  } catch (error) {
    console.error("Admin action error:", error);

    res.status(500).json({
      error: "Database error"
    });
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
io.on("connection", (socket) => {
  socket.emit("state", currentState());
});

setInterval(() => {
  if (state.running) {
    broadcast();
  }
}, 1000);

async function startServer() {
  try {
    await initDatabase();

    server.listen(PORT, () => {
      console.log(
        `Rugby Live Score running on port ${PORT}`
      );
    });
  } catch (error) {
    console.error(
      "Could not start Rugby Live Score:",
      error
    );
    process.exit(1);
  }
}

startServer();

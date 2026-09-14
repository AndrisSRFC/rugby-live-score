const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PIN = process.env.ADMIN_PIN || "1234";

let state = {
  homeName: "Team 1",
  awayName: "Team 2",
  homeScore: 0,
  awayScore: 0,
  half: 1,
  durationSeconds: 40 * 60,
  remainingSeconds: 40 * 60,
  running: false,
  startedAt: null,
  matchLive: false,
  message: "No match in progress"
};

function currentState() {
  const copy = { ...state };
  if (copy.running && copy.startedAt) {
    const elapsed = Math.floor((Date.now() - copy.startedAt) / 1000);
    copy.remainingSeconds = Math.max(0, copy.remainingSeconds - elapsed);
    if (copy.remainingSeconds === 0) {
      copy.running = false;
      copy.startedAt = null;
    }
  }
  return copy;
}

function commitClock() {
  state = currentState();
}

function broadcast() {
  io.emit("state", currentState());
}

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/state", (req, res) => res.json(currentState()));

app.post("/api/admin", (req, res) => {
  const { pin, action, payload = {} } = req.body || {};
  if (String(pin) !== String(ADMIN_PIN)) {
    return res.status(401).json({ error: "Incorrect PIN" });
  }

  commitClock();

  switch (action) {
    case "score":
      if (payload.team === "home") state.homeScore = Math.max(0, state.homeScore + Number(payload.delta || 0));
      if (payload.team === "away") state.awayScore = Math.max(0, state.awayScore + Number(payload.delta || 0));
      break;
    case "setNames":
      if (typeof payload.homeName === "string") state.homeName = payload.homeName.trim() || "Team 1";
      if (typeof payload.awayName === "string") state.awayName = payload.awayName.trim() || "Team 2";
      break;
    case "toggleClock":
      if (state.running) {
        state.running = false;
        state.startedAt = null;
      } else if (state.remainingSeconds > 0) {
        state.running = true;
        state.startedAt = Date.now();
      }
      break;
    case "resetClock":
      state.running = false;
      state.startedAt = null;
      state.remainingSeconds = state.durationSeconds;
      break;
    case "setClock":
      state.running = false;
      state.startedAt = null;
      state.remainingSeconds = Math.max(0, Number(payload.seconds || 0));
      break;
    case "setHalf":
      state.half = Number(payload.half) === 2 ? 2 : 1;
      break;
    case "startMatch":
      state.matchLive = true;
      state.message = "";
      break;
    case "endMatch":
      state.matchLive = false;
      state.running = false;
      state.startedAt = null;
      state.message = payload.message || "Full Time";
      break;
    case "newMatch":
      state = {
        ...state,
        homeName: payload.homeName?.trim() || "Team 1",
        awayName: payload.awayName?.trim() || "Team 2",
        homeScore: 0,
        awayScore: 0,
        half: 1,
        remainingSeconds: state.durationSeconds,
        running: false,
        startedAt: null,
        matchLive: true,
        message: ""
      };
      break;
    default:
      return res.status(400).json({ error: "Unknown action" });
  }

  broadcast();
  res.json({ ok: true, state: currentState() });
});

io.on("connection", (socket) => {
  socket.emit("state", currentState());
});

setInterval(() => {
  if (state.running) broadcast();
}, 1000);

server.listen(PORT, () => {
  console.log(`Rugby Live Score running on port ${PORT}`);
});

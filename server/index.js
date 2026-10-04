require("dotenv").config();
const express = require("express");
const cors = require("cors");
const crypto = require("crypto");
const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const app = express();
app.use(cors({ origin: process.env.CLIENT_URL || "*" }));
app.use(express.json());

// ---------- Models ----------
const User = mongoose.model("User", new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  email: { type: String, unique: true, sparse: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  verified: { type: Boolean, default: false },
  otpHash: String,
  otpExpires: Date,
  otpAttempts: { type: Number, default: 0 },
  otpSentAt: Date,
}));

const Job = mongoose.model("Job", new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  company: { type: String, required: true },
  role: { type: String, required: true },
  status: { type: String, enum: ["Applied", "Interview", "Offer", "Rejected"], default: "Applied" },
  link: String,
  notes: String,
  appliedOn: { type: Date, default: Date.now },
}));
function getBrevoKey() {
  const raw = (process.env.BREVO_API_KEY || "").trim();
  if (raw.startsWith("eyJ")) {
    try {
      return JSON.parse(Buffer.from(raw, "base64").toString("utf8")).api_key;
    } catch {}
  }
  return raw;
}
// ---------- Email OTP helpers ----------
async function sendOtpEmail(to, otp) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": getBrevoKey(),
      "Content-Type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      sender: { name: "Job Tracker", email: process.env.SENDER_EMAIL },
      to: [{ email: to }],
      subject: "Your Job Tracker verification code",
      htmlContent: `<p>Your verification code is:</p>
        <h2 style="letter-spacing:4px">${otp}</h2>
        <p>It expires in 10 minutes. If you didn't request this, ignore this email.</p>`,
    }),
  });
  if (!res.ok) throw new Error("Email failed: " + (await res.text()));
}

async function issueOtp(user) {
  const otp = String(crypto.randomInt(100000, 1000000));
  user.otpHash = await bcrypt.hash(otp, 8);
  user.otpExpires = new Date(Date.now() + 10 * 60 * 1000);
  user.otpAttempts = 0;
  user.otpSentAt = new Date();
  await user.save();
  await sendOtpEmail(user.email, otp);
}

const cleanEmail = (e) => String(e || "").trim().toLowerCase();

// ---------- Auth middleware ----------
const auth = (req, res, next) => {
  try {
    const token = (req.headers.authorization || "").replace("Bearer ", "");
    req.userId = jwt.verify(token, process.env.JWT_SECRET).id;
    next();
  } catch {
    res.status(401).json({ error: "Unauthorized" });
  }
};

// ---------- Auth routes ----------
app.get("/", (req, res) => res.send("Job tracker API running"));

app.post("/api/register", async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const email = cleanEmail(req.body.email);
    const password = String(req.body.password || "");

    if (!username || !email || !password) return res.status(400).json({ error: "Fill all fields" });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid email" });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });

    // old unverified signups can be replaced
    await User.deleteMany({ verified: { $ne: true }, $or: [{ email }, { username }] });
    const clash = await User.findOne({ $or: [{ email }, { username }] });
    if (clash) return res.status(400).json({ error: "Username or email already registered" });

    const user = await User.create({ username, email, password: await bcrypt.hash(password, 10) });
    try {
      await issueOtp(user);
    } catch (e) {
      console.error(e.message);
      return res.status(500).json({ error: "Could not send verification email. Try again." });
    }
    res.json({ ok: true });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/verify-otp", async (req, res) => {
  const email = cleanEmail(req.body.email);
  const otp = String(req.body.otp || "").trim();
  const user = await User.findOne({ email });

  if (!user || !user.otpHash) return res.status(400).json({ error: "Invalid or expired code" });
  if (user.otpExpires < new Date()) return res.status(400).json({ error: "Code expired. Click resend." });
  if (user.otpAttempts >= 5) return res.status(429).json({ error: "Too many tries. Click resend for a new code." });

  if (!(await bcrypt.compare(otp, user.otpHash))) {
    user.otpAttempts += 1;
    await user.save();
    return res.status(400).json({ error: "Wrong code" });
  }

  user.verified = true;
  user.otpHash = undefined;
  user.otpExpires = undefined;
  user.otpAttempts = 0;
  await user.save();
  res.json({ ok: true });
});

app.post("/api/resend-otp", async (req, res) => {
  const user = await User.findOne({ email: cleanEmail(req.body.email) });
  if (!user || user.verified) return res.json({ ok: true });
  if (user.otpSentAt && Date.now() - user.otpSentAt.getTime() < 30000)
    return res.status(429).json({ error: "Wait 30 seconds before resending" });
  try {
    await issueOtp(user);
    res.json({ ok: true });
  } catch (e) {
    console.error(e.message);
    res.status(500).json({ error: "Could not send email" });
  }
});

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user || !(await bcrypt.compare(password || "", user.password)))
    return res.status(401).json({ error: "Invalid username or password" });
  if (!user.verified) return res.status(403).json({ error: "Please verify your email first" });
  const token = jwt.sign({ id: user._id }, process.env.JWT_SECRET, { expiresIn: "7d" });
  res.json({ token, username });
});

// ---------- Job routes (all private) ----------
app.get("/api/jobs", auth, async (req, res) => {
  const jobs = await Job.find({ user: req.userId }).sort({ appliedOn: -1 });
  res.json(jobs);
});

app.post("/api/jobs", auth, async (req, res) => {
  try {
    const job = await Job.create({ ...req.body, user: req.userId });
    res.json(job);
  } catch (e) {
    res.status(400).json({ error: "Company and role are required" });
  }
});

app.put("/api/jobs/:id", auth, async (req, res) => {
  const job = await Job.findOneAndUpdate(
    { _id: req.params.id, user: req.userId },
    req.body,
    { new: true }
  );
  if (!job) return res.status(404).json({ error: "Not found" });
  res.json(job);
});

app.delete("/api/jobs/:id", auth, async (req, res) => {
  await Job.findOneAndDelete({ _id: req.params.id, user: req.userId });
  res.json({ ok: true });
});

// ---------- Start ----------
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => {
    console.log("MongoDB connected");
    app.listen(process.env.PORT || 5000, () => console.log("Server running"));
  })
  .catch((e) => console.error("DB error:", e.message));
import { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

const API = import.meta.env.VITE_API_URL;
const STATUSES = ["Applied", "Interview", "Offer", "Rejected"];
const COLORS = { Applied: "#3b82f6", Interview: "#f59e0b", Offer: "#10b981", Rejected: "#ef4444" };

async function api(path, token, method = "GET", body) {
  const res = await fetch(`${API}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Something went wrong");
  return data;
}

function Login({ onAuth }) {
  const [mode, setMode] = useState("login"); // login | register | verify
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [busy, setBusy] = useState(false);

  const go = (m) => { setMode(m); setError(""); setInfo(""); };

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setInfo("");
    setBusy(true);
    try {
      if (mode === "register") {
        await api("/register", null, "POST", { username, email, password });
        setMode("verify");
        setInfo(`We sent a 6-digit code to ${email}. Check your inbox (and spam).`);
      } else if (mode === "verify") {
        await api("/verify-otp", null, "POST", { email, otp });
        setOtp("");
        setMode("login");
        setInfo("Email verified! You can login now.");
      } else {
        const data = await api("/login", null, "POST", { username, password });
        localStorage.setItem("auth", JSON.stringify(data));
        onAuth(data);
      }
    } catch (err) {
      setError(err.message === "Failed to fetch" ? "Cannot reach server. Is the backend running?" : err.message);
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    setError("");
    setInfo("");
    try {
      await api("/resend-otp", null, "POST", { email });
      setInfo("A new code was sent.");
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <form className="login" onSubmit={submit}>
      <h2>📋 Job Tracker</h2>
      <p className="muted">
        {mode === "login" && "Login to continue"}
        {mode === "register" && "Create your account"}
        {mode === "verify" && "Verify your email"}
      </p>

      {mode !== "verify" && (
        <input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
      )}
      {mode !== "login" && (
        <input type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
      )}
      {mode !== "verify" && (
        <input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
      )}
      {mode === "verify" && (
        <input placeholder="6-digit code" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value)} />
      )}

      {error && <p className="error">{error}</p>}
      {info && <p className="success">{info}</p>}

      <button type="submit" disabled={busy}>
        {busy ? "Please wait..." : mode === "login" ? "Login" : mode === "register" ? "Send code" : "Verify"}
      </button>

      {mode === "verify" && <p className="link" onClick={resend}>Resend code</p>}
      {mode === "login" && <p className="link" onClick={() => go("register")}>New here? Register</p>}
      {mode === "login" && <p className="link" onClick={() => go("verify")}>Have a code? Verify email</p>}
      {mode !== "login" && <p className="link" onClick={() => go("login")}>Back to login</p>}
    </form>
  );
}

function Dashboard({ auth, onLogout }) {
  const [jobs, setJobs] = useState([]);
  const [filter, setFilter] = useState("All");
  const [form, setForm] = useState({ company: "", role: "", status: "Applied", link: "", notes: "" });
  const [error, setError] = useState("");

  const handle = (err) => (err.message === "Unauthorized" ? onLogout() : setError(err.message));

  const load = () => api("/jobs", auth.token).then(setJobs).catch(handle);
  useEffect(() => { load(); }, []);

  const addJob = async (e) => {
    e.preventDefault();
    setError("");
    try {
      const job = await api("/jobs", auth.token, "POST", form);
      setJobs([job, ...jobs]);
      setForm({ company: "", role: "", status: "Applied", link: "", notes: "" });
    } catch (err) { handle(err); }
  };

  const updateStatus = async (id, status) => {
    try {
      const updated = await api(`/jobs/${id}`, auth.token, "PUT", { status });
      setJobs(jobs.map((j) => (j._id === id ? updated : j)));
    } catch (err) { handle(err); }
  };

  const remove = async (id) => {
    if (!confirm("Delete this application?")) return;
    try {
      await api(`/jobs/${id}`, auth.token, "DELETE");
      setJobs(jobs.filter((j) => j._id !== id));
    } catch (err) { handle(err); }
  };

  const chartData = STATUSES.map((s) => ({ status: s, count: jobs.filter((j) => j.status === s).length }));
  const shown = filter === "All" ? jobs : jobs.filter((j) => j.status === filter);

  return (
    <div className="page">
      <header>
        <h2>📋 Job Tracker</h2>
        <div>
          <span className="muted">Hi, {auth.username} </span>
          <button className="small" onClick={onLogout}>Logout</button>
        </div>
      </header>

      <section className="cards">
        <div className="card"><b>{jobs.length}</b><span>Total</span></div>
        {STATUSES.map((s) => (
          <div key={s} className="card" style={{ borderTop: `4px solid ${COLORS[s]}` }}>
            <b>{chartData.find((c) => c.status === s).count}</b><span>{s}</span>
          </div>
        ))}
      </section>

      <section className="panel">
        <h3>Applications by status</h3>
        <ResponsiveContainer width="100%" height={220}>
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="status" />
            <YAxis allowDecimals={false} />
            <Tooltip />
            <Bar dataKey="count" fill="#4f46e5" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </section>

      <section className="panel">
        <h3>Add application</h3>
        <form className="addform" onSubmit={addJob}>
          <input placeholder="Company *" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          <input placeholder="Role *" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })} />
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
          <input placeholder="Job link (optional)" value={form.link} onChange={(e) => setForm({ ...form, link: e.target.value })} />
          <input placeholder="Notes (optional)" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <button type="submit">Add</button>
        </form>
        {error && <p className="error">{error}</p>}
      </section>

      <section className="panel">
        <div className="listhead">
          <h3>Your applications</h3>
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option>All</option>
            {STATUSES.map((s) => <option key={s}>{s}</option>)}
          </select>
        </div>
        {shown.length === 0 && <p className="muted">No applications yet.</p>}
        {shown.map((j) => (
          <div key={j._id} className="job">
            <div>
              <b>{j.role}</b> at {j.company}
              <div className="muted small-text">
                {new Date(j.appliedOn).toLocaleDateString()}
                {j.notes && ` · ${j.notes}`}
                {j.link && <> · <a href={j.link} target="_blank" rel="noreferrer">Link</a></>}
              </div>
            </div>
            <div className="actions">
              <select value={j.status} style={{ borderColor: COLORS[j.status] }} onChange={(e) => updateStatus(j._id, e.target.value)}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
              <button className="danger small" onClick={() => remove(j._id)}>Delete</button>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}

export default function App() {
  const [auth, setAuth] = useState(() => JSON.parse(localStorage.getItem("auth") || "null"));
  const logout = () => { localStorage.removeItem("auth"); setAuth(null); };
  return auth ? <Dashboard auth={auth} onLogout={logout} /> : <Login onAuth={setAuth} />;
}
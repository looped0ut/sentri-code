import sqlite3, json, random, subprocess, sys, tempfile, os, time
from flask import Flask, request, jsonify, send_from_directory

app = Flask(__name__, static_folder="static", static_url_path="/static")
DB = "exam.db"
now = time.time

def db():
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row; return c

def init():
    c = db()
    c.executescript("""
    CREATE TABLE IF NOT EXISTS exams(code TEXT PRIMARY KEY,title TEXT,duration INTEGER,question TEXT,sample_in TEXT,sample_out TEXT,tests TEXT,status TEXT,started_at REAL);
    CREATE TABLE IF NOT EXISTS sessions(id INTEGER PRIMARY KEY AUTOINCREMENT,exam_code TEXT,name TEXT,joined_at REAL,submitted_at REAL,status TEXT,score INTEGER,total INTEGER,results TEXT,code TEXT,review TEXT);
    CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,session_id INTEGER,ts REAL,type TEXT,info TEXT);
    """); c.commit()

def add(c, sid, typ, info="", ts=None):
    c.execute("INSERT INTO events(session_id,ts,type,info) VALUES(?,?,?,?)", (sid, ts or now(), typ, json.dumps(info)))

def get_exam(c, code): return c.execute("SELECT * FROM exams WHERE code=?", (code,)).fetchone()
def remaining(e, s):
    if e["status"] == "ENDED": return 0
    return max(0, int(e["duration"] * 60 - (now() - s["joined_at"])))

# DEMO ONLY: runs student code in a local subprocess with a 5s timeout. NOT a secure sandbox.
# Replace with Judge0 (sandboxed execution) in the next phase.
def run_code(code, inp):
    with tempfile.NamedTemporaryFile("w", suffix=".py", delete=False) as f:
        f.write(code); p = f.name
    try:
        r = subprocess.run([sys.executable, p], input=inp, capture_output=True, text=True, timeout=5)
        return r.stdout.strip(), r.returncode
    except subprocess.TimeoutExpired:
        return "TIMEOUT", 1
    finally:
        os.unlink(p)

@app.get("/student")
def student_page(): return send_from_directory("static", "student.html")
@app.get("/examiner")
def examiner_page(): return send_from_directory("static", "examiner.html")

@app.post("/api/exam/create")
def create():
    d = request.get_json(force=True); c = db()
    code = "PY" + str(random.randint(100, 999))
    while get_exam(c, code): code = "PY" + str(random.randint(100, 999))
    c.execute("INSERT INTO exams VALUES(?,?,?,?,?,?,?,?,?)",
              (code, d["title"], int(d["duration"]), d["question"], d["sample_in"], d["sample_out"], json.dumps(d["tests"]), "CREATED", None))
    c.commit(); return jsonify(code=code)

@app.post("/api/exam/<code>/start")
def start(code):
    c = db(); c.execute("UPDATE exams SET status='ACTIVE', started_at=? WHERE code=?", (now(), code)); c.commit()
    return jsonify(ok=True)

@app.post("/api/exam/<code>/end")
def end_exam(code):
    c = db(); c.execute("UPDATE exams SET status='ENDED' WHERE code=?", (code,)); c.commit()
    return jsonify(ok=True)

@app.get("/api/exam/<code>/overview")
def overview(code):
    c = db(); e = get_exam(c, code)
    if not e: return jsonify(error="Exam not found"), 404
    ss = c.execute("SELECT * FROM sessions WHERE exam_code=? ORDER BY id", (code,)).fetchall()
    status = e["status"]
    if status == "ACTIVE" and ss and all(s["status"] == "SUBMITTED" for s in ss): status = "FINISHED"
    return jsonify(title=e["title"], status=status, duration=e["duration"], joined=len(ss),
                   students=[dict(id=s["id"], name=s["name"], status=s["status"], score=s["score"], total=s["total"]) for s in ss])

@app.post("/api/join")
def join():
    d = request.get_json(force=True); code = d["code"].strip().upper(); name = d["name"].strip()
    c = db(); e = get_exam(c, code)
    if not name: return jsonify(error="Enter your name"), 400
    if not e: return jsonify(error="Invalid exam code"), 404
    if e["status"] == "ENDED": return jsonify(error="This exam has ended"), 400
    if e["status"] != "ACTIVE": return jsonify(error="Exam has not started yet"), 400
    s = c.execute("SELECT * FROM sessions WHERE exam_code=? AND name=?", (code, name)).fetchone()
    if s and s["status"] == "SUBMITTED": return jsonify(error="You have already submitted"), 400
    if not s:
        cur = c.execute("INSERT INTO sessions(exam_code,name,joined_at,status) VALUES(?,?,?,'IN_PROGRESS')", (code, name, now()))
        sid = cur.lastrowid; add(c, sid, "EXAM_STARTED"); c.commit()
        s = c.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
    return jsonify(session_id=s["id"], title=e["title"], question=e["question"], sample_in=e["sample_in"],
                   sample_out=e["sample_out"], remaining=remaining(e, s))

@app.post("/api/events")
def events():
    d = request.get_json(force=True); c = db()
    s = c.execute("SELECT * FROM sessions WHERE id=?", (d["session_id"],)).fetchone()
    if not s: return jsonify(error="No session"), 404
    for ev in d["events"]: add(c, s["id"], ev["type"], ev.get("info", ""), now() - float(ev.get("age", 0)))
    c.commit(); return jsonify(remaining=remaining(get_exam(c, s["exam_code"]), s))

@app.post("/api/submit")
def submit():
    d = request.get_json(force=True); c = db()
    s = c.execute("SELECT * FROM sessions WHERE id=?", (d["session_id"],)).fetchone()
    if not s: return jsonify(error="No session"), 404
    if s["status"] == "SUBMITTED": return jsonify(error="Already submitted"), 400
    e = get_exam(c, s["exam_code"]); res = []
    for t in json.loads(e["tests"]):
        out, rc = run_code(d["code"], t["input"] + "\n")
        res.append(rc == 0 and out == t["output"].strip())
    score = sum(res)
    c.execute("UPDATE sessions SET status='SUBMITTED',submitted_at=?,score=?,total=?,results=?,code=? WHERE id=?",
              (now(), score, len(res), json.dumps(res), d["code"], s["id"]))
    if d.get("expired"): add(c, s["id"], "TIME_EXPIRED")
    add(c, s["id"], "SUBMITTED", {"score": f"{score}/{len(res)}"}); c.commit()
    return jsonify(results=res, score=score, total=len(res))

@app.get("/api/session/<int:sid>")
def detail(sid):
    c = db(); s = c.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
    if not s: return jsonify(error="No session"), 404
    evs = c.execute("SELECT ts,type,info FROM events WHERE session_id=? ORDER BY ts, id", (sid,)).fetchall()
    st = dict(keys=0, edits=0, cursor=0, focus=0, paste=0, runs=0)
    for r in evs:
        t = r["type"]
        if t == "ACTIVITY":
            i = json.loads(r["info"]); st["keys"] += i.get("keys", 0); st["edits"] += i.get("edits", 0); st["cursor"] += i.get("cursor", 0)
        elif t == "FOCUS_LOST": st["focus"] += 1
        elif t == "PASTE_DETECTED": st["paste"] += 1
        elif t == "CODE_RUN": st["runs"] += 1
    reasons = [f"{st['focus']} focus change(s)", f"{st['paste']} paste event(s)",
               "normal editing activity" if st["keys"] > 0 else "no typing activity recorded"]
    indicator = "REQUIRES REVIEW" if (st["paste"] > 0 or st["focus"] >= 3) else "NO IMMEDIATE CONCERN"
    used = int((s["submitted_at"] or now()) - s["joined_at"])
    return jsonify(name=s["name"], status=s["status"], score=s["score"], total=s["total"],
                   results=json.loads(s["results"] or "[]"), code=s["code"] or "", time_used=used, stats=st,
                   warnings=st["focus"], reasons=reasons, indicator=indicator, review=s["review"],
                   events=[dict(ts=r["ts"], type=r["type"], info=r["info"]) for r in evs])

@app.post("/api/session/<int:sid>/review")
def review(sid):
    d = request.get_json(force=True); c = db()
    c.execute("UPDATE sessions SET review=? WHERE id=?", (d["decision"], sid)); c.commit()
    return jsonify(ok=True)

if __name__ == "__main__":
    init()
    app.run(host="0.0.0.0", port=5000, debug=False, threaded=True)
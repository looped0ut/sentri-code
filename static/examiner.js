const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
let CODE = localStorage.getItem("examCode") || "", SEL = null;
const post = (u,b)=>fetch(u,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(b||{})}).then(r=>r.json());
const mmss = s => String(Math.floor(s/60)).padStart(2,"0")+":"+String(s%60).padStart(2,"0");

$("createBtn").onclick = async ()=>{
  const tests = $("tests").value.split("###").filter(b=>b.includes("=>")).map(b=>{
    const [i,o] = b.split("=>"); return {input:i.trim(), output:o.trim()};
  });
  const r = await post("/api/exam/create", {title:$("title").value, duration:$("dur").value, question:$("q").value,
    sample_in:$("sin").value.trim(), sample_out:$("sout").value.trim(), tests});
  CODE = r.code; localStorage.setItem("examCode", CODE); SEL = null; $("detail").innerHTML = ""; poll();
};
$("startBtn").onclick = async ()=>{ await post(`/api/exam/${CODE}/start`); poll(); };

async function poll(){
  if(!CODE) return;
  const o = await fetch(`/api/exam/${CODE}/overview`).then(r=>r.json());
  if(o.error){ return; }
  $("status").classList.remove("hidden");
  $("sTitle").textContent = o.title.toUpperCase(); $("sCode").textContent = CODE;
  $("sStatus").textContent = o.status; $("sJoined").textContent = `${o.joined} students joined (${o.duration} min)`;
  $("rows").innerHTML = o.students.map(s=>`<tr class="row" onclick="SEL=${s.id};loadDetail()">
    <td>${esc(s.name)}</td><td>${s.status==="SUBMITTED"?"Submitted":"In progress"}</td>
    <td>${s.status==="SUBMITTED" ? s.score+" / "+s.total : "-"}</td></tr>`).join("");
  if(SEL) loadDetail();
}

function label(e){
  let i = {}; try{ i = JSON.parse(e.info) || {}; }catch(x){}
  switch(e.type){
    case "EXAM_STARTED": return "Exam started";
    case "ACTIVITY": return `Code edited (${i.keys||0} keystrokes, ${i.edits||0} edits)`;
    case "CODE_RUN": return "Code executed";
    case "RUN_COMPLETE": return "Execution completed" + (i.result ? ` (${i.result})` : "");
    case "FOCUS_LOST": return "Focus lost";
    case "FOCUS_RETURNED": return "Focus returned";
    case "PASTE_DETECTED": return `Paste detected (~${i.chars||0} characters)`;
    case "TIME_EXPIRED": return "Time expired (auto-submitted)";
    case "SUBMITTED": return "Submitted" + (i.score ? ` (${i.score})` : "");
    default: return e.type;
  }
}

async function loadDetail(){
  const d = await fetch(`/api/session/${SEL}`).then(r=>r.json()); if(d.error) return;
  const st = d.stats, rev = d.indicator==="REQUIRES REVIEW";
  const decision = d.review==="SAFE" ? "Examiner decision: MARKED SAFE" : d.review==="REVIEW" ? "Examiner decision: REVIEW REQUIRED" : "";
  $("detail").innerHTML = `<div class="card"><h3>STUDENT DETAILS</h3><table class="kv">
   <tr><td>Student</td><td><b>${esc(d.name)}</b></td></tr>
   <tr><td>Submission</td><td>${d.status==="SUBMITTED"?"Submitted":"In progress"}</td></tr>
   <tr><td>Time used</td><td>${mmss(d.time_used)}</td></tr>
   <tr><td>Test results</td><td>${d.status==="SUBMITTED" ? d.score+" / "+d.total : "-"}</td></tr>
   <tr><td>Code executions</td><td>${st.runs}</td></tr><tr><td>Keystrokes</td><td>${st.keys}</td></tr>
   <tr><td>Code edits</td><td>${st.edits}</td></tr><tr><td>Focus changes</td><td>${st.focus}</td></tr>
   <tr><td>Paste events</td><td>${st.paste}</td></tr><tr><td>Warnings</td><td>${d.warnings}</td></tr></table>
   <div>${d.results.map((p,i)=>`Test ${i+1} ${p?"✓":"✗"}`).join(" &nbsp; ")}</div></div>
   <div class="card"><h3>SUBMITTED CODE</h3><pre class="code">${esc(d.code)||"(not submitted yet)"}</pre></div>
   <div class="card"><h3>BEHAVIORAL EVENT TIMELINE</h3><pre class="code">${esc(d.events.map(e=>new Date(e.ts*1000).toLocaleTimeString()+"  "+label(e)).join("\n"))}</pre></div>
   <div class="card"><h3>INTEGRITY REVIEW</h3><p>Behavioral evidence:</p><ul>${d.reasons.map(r=>`<li>${esc(r)}</li>`).join("")}</ul>
   <p>System indicator: <b class="${rev?"rev":"ok"}">${d.indicator}</b></p>
   <p class="muted">Rule-based indicator for examiner review. It is not a finding of misconduct.</p>
   <button class="btn green" onclick="decide('SAFE')">MARK SAFE</button>
   <button class="btn" style="background:#b45309" onclick="decide('REVIEW')">REQUIRE REVIEW</button>
   <p><b>${decision}</b></p></div>`;
}
async function decide(x){ await post(`/api/session/${SEL}/review`, {decision:x}); loadDetail(); }
setInterval(poll, 2000); poll();
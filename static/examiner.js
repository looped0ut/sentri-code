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
  CODE = r.code; localStorage.setItem("examCode", CODE); SEL = null; $("detail").innerHTML = "";
  $("setup").classList.add("hidden"); poll();
};
$("startBtn").onclick = async ()=>{ $("startBtn").disabled = true; await post(`/api/exam/${CODE}/start`); poll(); };
$("endBtn").onclick = async ()=>{
  if(!confirm("End the exam for ALL students now? Their current code will be auto-submitted.")) return;
  await post(`/api/exam/${CODE}/end`); poll();
};
$("newBtn").onclick = ()=>{ localStorage.removeItem("examCode"); CODE = ""; SEL = null; $("detail").innerHTML = "";
  $("status").classList.add("hidden"); $("setup").classList.remove("hidden"); };

async function poll(){
  if(!CODE) return;
  const o = await fetch(`/api/exam/${CODE}/overview`).then(r=>r.json());
  if(o.error) return;
  $("setup").classList.add("hidden"); $("status").classList.remove("hidden");
  $("sTitle").textContent = o.title; $("sCode").textContent = CODE;
  $("sBadge").textContent = o.status; $("sBadge").className = "badge b-" + o.status;
  $("sJoined").textContent = `${o.joined} student(s) joined · ${o.duration} min`;
  const created = o.status === "CREATED", ended = o.status === "ENDED";
  $("startBtn").classList.toggle("hidden", !created); $("startBtn").disabled = false;
  $("endBtn").classList.toggle("hidden", created || ended);
  $("newBtn").classList.toggle("hidden", !ended);
  $("rows").innerHTML = o.students.map(s=>`<tr class="row" onclick="SEL=${s.id};loadDetail()">
    <td>${esc(s.name)}</td><td>${s.status==="SUBMITTED"?"Submitted":"In progress"}</td>
    <td>${s.status==="SUBMITTED" ? s.score+" / "+s.total : "-"}</td></tr>`).join("") || `<tr><td colspan="3" class="muted">No students yet</td></tr>`;
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
    case "TIME_EXPIRED": return "Time expired / exam ended (auto-submitted)";
    case "SUBMITTED": return "Submitted" + (i.score ? ` (${i.score})` : "");
    default: return e.type;
  }
}

async function loadDetail(){
  const d = await fetch(`/api/session/${SEL}`).then(r=>r.json()); if(d.error) return;
  const st = d.stats, rev = d.indicator==="REQUIRES REVIEW";
  const decision = d.review==="SAFE" ? "Examiner decision: MARKED SAFE" : d.review==="REVIEW" ? "Examiner decision: REVIEW REQUIRED" : "";
  const kv = (a,b)=>`<tr><td>${a}</td><td>${b}</td></tr>`;
  $("detail").innerHTML = `<div class="grid"><div class="card"><h3>Student details</h3><table class="kv">
   ${kv("Student",esc(d.name))}${kv("Submission",d.status==="SUBMITTED"?"Submitted":"In progress")}
   ${kv("Time used",mmss(d.time_used))}${kv("Test results",d.status==="SUBMITTED"?d.score+" / "+d.total:"-")}
   ${kv("Code executions",st.runs)}${kv("Keystrokes",st.keys)}${kv("Code edits",st.edits)}
   ${kv("Focus changes",st.focus)}${kv("Paste events",st.paste)}${kv("Warnings",d.warnings)}</table>
   <p>${d.results.map((p,i)=>`Test ${i+1} ${p?"✓":"✗"}`).join(" &nbsp; ")}</p></div>
   <div class="card"><h3>Integrity review</h3><p class="muted">Behavioral evidence:</p><ul>${d.reasons.map(r=>`<li>${esc(r)}</li>`).join("")}</ul>
   <p>System indicator: <b class="${rev?"rev":"ok"}">${d.indicator}</b></p>
   <p class="muted">Rule-based indicator for examiner review. It is not a finding of misconduct.</p>
   <button class="btn green" onclick="decide('SAFE')">MARK SAFE</button>
   <button class="btn amber" onclick="decide('REVIEW')">REQUIRE REVIEW</button><p><b>${decision}</b></p></div></div>
   <div class="card"><h3>Submitted code</h3><pre class="code">${esc(d.code)||"(not submitted yet)"}</pre></div>
   <div class="card"><h3>Behavioral event timeline</h3><pre class="code">${esc(d.events.map(e=>new Date(e.ts*1000).toLocaleTimeString()+"  "+label(e)).join("\n"))}</pre></div>`;
}
async function decide(x){ await post(`/api/session/${SEL}/review`, {decision:x}); loadDetail(); }
setInterval(poll, 2000); poll();
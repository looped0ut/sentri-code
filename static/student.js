const $ = id => document.getElementById(id);
const REFS = [
 {n:"print()",d:"Displays output on the screen.",s:"print(value, ...)",e:'print("Hello")'},
 {n:"input()",d:"Reads a line of text typed by the user.",s:"input(prompt)",e:'name = input("Name: ")'},
 {n:"len()",d:"Returns the number of items in a list or characters in a string.",s:"len(object)",e:"len([1,2,3])  # 3"},
 {n:"range()",d:"Generates a sequence of numbers, mostly used in for loops.",s:"range(start, stop, step)",e:"for i in range(5): print(i)"},
 {n:"append()",d:"Adds an element to the end of a list.",s:"list.append(element)",e:"numbers.append(10)"},
 {n:"pop()",d:"Removes and returns an element (last one by default).",s:"list.pop(index)",e:"numbers.pop()"},
 {n:"sort()",d:"Sorts a list in place (ascending by default).",s:"list.sort(reverse=False)",e:"numbers.sort()"},
 {n:"split()",d:"Splits a string into a list of words.",s:"string.split(separator)",e:'"a b c".split()'},
 {n:"replace()",d:"Returns a string with one part replaced by another.",s:"string.replace(old, new)",e:'"cat".replace("c","b")'},
 {n:"lower()",d:"Converts a string to lowercase.",s:"string.lower()",e:'"ABC".lower()'},
 {n:"upper()",d:"Converts a string to uppercase.",s:"string.upper()",e:'"abc".upper()'}
];
const SYNTAX = [
 {t:"if / else",c:"if x > 0:\n    print('positive')\nelse:\n    print('not positive')"},
 {t:"for loop",c:"for i in range(5):\n    print(i)"},
 {t:"while loop",c:"while x < 10:\n    x += 1"},
 {t:"Function definition",c:"def add(a, b):\n    return a + b"},
 {t:"List",c:"nums = [4, 8, 2]\nnums.append(9)"},
 {t:"String",c:"s = 'hello'\nprint(s.upper())"},
 {t:"Input / Output",c:"name = input('Name: ')\nprint('Hi', name)"}
];

let SID = null, EXAM = null, endAt = 0, done = false, away = false;
const C = {keys:0, edits:0, cursor:0, focus:0, runs:0, paste:0};
let buf = [], pk = 0, pe = 0, pc = 0;

function upd(){
  $("m-keys").textContent=C.keys; $("m-edits").textContent=C.edits; $("m-cursor").textContent=C.cursor;
  $("m-focus").textContent=C.focus; $("m-paste").textContent=C.paste; $("m-runs").textContent=C.runs;
  $("m-warn").textContent=C.focus; $("m-status").textContent = done ? "Submitted" : "Active";
}

// ---------- Server communication (events are buffered, sent every 3s) ----------
async function api(url, body){
  const r = await fetch(url, {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify(body)});
  return r.json();
}
function ev(type, info){ buf.push({type, info:info||"", ts:Date.now()}); }
async function flush(){
  if(!SID) return;
  if(pk||pe||pc){ buf.push({type:"ACTIVITY", info:{keys:pk, edits:pe, cursor:pc}, ts:Date.now()}); pk=pe=pc=0; }
  const send = buf.splice(0), t = Date.now();
  try{
    const r = await api("/api/events", {session_id:SID, events:send.map(e=>({type:e.type, info:e.info, age:(t-e.ts)/1000}))});
    if(r.remaining !== undefined) endAt = Date.now() + r.remaining*1000;   // server time is source of truth
  }catch(e){ buf = send.concat(buf); }
}
setInterval(flush, 3000);

// ---------- Editor ----------
const editor = CodeMirror.fromTextArea($("code"), {
  mode:"python", theme:"dracula", lineNumbers:true, indentUnit:4, tabSize:4, indentWithTabs:false,
  extraKeys:{Tab:cm=>cm.replaceSelection("    ")}
});
editor.on("keydown", ()=>{ if(!SID||done) return; C.keys++; pk++; upd(); });
editor.on("change", ()=>{ if(!SID||done) return; C.edits++; pe++; upd(); });
editor.on("cursorActivity", ()=>{ if(!SID||done) return; C.cursor++; pc++; upd(); });
editor.on("beforeChange", (cm, ch)=>{
  if(SID && !done && ch.origin === "paste"){
    const n = ch.text.join("\n").length; C.paste++; ev("PASTE_DETECTED", {chars:n}); upd();
  }
});

// ---------- Join ----------
$("joinBtn").onclick = async ()=>{
  const r = await api("/api/join", {name:$("jname").value, code:$("jcode").value});
  if(r.error){ $("jerr").textContent = r.error; return; }
  EXAM = r;
  $("examTitle").textContent = r.title; $("student").textContent = $("jname").value.trim();
  $("qtext").textContent = r.question; $("sin").textContent = r.sample_in; $("sout").textContent = r.sample_out;
  $("stdin").value = r.sample_in; $("output").textContent = "Loading Python engine...";
  editor.setValue("# Write your program below\nn = int(input())\n");
  editor.setCursor(editor.lineCount(), 0);
  endAt = Date.now() + r.remaining*1000; SID = r.session_id;
  $("join").classList.add("hidden"); editor.refresh(); upd();
};

// ---------- Timer ----------
setInterval(()=>{
  if(!SID || done) return;
  const left = Math.max(0, Math.round((endAt - Date.now())/1000));
  $("timer").textContent = String(Math.floor(left/60)).padStart(2,"0")+":"+String(left%60).padStart(2,"0");
  if(left === 0) doSubmit(true);
}, 500);

// ---------- Focus tracking + progressive warnings ----------
function leave(){
  if(away || done || !SID) return; away = true; C.focus++; ev("FOCUS_LOST"); upd();
  const w = $("warn"); w.classList.remove("hidden");
  if(C.focus===1) w.textContent="Warning 1: The exam window lost focus. If this was accidental, return to the exam.";
  else if(C.focus===2) w.textContent="Warning 2: The exam window lost focus again. Please stay on the exam window.";
  else { w.textContent="Warning 3: Repeated focus changes recorded. Examiner review may be required."; w.classList.add("w3"); }
}
function back(){ if(!away) return; away = false; if(SID && !done) ev("FOCUS_RETURNED"); }
window.addEventListener("blur", leave); window.addEventListener("focus", back);
document.addEventListener("visibilitychange", ()=>document.hidden ? leave() : back());

// ---------- Run (real Python in browser via Pyodide) ----------
let pyodide = null;
const pyReady = loadPyodide().then(p=>{ pyodide=p; $("output").textContent="Python ready. Press Run."; });
async function runPy(code, stdinText){
  await pyReady;
  const lines = stdinText.split("\n"); let out = "";
  pyodide.setStdin({stdin: ()=> lines.length ? lines.shift() : undefined});
  pyodide.setStdout({batched: s=>{ out += s + "\n"; }});
  pyodide.setStderr({batched: s=>{ out += s + "\n"; }});
  try{
    await pyodide.runPythonAsync(code, {globals: pyodide.globals.get("dict")()});
    return {out, err:null};
  }catch(e){
    let m = String(e.message), i = m.indexOf('File "<exec>"');
    if(i >= 0) m = "Traceback (most recent call last):\n  " + m.slice(i);
    return {out, err:m.trim()};
  }
}
$("runBtn").onclick = async ()=>{
  if(done || !SID) return;
  C.runs++; ev("CODE_RUN"); upd(); $("output").textContent = "Running...";
  const inp = $("stdin").value, r = await runPy(editor.getValue(), inp);
  let t = r.out;
  if(r.err){ t += "\n" + r.err + "\n\n✗ Error: fix the error and run again."; ev("RUN_COMPLETE", {result:"error"}); }
  else if(inp.trim() === EXAM.sample_in.trim()){
    const ok = r.out.trim() === EXAM.sample_out.trim();
    t += ok ? "\n✓ Sample test passed" : `\n✗ Sample test failed (expected ${EXAM.sample_out})`;
    ev("RUN_COMPLETE", {result: ok ? "sample passed" : "sample failed"});
  } else ev("RUN_COMPLETE", {result:"ok"});
  $("output").textContent = t;
};

// ---------- Submit ----------
async function doSubmit(expired){
  if(done) return; done = true; editor.setOption("readOnly", "nocursor"); upd();
  $("modal").classList.remove("hidden"); $("modalBox").innerHTML = "<h3>Submitting...</h3>";
  await flush();
  const r = await api("/api/submit", {session_id:SID, code:editor.getValue(), expired:!!expired});
  if(r.error){ $("modalBox").innerHTML = `<h3 class="err">${r.error}</h3>`; return; }
  $("modalBox").innerHTML = (expired ? `<h3 style="color:#f87171">TIME EXPIRED</h3>` : "") +
    `<h3>SUBMISSION RESULT</h3><ul style="list-style:none;padding:0">` +
    r.results.map((p,i)=>`<li>Test ${i+1} ${p ? "✓ Passed" : "✗ Failed"}</li>`).join("") +
    `</ul><h3>${r.score} / ${r.total} TEST CASES PASSED</h3><p class="ok">Submission recorded.</p>
     <p class="muted">Behavioral signals have been saved for examiner review.</p>`;
}
$("submitBtn").onclick = ()=>{
  if(done || !SID) return;
  $("modalBox").innerHTML = `<h3>Confirm submission?</h3><p>Runs: ${C.runs} | Focus changes: ${C.focus} | Code length: ${editor.getValue().length}</p>
   <button class="btn gray" id="cancelBtn">Cancel</button><button class="btn green" id="confirmBtn">Confirm Submit</button>`;
  $("modal").classList.remove("hidden");
  $("cancelBtn").onclick = ()=>$("modal").classList.add("hidden");
  $("confirmBtn").onclick = ()=>doSubmit(false);
};

// ---------- Reference sidebar ----------
function renderList(q=""){
  $("funcList").innerHTML = ""; q = q.toLowerCase();
  REFS.filter(r=>r.n.includes(q) || r.d.toLowerCase().includes(q)).forEach(r=>{
    const b = document.createElement("button"); b.textContent = r.n;
    b.onclick = ()=>{ $("detail").innerHTML =
      `<h4>${r.n}</h4><div class="lbl">Description</div><p>${r.d}</p>
       <div class="lbl">Syntax</div><pre class="code"></pre><div class="lbl">Example</div><pre class="code"></pre>`;
      const p = $("detail").querySelectorAll("pre"); p[0].textContent=r.s; p[1].textContent=r.e; };
    $("funcList").appendChild(b);
  });
}
$("search").oninput = e=>renderList(e.target.value); renderList();
SYNTAX.forEach(s=>{
  const h = document.createElement("div"); h.className="lbl"; h.textContent=s.t;
  const p = document.createElement("pre"); p.className="code"; p.textContent=s.c;
  $("syntaxView").append(h,p);
});
$("tabF").onclick = ()=>{ $("funcView").classList.remove("hidden"); $("syntaxView").classList.add("hidden"); $("tabF").classList.add("active"); $("tabS").classList.remove("active"); };
$("tabS").onclick = ()=>{ $("syntaxView").classList.remove("hidden"); $("funcView").classList.add("hidden"); $("tabS").classList.add("active"); $("tabF").classList.remove("active"); };
upd();
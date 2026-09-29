// ---------- Reference data ----------
const REFS = [
 {n:"print()",d:"Displays output on the screen.",s:"print(value, ...)",e:'print("Hello")'},
 {n:"input()",d:"Reads a line of text typed by the user.",s:"input(prompt)",e:'name = input("Name: ")'},
 {n:"len()",d:"Returns the number of items in a list or characters in a string.",s:"len(object)",e:"len([1,2,3])  # 3"},
 {n:"range()",d:"Generates a sequence of numbers, mostly used in for loops.",s:"range(start, stop, step)",e:"for i in range(5): print(i)"},
 {n:"append()",d:"Adds an element to the end of a list.",s:"list.append(element)",e:"numbers.append(10)"},
 {n:"pop()",d:"Removes and returns an element (last one by default).",s:"list.pop(index)",e:"numbers.pop()"},
 {n:"sort()",d:"Sorts a list in place (ascending by default).",s:"list.sort(reverse=False)",e:"numbers.sort()"},
 {n:"split()",d:"Splits a string into a list of words.",s:"string.split(separator)",e:'"a b c".split()  # [\'a\',\'b\',\'c\']'},
 {n:"replace()",d:"Returns a string with one part replaced by another.",s:"string.replace(old, new)",e:'"cat".replace("c","b")  # bat'},
 {n:"lower()",d:"Converts a string to lowercase.",s:"string.lower()",e:'"ABC".lower()  # abc'},
 {n:"upper()",d:"Converts a string to uppercase.",s:"string.upper()",e:'"abc".upper()  # ABC'}
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

// ---------- Session state ----------
const S = {student:"Demo Student", start:Date.now(), keys:0, edits:0, cursor:0, focus:0, runs:0,
           warnings:0, submitted:false, code:"", events:[]};
const $ = id => document.getElementById(id);
$("student").textContent = S.student;

function save(){ S.code = editor.getValue(); localStorage.setItem("examSession", JSON.stringify(S)); }
function log(type, info){
  S.events.push({t:new Date().toISOString(), type, info:info||""});
  if(S.events.length > 500) S.events.shift();
  save(); updateUI();
}
function updateUI(){
  $("m-keys").textContent=S.keys; $("m-edits").textContent=S.edits; $("m-cursor").textContent=S.cursor;
  $("m-focus").textContent=S.focus; $("m-runs").textContent=S.runs; $("m-warn").textContent=S.warnings;
  $("m-status").textContent = S.submitted ? "Submitted" : "Active";
}

// ---------- Editor ----------
const editor = CodeMirror.fromTextArea($("code"), {
  mode:"python", theme:"dracula", lineNumbers:true, indentUnit:4, tabSize:4, indentWithTabs:false,
  extraKeys:{Tab:cm=>cm.replaceSelection("    ")}
});
editor.setValue("# Question 1: print the largest number\nnumbers = list(map(int, input().split()))\n\n# Write your code below\n");
editor.setCursor(editor.lineCount(),0);
editor.on("keydown",(cm,e)=>{ S.keys++; log("keystroke", e.key.length>1 ? e.key : "character"); });
editor.on("change",()=>{ S.edits++; log("edit","length="+editor.getValue().length); });
editor.on("cursorActivity",()=>{ S.cursor++; updateUI(); });
editor.on("mousedown",()=>{ S.cursor++; updateUI(); });

// ---------- Focus tracking + progressive warnings ----------
let away = false;
function leave(){
  if(away || S.submitted) return; away = true;
  S.focus++; S.warnings = S.focus; log("focus_lost","count="+S.focus);
  const w = $("warn"); w.classList.remove("hidden");
  if(S.focus===1) w.textContent="Warning 1: The exam window lost focus. If this was accidental, return to the exam.";
  else if(S.focus===2) w.textContent="Warning 2: The exam window lost focus again. Please stay on the exam window.";
  else { w.textContent="Warning 3: Repeated focus changes recorded. Examiner review may be required."; w.classList.add("w3"); }
}
function back(){ if(!away) return; away=false; log("focus_returned"); }
window.addEventListener("blur", leave);
window.addEventListener("focus", back);
document.addEventListener("visibilitychange",()=>document.hidden?leave():back());

// ---------- Run (REAL Python via Pyodide, runs in browser) ----------
// To use Judge0 later: replace runPy() with a fetch() to the Judge0 API.
const TESTS = [
  {input:"12 45 7 89 23", expected:"89"},
  {input:"-5 -2 -9", expected:"-2"},
  {input:"3", expected:"3"},
  {input:"10 10 10", expected:"10"}
];
let pyodide = null;
const pyReady = loadPyodide().then(p=>{ pyodide=p; $("output").textContent="Python ready. Press Run."; });
$("output").textContent = "Loading Python engine (first time takes a few seconds)...";

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
  if(S.submitted) return;
  S.runs++; log("run");
  const code = editor.getValue();
  $("output").textContent = "Running...";
  const r = await runPy(code, $("stdin").value);
  let text = r.out;
  if(r.err){ $("output").textContent = text + "\n" + r.err + "\n\n❌ Error: fix the error and run again."; return; }
  text += "\n--- Test cases ---\n";
  let pass = 0;
  for(let i=0;i<TESTS.length;i++){
    const t = await runPy(code, TESTS[i].input);
    const ok = !t.err && t.out.trim() === TESTS[i].expected;
    if(ok) pass++;
    text += `Test ${i+1}: ` + (ok ? "✅ Passed" : `❌ Incorrect output (expected ${TESTS[i].expected}, got ${t.err ? "error" : (t.out.trim()||"nothing")})`) + "\n";
  }
  text += pass===TESTS.length ? "\n✅ Correct: all tests passed." : `\n❌ Incorrect: ${pass}/${TESTS.length} tests passed.`;
  $("output").textContent = text;
  log("run_result", pass+"/"+TESTS.length+" passed");
};

// ---------- Timer ----------
setInterval(()=>{
  const left = Math.max(0, 3600 - Math.floor((Date.now()-S.start)/1000));
  $("timer").textContent = String(Math.floor(left/60)).padStart(2,"0")+":"+String(left%60).padStart(2,"0");
},1000);

// ---------- Submit ----------
$("submitBtn").onclick = ()=>{
  if(S.submitted) return;
  const secs = Math.floor((Date.now()-S.start)/1000);
  $("modalBox").innerHTML = `<h3>Confirm submission?</h3><ul>
   <li>Question: Largest number in a list</li>
   <li>Code length: ${editor.getValue().length} characters</li>
   <li>Executions: ${S.runs}</li>
   <li>Session duration: ${Math.floor(secs/60)}m ${secs%60}s</li>
   <li>Behavioral events recorded: ${S.events.length}</li>
   <li>Focus changes: ${S.focus}</li></ul>
   <button class="btn gray" id="cancelBtn">Cancel</button>
   <button class="btn green" id="confirmBtn">Confirm Submit</button>`;
  $("modal").classList.remove("hidden");
  $("cancelBtn").onclick = ()=>$("modal").classList.add("hidden");
  $("confirmBtn").onclick = ()=>{
    S.submitted = true; log("submit"); editor.setOption("readOnly","nocursor");
    $("modalBox").innerHTML = `<h3 class="ok">Submission recorded successfully.</h3>
     <p>Behavioral signals have been saved for examiner review.</p>
     <button class="btn" id="closeBtn">Close</button>`;
    $("closeBtn").onclick = ()=>$("modal").classList.add("hidden");
  };
};

// ---------- Reference sidebar ----------
function renderList(q=""){
  $("funcList").innerHTML = "";
  REFS.filter(r=>r.n.includes(q.toLowerCase()) || r.d.toLowerCase().includes(q.toLowerCase())).forEach(r=>{
    const b = document.createElement("button"); b.textContent = r.n;
    b.onclick = ()=>{ $("detail").innerHTML =
      `<h4>${r.n}</h4><div class="lbl">Description</div><p>${r.d}</p>
       <div class="lbl">Syntax</div><pre class="code"></pre>
       <div class="lbl">Example</div><pre class="code"></pre>`;
      const p = $("detail").querySelectorAll("pre"); p[0].textContent=r.s; p[1].textContent=r.e; };
    $("funcList").appendChild(b);
  });
}
$("search").oninput = e=>renderList(e.target.value);
renderList();
SYNTAX.forEach(s=>{
  const h = document.createElement("div"); h.className="lbl"; h.textContent=s.t;
  const p = document.createElement("pre"); p.className="code"; p.textContent=s.c;
  $("syntaxView").append(h,p);
});
$("tabF").onclick = ()=>{ $("funcView").classList.remove("hidden"); $("syntaxView").classList.add("hidden"); $("tabF").classList.add("active"); $("tabS").classList.remove("active"); };
$("tabS").onclick = ()=>{ $("syntaxView").classList.remove("hidden"); $("funcView").classList.add("hidden"); $("tabS").classList.add("active"); $("tabF").classList.remove("active"); };

save(); updateUI();
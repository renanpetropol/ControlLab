import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase.js";

// ─── Constantes ────────────────────────────────────────────────────────────────
const OPERATORS = ["Anna", "André", "Érica", "Gustavo", "Kauã", "Pamela", "Renan"];

const ENSAIOS_DEFAULT = [
  { id: "injecao",     label: "Injeção Corpos de Prova" },
  { id: "fusao",       label: "Ponto de Fusão" },
  { id: "fluidez",     label: "Índice de Fluidez" },
  { id: "densidade",   label: "Densidade" },
  { id: "tracao",      label: "Tração" },
  { id: "flexao",      label: "Flexão" },
  { id: "charpy_c",    label: "Charpy c/ Entalhe - ISO" },
  { id: "izod_c",      label: "Izod c/ Entalhe - ISO" },
  { id: "izod_s",      label: "Izod s/ Entalhe - ISO" },
  { id: "charpy_s",    label: "Charpy s/ Entalhe - ISO" },
  { id: "izod_c_astm", label: "Izod c/ Entalhe - ASTM" },
  { id: "izod_s_astm", label: "Izod s/ Entalhe - ASTM" },
];

const TURNOS = [
  { id: 1, label: "1º Turno", inicio: "06:00", fim: "15:48", color: "#185fa5", bg: "#e6f1fb", dot: "#378add" },
  { id: 2, label: "2º Turno", inicio: "13:00", fim: "22:42", color: "#7b4fa6", bg: "#ede9fb", dot: "#9b6fd4" },
  { id: 3, label: "3º Turno", inicio: "22:00", fim: "06:20", color: "#1a6b3a", bg: "#d4f5e0", dot: "#2eaa5f" },
];

const STATUS_CONFIG = {
  pendente:  { bg:"#E8E8E4", txt:"#555550", label:"Pendente",     dot:"#AAAAAA" },
  andamento: { bg:"#FFF3C4", txt:"#8A6800", label:"Em Andamento", dot:"#F0B429" },
  concluido: { bg:"#D4F5E0", txt:"#1A6B3A", label:"Concluído",    dot:"#2EAA5F" },
  na:        { bg:"transparent", txt:"transparent", label:"N/A",  dot:"transparent" },
};

function makeCell(status="pendente", operador=null, hora=null) { return {status,operador,hora}; }
function today() {
  // Usa fuso horário de Brasília (America/Sao_Paulo) para evitar virada de dia prematura
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}
function fmtDate(d) { if(!d) return ""; const [y,m,dd]=d.split("-"); return `${dd}/${m}/${y}`; }

function calcProgress(materiais) {
  let total=0, done=0, wip=0;
  (materiais||[]).forEach(m => ENSAIOS_DEFAULT.forEach(e => {
    const c = m.cells[e.id];
    if (!c || c.status==="na") return;
    total++; if (c.status==="concluido") done++; if (c.status==="andamento") wip++;
  }));
  return { total, done, wip, pending:total-done-wip, pct:total>0?Math.round((done/total)*100):0 };
}

// ─── Supabase helpers ──────────────────────────────────────────────────────────
function rowsToDia(diaRow, materiaisRows, ensaiosRows, turnoAnotacoesRows) {
  const materiais = (materiaisRows||[]).map(m => {
    const cells = {};
    ENSAIOS_DEFAULT.forEach(e => { cells[e.id] = { status:"na" }; });
    (ensaiosRows||[]).filter(en => en.material_id===m.id).forEach(en => {
      cells[en.ensaio_id] = { status:en.status, operador:en.operador, hora:en.hora };
    });
    return { id:m.id, codigo:m.codigo, resina:m.resina, cells };
  });
  // Anotações por turno: array de {turno_num, texto, finalizado}
  const anotacoes = [1,2,3].map(n => {
    const row = (turnoAnotacoesRows||[]).find(r => r.turno_num===n);
    return { turno_num:n, texto: row?.texto||"", finalizado: row?.finalizado||false };
  });
  return { id:diaRow.id, date:diaRow.date, finalizado:diaRow.finalizado, turnoAtivo:diaRow.turno_ativo||1, materiais, anotacoes };
}

// Retorna o turno que abre o dia baseado na data (fuso Brasília).
// Seg (ou pós-feriado): 1º Turno. Ter–Sex: 3º Turno. Sáb/Dom: 1º Turno (fallback).
function turnoInicialDoDia(dateStr) {
  // dateStr = "YYYY-MM-DD"
  const [y, m, d] = dateStr.split("-").map(Number);
  const dia = new Date(y, m - 1, d); // local, mas só usamos getDay()
  const dow = dia.getDay(); // 0=dom,1=seg,2=ter,3=qua,4=qui,5=sex,6=sab
  // Ter(2), Qua(3), Qui(4), Sex(5) → 3º turno abre o dia
  return [2, 3, 4, 5].includes(dow) ? 3 : 1;
}

async function fetchDiaByDate(dateStr) {
  let { data:dia, error } = await supabase.from("dias").select("*").eq("date",dateStr).single();
  if (error && error.code==="PGRST116") {
    const turnoInicial = turnoInicialDoDia(dateStr);
    const { data:novo, error:e2 } = await supabase.from("dias").insert({date:dateStr, finalizado:false, turno_ativo:turnoInicial}).select().single();
    if (e2) throw e2;
    dia = novo;
  } else if (error) throw error;

  const { data:materiais } = await supabase.from("materiais").select("*").eq("dia_id",dia.id).order("ordem");
  const matIds = (materiais||[]).map(m=>m.id);
  const { data:ensaios } = matIds.length ? await supabase.from("ensaios").select("*").in("material_id",matIds) : {data:[]};
  const { data:anotacoes } = await supabase.from("turno_anotacoes").select("*").eq("dia_id",dia.id);
  return rowsToDia(dia, materiais||[], ensaios||[], anotacoes||[]);
}

async function fetchHistorico() {
  const { data:dias, error } = await supabase.from("dias").select("*").eq("finalizado",true).order("date",{ascending:false});
  if (error) throw error;
  if (!dias||!dias.length) return [];
  const diaIds = dias.map(d=>d.id);
  const { data:materiais } = await supabase.from("materiais").select("*").in("dia_id",diaIds).order("ordem");
  const matIds = (materiais||[]).map(m=>m.id);
  const { data:ensaios } = matIds.length ? await supabase.from("ensaios").select("*").in("material_id",matIds) : {data:[]};
  const { data:anotacoes } = await supabase.from("turno_anotacoes").select("*").in("dia_id",diaIds);
  return dias.map(d => {
    const mats = (materiais||[]).filter(m=>m.dia_id===d.id);
    const anots = (anotacoes||[]).filter(a=>a.dia_id===d.id);
    return rowsToDia(d, mats, ensaios||[], anots);
  });
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, type }) {
  return (
    <div style={{position:"fixed",bottom:24,right:24,zIndex:9999,background:type==="error"?"#dc2626":"#1a3a2a",color:"#fff",padding:"12px 20px",borderRadius:10,fontSize:13,fontWeight:600,boxShadow:"0 8px 24px rgba(0,0,0,.2)",maxWidth:340}}>
      {type==="error"?"❌ ":"✓ "}{msg}
    </div>
  );
}

// ─── AuthPage ─────────────────────────────────────────────────────────────────
function AuthPage() {
  const [tab, setTab] = useState("login");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState(null);
  const [msgType, setMsgType] = useState("error");

  async function handleLogin(e) {
    e.preventDefault(); setLoading(true); setMsg(null);
    const { error } = await supabase.auth.signInWithPassword({email, password:senha});
    if (error) { setMsg("E-mail ou senha incorretos."); setMsgType("error"); }
    setLoading(false);
  }

  async function handleCadastro(e) {
    e.preventDefault(); setLoading(true); setMsg(null);
    if (!email.endsWith("@petropol.com.br")) { setMsg("Apenas e-mails @petropol.com.br são permitidos."); setMsgType("error"); setLoading(false); return; }
    const { error } = await supabase.auth.signUp({email, password:senha, options:{data:{full_name:nome}}});
    if (error) { setMsg(error.message||"Erro ao criar conta."); setMsgType("error"); }
    else { setMsg("Conta criada! Verifique seu e-mail para confirmar (se necessário)."); setMsgType("ok"); }
    setLoading(false);
  }

  return (
    <div style={{minHeight:"100vh",background:"#f5f3ef",display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div style={{background:"#fff",borderRadius:20,padding:"2.5rem 2rem",width:"min(440px,100%)",boxShadow:"0 20px 60px rgba(0,0,0,.1)"}}>
        <div style={{textAlign:"center",marginBottom:"2rem"}}>
          <div style={{fontSize:24,fontWeight:900,color:"#1a1a18",letterSpacing:"-.02em",marginBottom:4}}>
            <span style={{color:"#2eaa5f"}}>Lab</span>Quality
          </div>
          <div style={{fontSize:12,color:"#aaa",textTransform:"uppercase",letterSpacing:".1em"}}>Controle de Validações · Petropol</div>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",background:"#f0eeea",borderRadius:10,padding:4,marginBottom:"1.5rem"}}>
          {["login","cadastro"].map(t=>(
            <button key={t} onClick={()=>{setTab(t);setMsg(null);}} style={{padding:"8px",borderRadius:7,border:"none",background:tab===t?"#1a3a2a":"transparent",color:tab===t?"#7bc99a":"#888",cursor:"pointer",fontSize:13,fontWeight:600,textTransform:"capitalize",transition:"all .15s"}}>
              {t==="login"?"Entrar":"Cadastrar"}
            </button>
          ))}
        </div>
        <form onSubmit={tab==="login"?handleLogin:handleCadastro} style={{display:"grid",gap:12}}>
          {tab==="cadastro"&&(
            <div>
              <label style={{fontSize:11,color:"#888",fontWeight:500,textTransform:"uppercase",letterSpacing:".06em",display:"block",marginBottom:4}}>Nome Completo</label>
              <input value={nome} onChange={e=>setNome(e.target.value)} required placeholder="Seu nome" style={{width:"100%",border:"1px solid #e0ddd6",borderRadius:8,padding:"9px 12px",fontSize:13,boxSizing:"border-box"}} />
            </div>
          )}
          <div>
            <label style={{fontSize:11,color:"#888",fontWeight:500,textTransform:"uppercase",letterSpacing:".06em",display:"block",marginBottom:4}}>E-mail Corporativo</label>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="nome@petropol.com.br" style={{width:"100%",border:"1px solid #e0ddd6",borderRadius:8,padding:"9px 12px",fontSize:13,boxSizing:"border-box"}} />
          </div>
          <div>
            <label style={{fontSize:11,color:"#888",fontWeight:500,textTransform:"uppercase",letterSpacing:".06em",display:"block",marginBottom:4}}>Senha</label>
            <input type="password" value={senha} onChange={e=>setSenha(e.target.value)} required minLength={6} style={{width:"100%",border:"1px solid #e0ddd6",borderRadius:8,padding:"9px 12px",fontSize:13,boxSizing:"border-box"}} />
          </div>
          {msg&&<div style={{background:msgType==="error"?"#fef2f2":"#d4f5e0",border:`1px solid ${msgType==="error"?"#fca5a5":"#86d9a8"}`,borderRadius:8,padding:"10px 14px",fontSize:13,color:msgType==="error"?"#991b1b":"#1a6b3a"}}>{msg}</div>}
          <button type="submit" disabled={loading} style={{padding:"11px",borderRadius:9,border:"none",background:loading?"#ccc":"#1a3a2a",color:"#fff",cursor:loading?"default":"pointer",fontSize:14,fontWeight:700,marginTop:4}}>
            {loading?"Aguarde...":(tab==="login"?"Entrar":"Criar conta")}
          </button>
        </form>
        <p style={{textAlign:"center",fontSize:12,color:"#aaa",margin:"1.25rem 0 0"}}>Acesso restrito a <strong>@petropol.com.br</strong></p>
      </div>
    </div>
  );
}

// ─── CellModal ────────────────────────────────────────────────────────────────
function CellModal({ cell, ensaio, material, onClose, onSave }) {
  const [status, setStatus] = useState(cell.status==="na"?"pendente":cell.status);
  const [op, setOp] = useState(cell.operador||"");
  const [hora, setHora] = useState(cell.hora||"");
  const [customOp, setCustomOp] = useState(!OPERATORS.includes(cell.operador||"") && !!(cell.operador));
  function save() { onSave({status, operador:op||null, hora:status==="concluido"?(hora||new Date().toTimeString().slice(0,5)):null}); onClose(); }
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:"1.5rem",width:360,boxShadow:"0 20px 60px rgba(0,0,0,.15)"}}>
        <p style={{fontSize:11,color:"#888",margin:"0 0 2px",textTransform:"uppercase",letterSpacing:".08em"}}>{material.codigo} — {material.resina}</p>
        <h3 style={{margin:"0 0 1rem",fontSize:16,fontWeight:600,color:"#1a1a18"}}>{ensaio.label}</h3>
        <p style={{fontSize:12,color:"#888",margin:"0 0 6px",fontWeight:500}}>Status</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:"1.25rem"}}>
          {["pendente","andamento","concluido"].map(s=>{
            const c=STATUS_CONFIG[s];
            return <button key={s} onClick={()=>setStatus(s)} style={{padding:"8px 4px",borderRadius:8,border:status===s?"2px solid "+c.dot:"1.5px solid #e0ddd6",background:status===s?c.bg:"transparent",cursor:"pointer",fontSize:11,fontWeight:600,color:status===s?c.txt:"#888",transition:"all .15s"}}>
              <div style={{width:8,height:8,borderRadius:4,background:c.dot,margin:"0 auto 4px"}} />{c.label}
            </button>;
          })}
        </div>
        <p style={{fontSize:12,color:"#888",margin:"0 0 6px",fontWeight:500}}>Responsável</p>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:"0.75rem"}}>
          {OPERATORS.map(o=>(
            <button key={o} onClick={()=>{setOp(o);setCustomOp(false);}} style={{padding:"4px 12px",borderRadius:20,border:op===o&&!customOp?"1.5px solid #1a6b3a":"1px solid #e0ddd6",background:op===o&&!customOp?"#d4f5e0":"transparent",fontSize:12,cursor:"pointer",color:op===o&&!customOp?"#1a6b3a":"#555",transition:"all .12s"}}>{o}</button>
          ))}
          <button onClick={()=>setCustomOp(true)} style={{padding:"4px 12px",borderRadius:20,border:customOp?"1.5px solid #378add":"1px solid #e0ddd6",background:customOp?"#e6f1fb":"transparent",fontSize:12,cursor:"pointer",color:customOp?"#185fa5":"#888"}}>+ Outro</button>
        </div>
        {customOp&&<input value={op} onChange={e=>setOp(e.target.value)} placeholder="Nome do operador" style={{width:"100%",border:"1px solid #e0ddd6",borderRadius:8,padding:"7px 10px",fontSize:13,marginBottom:"0.75rem",boxSizing:"border-box"}} />}
        {status==="concluido"&&<>
          <p style={{fontSize:12,color:"#888",margin:"0 0 6px",fontWeight:500}}>Horário de conclusão</p>
          <input type="time" value={hora} onChange={e=>setHora(e.target.value)} style={{border:"1px solid #e0ddd6",borderRadius:8,padding:"7px 10px",fontSize:13,marginBottom:"1rem",width:140}} />
        </>}
        <div style={{display:"flex",gap:8,marginTop:"1rem"}}>
          <button onClick={onClose} style={{flex:1,padding:"9px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13,color:"#888"}}>Cancelar</button>
          <button onClick={save} style={{flex:2,padding:"9px",borderRadius:8,border:"none",background:"#1a3a2a",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:600}}>Salvar</button>
        </div>
      </div>
    </div>
  );
}

// ─── AddMaterialModal ─────────────────────────────────────────────────────────
function AddMaterialModal({ onClose, onAdd }) {
  const DRAFT_KEY = "labquality_draft_material";

  // Restaura rascunho salvo ao abrir o modal
  const draft = (() => { try { return JSON.parse(localStorage.getItem(DRAFT_KEY)||"{}"); } catch{ return {}; } })();

  const [codigo, setCodigo] = useState(draft.codigo||"");
  const [resina, setResina] = useState(draft.resina||"");
  const [aplicavel, setAplicavel] = useState(draft.aplicavel||["injecao","fusao","densidade","tracao","flexao","charpy_c","izod_c"]);
  const [saving, setSaving] = useState(false);

  // Salva no localStorage a cada mudança
  function saveDraft(c, r, a) {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({codigo:c, resina:r, aplicavel:a}));
  }

  function handleCodigo(v)    { setCodigo(v);    saveDraft(v, resina, aplicavel); }
  function handleResina(v)    { setResina(v);    saveDraft(codigo, v, aplicavel); }
  function toggle(id) {
    setAplicavel(p => {
      const next = p.includes(id) ? p.filter(x=>x!==id) : [...p,id];
      saveDraft(codigo, resina, next);
      return next;
    });
  }

  async function add() {
    if (!codigo.trim()||saving) return; setSaving(true);
    const cells={};
    ENSAIOS_DEFAULT.forEach(e=>{ cells[e.id]=aplicavel.includes(e.id)?makeCell("pendente"):{status:"na"}; });
    await onAdd({codigo:codigo.trim(), resina:resina.trim(), cells});
    localStorage.removeItem(DRAFT_KEY); // limpa rascunho após salvar
    onClose();
  }

  function handleClose() {
    localStorage.removeItem(DRAFT_KEY);
    onClose();
  }
  return (
    <div onClick={handleClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:"1.75rem",width:"min(520px,100%)",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.18)"}}>
        <h3 style={{margin:"0 0 1.25rem",fontSize:18,fontWeight:700,color:"#1a1a18"}}>Cadastrar Material</h3>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:"1.25rem"}}>
          <div><label style={{fontSize:11,color:"#888",fontWeight:500,textTransform:"uppercase",letterSpacing:".06em",display:"block",marginBottom:4}}>Código *</label>
            <input value={codigo} onChange={e=>handleCodigo(e.target.value)} placeholder="ex: 100.0842" style={{width:"100%",border:"1px solid #e0ddd6",borderRadius:8,padding:"8px 10px",fontSize:13,boxSizing:"border-box"}} /></div>
          <div><label style={{fontSize:11,color:"#888",fontWeight:500,textTransform:"uppercase",letterSpacing:".06em",display:"block",marginBottom:4}}>Resina</label>
            <input value={resina} onChange={e=>handleResina(e.target.value)} placeholder="ex: PA66 G30" style={{width:"100%",border:"1px solid #e0ddd6",borderRadius:8,padding:"8px 10px",fontSize:13,boxSizing:"border-box"}} /></div>
        </div>
        <p style={{fontSize:11,color:"#888",fontWeight:600,textTransform:"uppercase",letterSpacing:".06em",margin:"0 0 8px"}}>Ensaios aplicáveis</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:"1.5rem"}}>
          {ENSAIOS_DEFAULT.map(e=>(
            <label key={e.id} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,color:"#444",padding:"5px 8px",borderRadius:6,background:aplicavel.includes(e.id)?"#d4f5e0":"#f7f5f2",border:aplicavel.includes(e.id)?"1px solid #86d9a8":"1px solid transparent",transition:"all .12s"}}>
              <input type="checkbox" checked={aplicavel.includes(e.id)} onChange={()=>toggle(e.id)} style={{accentColor:"#2eaa5f"}} />{e.label}
            </label>
          ))}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={handleClose} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13,color:"#888"}}>Cancelar</button>
          <button onClick={add} disabled={!codigo.trim()||saving} style={{flex:2,padding:"10px",borderRadius:8,border:"none",background:codigo.trim()&&!saving?"#1a3a2a":"#ccc",color:"#fff",cursor:codigo.trim()&&!saving?"pointer":"default",fontSize:13,fontWeight:600}}>{saving?"Salvando...":"Adicionar Material"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── EditMaterialModal ────────────────────────────────────────────────────────
function EditMaterialModal({ material, onClose, onSave, onRemove }) {
  const [codigo, setCodigo] = useState(material.codigo);
  const [resina, setResina] = useState(material.resina||"");
  const [aplicavel, setAplicavel] = useState(ENSAIOS_DEFAULT.filter(e=>material.cells[e.id]?.status!=="na").map(e=>e.id));
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [saving, setSaving] = useState(false);
  function toggle(id) { setAplicavel(p=>p.includes(id)?p.filter(x=>x!==id):[...p,id]); }
  async function save() {
    if (!codigo.trim()||saving) return; setSaving(true);
    const newCells={};
    ENSAIOS_DEFAULT.forEach(e=>{
      if (!aplicavel.includes(e.id)) newCells[e.id]={status:"na"};
      else { const ex=material.cells[e.id]; newCells[e.id]=(ex&&ex.status!=="na")?ex:makeCell("pendente"); }
    });
    await onSave({...material, codigo:codigo.trim(), resina:resina.trim(), cells:newCells}); onClose();
  }
  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:"1.75rem",width:"min(520px,100%)",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.18)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.25rem"}}>
          <h3 style={{margin:0,fontSize:18,fontWeight:700,color:"#1a1a18"}}>Editar Material</h3>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#aaa",lineHeight:1}}>×</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:"1.25rem"}}>
          <div><label style={{fontSize:11,color:"#888",fontWeight:500,textTransform:"uppercase",letterSpacing:".06em",display:"block",marginBottom:4}}>Código *</label>
            <input value={codigo} onChange={e=>setCodigo(e.target.value)} style={{width:"100%",border:"1px solid #e0ddd6",borderRadius:8,padding:"8px 10px",fontSize:13,boxSizing:"border-box"}} /></div>
          <div><label style={{fontSize:11,color:"#888",fontWeight:500,textTransform:"uppercase",letterSpacing:".06em",display:"block",marginBottom:4}}>Resina</label>
            <input value={resina} onChange={e=>setResina(e.target.value)} placeholder="ex: PA66 G30" style={{width:"100%",border:"1px solid #e0ddd6",borderRadius:8,padding:"8px 10px",fontSize:13,boxSizing:"border-box"}} /></div>
        </div>
        <p style={{fontSize:11,color:"#888",fontWeight:600,textTransform:"uppercase",letterSpacing:".06em",margin:"0 0 8px"}}>Ensaios aplicáveis</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:"1.5rem"}}>
          {ENSAIOS_DEFAULT.map(e=>{const ativo=aplicavel.includes(e.id);const temDados=["concluido","andamento"].includes(material.cells[e.id]?.status);return(
            <label key={e.id} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,color:"#444",padding:"5px 8px",borderRadius:6,background:ativo?"#d4f5e0":"#f7f5f2",border:ativo?"1px solid #86d9a8":"1px solid transparent",transition:"all .12s"}}>
              <input type="checkbox" checked={ativo} onChange={()=>toggle(e.id)} style={{accentColor:"#2eaa5f"}} />{e.label}
              {temDados&&<span style={{marginLeft:"auto",fontSize:9,background:"#fff3c4",color:"#8a6800",padding:"1px 5px",borderRadius:4,fontWeight:700}}>dados</span>}
            </label>);})}
        </div>
        <div style={{borderTop:"1px solid #f0eeea",paddingTop:"1rem",display:"flex",gap:8,flexWrap:"wrap"}}>
          {confirmRemove?(
            <><div style={{width:"100%",background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#991b1b",marginBottom:4}}>⚠️ Remover <strong>{material.codigo}</strong>?</div>
              <button onClick={()=>setConfirmRemove(false)} style={{flex:1,padding:"9px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13,color:"#888"}}>Cancelar</button>
              <button onClick={()=>{onRemove(material.id);onClose();}} style={{flex:2,padding:"9px",borderRadius:8,border:"none",background:"#dc2626",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Confirmar</button></>
          ):(
            <><button onClick={()=>setConfirmRemove(true)} style={{padding:"9px 14px",borderRadius:8,border:"1px solid #fca5a5",background:"#fef2f2",cursor:"pointer",fontSize:13,color:"#dc2626",fontWeight:600}}>🗑 Remover</button>
              <div style={{flex:1}} />
              <button onClick={onClose} style={{padding:"9px 16px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13,color:"#888"}}>Cancelar</button>
              <button onClick={save} disabled={!codigo.trim()||saving} style={{padding:"9px 20px",borderRadius:8,border:"none",background:codigo.trim()&&!saving?"#1a3a2a":"#ccc",color:"#fff",cursor:codigo.trim()&&!saving?"pointer":"default",fontSize:13,fontWeight:600}}>{saving?"Salvando...":"Salvar"}</button></>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── DashboardGrid ────────────────────────────────────────────────────────────
function DashboardGrid({ materiais, onUpdateCell, onEditMaterial, readonly }) {
  const [activeCell, setActiveCell] = useState(null);
  const COL_W=130, ROW_H=44;
  function handleCell(mat, ensaio) {
    if (readonly) return;
    const cell=mat.cells[ensaio.id];
    if (!cell||cell.status==="na") return;
    setActiveCell({mat,ensaio,cell});
  }
  return (
    <div style={{overflowX:"auto",borderRadius:12,border:"1px solid #e8e5de"}}>
      <table style={{borderCollapse:"collapse",tableLayout:"fixed",minWidth:"100%"}}>
        <colgroup>
          <col style={{width:200}} />
          {materiais.map(m=><col key={m.id} style={{width:COL_W}} />)}
        </colgroup>
        <thead>
          <tr style={{background:"#1a3a2a"}}>
            <th style={{padding:"10px 16px",textAlign:"left",color:"#7bc99a",fontSize:11,fontWeight:600,letterSpacing:".07em",textTransform:"uppercase",borderRight:"1px solid #2d5c42"}}>ENSAIO</th>
            {materiais.map(m=>(
              <th key={m.id} style={{padding:"8px 6px",textAlign:"center",borderRight:"1px solid #2d5c42"}}>
                <div style={{color:"#fff",fontSize:12,fontWeight:700,lineHeight:1.2}}>{m.codigo}</div>
                <div style={{color:"#7bc99a",fontSize:10,marginTop:2}}>{m.resina}</div>
                {!readonly&&<button onClick={()=>onEditMaterial(m)} style={{marginTop:5,padding:"2px 8px",borderRadius:5,border:"1px solid rgba(123,201,154,.35)",background:"rgba(123,201,154,.12)",color:"#7bc99a",cursor:"pointer",fontSize:10,fontWeight:600,transition:"all .15s"}} onMouseEnter={e=>e.currentTarget.style.background="rgba(123,201,154,.28)"} onMouseLeave={e=>e.currentTarget.style.background="rgba(123,201,154,.12)"}>✎ editar</button>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ENSAIOS_DEFAULT.map((ensaio,ri)=>(
            <tr key={ensaio.id} style={{background:ri%2===0?"#fafaf8":"#f5f3ef"}}>
              <td style={{padding:"0 16px",height:ROW_H,fontSize:12,fontWeight:500,color:"#3d3d3a",borderRight:"1px solid #e8e5de",whiteSpace:"nowrap"}}>{ensaio.label}</td>
              {materiais.map(mat=>{
                const cell=mat.cells[ensaio.id];
                const isNA=!cell||cell.status==="na";
                return (
                  <td key={mat.id} onClick={()=>handleCell(mat,ensaio)}
                    title={isNA?"N/A":`${STATUS_CONFIG[cell?.status]?.label||""}${cell?.operador?" — "+cell.operador:""}${cell?.hora?" ("+cell.hora+")":""}`}
                    style={{height:ROW_H,padding:0,borderRight:"1px solid #e8e5de",cursor:!isNA&&!readonly?"pointer":"default",position:"relative"}}>
                    <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                      {isNA
                        ? <div style={{width:"100%",height:"100%",background:"repeating-linear-gradient(-45deg,#ebe9e3,#ebe9e3 4px,#e2e0da 4px,#e2e0da 8px)"}} />
                        : <div style={{width:"100%",height:"100%",background:STATUS_CONFIG[cell.status]?.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2}}>
                            <div style={{width:8,height:8,borderRadius:4,background:STATUS_CONFIG[cell.status]?.dot}} />
                            {cell.operador&&<div style={{fontSize:9,color:STATUS_CONFIG[cell.status]?.txt,fontWeight:600,maxWidth:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cell.operador}</div>}
                            {cell.hora&&<div style={{fontSize:9,color:STATUS_CONFIG[cell.status]?.txt,opacity:.8}}>{cell.hora}</div>}
                          </div>
                      }
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {activeCell&&<CellModal cell={activeCell.cell} ensaio={activeCell.ensaio} material={activeCell.mat} onClose={()=>setActiveCell(null)} onSave={data=>{onUpdateCell(activeCell.mat.id,activeCell.ensaio.id,data);setActiveCell(null);}} />}
    </div>
  );
}

// ─── StatsBar ─────────────────────────────────────────────────────────────────
function StatsBar({ progress }) {
  const {done,wip,pending,pct}=progress;
  return (
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:"1.25rem"}}>
      {[{l:"Concluídos",v:done,c:"#2eaa5f",b:"#d4f5e0"},{l:"Em Andamento",v:wip,c:"#f0b429",b:"#fff3c4"},{l:"Pendentes",v:pending,c:"#888",b:"#f0eeea"},{l:"Progresso",v:pct+"%",c:"#185fa5",b:"#e6f1fb"}].map(s=>(
        <div key={s.l} style={{background:s.b,borderRadius:10,padding:"10px 18px",display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:22,fontWeight:700,color:s.c}}>{s.v}</div>
          <div style={{fontSize:11,color:s.c,fontWeight:600,textTransform:"uppercase",letterSpacing:".05em"}}>{s.l}</div>
        </div>
      ))}
      <div style={{flex:1,minWidth:180,display:"flex",alignItems:"center",gap:10}}>
        <div style={{flex:1,height:8,background:"#e8e5de",borderRadius:4,overflow:"hidden"}}>
          <div style={{height:"100%",width:pct+"%",background:pct>=100?"#2eaa5f":pct>=60?"#f0b429":"#378add",borderRadius:4,transition:"width .5s"}} />
        </div>
        <span style={{fontSize:12,color:"#888",minWidth:36}}>{pct}%</span>
      </div>
    </div>
  );
}

// ─── AnotacoesTurnos ──────────────────────────────────────────────────────────
function AnotacoesTurnos({ anotacoes, turnoAtivo, readonly, onChange }) {
  // anotacoes: [{turno_num, texto, finalizado}]
  return (
    <div style={{marginTop:"1.75rem",display:"grid",gap:12}}>
      <h3 style={{margin:0,fontSize:15,fontWeight:700,color:"#1a1a18"}}>Anotações por Turno</h3>
      {TURNOS.map(t => {
        const anot = anotacoes.find(a=>a.turno_num===t.id)||{turno_num:t.id,texto:"",finalizado:false};
        const isAtivo = t.id===turnoAtivo;
        const editavel = !readonly && isAtivo && !anot.finalizado;
        return (
          <div key={t.id} style={{background:"#fff",borderRadius:12,border:`1.5px solid ${isAtivo&&!anot.finalizado?"#e8e5de":anot.finalizado?"#86d9a8":"#e8e5de"}`,padding:"1rem 1.25rem"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:"0.75rem"}}>
              <div style={{width:8,height:8,borderRadius:4,background:t.dot}} />
              <span style={{fontWeight:700,fontSize:13,color:"#1a1a18"}}>{t.label}</span>
              <span style={{fontSize:11,color:t.color,background:t.bg,padding:"2px 8px",borderRadius:8,fontWeight:600}}>{t.inicio} – {t.fim}</span>
              {anot.finalizado&&<span style={{fontSize:11,color:"#1a6b3a",background:"#d4f5e0",padding:"2px 8px",borderRadius:8,fontWeight:700,marginLeft:"auto"}}>✓ Finalizado</span>}
              {isAtivo&&!anot.finalizado&&!readonly&&<span style={{fontSize:11,color:t.color,background:t.bg,padding:"2px 8px",borderRadius:8,fontWeight:700,marginLeft:"auto"}}>● Turno Ativo</span>}
            </div>
            {editavel ? (
              <textarea
                value={anot.texto}
                onChange={e=>onChange(t.id, e.target.value)}
                placeholder={`Anotações do ${t.label}... (ocorrências, observações, equipamentos, etc.)`}
                rows={3}
                style={{width:"100%",border:"1px solid #e0ddd6",borderRadius:8,padding:"8px 10px",fontSize:13,boxSizing:"border-box",resize:"vertical",fontFamily:"inherit",lineHeight:1.5}}
              />
            ) : (
              <div style={{fontSize:13,color:anot.texto?"#444":"#bbb",lineHeight:1.6,minHeight:36,fontStyle:anot.texto?"normal":"italic",whiteSpace:"pre-wrap"}}>
                {anot.texto||"Nenhuma anotação registrada."}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Legend ───────────────────────────────────────────────────────────────────
function Legend() {
  return (
    <div style={{display:"flex",gap:16,flexWrap:"wrap",background:"#f7f5f2",borderRadius:8,padding:"8px 14px",marginBottom:"1.25rem",alignItems:"center"}}>
      <span style={{fontSize:11,color:"#aaa",fontWeight:600,textTransform:"uppercase",letterSpacing:".06em"}}>Legenda:</span>
      {Object.entries(STATUS_CONFIG).filter(([k])=>k!=="na").map(([k,v])=>(
        <div key={k} style={{display:"flex",alignItems:"center",gap:5}}>
          <div style={{width:10,height:10,borderRadius:5,background:v.dot}} />
          <span style={{fontSize:11,color:"#666"}}>{v.label}</span>
        </div>
      ))}
      <div style={{display:"flex",alignItems:"center",gap:5}}>
        <div style={{width:10,height:10,background:"repeating-linear-gradient(-45deg,#e2e0da,#e2e0da 2px,#ebe9e3 2px,#ebe9e3 4px)"}} />
        <span style={{fontSize:11,color:"#666"}}>Não aplicável</span>
      </div>
    </div>
  );
}

// ─── DashboardPage ────────────────────────────────────────────────────────────
function DashboardPage({ dia, onFinalizarTurno, onFinalizarDia, onAddMaterial, onUpdateCell, onEditMaterial, onRemoveMaterial, onLimparDashboard, onAnotacaoChange, onChangeDia }) {
  const [showAdd, setShowAdd]             = useState(false);
  const [showFinalizarTurno, setShowFT]   = useState(false);
  const [showFinalizar, setShowFinalizar] = useState(false);
  const [showLimpar, setShowLimpar]       = useState(false);
  const [editingMat, setEditingMat]       = useState(null);
  const [selectedDate, setSelectedDate]   = useState(dia.date);
  const isHoje = dia.date===today();
  const progress = calcProgress(dia.materiais);
  const t = TURNOS.find(x=>x.id===dia.turnoAtivo)||TURNOS[0];
  const anotAtiva = dia.anotacoes.find(a=>a.turno_num===dia.turnoAtivo)||{texto:""};

  function handleDateChange(e) {
    const d = e.target.value;
    setSelectedDate(d);
    if (d) onChangeDia(d);
  }

  return (
    <div>
      {/* Header do dashboard */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"1.5rem",flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <h1 style={{margin:0,fontSize:26,fontWeight:800,color:"#1a1a18",letterSpacing:"-.02em"}}>Dashboard</h1>
            {dia.finalizado&&<span style={{background:"#1a3a2a",color:"#7bc99a",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20}}>FINALIZADO</span>}
            {!isHoje&&<span style={{background:"#e6f1fb",color:"#185fa5",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20}}>📅 Dia anterior</span>}
          </div>
          <div style={{display:"flex",alignItems:"center",gap:10,marginTop:6,flexWrap:"wrap"}}>
            <input type="date" value={selectedDate} max={today()} onChange={handleDateChange}
              style={{border:"1px solid #e0ddd6",borderRadius:8,padding:"5px 10px",fontSize:13,background:"#fff",cursor:"pointer"}} />
            <span style={{fontSize:14,color:"#888"}}>{dia.materiais.length} {dia.materiais.length===1?"material":"materiais"}</span>
          </div>
        </div>
        {!dia.finalizado&&(
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={()=>setShowLimpar(true)} style={{padding:"9px 14px",borderRadius:9,border:"1.5px solid #fca5a5",background:"#fef2f2",cursor:"pointer",fontSize:13,fontWeight:600,color:"#dc2626"}}>🗑 Limpar</button>
            <button onClick={()=>setShowAdd(true)} style={{padding:"9px 16px",borderRadius:9,border:"1.5px solid #e0ddd6",background:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,color:"#444"}}>+ Material</button>
            {isHoje&&<button onClick={()=>setShowFT(true)} style={{padding:"9px 16px",borderRadius:9,border:"none",background:t.dot,color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>🔔 Finalizar {t.label}</button>}
            <button onClick={()=>setShowFinalizar(true)} style={{padding:"9px 18px",borderRadius:9,border:"none",background:"#1a3a2a",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>✓ Finalizar Dia</button>
          </div>
        )}
      </div>

      <StatsBar progress={progress} />

      {dia.materiais.length===0
        ? <div style={{textAlign:"center",padding:"4rem 2rem",color:"#aaa",background:"#fafaf8",borderRadius:12,border:"1.5px dashed #e0ddd6"}}>
            <div style={{fontSize:32,marginBottom:8}}>📋</div>
            <p style={{fontWeight:600,color:"#888",margin:"0 0 8px"}}>Nenhum material cadastrado</p>
            <p style={{fontSize:13,margin:0}}>Clique em "+ Material" para começar</p>
          </div>
        : <DashboardGrid materiais={dia.materiais} onUpdateCell={onUpdateCell} onEditMaterial={setEditingMat} readonly={dia.finalizado} />
      }

      {/* Anotações dos turnos */}
      <AnotacoesTurnos
        anotacoes={dia.anotacoes}
        turnoAtivo={dia.turnoAtivo}
        readonly={dia.finalizado}
        onChange={onAnotacaoChange}
      />

      {/* Modais */}
      {showAdd&&<AddMaterialModal onClose={()=>setShowAdd(false)} onAdd={onAddMaterial} />}
      {editingMat&&<EditMaterialModal material={editingMat} onClose={()=>setEditingMat(null)} onSave={async m=>{await onEditMaterial(m);setEditingMat(null);}} onRemove={async id=>{await onRemoveMaterial(id);setEditingMat(null);}} />}

      {/* Modal Finalizar Turno */}
      {showFinalizarTurno&&(
        <div onClick={()=>setShowFT(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:"2rem",width:400,boxShadow:"0 20px 60px rgba(0,0,0,.18)"}}>
            <div style={{width:48,height:48,borderRadius:24,background:t.bg,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,marginBottom:"1rem"}}>🔔</div>
            <h3 style={{margin:"0 0 .5rem",fontSize:18,fontWeight:700}}>Finalizar {t.label}?</h3>
            <p style={{color:"#666",fontSize:13,margin:"0 0 1rem",lineHeight:1.5}}>{t.inicio} – {t.fim} · As anotações abaixo serão salvas.</p>
            <div style={{background:"#f7f5f2",borderRadius:8,padding:"10px 12px",marginBottom:"1.25rem",border:`2px solid ${t.dot}`}}>
              <p style={{fontSize:11,color:"#888",margin:"0 0 6px",fontWeight:600,textTransform:"uppercase",letterSpacing:".05em"}}>Anotação do {t.label}</p>
              <div style={{fontSize:13,color:anotAtiva.texto?"#444":"#bbb",lineHeight:1.6,fontStyle:anotAtiva.texto?"normal":"italic",whiteSpace:"pre-wrap"}}>
                {anotAtiva.texto||"Nenhuma anotação preenchida."}
              </div>
            </div>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowFT(false)} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13,color:"#888"}}>Cancelar</button>
              <button onClick={()=>{onFinalizarTurno();setShowFT(false);}} style={{flex:2,padding:"10px",borderRadius:8,border:"none",background:t.dot,color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Confirmar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Finalizar Dia */}
      {showFinalizar&&(
        <div onClick={()=>setShowFinalizar(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:"2rem",width:400,boxShadow:"0 20px 60px rgba(0,0,0,.18)"}}>
            <div style={{width:48,height:48,borderRadius:24,background:"#d4f5e0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,marginBottom:"1rem"}}>✓</div>
            <h3 style={{margin:"0 0 .75rem",fontSize:18,fontWeight:700}}>Finalizar o dia?</h3>
            <p style={{color:"#666",fontSize:14,margin:"0 0 .75rem",lineHeight:1.6}}>O dia <strong>{fmtDate(dia.date)}</strong> será salvo no histórico{isHoje?" e o painel será limpo para amanhã":""}.</p>
            {progress.pct<100&&<div style={{background:"#fff3c4",border:"1px solid #f0b429",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#8a6800",marginBottom:"1rem"}}>⚠️ Ainda há <strong>{progress.pending}</strong> ensaio{progress.pending!==1?"s":""} pendente{progress.pending!==1?"s":""}.</div>}
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowFinalizar(false)} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13}}>Cancelar</button>
              <button onClick={()=>{onFinalizarDia();setShowFinalizar(false);}} style={{flex:2,padding:"10px",borderRadius:8,border:"none",background:"#1a3a2a",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Confirmar e Finalizar</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Limpar */}
      {showLimpar&&(
        <div onClick={()=>setShowLimpar(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:"2rem",width:400,boxShadow:"0 20px 60px rgba(0,0,0,.2)"}}>
            <div style={{width:48,height:48,borderRadius:24,background:"#fef2f2",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,marginBottom:"1rem"}}>🗑</div>
            <h3 style={{margin:"0 0 .75rem",fontSize:18,fontWeight:700}}>Limpar o dashboard?</h3>
            <p style={{color:"#dc2626",fontSize:13,margin:"0 0 1.5rem",fontWeight:600}}>⚠️ Todos os {dia.materiais.length} materiais serão removidos. Esta ação não pode ser desfeita.</p>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowLimpar(false)} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13}}>Cancelar</button>
              <button onClick={()=>{onLimparDashboard();setShowLimpar(false);}} style={{flex:2,padding:"10px",borderRadius:8,border:"none",background:"#dc2626",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Limpar Tudo</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── HistoricoPage ────────────────────────────────────────────────────────────
function HistoricoPage({ historico, loading, onReopenDia }) {
  const [busca, setBusca] = useState("");
  const [buscaMat, setBuscaMat] = useState("");
  const [selecionado, setSelecionado] = useState(null);
  const [showReabrir, setShowReabrir] = useState(false);

  const filtrado = historico.filter(h=>{
    const byDate=!busca||h.date.includes(busca)||fmtDate(h.date).includes(busca);
    const byCod=!buscaMat||h.materiais.some(m=>m.codigo.toLowerCase().includes(buscaMat.toLowerCase())||m.resina?.toLowerCase().includes(buscaMat.toLowerCase()));
    return byDate&&byCod;
  }).sort((a,b)=>b.date.localeCompare(a.date));

  return (
    <div>
      <h1 style={{margin:"0 0 1.5rem",fontSize:26,fontWeight:800,color:"#1a1a18",letterSpacing:"-.02em"}}>Histórico</h1>
      <div style={{display:"flex",gap:10,marginBottom:"1.25rem",flexWrap:"wrap"}}>
        <input type="date" value={busca} onChange={e=>setBusca(e.target.value)} style={{border:"1px solid #e0ddd6",borderRadius:9,padding:"9px 12px",fontSize:13,background:"#fff"}} />
        <input value={buscaMat} onChange={e=>setBuscaMat(e.target.value)} placeholder="Buscar por código ou resina..." style={{flex:1,minWidth:200,border:"1px solid #e0ddd6",borderRadius:9,padding:"9px 12px",fontSize:13}} />
        {(busca||buscaMat)&&<button onClick={()=>{setBusca("");setBuscaMat("");}} style={{padding:"9px 14px",borderRadius:9,border:"1px solid #e0ddd6",background:"#f7f5f2",cursor:"pointer",fontSize:13,color:"#888"}}>✕ Limpar</button>}
      </div>

      {selecionado ? (
        <div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:"1rem"}}>
            <button onClick={()=>{setSelecionado(null);setShowReabrir(false);}} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 14px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13,color:"#444"}}>← Voltar</button>
            <button onClick={()=>setShowReabrir(true)} style={{padding:"8px 18px",borderRadius:8,border:"1.5px solid #f0b429",background:"#fff8ed",cursor:"pointer",fontSize:13,fontWeight:600,color:"#8a6800"}}>🔓 Reabrir Dia</button>
          </div>
          <h2 style={{margin:"0 0 4px",fontSize:18,fontWeight:700}}>{fmtDate(selecionado.date)}</h2>
          <p style={{margin:"0 0 1rem",color:"#888",fontSize:13}}>{selecionado.materiais.length} materiais — {calcProgress(selecionado.materiais).pct}% concluído</p>
          <StatsBar progress={calcProgress(selecionado.materiais)} />
          <DashboardGrid materiais={selecionado.materiais} onUpdateCell={()=>{}} onEditMaterial={()=>{}} readonly={true} />

          {/* Anotações dos turnos no histórico */}
          <AnotacoesTurnos anotacoes={selecionado.anotacoes} turnoAtivo={0} readonly={true} onChange={()=>{}} />

          {showReabrir&&(
            <div onClick={()=>setShowReabrir(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:"2rem",width:400,boxShadow:"0 20px 60px rgba(0,0,0,.18)"}}>
                <div style={{width:48,height:48,borderRadius:24,background:"#fff8ed",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,marginBottom:"1rem"}}>🔓</div>
                <h3 style={{margin:"0 0 .75rem",fontSize:18,fontWeight:700}}>Reabrir o dia?</h3>
                <p style={{color:"#666",fontSize:14,margin:"0 0 .75rem",lineHeight:1.6}}>O dia <strong>{fmtDate(selecionado.date)}</strong> voltará para o Dashboard para edição.</p>
                <div style={{background:"#fff3c4",border:"1px solid #f0b429",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#8a6800",marginBottom:"1.25rem"}}>⚠️ O dia atual no Dashboard será substituído por este.</div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setShowReabrir(false)} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13,color:"#888"}}>Cancelar</button>
                  <button onClick={()=>{onReopenDia(selecionado);setShowReabrir(false);setSelecionado(null);}} style={{flex:2,padding:"10px",borderRadius:8,border:"none",background:"#8a6800",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Confirmar</button>
                </div>
              </div>
            </div>
          )}
        </div>
      ) : loading ? (
        <div style={{textAlign:"center",padding:"3rem",color:"#aaa"}}>Carregando histórico...</div>
      ) : (
        <div>
          <p style={{fontSize:13,color:"#aaa",margin:"0 0 12px"}}>{filtrado.length} registro{filtrado.length!==1?"s":""}</p>
          <div style={{display:"grid",gap:8}}>
            {filtrado.map(h=>{
              const prog=calcProgress(h.materiais);
              return (
                <div key={h.id} onClick={()=>setSelecionado(h)}
                  style={{background:"#fff",borderRadius:12,border:"1px solid #e8e5de",padding:"14px 18px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,transition:"box-shadow .15s,border-color .15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor="#1a3a2a";e.currentTarget.style.boxShadow="0 4px 16px rgba(26,58,42,.08)";}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor="#e8e5de";e.currentTarget.style.boxShadow="none";}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:15,color:"#1a1a18"}}>{fmtDate(h.date)}</div>
                    <div style={{fontSize:12,color:"#888",marginTop:2}}>{h.materiais.length} materiais — {h.materiais.map(m=>m.resina).filter((v,i,a)=>a.indexOf(v)===i&&v).join(", ")}</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:18,fontWeight:800,color:prog.pct>=100?"#2eaa5f":prog.pct>=60?"#f0b429":"#888"}}>{prog.pct}%</div>
                      <div style={{fontSize:10,color:"#aaa",textTransform:"uppercase",letterSpacing:".05em"}}>Concluído</div>
                    </div>
                    <div style={{width:48,height:48,borderRadius:24,background:"#f0eeea",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <div style={{width:36,height:36,borderRadius:18,background:`conic-gradient(#2eaa5f ${prog.pct}%, #e8e5de ${prog.pct}%)`,display:"flex",alignItems:"center",justifyContent:"center"}}>
                        <div style={{width:24,height:24,borderRadius:12,background:"#fff"}} />
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            {filtrado.length===0&&<div style={{textAlign:"center",padding:"3rem",color:"#aaa"}}>Nenhum registro encontrado.</div>}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── IndicadoresPage ──────────────────────────────────────────────────────────
function IndicadoresPage({ diaAtual, historico }) {
  const [filtro, setFiltro] = useState("mes");
  const [dataInicio, setDataInicio] = useState("");
  const [dataFim, setDataFim] = useState("");

  function getDias() {
    const all = [diaAtual, ...historico];
    if (filtro==="hoje") return all.filter(d=>d.date===today());
    if (filtro==="semana") { const r=new Date(); r.setDate(r.getDate()-7); return all.filter(d=>new Date(d.date)>=r); }
    if (filtro==="mes")    { const r=new Date(); r.setDate(r.getDate()-30); return all.filter(d=>new Date(d.date)>=r); }
    if (filtro==="custom") {
      return all.filter(d=>{
        const dt=new Date(d.date);
        const ok1=!dataInicio||dt>=new Date(dataInicio);
        const ok2=!dataFim||dt<=new Date(dataFim);
        return ok1&&ok2;
      });
    }
    return all;
  }

  const dias = getDias();
  const ranking = ENSAIOS_DEFAULT.map(ensaio=>{
    let realizados=0,pendentes=0,andamento=0;
    dias.forEach(dia=>dia.materiais.forEach(mat=>{
      const cell=mat.cells[ensaio.id];
      if (!cell||cell.status==="na") return;
      if (cell.status==="concluido") realizados++;
      else if (cell.status==="andamento") andamento++;
      else pendentes++;
    }));
    const total=realizados+andamento+pendentes;
    return {...ensaio,realizados,pendentes,andamento,total,pct:total>0?Math.round((realizados/total)*100):0};
  }).sort((a,b)=>b.realizados-a.realizados);

  const maxR=ranking[0]?.realizados||1;
  const totR=ranking.reduce((s,e)=>s+e.realizados,0);
  const totP=ranking.reduce((s,e)=>s+e.pendentes,0);
  const media=dias.length>0?Math.round(totR/dias.length):0;
  const MEDAL=["🥇","🥈","🥉"];

  return (
    <div>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"1.5rem",flexWrap:"wrap",gap:12}}>
        <div>
          <h1 style={{margin:0,fontSize:26,fontWeight:800,color:"#1a1a18",letterSpacing:"-.02em"}}>Indicadores</h1>
          <p style={{margin:"4px 0 0",fontSize:15,color:"#888"}}>Frequência e volume de ensaios realizados</p>
        </div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"center"}}>
          <div style={{display:"flex",gap:4,background:"#eceae5",borderRadius:10,padding:4}}>
            {[{id:"hoje",l:"Hoje"},{id:"semana",l:"7 dias"},{id:"mes",l:"30 dias"},{id:"tudo",l:"Tudo"},{id:"custom",l:"📅 Período"}].map(o=>(
              <button key={o.id} onClick={()=>setFiltro(o.id)} style={{padding:"6px 14px",borderRadius:7,border:"none",background:filtro===o.id?"#1a3a2a":"transparent",color:filtro===o.id?"#7bc99a":"#888",cursor:"pointer",fontSize:13,fontWeight:600,transition:"all .15s"}}>{o.l}</button>
            ))}
          </div>
          {filtro==="custom"&&(
            <div style={{display:"flex",gap:6,alignItems:"center",background:"#fff",border:"1px solid #e0ddd6",borderRadius:9,padding:"6px 10px"}}>
              <input type="date" value={dataInicio} onChange={e=>setDataInicio(e.target.value)} style={{border:"none",fontSize:12,outline:"none",background:"transparent"}} />
              <span style={{color:"#aaa",fontSize:12}}>até</span>
              <input type="date" value={dataFim} onChange={e=>setDataFim(e.target.value)} style={{border:"none",fontSize:12,outline:"none",background:"transparent"}} />
            </div>
          )}
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12,marginBottom:"1.75rem"}}>
        {[{l:"Realizados",v:totR,c:"#2eaa5f",b:"#d4f5e0"},{l:"Pendentes",v:totP,c:"#f0b429",b:"#fff3c4"},{l:"Dias",v:dias.length,c:"#185fa5",b:"#e6f1fb"},{l:"Média/dia",v:media,c:"#7b4fa6",b:"#ede9fb"}].map(c=>(
          <div key={c.l} style={{background:c.b,borderRadius:12,padding:"14px 18px"}}>
            <div style={{fontSize:28,fontWeight:800,color:c.c,lineHeight:1}}>{c.v}</div>
            <div style={{fontSize:11,color:c.c,fontWeight:600,textTransform:"uppercase",letterSpacing:".05em",marginTop:4,opacity:.85}}>{c.l}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 300px",gap:20,alignItems:"start"}}>
        <div style={{background:"#fff",borderRadius:14,border:"1px solid #e8e5de",padding:"1.5rem"}}>
          <h2 style={{margin:"0 0 1.25rem",fontSize:16,fontWeight:700,color:"#1a1a18"}}>Ranking de Ensaios</h2>
          <div style={{display:"grid",gap:10}}>
            {ranking.map((e,i)=>(
              <div key={e.id}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:14,width:20,textAlign:"center"}}>{i<3?MEDAL[i]:<span style={{fontSize:12,color:"#bbb",fontWeight:700}}>#{i+1}</span>}</span>
                    <span style={{fontSize:13,fontWeight:600,color:"#2a2a28"}}>{e.label}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    {e.realizados>0&&<span style={{fontSize:11,background:"#d4f5e0",color:"#1a6b3a",borderRadius:6,padding:"2px 7px",fontWeight:700}}>{e.realizados} ✓</span>}
                    {e.andamento>0&&<span style={{fontSize:11,background:"#fff3c4",color:"#8a6800",borderRadius:6,padding:"2px 7px",fontWeight:700}}>{e.andamento} ⏳</span>}
                    {e.pendentes>0&&<span style={{fontSize:11,background:"#f0eeea",color:"#888",borderRadius:6,padding:"2px 7px",fontWeight:700}}>{e.pendentes} ○</span>}
                    <span style={{fontSize:11,color:"#aaa",minWidth:32,textAlign:"right"}}>{e.pct}%</span>
                  </div>
                </div>
                <div style={{display:"flex",height:10,borderRadius:5,overflow:"hidden",background:"#f0eeea"}}>
                  {e.realizados>0&&<div style={{width:(e.realizados/maxR*100)+"%",background:"#2eaa5f",transition:"width .6s"}} />}
                  {e.andamento>0&&<div style={{width:(e.andamento/maxR*100)+"%",background:"#f0b429",transition:"width .6s"}} />}
                  {e.pendentes>0&&<div style={{width:(e.pendentes/maxR*100)+"%",background:"#d0cec8",transition:"width .6s"}} />}
                </div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:16,marginTop:"1.25rem",paddingTop:"1rem",borderTop:"1px solid #f0eeea"}}>
            {[{c:"#2eaa5f",l:"Concluídos"},{c:"#f0b429",l:"Em andamento"},{c:"#d0cec8",l:"Pendentes"}].map(l=>(
              <div key={l.l} style={{display:"flex",alignItems:"center",gap:5}}><div style={{width:10,height:10,borderRadius:2,background:l.c}} /><span style={{fontSize:11,color:"#888"}}>{l.l}</span></div>
            ))}
          </div>
        </div>

        <div style={{display:"grid",gap:14}}>
          {ranking[0]?.realizados>0&&(
            <div style={{background:"#1a3a2a",borderRadius:14,padding:"1.25rem"}}>
              <div style={{fontSize:11,color:"#7bc99a",fontWeight:600,textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>🏆 Mais realizado</div>
              <div style={{fontSize:16,fontWeight:800,color:"#fff",lineHeight:1.3,marginBottom:8}}>{ranking[0].label}</div>
              <div style={{fontSize:32,fontWeight:900,color:"#7bc99a",lineHeight:1}}>{ranking[0].realizados}</div>
              <div style={{fontSize:12,color:"#5a9470",marginTop:2}}>execuções · {ranking[0].pct}% de conclusão</div>
            </div>
          )}
          {(()=>{const c=[...ranking].sort((a,b)=>a.realizados-b.realizados).find(e=>e.total>0);if(!c)return null;return(
            <div style={{background:"#fff8ed",borderRadius:14,border:"1px solid #fce0a0",padding:"1.25rem"}}>
              <div style={{fontSize:11,color:"#b07d00",fontWeight:600,textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>⚠️ Menos realizado</div>
              <div style={{fontSize:15,fontWeight:700,color:"#5a3d00",marginBottom:4}}>{c.label}</div>
              <div style={{fontSize:26,fontWeight:900,color:"#c9920a",lineHeight:1}}>{c.realizados}</div>
              <div style={{fontSize:12,color:"#b07d00",marginTop:2}}>{c.pct}% de conclusão</div>
            </div>
          );})()}
        </div>
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage]           = useState("dashboard");
  const [session, setSession]     = useState(undefined);
  const [dia, setDia]             = useState(null);
  const [historico, setHistorico] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [toast, setToast]         = useState(null);

  function showToast(msg, type="success") { setToast({msg,type}); setTimeout(()=>setToast(null),3500); }

  // Auth
  useEffect(()=>{
    supabase.auth.getSession().then(({data:{session}})=>setSession(session??null));
    const {data:{subscription}} = supabase.auth.onAuthStateChange((_,s)=>setSession(s??null));
    return ()=>subscription.unsubscribe();
  },[]);

  // Load data when logged in
  useEffect(()=>{
    if (!session) return;
    async function init() {
      try {
        setLoading(true);
        const [diaData, histData] = await Promise.all([fetchDiaByDate(today()), fetchHistorico()]);
        setDia(diaData); setHistorico(histData);
      } catch(e) { showToast("Erro ao conectar com o banco de dados.","error"); }
      finally { setLoading(false); }
    }
    init();
  },[session]);

  // Handlers
  async function handleUpdateCell(matId, ensaioId, data) {
    // Se marcou Injeção como concluído, avança todos pendentes para andamento
    let extraUpdates = [];
    if (ensaioId==="injecao" && data.status==="concluido") {
      const mat = dia.materiais.find(m=>m.id===matId);
      if (mat) {
        extraUpdates = ENSAIOS_DEFAULT
          .filter(e => e.id!=="injecao" && mat.cells[e.id]?.status==="pendente")
          .map(e => ({ensaioId:e.id, data:{status:"andamento",operador:null,hora:null}}));
      }
    }
    setDia(prev=>({...prev, materiais:prev.materiais.map(m=>{
      if (m.id!==matId) return m;
      let newCells = {...m.cells, [ensaioId]:{...m.cells[ensaioId],...data}};
      extraUpdates.forEach(u=>{ newCells[u.ensaioId]={...newCells[u.ensaioId],...u.data}; });
      return {...m, cells:newCells};
    })}));
    try {
      await supabase.from("ensaios").update({status:data.status,operador:data.operador,hora:data.hora,updated_at:new Date().toISOString()}).eq("material_id",matId).eq("ensaio_id",ensaioId);
      for (const u of extraUpdates) {
        await supabase.from("ensaios").update({status:u.data.status,operador:null,hora:null,updated_at:new Date().toISOString()}).eq("material_id",matId).eq("ensaio_id",u.ensaioId);
      }
    } catch(e) { showToast("Erro ao salvar ensaio.","error"); }
  }

  async function handleAddMaterial(mat) {
    try {
      const ordem = dia.materiais.length;
      const { data:matRow, error } = await supabase.from("materiais").insert({dia_id:dia.id,codigo:mat.codigo,resina:mat.resina,nome:mat.codigo,ordem}).select().single();
      if (error) throw error;
      const ins = ENSAIOS_DEFAULT.map(e=>({material_id:matRow.id,ensaio_id:e.id,status:mat.cells[e.id]?.status||"na",operador:null,hora:null}));
      await supabase.from("ensaios").insert(ins);
      setDia(prev=>({...prev, materiais:[...prev.materiais,{...mat,id:matRow.id}]}));
      showToast(`Material ${mat.codigo} adicionado.`);
    } catch(e) { showToast("Erro ao adicionar material.","error"); }
  }

  async function handleEditMaterial(mat) {
    setDia(prev=>({...prev,materiais:prev.materiais.map(m=>m.id===mat.id?mat:m)}));
    try {
      await supabase.from("materiais").update({codigo:mat.codigo,resina:mat.resina,nome:mat.codigo}).eq("id",mat.id);
      const updates = ENSAIOS_DEFAULT.map(e=>({material_id:mat.id,ensaio_id:e.id,status:mat.cells[e.id]?.status||"na",operador:mat.cells[e.id]?.operador||null,hora:mat.cells[e.id]?.hora||null,updated_at:new Date().toISOString()}));
      await supabase.from("ensaios").upsert(updates,{onConflict:"material_id,ensaio_id"});
      showToast("Material atualizado.");
    } catch(e) { showToast("Erro ao editar.","error"); }
  }

  async function handleRemoveMaterial(id) {
    setDia(prev=>({...prev,materiais:prev.materiais.filter(m=>m.id!==id)}));
    try { await supabase.from("materiais").delete().eq("id",id); showToast("Material removido."); }
    catch(e) { showToast("Erro ao remover.","error"); }
  }

  async function handleLimparDashboard() {
    const bk=dia.materiais;
    setDia(prev=>({...prev,materiais:[]}));
    try { await supabase.from("materiais").delete().eq("dia_id",dia.id); showToast("Dashboard limpo."); }
    catch(e) { setDia(prev=>({...prev,materiais:bk})); showToast("Erro ao limpar.","error"); }
  }

  // Salva anotação automaticamente com debounce enquanto o usuário digita
  const anotacaoTimers = useRef({});
  function handleAnotacaoChange(turnoNum, texto) {
    setDia(prev=>({...prev, anotacoes:prev.anotacoes.map(a=>a.turno_num===turnoNum?{...a,texto}:a)}));
    // Cancela o timer anterior e agenda um novo save após 800ms sem digitar
    if (anotacaoTimers.current[turnoNum]) clearTimeout(anotacaoTimers.current[turnoNum]);
    anotacaoTimers.current[turnoNum] = setTimeout(async ()=>{
      try {
        await supabase.from("turno_anotacoes").upsert(
          {dia_id:dia.id, turno_num:turnoNum, texto, finalizado:false},
          {onConflict:"dia_id,turno_num"}
        );
      } catch(e) { /* silencioso */ }
    }, 800);
  }

  async function handleFinalizarTurno() {
    const turnoNum = dia.turnoAtivo;
    const texto = dia.anotacoes.find(a=>a.turno_num===turnoNum)?.texto||"";
    try {
      // Salva anotação e marca como finalizada
      await supabase.from("turno_anotacoes").upsert({dia_id:dia.id, turno_num:turnoNum, texto, finalizado:true},{onConflict:"dia_id,turno_num"});
      // Avança para o próximo turno
      const proximo = turnoNum===3 ? null : turnoNum+1;
      await supabase.from("dias").update({turno_ativo:proximo||turnoNum}).eq("id",dia.id);
      setDia(prev=>({
        ...prev,
        turnoAtivo: proximo||turnoNum,
        anotacoes: prev.anotacoes.map(a=>a.turno_num===turnoNum?{...a,finalizado:true}:a)
      }));
      showToast(`${TURNOS.find(t=>t.id===turnoNum)?.label} finalizado!`);
    } catch(e) { showToast("Erro ao finalizar turno.","error"); console.error(e); }
  }

  async function handleFinalizarDia() {
    const isPast = dia.date!==today();
    try {
      await supabase.from("dias").update({finalizado:true}).eq("id",dia.id);
      setHistorico(prev=>[{...dia,finalizado:true},...prev].sort((a,b)=>b.date.localeCompare(a.date)));
      const novoDia = await fetchDiaByDate(today());
      setDia(novoDia);
      showToast(isPast?`Dia ${fmtDate(dia.date)} salvo no histórico!`:"Dia finalizado e salvo no histórico! ✓");
    } catch(e) { showToast("Erro ao finalizar o dia.","error"); }
  }

  async function handleReopenDia(diaHist) {
    try {
      await supabase.from("dias").update({finalizado:false}).eq("id",diaHist.id);
      setHistorico(prev=>prev.filter(h=>h.id!==diaHist.id));
      setDia({...diaHist,finalizado:false});
      setPage("dashboard");
      showToast(`Dia ${fmtDate(diaHist.date)} reaberto.`);
    } catch(e) { showToast("Erro ao reabrir o dia.","error"); }
  }

  async function handleChangeDia(dateStr) {
    try {
      setLoading(true);
      const d = await fetchDiaByDate(dateStr);
      setDia(d);
    } catch(e) { showToast("Erro ao carregar dia.","error"); }
    finally { setLoading(false); }
  }

  const primeiroNome = session?.user?.user_metadata?.full_name?.split(" ")[0] || session?.user?.email?.split("@")[0] || "Usuário";
  const progress = dia ? calcProgress(dia.materiais) : {pct:0};

  if (session===undefined) return (
    <div style={{minHeight:"100vh",background:"#f5f3ef",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{fontSize:32}}>🧪</div>
      <div style={{fontSize:16,fontWeight:600,color:"#1a3a2a"}}>Carregando LabQuality...</div>
    </div>
  );
  if (session===null) return <AuthPage />;
  if (loading) return (
    <div style={{minHeight:"100vh",background:"#f5f3ef",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{fontSize:32}}>🧪</div>
      <div style={{fontSize:16,fontWeight:600,color:"#1a3a2a"}}>Carregando dados...</div>
    </div>
  );

  const NAV=[{id:"dashboard",label:"Dashboard",icon:"📊"},{id:"indicadores",label:"Indicadores",icon:"📈"},{id:"historico",label:"Histórico",icon:"📁"}];

  return (
    <div style={{minHeight:"100vh",background:"#f5f3ef",fontFamily:"system-ui,-apple-system,sans-serif"}}>
      <div style={{background:"#1a3a2a",borderBottom:"1px solid #2d5c42",padding:"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",height:56,position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          <div style={{fontSize:18,fontWeight:900,color:"#fff",letterSpacing:"-.02em"}}><span style={{color:"#7bc99a"}}>Lab</span>Quality</div>
          <div style={{width:1,height:20,background:"#2d5c42"}} />
          <nav style={{display:"flex",gap:2}}>
            {NAV.map(n=>(
              <button key={n.id} onClick={()=>setPage(n.id)} style={{padding:"7px 16px",borderRadius:8,border:"none",background:page===n.id?"rgba(123,201,154,.15)":"transparent",color:page===n.id?"#7bc99a":"#8aac98",cursor:"pointer",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:6,transition:"all .15s"}}>
                <span>{n.icon}</span>{n.label}
              </button>
            ))}
          </nav>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          {dia&&!dia.finalizado&&<>
            <div style={{width:80,height:4,background:"rgba(255,255,255,.15)",borderRadius:2,overflow:"hidden"}}>
              <div style={{height:"100%",width:progress.pct+"%",background:"#7bc99a",borderRadius:2,transition:"width .4s"}} />
            </div>
            <span style={{fontSize:12,color:"#7bc99a",fontWeight:600}}>{progress.pct}%</span>
          </>}
          <div style={{fontSize:12,color:"#7bc99a"}}>{fmtDate(today())}</div>
          <div style={{width:1,height:20,background:"#2d5c42"}} />
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:28,height:28,borderRadius:14,background:"rgba(123,201,154,.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#7bc99a"}}>{primeiroNome.slice(0,2).toUpperCase()}</div>
            <span style={{fontSize:13,color:"#7bc99a",fontWeight:600}}>{primeiroNome}</span>
          </div>
          <button onClick={()=>supabase.auth.signOut()} style={{padding:"5px 12px",borderRadius:7,border:"1px solid rgba(123,201,154,.3)",background:"transparent",color:"#7bc99a",cursor:"pointer",fontSize:12,fontWeight:600}}>Sair</button>
        </div>
      </div>

      <main style={{maxWidth:1400,margin:"0 auto",padding:"2rem 24px"}}>
        <Legend />
        {page==="dashboard"&&dia&&<DashboardPage dia={dia} onFinalizarTurno={handleFinalizarTurno} onFinalizarDia={handleFinalizarDia} onAddMaterial={handleAddMaterial} onUpdateCell={handleUpdateCell} onEditMaterial={handleEditMaterial} onRemoveMaterial={handleRemoveMaterial} onLimparDashboard={handleLimparDashboard} onAnotacaoChange={handleAnotacaoChange} onChangeDia={handleChangeDia} />}
        {page==="indicadores"&&dia&&<IndicadoresPage diaAtual={dia} historico={historico} />}
        {page==="historico"&&<HistoricoPage historico={historico} loading={false} onReopenDia={handleReopenDia} />}
      </main>
      {toast&&<Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}

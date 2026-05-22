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

const STATUS_CONFIG = {
  pendente:  { bg:"#E8E8E4", txt:"#555550", label:"Pendente",     dot:"#AAAAAA" },
  andamento: { bg:"#FFF3C4", txt:"#8A6800", label:"Em Andamento", dot:"#F0B429" },
  concluido: { bg:"#D4F5E0", txt:"#1A6B3A", label:"Concluído",    dot:"#2EAA5F" },
  na:        { bg:"transparent", txt:"transparent", label:"N/A",  dot:"transparent" },
};

function makeCell(status = "pendente", operador = null, hora = null) {
  return { status, operador, hora };
}
function today() { return new Date().toISOString().split("T")[0]; }
function fmtDate(d) { const [y,m,dd] = d.split("-"); return `${dd}/${m}/${y}`; }

function calcProgress(materiais) {
  let total=0, done=0, wip=0;
  materiais.forEach(m => ENSAIOS_DEFAULT.forEach(e => {
    const c = m.cells[e.id];
    if (!c || c.status==="na") return;
    total++; if (c.status==="concluido") done++; if (c.status==="andamento") wip++;
  }));
  return { total, done, wip, pending:total-done-wip, pct:total>0?Math.round((done/total)*100):0 };
}

// ─── Supabase helpers ──────────────────────────────────────────────────────────

// Converte linhas do banco → estrutura usada pelo React
function rowsToDia(diaRow, materiaisRows, ensaiosRows) {
  const materiais = materiaisRows.map(m => {
    const cells = {};
    ENSAIOS_DEFAULT.forEach(e => { cells[e.id] = { status: "na" }; });
    ensaiosRows.filter(en => en.material_id === m.id).forEach(en => {
      cells[en.ensaio_id] = { status: en.status, operador: en.operador, hora: en.hora };
    });
    return { id: m.id, codigo: m.codigo, nome: m.nome, resina: m.resina, cells };
  });
  return { id: diaRow.id, date: diaRow.date, finalizado: diaRow.finalizado, materiais };
}

// Busca ou cria o dia de hoje
async function fetchOrCreateToday() {
  const dateStr = today();
  let { data: dia, error } = await supabase
    .from("dias").select("*").eq("date", dateStr).single();

  if (error && error.code === "PGRST116") {
    // não existe ainda — cria
    const { data: novoDia, error: errCria } = await supabase
      .from("dias").insert({ date: dateStr, finalizado: false }).select().single();
    if (errCria) throw errCria;
    dia = novoDia;
  } else if (error) throw error;

  const { data: materiais } = await supabase
    .from("materiais").select("*").eq("dia_id", dia.id).order("ordem");
  const matIds = (materiais||[]).map(m => m.id);
  const { data: ensaios } = matIds.length
    ? await supabase.from("ensaios").select("*").in("material_id", matIds)
    : { data: [] };

  return rowsToDia(dia, materiais||[], ensaios||[]);
}

// Busca todos os dias finalizados para o histórico
async function fetchHistorico() {
  const { data: dias, error } = await supabase
    .from("dias").select("*").eq("finalizado", true).order("date", { ascending: false });
  if (error) throw error;
  if (!dias || dias.length === 0) return [];

  const diaIds = dias.map(d => d.id);
  const { data: materiais } = await supabase
    .from("materiais").select("*").in("dia_id", diaIds).order("ordem");
  const matIds = (materiais||[]).map(m => m.id);
  const { data: ensaios } = matIds.length
    ? await supabase.from("ensaios").select("*").in("material_id", matIds)
    : { data: [] };

  return dias.map(d => {
    const mats = (materiais||[]).filter(m => m.dia_id === d.id);
    return rowsToDia(d, mats, ensaios||[]);
  });
}

// Adiciona material + ensaios no banco
async function dbAddMaterial(diaId, mat, ordem) {
  const { data: matRow, error } = await supabase
    .from("materiais")
    .insert({ dia_id: diaId, codigo: mat.codigo, nome: mat.nome, resina: mat.resina, ordem })
    .select().single();
  if (error) throw error;

  const ensaiosInsert = ENSAIOS_DEFAULT.map(e => ({
    material_id: matRow.id,
    ensaio_id: e.id,
    status: mat.cells[e.id]?.status || "na",
    operador: null,
    hora: null,
  }));
  const { error: errE } = await supabase.from("ensaios").insert(ensaiosInsert);
  if (errE) throw errE;
  return { ...mat, id: matRow.id };
}

// Atualiza uma célula (ensaio) no banco
async function dbUpdateCell(materialId, ensaioId, data) {
  const { error } = await supabase
    .from("ensaios")
    .update({ status: data.status, operador: data.operador, hora: data.hora, updated_at: new Date().toISOString() })
    .eq("material_id", materialId).eq("ensaio_id", ensaioId);
  if (error) throw error;
}

// Edita material e reconstrói seus ensaios
async function dbEditMaterial(mat) {
  const { error } = await supabase
    .from("materiais")
    .update({ codigo: mat.codigo, nome: mat.nome, resina: mat.resina })
    .eq("id", mat.id);
  if (error) throw error;

  // Atualiza cada célula
  const updates = ENSAIOS_DEFAULT.map(e => ({
    material_id: mat.id,
    ensaio_id: e.id,
    status: mat.cells[e.id]?.status || "na",
    operador: mat.cells[e.id]?.operador || null,
    hora: mat.cells[e.id]?.hora || null,
    updated_at: new Date().toISOString(),
  }));
  const { error: errU } = await supabase
    .from("ensaios").upsert(updates, { onConflict: "material_id,ensaio_id" });
  if (errU) throw errU;
}

// Remove material (ensaios em cascade)
async function dbRemoveMaterial(materialId) {
  const { error } = await supabase.from("materiais").delete().eq("id", materialId);
  if (error) throw error;
}

// Limpa todos os materiais do dia
async function dbLimparDia(diaId) {
  const { error } = await supabase.from("materiais").delete().eq("dia_id", diaId);
  if (error) throw error;
}

// Finaliza o dia e cria novo
async function dbFinalizarDia(diaId) {
  const { error } = await supabase.from("dias").update({ finalizado: true }).eq("id", diaId);
  if (error) throw error;
  // Cria o dia seguinte (hoje, se ainda não existe)
  return fetchOrCreateToday();
}

// ─── Toast ────────────────────────────────────────────────────────────────────
function Toast({ msg, type }) {
  return (
    <div style={{position:"fixed",bottom:24,right:24,zIndex:9999,background:type==="error"?"#dc2626":"#1a3a2a",color:"#fff",padding:"12px 20px",borderRadius:10,fontSize:13,fontWeight:600,boxShadow:"0 8px 24px rgba(0,0,0,.2)",maxWidth:320,animation:"fadeIn .2s ease"}}>
      {type==="error"?"❌ ":"✓ "}{msg}
    </div>
  );
}

// ─── CellModal ────────────────────────────────────────────────────────────────
function CellModal({ cell, ensaio, material, onClose, onSave }) {
  const [status, setStatus] = useState(cell.status==="na"?"pendente":cell.status);
  const [op, setOp] = useState(cell.operador||"");
  const [hora, setHora] = useState(cell.hora||"");
  const [customOp, setCustomOp] = useState(!OPERATORS.includes(cell.operador||""));

  function save() {
    onSave({ status, operador: op||null, hora: status==="concluido"?(hora||new Date().toTimeString().slice(0,5)):null });
    onClose();
  }

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",border:"1px solid #e0ddd6",borderRadius:16,padding:"1.5rem",width:360,boxShadow:"0 20px 60px rgba(0,0,0,.15)"}}>
        <div style={{marginBottom:"1rem"}}>
          <p style={{fontSize:11,color:"#888",margin:0,textTransform:"uppercase",letterSpacing:".08em"}}>{material.codigo} — {material.resina}</p>
          <h3 style={{margin:"4px 0 0",fontSize:16,fontWeight:600,color:"#1a1a18"}}>{ensaio.label}</h3>
        </div>
        <p style={{fontSize:12,color:"#888",margin:"0 0 6px",fontWeight:500}}>Status</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:"1.25rem"}}>
          {["pendente","andamento","concluido"].map(s=>{
            const c=STATUS_CONFIG[s];
            return (
              <button key={s} onClick={()=>setStatus(s)} style={{padding:"8px 4px",borderRadius:8,border:status===s?"2px solid "+c.dot:"1.5px solid #e0ddd6",background:status===s?c.bg:"transparent",cursor:"pointer",fontSize:11,fontWeight:600,color:status===s?c.txt:"#888",transition:"all .15s"}}>
                <div style={{width:8,height:8,borderRadius:4,background:c.dot,margin:"0 auto 4px"}} />
                {c.label}
              </button>
            );
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
        {status==="concluido"&&(
          <>
            <p style={{fontSize:12,color:"#888",margin:"0 0 6px",fontWeight:500}}>Horário de conclusão</p>
            <input type="time" value={hora} onChange={e=>setHora(e.target.value)} style={{border:"1px solid #e0ddd6",borderRadius:8,padding:"7px 10px",fontSize:13,marginBottom:"1rem",width:140}} />
          </>
        )}
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
  const [codigo, setCodigo] = useState("");
  const [resina, setResina] = useState("");
  const [aplicavel, setAplicavel] = useState(["injecao","fusao","densidade","tracao","flexao","charpy_c","izod_c"]);
  const [saving, setSaving] = useState(false);

  function toggleEnsaio(id) {
    setAplicavel(p => p.includes(id)?p.filter(x=>x!==id):[...p,id]);
  }

  async function add() {
    if (!codigo.trim() || saving) return;
    setSaving(true);
    const cells = {};
    ENSAIOS_DEFAULT.forEach(e => {
      cells[e.id] = aplicavel.includes(e.id) ? makeCell("pendente") : { status:"na" };
    });
    await onAdd({ codigo:codigo.trim(), nome:codigo.trim(), resina:resina.trim(), cells });
    onClose();
  }

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:"1.75rem",width:"min(520px,100%)",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.18)"}}>
        <h3 style={{margin:"0 0 1.25rem",fontSize:18,fontWeight:700,color:"#1a1a18"}}>Cadastrar Material</h3>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:"1.25rem"}}>
          <div>
            <label style={{fontSize:11,color:"#888",fontWeight:500,textTransform:"uppercase",letterSpacing:".06em",display:"block",marginBottom:4}}>Código *</label>
            <input value={codigo} onChange={e=>setCodigo(e.target.value)} placeholder="ex: 100.0842" style={{width:"100%",border:"1px solid #e0ddd6",borderRadius:8,padding:"8px 10px",fontSize:13,boxSizing:"border-box"}} />
          </div>
          <div>
            <label style={{fontSize:11,color:"#888",fontWeight:500,textTransform:"uppercase",letterSpacing:".06em",display:"block",marginBottom:4}}>Resina</label>
            <input value={resina} onChange={e=>setResina(e.target.value)} placeholder="ex: PA66 G30" style={{width:"100%",border:"1px solid #e0ddd6",borderRadius:8,padding:"8px 10px",fontSize:13,boxSizing:"border-box"}} />
          </div>
        </div>
        <p style={{fontSize:11,color:"#888",fontWeight:600,textTransform:"uppercase",letterSpacing:".06em",margin:"0 0 8px"}}>Ensaios aplicáveis</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:"1.5rem"}}>
          {ENSAIOS_DEFAULT.map(e=>(
            <label key={e.id} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,color:"#444",padding:"5px 8px",borderRadius:6,background:aplicavel.includes(e.id)?"#d4f5e0":"#f7f5f2",border:aplicavel.includes(e.id)?"1px solid #86d9a8":"1px solid transparent",transition:"all .12s"}}>
              <input type="checkbox" checked={aplicavel.includes(e.id)} onChange={()=>toggleEnsaio(e.id)} style={{accentColor:"#2eaa5f"}} />
              {e.label}
            </label>
          ))}
        </div>
        <div style={{display:"flex",gap:8}}>
          <button onClick={onClose} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13,color:"#888"}}>Cancelar</button>
          <button onClick={add} disabled={!codigo.trim()||saving} style={{flex:2,padding:"10px",borderRadius:8,border:"none",background:codigo.trim()&&!saving?"#1a3a2a":"#ccc",color:"#fff",cursor:codigo.trim()&&!saving?"pointer":"default",fontSize:13,fontWeight:600}}>
            {saving?"Salvando...":"Adicionar Material"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── EditMaterialModal ────────────────────────────────────────────────────────
function EditMaterialModal({ material, onClose, onSave, onRemove }) {
  const [codigo, setCodigo] = useState(material.codigo);
  const [resina, setResina] = useState(material.resina||"");
  const [aplicavel, setAplicavel] = useState(
    ENSAIOS_DEFAULT.filter(e => material.cells[e.id]?.status !== "na").map(e => e.id)
  );
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [saving, setSaving] = useState(false);

  function toggleEnsaio(id) {
    setAplicavel(p => p.includes(id) ? p.filter(x=>x!==id) : [...p,id]);
  }

  async function save() {
    if (!codigo.trim()||saving) return;
    setSaving(true);
    const newCells = {};
    ENSAIOS_DEFAULT.forEach(e => {
      if (!aplicavel.includes(e.id)) { newCells[e.id] = { status:"na" }; }
      else {
        const existing = material.cells[e.id];
        newCells[e.id] = (existing && existing.status !== "na") ? existing : makeCell("pendente");
      }
    });
    await onSave({ ...material, codigo:codigo.trim(), nome:codigo.trim(), resina:resina.trim(), cells:newCells });
    onClose();
  }

  return (
    <div onClick={onClose} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:"1.75rem",width:"min(520px,100%)",maxHeight:"90vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.18)"}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1.25rem"}}>
          <h3 style={{margin:0,fontSize:18,fontWeight:700,color:"#1a1a18"}}>Editar Material</h3>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#aaa",lineHeight:1}}>×</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:"1.25rem"}}>
          <div>
            <label style={{fontSize:11,color:"#888",fontWeight:500,textTransform:"uppercase",letterSpacing:".06em",display:"block",marginBottom:4}}>Código *</label>
            <input value={codigo} onChange={e=>setCodigo(e.target.value)} style={{width:"100%",border:"1px solid #e0ddd6",borderRadius:8,padding:"8px 10px",fontSize:13,boxSizing:"border-box"}} />
          </div>
          <div>
            <label style={{fontSize:11,color:"#888",fontWeight:500,textTransform:"uppercase",letterSpacing:".06em",display:"block",marginBottom:4}}>Resina</label>
            <input value={resina} onChange={e=>setResina(e.target.value)} placeholder="ex: PA66 G30" style={{width:"100%",border:"1px solid #e0ddd6",borderRadius:8,padding:"8px 10px",fontSize:13,boxSizing:"border-box"}} />
          </div>
        </div>
        <p style={{fontSize:11,color:"#888",fontWeight:600,textTransform:"uppercase",letterSpacing:".06em",margin:"0 0 8px"}}>Ensaios aplicáveis</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,marginBottom:"1.5rem"}}>
          {ENSAIOS_DEFAULT.map(e => {
            const ativo = aplicavel.includes(e.id);
            const temDados = material.cells[e.id]?.status==="concluido"||material.cells[e.id]?.status==="andamento";
            return (
              <label key={e.id} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,color:"#444",padding:"5px 8px",borderRadius:6,background:ativo?"#d4f5e0":"#f7f5f2",border:ativo?"1px solid #86d9a8":"1px solid transparent",transition:"all .12s"}}>
                <input type="checkbox" checked={ativo} onChange={()=>toggleEnsaio(e.id)} style={{accentColor:"#2eaa5f"}} />
                {e.label}
                {temDados&&<span style={{marginLeft:"auto",fontSize:9,background:"#fff3c4",color:"#8a6800",padding:"1px 5px",borderRadius:4,fontWeight:700}}>dados</span>}
              </label>
            );
          })}
        </div>
        <div style={{borderTop:"1px solid #f0eeea",paddingTop:"1rem",display:"flex",gap:8,flexWrap:"wrap"}}>
          {confirmRemove ? (
            <>
              <div style={{width:"100%",background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#991b1b",marginBottom:4}}>
                ⚠️ Remover <strong>{material.codigo}</strong>? Esta ação não pode ser desfeita.
              </div>
              <button onClick={()=>setConfirmRemove(false)} style={{flex:1,padding:"9px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13,color:"#888"}}>Cancelar</button>
              <button onClick={()=>{onRemove(material.id);onClose();}} style={{flex:2,padding:"9px",borderRadius:8,border:"none",background:"#dc2626",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Confirmar Remoção</button>
            </>
          ) : (
            <>
              <button onClick={()=>setConfirmRemove(true)} style={{padding:"9px 14px",borderRadius:8,border:"1px solid #fca5a5",background:"#fef2f2",cursor:"pointer",fontSize:13,color:"#dc2626",fontWeight:600}}>🗑 Remover</button>
              <div style={{flex:1}} />
              <button onClick={onClose} style={{padding:"9px 16px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13,color:"#888"}}>Cancelar</button>
              <button onClick={save} disabled={!codigo.trim()||saving} style={{padding:"9px 20px",borderRadius:8,border:"none",background:codigo.trim()&&!saving?"#1a3a2a":"#ccc",color:"#fff",cursor:codigo.trim()&&!saving?"pointer":"default",fontSize:13,fontWeight:600}}>
                {saving?"Salvando...":"Salvar"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── DashboardGrid ────────────────────────────────────────────────────────────
function DashboardGrid({ materiais, onUpdateCell, onEditMaterial, readonly }) {
  const [activeCell, setActiveCell] = useState(null);
  const scrollRef = useRef(null);
  const COL_W = 130, ROW_H = 44;

  function handleCell(mat, ensaio) {
    if (readonly) return;
    const cell = mat.cells[ensaio.id];
    if (!cell || cell.status==="na") return;
    setActiveCell({mat, ensaio, cell});
  }

  return (
    <div style={{overflowX:"auto",borderRadius:12,border:"1px solid #e8e5de"}} ref={scrollRef}>
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
                {!readonly&&(
                  <button onClick={()=>onEditMaterial(m)}
                    style={{marginTop:5,padding:"2px 8px",borderRadius:5,border:"1px solid rgba(123,201,154,.35)",background:"rgba(123,201,154,.12)",color:"#7bc99a",cursor:"pointer",fontSize:10,fontWeight:600,transition:"all .15s"}}
                    onMouseEnter={e=>e.currentTarget.style.background="rgba(123,201,154,.28)"}
                    onMouseLeave={e=>e.currentTarget.style.background="rgba(123,201,154,.12)"}>
                    ✎ editar
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ENSAIOS_DEFAULT.map((ensaio, ri) => (
            <tr key={ensaio.id} style={{background:ri%2===0?"#fafaf8":"#f5f3ef"}}>
              <td style={{padding:"0 16px",height:ROW_H,fontSize:12,fontWeight:500,color:"#3d3d3a",borderRight:"1px solid #e8e5de",whiteSpace:"nowrap"}}>{ensaio.label}</td>
              {materiais.map(mat => {
                const cell = mat.cells[ensaio.id];
                const isNA = !cell || cell.status==="na";
                return (
                  <td key={mat.id} onClick={()=>handleCell(mat,ensaio)}
                    title={isNA?"N/A":`${STATUS_CONFIG[cell.status]?.label}${cell.operador?" — "+cell.operador:""}${cell.hora?" ("+cell.hora+")":""}`}
                    style={{height:ROW_H,padding:0,borderRight:"1px solid #e8e5de",cursor:!isNA&&!readonly?"pointer":"default",position:"relative"}}>
                    <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                      {isNA ? (
                        <div style={{width:"100%",height:"100%",background:"repeating-linear-gradient(-45deg,#ebe9e3,#ebe9e3 4px,#e2e0da 4px,#e2e0da 8px)"}} />
                      ) : (
                        <div style={{width:"100%",height:"100%",background:STATUS_CONFIG[cell.status]?.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2}}>
                          <div style={{width:8,height:8,borderRadius:4,background:STATUS_CONFIG[cell.status]?.dot}} />
                          {cell.operador&&<div style={{fontSize:9,color:STATUS_CONFIG[cell.status]?.txt,fontWeight:600,maxWidth:110,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cell.operador}</div>}
                          {cell.hora&&<div style={{fontSize:9,color:STATUS_CONFIG[cell.status]?.txt,opacity:.8}}>{cell.hora}</div>}
                        </div>
                      )}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      {activeCell&&(
        <CellModal
          cell={activeCell.cell} ensaio={activeCell.ensaio} material={activeCell.mat}
          onClose={()=>setActiveCell(null)}
          onSave={data=>{ onUpdateCell(activeCell.mat.id,activeCell.ensaio.id,data); setActiveCell(null); }}
        />
      )}
    </div>
  );
}

// ─── StatsBar ─────────────────────────────────────────────────────────────────
function StatsBar({ progress }) {
  const { total, done, wip, pending, pct } = progress;
  return (
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:"1.25rem"}}>
      {[
        {label:"Concluídos",   val:done,    color:"#2eaa5f", bg:"#d4f5e0"},
        {label:"Em Andamento", val:wip,     color:"#f0b429", bg:"#fff3c4"},
        {label:"Pendentes",    val:pending, color:"#888",    bg:"#f0eeea"},
        {label:"Progresso",    val:pct+"%", color:"#185fa5", bg:"#e6f1fb"},
      ].map(s=>(
        <div key={s.label} style={{background:s.bg,borderRadius:10,padding:"10px 18px",display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:22,fontWeight:700,color:s.color}}>{s.val}</div>
          <div style={{fontSize:11,color:s.color,fontWeight:600,textTransform:"uppercase",letterSpacing:".05em"}}>{s.label}</div>
        </div>
      ))}
      <div style={{flex:1,minWidth:180,display:"flex",alignItems:"center",gap:10}}>
        <div style={{flex:1,height:8,background:"#e8e5de",borderRadius:4,overflow:"hidden"}}>
          <div style={{height:"100%",width:pct+"%",background:pct>=100?"#2eaa5f":pct>=60?"#f0b429":"#378add",borderRadius:4,transition:"width .5s ease"}} />
        </div>
        <span style={{fontSize:12,color:"#888",minWidth:36}}>{pct}%</span>
      </div>
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
function DashboardPage({ dia, onFinalizarDia, onAddMaterial, onUpdateCell, onEditMaterial, onRemoveMaterial, onLimparDashboard }) {
  const [showAdd, setShowAdd] = useState(false);
  const [showFinalizar, setShowFinalizar] = useState(false);
  const [showLimpar, setShowLimpar] = useState(false);
  const [editingMaterial, setEditingMaterial] = useState(null);
  const progress = calcProgress(dia.materiais);

  return (
    <div>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"1.5rem",flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{display:"flex",alignItems:"center",gap:12}}>
            <h1 style={{margin:0,fontSize:26,fontWeight:800,color:"#1a1a18",letterSpacing:"-.02em"}}>Dashboard Diário</h1>
            {dia.finalizado&&<span style={{background:"#1a3a2a",color:"#7bc99a",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,letterSpacing:".06em"}}>FINALIZADO</span>}
          </div>
          <p style={{margin:"4px 0 0",fontSize:15,color:"#888"}}>{fmtDate(dia.date)} — {dia.materiais.length} {dia.materiais.length===1?"material":"materiais"}</p>
        </div>
        {!dia.finalizado&&(
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={()=>setShowLimpar(true)} style={{padding:"9px 16px",borderRadius:9,border:"1.5px solid #fca5a5",background:"#fef2f2",cursor:"pointer",fontSize:13,fontWeight:600,color:"#dc2626",display:"flex",alignItems:"center",gap:6}}>
              🗑 Limpar Dashboard
            </button>
            <button onClick={()=>setShowAdd(true)} style={{padding:"9px 18px",borderRadius:9,border:"1.5px solid #e0ddd6",background:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,color:"#444",display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:16,lineHeight:1}}>+</span> Adicionar Material
            </button>
            <button onClick={()=>setShowFinalizar(true)} style={{padding:"9px 20px",borderRadius:9,border:"none",background:"#1a3a2a",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>
              ✓ Finalizar Dia
            </button>
          </div>
        )}
      </div>

      <StatsBar progress={progress} />

      {dia.materiais.length===0 ? (
        <div style={{textAlign:"center",padding:"4rem 2rem",color:"#aaa",background:"#fafaf8",borderRadius:12,border:"1.5px dashed #e0ddd6"}}>
          <div style={{fontSize:32,marginBottom:8}}>📋</div>
          <p style={{fontWeight:600,color:"#888",margin:"0 0 8px"}}>Nenhum material cadastrado</p>
          <p style={{fontSize:13,margin:0}}>Clique em "Adicionar Material" para começar</p>
        </div>
      ) : (
        <DashboardGrid materiais={dia.materiais} onUpdateCell={onUpdateCell} onEditMaterial={setEditingMaterial} readonly={dia.finalizado} />
      )}

      {showAdd&&<AddMaterialModal onClose={()=>setShowAdd(false)} onAdd={onAddMaterial} />}
      {editingMaterial&&<EditMaterialModal material={editingMaterial} onClose={()=>setEditingMaterial(null)} onSave={async mat=>{await onEditMaterial(mat);setEditingMaterial(null);}} onRemove={async id=>{await onRemoveMaterial(id);setEditingMaterial(null);}} />}

      {showLimpar&&(
        <div onClick={()=>setShowLimpar(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:"2rem",width:400,boxShadow:"0 20px 60px rgba(0,0,0,.2)"}}>
            <div style={{width:48,height:48,borderRadius:24,background:"#fef2f2",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,marginBottom:"1rem"}}>🗑</div>
            <h3 style={{margin:"0 0 .75rem",fontSize:18,fontWeight:700}}>Limpar o dashboard?</h3>
            <p style={{color:"#666",fontSize:14,margin:"0 0 .75rem",lineHeight:1.6}}>Todos os <strong>{dia.materiais.length} materiais</strong> e seus ensaios serão removidos permanentemente do banco de dados.</p>
            <p style={{color:"#dc2626",fontSize:13,margin:"0 0 1.5rem",fontWeight:600}}>⚠️ Esta ação não pode ser desfeita e os dados não serão salvos no histórico.</p>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowLimpar(false)} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13}}>Cancelar</button>
              <button onClick={()=>{onLimparDashboard();setShowLimpar(false);}} style={{flex:2,padding:"10px",borderRadius:8,border:"none",background:"#dc2626",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Limpar Tudo</button>
            </div>
          </div>
        </div>
      )}

      {showFinalizar&&(
        <div onClick={()=>setShowFinalizar(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:"2rem",width:400,boxShadow:"0 20px 60px rgba(0,0,0,.18)"}}>
            <div style={{width:48,height:48,borderRadius:24,background:"#d4f5e0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,marginBottom:"1rem"}}>✓</div>
            <h3 style={{margin:"0 0 .75rem",fontSize:18,fontWeight:700}}>Finalizar o dia?</h3>
            <p style={{color:"#666",fontSize:14,margin:"0 0 .75rem",lineHeight:1.6}}>O dashboard de <strong>{fmtDate(dia.date)}</strong> será salvo no histórico e o painel será limpo para um novo dia.</p>
            {progress.pct<100&&<div style={{background:"#fff3c4",border:"1px solid #f0b429",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#8a6800",marginBottom:"1.25rem"}}>⚠️ Ainda há <strong>{progress.pending}</strong> ensaio{progress.pending!==1?"s":""} pendente{progress.pending!==1?"s":""}.</div>}
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowFinalizar(false)} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13}}>Cancelar</button>
              <button onClick={()=>{onFinalizarDia();setShowFinalizar(false);}} style={{flex:2,padding:"10px",borderRadius:8,border:"none",background:"#1a3a2a",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Confirmar e Finalizar</button>
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

  const filtrado = historico.filter(h => {
    const byDate = !busca || h.date.includes(busca) || fmtDate(h.date).includes(busca);
    const byCod  = !buscaMat || h.materiais.some(m=>m.codigo.toLowerCase().includes(buscaMat.toLowerCase())||m.resina?.toLowerCase().includes(buscaMat.toLowerCase()));
    return byDate && byCod;
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
            <button onClick={()=>setShowReabrir(true)} style={{padding:"8px 18px",borderRadius:8,border:"1.5px solid #f0b429",background:"#fff8ed",cursor:"pointer",fontSize:13,fontWeight:600,color:"#8a6800",display:"flex",alignItems:"center",gap:6}}>
              🔓 Reabrir Dia
            </button>
          </div>
          <div style={{marginBottom:"1rem"}}>
            <h2 style={{margin:"0 0 4px",fontSize:18,fontWeight:700}}>{fmtDate(selecionado.date)}</h2>
            <p style={{margin:0,color:"#888",fontSize:13}}>{selecionado.materiais.length} materiais — {calcProgress(selecionado.materiais).pct}% concluído</p>
          </div>
          <StatsBar progress={calcProgress(selecionado.materiais)} />
          <DashboardGrid materiais={selecionado.materiais} onUpdateCell={()=>{}} onEditMaterial={()=>{}} readonly={true} />

          {showReabrir&&(
            <div onClick={()=>setShowReabrir(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
              <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:"2rem",width:400,boxShadow:"0 20px 60px rgba(0,0,0,.18)"}}>
                <div style={{width:48,height:48,borderRadius:24,background:"#fff8ed",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,marginBottom:"1rem"}}>🔓</div>
                <h3 style={{margin:"0 0 .75rem",fontSize:18,fontWeight:700}}>Reabrir o dia?</h3>
                <p style={{color:"#666",fontSize:14,margin:"0 0 .75rem",lineHeight:1.6}}>
                  O dia <strong>{fmtDate(selecionado.date)}</strong> voltará para o Dashboard para edição.
                </p>
                <div style={{background:"#fff3c4",border:"1px solid #f0b429",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#8a6800",marginBottom:"1.25rem"}}>
                  ⚠️ O dia atual em aberto no Dashboard será substituído por este.
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>setShowReabrir(false)} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13,color:"#888"}}>Cancelar</button>
                  <button onClick={()=>{onReopenDia(selecionado);setShowReabrir(false);setSelecionado(null);}} style={{flex:2,padding:"10px",borderRadius:8,border:"none",background:"#8a6800",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Confirmar Reabertura</button>
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
            {filtrado.map(h => {
              const prog = calcProgress(h.materiais);
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
          <button onClick={()=>setSelecionado(null)} style={{display:"flex",alignItems:"center",gap:6,marginBottom:"1rem",padding:"7px 14px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13,color:"#444"}}>← Voltar</button>
          <div style={{marginBottom:"1rem"}}>
            <h2 style={{margin:"0 0 4px",fontSize:18,fontWeight:700}}>{fmtDate(selecionado.date)}</h2>
            <p style={{margin:0,color:"#888",fontSize:13}}>{selecionado.materiais.length} materiais — {calcProgress(selecionado.materiais).pct}% concluído</p>
          </div>
          <StatsBar progress={calcProgress(selecionado.materiais)} />
          <DashboardGrid materiais={selecionado.materiais} onUpdateCell={()=>{}} onEditMaterial={()=>{}} readonly={true} />
        </div>
      ) : loading ? (
        <div style={{textAlign:"center",padding:"3rem",color:"#aaa"}}>Carregando histórico...</div>
      ) : (
        <div>
          <p style={{fontSize:13,color:"#aaa",margin:"0 0 12px"}}>{filtrado.length} registro{filtrado.length!==1?"s":""}</p>
          <div style={{display:"grid",gap:8}}>
            {filtrado.map(h => {
              const prog = calcProgress(h.materiais);
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

  function getDiasFiltro(f) {
    const all = [diaAtual, ...historico];
    if (f==="hoje") return all.filter(d=>d.date===today());
    if (f==="semana") { const r=new Date(); r.setDate(r.getDate()-7); return all.filter(d=>new Date(d.date)>=r); }
    if (f==="mes")    { const r=new Date(); r.setDate(r.getDate()-30); return all.filter(d=>new Date(d.date)>=r); }
    return all;
  }

  const diasUsados = getDiasFiltro(filtro);

  const rankingFinal = ENSAIOS_DEFAULT.map(ensaio => {
    let realizados=0, pendentes=0, andamento=0;
    diasUsados.forEach(dia => {
      dia.materiais.forEach(mat => {
        const cell = mat.cells[ensaio.id];
        if (!cell||cell.status==="na") return;
        if (cell.status==="concluido") realizados++;
        else if (cell.status==="andamento") andamento++;
        else pendentes++;
      });
    });
    const total = realizados+andamento+pendentes;
    return { ...ensaio, realizados, pendentes, andamento, total, pct:total>0?Math.round((realizados/total)*100):0 };
  }).sort((a,b)=>b.realizados-a.realizados);

  const maxR = rankingFinal[0]?.realizados||1;
  const totR = rankingFinal.reduce((s,e)=>s+e.realizados,0);
  const totP = rankingFinal.reduce((s,e)=>s+e.pendentes,0);
  const totD = diasUsados.length;
  const media = totD>0?Math.round(totR/totD):0;
  const MEDAL = ["🥇","🥈","🥉"];

  return (
    <div>
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"1.5rem",flexWrap:"wrap",gap:12}}>
        <div>
          <h1 style={{margin:0,fontSize:26,fontWeight:800,color:"#1a1a18",letterSpacing:"-.02em"}}>Indicadores</h1>
          <p style={{margin:"4px 0 0",fontSize:15,color:"#888"}}>Frequência e volume de ensaios realizados</p>
        </div>
        <div style={{display:"flex",gap:6,background:"#eceae5",borderRadius:10,padding:4}}>
          {[{id:"hoje",label:"Hoje"},{id:"semana",label:"7 dias"},{id:"mes",label:"30 dias"},{id:"tudo",label:"Tudo"}].map(o=>(
            <button key={o.id} onClick={()=>setFiltro(o.id)} style={{padding:"6px 16px",borderRadius:7,border:"none",background:filtro===o.id?"#1a3a2a":"transparent",color:filtro===o.id?"#7bc99a":"#888",cursor:"pointer",fontSize:13,fontWeight:600,transition:"all .15s"}}>{o.label}</button>
          ))}
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12,marginBottom:"1.75rem"}}>
        {[
          {label:"Ensaios Realizados",val:totR, color:"#2eaa5f",bg:"#d4f5e0"},
          {label:"Ainda Pendentes",   val:totP, color:"#f0b429",bg:"#fff3c4"},
          {label:"Dias Analisados",   val:totD, color:"#185fa5",bg:"#e6f1fb"},
          {label:"Média por Dia",     val:media,color:"#7b4fa6",bg:"#ede9fb"},
        ].map(c=>(
          <div key={c.label} style={{background:c.bg,borderRadius:12,padding:"14px 18px"}}>
            <div style={{fontSize:28,fontWeight:800,color:c.color,lineHeight:1}}>{c.val}</div>
            <div style={{fontSize:11,color:c.color,fontWeight:600,textTransform:"uppercase",letterSpacing:".05em",marginTop:4,opacity:.85}}>{c.label}</div>
          </div>
        ))}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:20,alignItems:"start"}}>
        <div style={{background:"#fff",borderRadius:14,border:"1px solid #e8e5de",padding:"1.5rem"}}>
          <h2 style={{margin:"0 0 1.25rem",fontSize:16,fontWeight:700,color:"#1a1a18"}}>Ranking de Ensaios</h2>
          <div style={{display:"grid",gap:10}}>
            {rankingFinal.map((e,i)=>(
              <div key={e.id}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:14,width:20,textAlign:"center"}}>{i<3?MEDAL[i]:<span style={{fontSize:12,color:"#bbb",fontWeight:700}}>#{i+1}</span>}</span>
                    <span style={{fontSize:13,fontWeight:600,color:"#2a2a28"}}>{e.label}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{display:"flex",gap:5}}>
                      {e.realizados>0&&<span style={{fontSize:11,background:"#d4f5e0",color:"#1a6b3a",borderRadius:6,padding:"2px 8px",fontWeight:700}}>{e.realizados} ✓</span>}
                      {e.andamento>0&&<span style={{fontSize:11,background:"#fff3c4",color:"#8a6800",borderRadius:6,padding:"2px 8px",fontWeight:700}}>{e.andamento} ⏳</span>}
                      {e.pendentes>0&&<span style={{fontSize:11,background:"#f0eeea",color:"#888",borderRadius:6,padding:"2px 8px",fontWeight:700}}>{e.pendentes} ○</span>}
                    </div>
                    <span style={{fontSize:12,color:"#aaa",minWidth:36,textAlign:"right"}}>{e.pct}%</span>
                  </div>
                </div>
                <div style={{display:"flex",height:10,borderRadius:5,overflow:"hidden",background:"#f0eeea"}}>
                  {e.realizados>0&&<div style={{width:(e.realizados/maxR*100)+"%",background:"#2eaa5f",transition:"width .6s ease",minWidth:4}} />}
                  {e.andamento>0&&<div style={{width:(e.andamento/maxR*100)+"%",background:"#f0b429",transition:"width .6s ease",minWidth:4}} />}
                  {e.pendentes>0&&<div style={{width:(e.pendentes/maxR*100)+"%",background:"#d0cec8",transition:"width .6s ease",minWidth:4}} />}
                </div>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:16,marginTop:"1.25rem",paddingTop:"1rem",borderTop:"1px solid #f0eeea"}}>
            {[{color:"#2eaa5f",label:"Concluídos"},{color:"#f0b429",label:"Em andamento"},{color:"#d0cec8",label:"Pendentes"}].map(l=>(
              <div key={l.label} style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:10,height:10,borderRadius:2,background:l.color}} />
                <span style={{fontSize:11,color:"#888"}}>{l.label}</span>
              </div>
            ))}
          </div>
        </div>
        <div style={{display:"grid",gap:16}}>
          {rankingFinal[0]?.realizados>0&&(
            <div style={{background:"#1a3a2a",borderRadius:14,padding:"1.25rem"}}>
              <div style={{fontSize:11,color:"#7bc99a",fontWeight:600,textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>🏆 Ensaio mais realizado</div>
              <div style={{fontSize:17,fontWeight:800,color:"#fff",lineHeight:1.3,marginBottom:8}}>{rankingFinal[0].label}</div>
              <div style={{fontSize:32,fontWeight:900,color:"#7bc99a",lineHeight:1}}>{rankingFinal[0].realizados}</div>
              <div style={{fontSize:12,color:"#5a9470",marginTop:2}}>execuções concluídas</div>
              <div style={{marginTop:12,height:4,background:"rgba(255,255,255,.1)",borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",width:rankingFinal[0].pct+"%",background:"#7bc99a",borderRadius:2}} />
              </div>
              <div style={{fontSize:11,color:"#5a9470",marginTop:4}}>{rankingFinal[0].pct}% de conclusão</div>
            </div>
          )}
          {rankingFinal.length>0&&(()=>{
            const c=[...rankingFinal].sort((a,b)=>a.realizados-b.realizados).find(e=>e.total>0);
            if(!c) return null;
            return (
              <div style={{background:"#fff8ed",borderRadius:14,border:"1px solid #fce0a0",padding:"1.25rem"}}>
                <div style={{fontSize:11,color:"#b07d00",fontWeight:600,textTransform:"uppercase",letterSpacing:".07em",marginBottom:6}}>⚠️ Menos realizado</div>
                <div style={{fontSize:15,fontWeight:700,color:"#5a3d00",marginBottom:4}}>{c.label}</div>
                <div style={{fontSize:26,fontWeight:900,color:"#c9920a",lineHeight:1}}>{c.realizados}</div>
                <div style={{fontSize:12,color:"#b07d00",marginTop:2}}>{c.pct}% de conclusão</div>
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

const ALLOWED_DOMAIN = "petropol.com.br";

// ─── AuthPage ─────────────────────────────────────────────────────────────────
function AuthPage({ onAuth }) {
  const [mode, setMode]         = useState("login"); // login | cadastro | confirmado
  const [nome, setNome]         = useState("");
  const [email, setEmail]       = useState("");
  const [senha, setSenha]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [erro, setErro]         = useState("");

  function validarEmail(e) {
    if (!e.endsWith(`@${ALLOWED_DOMAIN}`))
      return `Apenas e-mails @${ALLOWED_DOMAIN} são permitidos.`;
    return "";
  }

  async function handleLogin() {
    setErro("");
    const erroEmail = validarEmail(email);
    if (erroEmail) { setErro(erroEmail); return; }
    if (!senha) { setErro("Informe a senha."); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha });
    setLoading(false);
    if (error) {
      if (error.message.includes("Invalid login")) setErro("E-mail ou senha incorretos.");
      else if (error.message.includes("Email not confirmed")) setErro("Confirme seu e-mail antes de entrar.");
      else setErro(error.message);
    }
    // onAuth será chamado automaticamente pelo listener de sessão no App
  }

  async function handleCadastro() {
    setErro("");
    if (!nome.trim()) { setErro("Informe seu nome."); return; }
    const erroEmail = validarEmail(email);
    if (erroEmail) { setErro(erroEmail); return; }
    if (senha.length < 6) { setErro("A senha deve ter ao menos 6 caracteres."); return; }
    setLoading(true);
    const { error } = await supabase.auth.signUp({
      email, password: senha,
      options: { data: { nome_completo: nome.trim() } },
    });
    setLoading(false);
    if (error) { setErro(error.message); return; }
    setMode("confirmado");
  }

  if (mode === "confirmado") return (
    <div style={{minHeight:"100vh",background:"#f5f3ef",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"system-ui,-apple-system,sans-serif"}}>
      <div style={{background:"#fff",borderRadius:20,padding:"2.5rem",width:"min(420px,92vw)",textAlign:"center",boxShadow:"0 20px 60px rgba(0,0,0,.1)"}}>
        <div style={{width:56,height:56,borderRadius:28,background:"#d4f5e0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:26,margin:"0 auto 1.25rem"}}>✉️</div>
        <h2 style={{margin:"0 0 .75rem",fontSize:20,fontWeight:800,color:"#1a1a18"}}>Confirme seu e-mail</h2>
        <p style={{color:"#666",fontSize:14,lineHeight:1.7,margin:"0 0 1.5rem"}}>
          Enviamos um link de confirmação para<br/>
          <strong style={{color:"#1a3a2a"}}>{email}</strong><br/>
          Acesse seu e-mail e clique no link para ativar sua conta.
        </p>
        <button onClick={()=>setMode("login")} style={{padding:"10px 24px",borderRadius:9,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13,color:"#666"}}>
          Voltar ao login
        </button>
      </div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#f5f3ef",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"system-ui,-apple-system,sans-serif"}}>
      <div style={{background:"#fff",borderRadius:20,padding:"2.5rem",width:"min(420px,92vw)",boxShadow:"0 20px 60px rgba(0,0,0,.1)"}}>

        {/* Logo */}
        <div style={{textAlign:"center",marginBottom:"2rem"}}>
          <div style={{fontSize:28,fontWeight:900,color:"#1a3a2a",letterSpacing:"-.02em",marginBottom:4}}>
            <span style={{color:"#2eaa5f"}}>Lab</span>Quality
          </div>
          <div style={{fontSize:12,color:"#aaa",letterSpacing:".06em",textTransform:"uppercase"}}>Controle de Validações · Petropol</div>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",background:"#f0eeea",borderRadius:10,padding:4,marginBottom:"1.5rem"}}>
          {[{id:"login",label:"Entrar"},{id:"cadastro",label:"Cadastrar"}].map(t=>(
            <button key={t.id} onClick={()=>{setMode(t.id);setErro("");}} style={{flex:1,padding:"8px",borderRadius:7,border:"none",background:mode===t.id?"#1a3a2a":"transparent",color:mode===t.id?"#7bc99a":"#888",cursor:"pointer",fontSize:13,fontWeight:700,transition:"all .15s"}}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Campos */}
        <div style={{display:"grid",gap:12}}>
          {mode==="cadastro" && (
            <div>
              <label style={{fontSize:11,color:"#888",fontWeight:600,textTransform:"uppercase",letterSpacing:".06em",display:"block",marginBottom:4}}>Nome completo</label>
              <input value={nome} onChange={e=>setNome(e.target.value)} placeholder="ex: Ana Paula Silva"
                style={{width:"100%",border:"1px solid #e0ddd6",borderRadius:9,padding:"10px 12px",fontSize:14,boxSizing:"border-box",outline:"none"}}
                onFocus={e=>e.target.style.borderColor="#1a3a2a"} onBlur={e=>e.target.style.borderColor="#e0ddd6"} />
            </div>
          )}
          <div>
            <label style={{fontSize:11,color:"#888",fontWeight:600,textTransform:"uppercase",letterSpacing:".06em",display:"block",marginBottom:4}}>E-mail corporativo</label>
            <input value={email} onChange={e=>setEmail(e.target.value)} placeholder={`nome@${ALLOWED_DOMAIN}`} type="email"
              style={{width:"100%",border:"1px solid #e0ddd6",borderRadius:9,padding:"10px 12px",fontSize:14,boxSizing:"border-box",outline:"none"}}
              onFocus={e=>e.target.style.borderColor="#1a3a2a"} onBlur={e=>e.target.style.borderColor="#e0ddd6"} />
          </div>
          <div>
            <label style={{fontSize:11,color:"#888",fontWeight:600,textTransform:"uppercase",letterSpacing:".06em",display:"block",marginBottom:4}}>Senha</label>
            <input value={senha} onChange={e=>setSenha(e.target.value)} type="password"
              placeholder={mode==="cadastro"?"Mínimo 6 caracteres":"Sua senha"}
              style={{width:"100%",border:"1px solid #e0ddd6",borderRadius:9,padding:"10px 12px",fontSize:14,boxSizing:"border-box",outline:"none"}}
              onFocus={e=>e.target.style.borderColor="#1a3a2a"} onBlur={e=>e.target.style.borderColor="#e0ddd6"}
              onKeyDown={e=>e.key==="Enter"&&(mode==="login"?handleLogin():handleCadastro())} />
          </div>
        </div>

        {/* Erro */}
        {erro && (
          <div style={{marginTop:12,background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#dc2626"}}>
            {erro}
          </div>
        )}

        {/* Botão */}
        <button
          onClick={mode==="login"?handleLogin:handleCadastro}
          disabled={loading}
          style={{width:"100%",marginTop:20,padding:"12px",borderRadius:9,border:"none",background:loading?"#ccc":"#1a3a2a",color:"#fff",cursor:loading?"default":"pointer",fontSize:14,fontWeight:700,transition:"background .15s"}}>
          {loading ? "Aguarde..." : mode==="login" ? "Entrar" : "Criar conta"}
        </button>

        <p style={{textAlign:"center",fontSize:12,color:"#bbb",marginTop:"1.25rem",marginBottom:0}}>
          Acesso restrito a <strong>@{ALLOWED_DOMAIN}</strong>
        </p>
      </div>
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage]           = useState("dashboard");
  const [session, setSession]     = useState(undefined); // undefined=carregando, null=sem auth
  const [dia, setDia]             = useState(null);
  const [historico, setHistorico] = useState([]);
  const [loading, setLoading]     = useState(true);
  const [toast, setToast]         = useState(null);

  // Primeiro nome do usuário logado
  const primeiroNome = session?.user?.user_metadata?.nome_completo?.split(" ")[0]
    || session?.user?.email?.split("@")[0]
    || "";

  function showToast(msg, type="success") {
    setToast({msg, type});
    setTimeout(()=>setToast(null), 3500);
  }

  // Listener de sessão — roda uma vez, escuta mudanças de auth
  useEffect(()=>{
    supabase.auth.getSession().then(({ data: { session } })=>{
      setSession(session ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session)=>{
      setSession(session ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Carrega dados quando há sessão ativa
  useEffect(()=>{
    if (!session) { setLoading(false); return; }
    async function init() {
      try {
        setLoading(true);
        const [diaData, histData] = await Promise.all([
          fetchOrCreateToday(),
          fetchHistorico(),
        ]);
        setDia(diaData);
        setHistorico(histData);
      } catch(e) {
        console.error(e);
        showToast("Erro ao conectar com o banco de dados.", "error");
      } finally {
        setLoading(false);
      }
    }
    init();
  }, [session]);

  async function handleUpdateCell(matId, ensaioId, data) {
    // Atualiza UI imediatamente (otimista)
    setDia(prev=>({...prev, materiais:prev.materiais.map(m=>
      m.id!==matId ? m : {...m, cells:{...m.cells,[ensaioId]:{...m.cells[ensaioId],...data}}}
    )}));
    try {
      await dbUpdateCell(matId, ensaioId, data);
    } catch(e) {
      showToast("Erro ao salvar ensaio.", "error");
    }
  }

  async function handleAddMaterial(mat) {
    try {
      const ordem = dia.materiais.length;
      const matSalvo = await dbAddMaterial(dia.id, mat, ordem);
      setDia(prev=>({...prev, materiais:[...prev.materiais, matSalvo]}));
      showToast(`Material ${matSalvo.codigo} adicionado.`);
    } catch(e) {
      showToast("Erro ao adicionar material.", "error");
    }
  }

  async function handleEditMaterial(mat) {
    setDia(prev=>({...prev, materiais:prev.materiais.map(m=>m.id===mat.id?mat:m)}));
    try {
      await dbEditMaterial(mat);
      showToast("Material atualizado.");
    } catch(e) {
      showToast("Erro ao editar material.", "error");
    }
  }

  async function handleRemoveMaterial(id) {
    setDia(prev=>({...prev, materiais:prev.materiais.filter(m=>m.id!==id)}));
    try {
      await dbRemoveMaterial(id);
      showToast("Material removido.");
    } catch(e) {
      showToast("Erro ao remover material.", "error");
    }
  }

  async function handleLimparDashboard() {
    const backup = dia.materiais;
    setDia(prev=>({...prev, materiais:[]}));
    try {
      await dbLimparDia(dia.id);
      showToast("Dashboard limpo.");
    } catch(e) {
      setDia(prev=>({...prev, materiais:backup}));
      showToast("Erro ao limpar dashboard.", "error");
    }
  }

  async function handleFinalizarDia() {
    try {
      const novoDia = await dbFinalizarDia(dia.id);
      setHistorico(prev=>[{...dia, finalizado:true}, ...prev]);
      setDia(novoDia);
      showToast("Dia finalizado e salvo no histórico! ✓");
    } catch(e) {
      showToast("Erro ao finalizar o dia.", "error");
    }
  }

  async function handleReopenDia(diaHist) {
    try {
      // Marca o dia do histórico como não finalizado no banco
      const { error } = await supabase.from("dias").update({ finalizado: false }).eq("id", diaHist.id);
      if (error) throw error;
      // Remove do histórico local e coloca como dia ativo
      setHistorico(prev => prev.filter(h => h.id !== diaHist.id));
      setDia({ ...diaHist, finalizado: false });
      setPage("dashboard");
      showToast(`Dia ${fmtDate(diaHist.date)} reaberto para edição.`);
    } catch(e) {
      showToast("Erro ao reabrir o dia.", "error");
    }
  }

  const NAV = [
    {id:"dashboard",   label:"Dashboard",  icon:"📊"},
    {id:"indicadores", label:"Indicadores",icon:"📈"},
    {id:"historico",   label:"Histórico",  icon:"📁"},
  ];

  const progress = dia ? calcProgress(dia.materiais) : {pct:0};

  // session === undefined → ainda verificando auth (splash)
  // session === null     → sem login → mostra AuthPage
  // session === object   → logado → mostra app
  if (session === undefined) return (
    <div style={{minHeight:"100vh",background:"#f5f3ef",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{fontSize:32}}>🧪</div>
      <div style={{fontSize:16,fontWeight:600,color:"#1a3a2a"}}>Carregando LabQuality...</div>
    </div>
  );

  if (session === null) return <AuthPage />;

  if (loading) return (
    <div style={{minHeight:"100vh",background:"#f5f3ef",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:16}}>
      <div style={{fontSize:32}}>🧪</div>
      <div style={{fontSize:16,fontWeight:600,color:"#1a3a2a"}}>Carregando LabQuality...</div>
      <div style={{fontSize:13,color:"#aaa"}}>Conectando ao banco de dados</div>
    </div>
  );

  return (
    <div style={{minHeight:"100vh",background:"#f5f3ef",fontFamily:"system-ui,-apple-system,sans-serif"}}>
      <div style={{background:"#1a3a2a",borderBottom:"1px solid #2d5c42",padding:"0 24px",display:"flex",alignItems:"center",justifyContent:"space-between",height:56,position:"sticky",top:0,zIndex:100}}>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          <div style={{fontSize:18,fontWeight:900,color:"#fff",letterSpacing:"-.02em"}}>
            <span style={{color:"#7bc99a"}}>Lab</span>Quality
          </div>
          <div style={{width:1,height:20,background:"#2d5c42"}} />
          <nav style={{display:"flex",gap:2}}>
            {NAV.map(n=>(
              <button key={n.id} onClick={()=>setPage(n.id)} style={{padding:"7px 16px",borderRadius:8,border:"none",background:page===n.id?"rgba(123,201,154,.15)":"transparent",color:page===n.id?"#7bc99a":"#8aac98",cursor:"pointer",fontSize:13,fontWeight:600,display:"flex",alignItems:"center",gap:6,transition:"all .15s"}}>
                <span>{n.icon}</span>{n.label}
              </button>
            ))}
          </nav>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:16}}>
          {dia&&!dia.finalizado&&(
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:80,height:4,background:"rgba(255,255,255,.15)",borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",width:progress.pct+"%",background:"#7bc99a",borderRadius:2,transition:"width .4s"}} />
              </div>
              <span style={{fontSize:12,color:"#7bc99a",fontWeight:600}}>{progress.pct}%</span>
            </div>
          )}
          <div style={{fontSize:12,color:"#7bc99a"}}>{fmtDate(today())}</div>
          {dia?.finalizado&&<span style={{background:"rgba(123,201,154,.2)",color:"#7bc99a",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20}}>DIA FINALIZADO</span>}
          <div style={{width:1,height:20,background:"#2d5c42"}} />
          <div style={{display:"flex",alignItems:"center",gap:10}}>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:28,height:28,borderRadius:14,background:"rgba(123,201,154,.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:11,fontWeight:800,color:"#7bc99a"}}>
                {primeiroNome.slice(0,2).toUpperCase()}
              </div>
              <span style={{fontSize:13,color:"#7bc99a",fontWeight:600}}>{primeiroNome}</span>
            </div>
            <button
              onClick={()=>supabase.auth.signOut()}
              title="Sair"
              style={{padding:"5px 12px",borderRadius:7,border:"1px solid rgba(123,201,154,.3)",background:"transparent",color:"#7bc99a",cursor:"pointer",fontSize:12,fontWeight:600,transition:"all .15s"}}
              onMouseEnter={e=>{e.currentTarget.style.background="rgba(123,201,154,.15)";}}
              onMouseLeave={e=>{e.currentTarget.style.background="transparent";}}>
              Sair
            </button>
          </div>
        </div>
      </div>

      <main style={{maxWidth:1400,margin:"0 auto",padding:"2rem 24px"}}>
        <Legend />
        {page==="dashboard"&&dia&&(
          <DashboardPage dia={dia} onFinalizarDia={handleFinalizarDia} onAddMaterial={handleAddMaterial}
            onUpdateCell={handleUpdateCell} onEditMaterial={handleEditMaterial}
            onRemoveMaterial={handleRemoveMaterial} onLimparDashboard={handleLimparDashboard} />
        )}
        {page==="indicadores"&&dia&&<IndicadoresPage diaAtual={dia} historico={historico} />}
        {page==="historico"&&<HistoricoPage historico={historico} loading={loading} onReopenDia={handleReopenDia} />}
      </main>

      {toast&&<Toast msg={toast.msg} type={toast.type} />}
    </div>
  );
}

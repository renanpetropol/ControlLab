import { useState, useEffect, useRef } from "react";

// ─── Mock Data ─────────────────────────────────────────────────────────────────
const OPERATORS = ["Anna", "André", "Érica", "Gustavo", "Kauã", "Pamela", "Renan"];

const ENSAIOS_DEFAULT = [
  { id: "injecao",       label: "Injeção Corpos de Prova" },
  { id: "fusao",         label: "Ponto de Fusão" },
  { id: "fluidez",       label: "Índice de Fluidez" },
  { id: "densidade",     label: "Densidade" },
  { id: "tracao",        label: "Tração" },
  { id: "flexao",        label: "Flexão" },
  { id: "charpy_c",      label: "Charpy c/ Entalhe - ISO" },
  { id: "izod_c",        label: "Izod c/ Entalhe - ISO" },
  { id: "izod_s",        label: "Izod s/ Entalhe - ISO" },
  { id: "charpy_s",      label: "Charpy s/ Entalhe - ISO" },
  { id: "izod_c_astm",   label: "Izod c/ Entalhe - ASTM" },
  { id: "izod_s_astm",   label: "Izod s/ Entalhe - ASTM" },
];

const RESINAS = ["PA6", "PA66", "PBT", "PP", "ABS", "PC", "POM", "PEEK", "PPS"];

function makeCell(status = "pendente", operador = null, hora = null) {
  return { status, operador, hora };
}

function mockMaterial(codigo, nome, resina, aplicavel) {
  const cells = {};
  ENSAIOS_DEFAULT.forEach(e => {
    if (!aplicavel.includes(e.id)) { cells[e.id] = { status: "na" }; return; }
    const r = Math.random();
    if (r < 0.55) cells[e.id] = makeCell("concluido", OPERATORS[Math.floor(Math.random()*OPERATORS.length)], `${8+Math.floor(Math.random()*9)}:${String(Math.floor(Math.random()*60)).padStart(2,"0")}`);
    else if (r < 0.72) cells[e.id] = makeCell("andamento", OPERATORS[Math.floor(Math.random()*OPERATORS.length)], null);
    else cells[e.id] = makeCell("pendente");
  });
  return { id: crypto.randomUUID(), codigo, nome, resina, cells };
}

const MOCK_HISTORICO = [];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const STATUS_CONFIG = {
  pendente:  { bg:"#E8E8E4", txt:"#555550", label:"Pendente",    dot:"#AAAAAA" },
  andamento: { bg:"#FFF3C4", txt:"#8A6800", label:"Em Andamento",dot:"#F0B429" },
  concluido: { bg:"#D4F5E0", txt:"#1A6B3A", label:"Concluído",   dot:"#2EAA5F" },
  na:        { bg:"transparent", txt:"transparent", label:"N/A", dot:"transparent" },
};

function today() {
  return new Date().toISOString().split("T")[0];
}
function fmtDate(d) {
  const [y,m,dd] = d.split("-");
  return `${dd}/${m}/${y}`;
}

function calcProgress(materiais) {
  let total=0, done=0, wip=0;
  materiais.forEach(m => ENSAIOS_DEFAULT.forEach(e => {
    const c = m.cells[e.id];
    if (!c || c.status==="na") return;
    total++;
    if (c.status==="concluido") done++;
    if (c.status==="andamento") wip++;
  }));
  return { total, done, wip, pending: total-done-wip, pct: total>0 ? Math.round((done/total)*100):0 };
}

// ─── Components ───────────────────────────────────────────────────────────────

function Badge({ status }) {
  const c = STATUS_CONFIG[status];
  if (status==="na") return (
    <div style={{width:"100%",height:"100%",background:"repeating-linear-gradient(-45deg,#f0eeea,#f0eeea 4px,#e6e4df 4px,#e6e4df 8px)"}} />
  );
  return (
    <div style={{background:c.bg,width:"100%",height:"100%",display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:2,transition:"all .15s"}}>
      <div style={{width:8,height:8,borderRadius:4,background:c.dot}} />
    </div>
  );
}

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
      <div onClick={e=>e.stopPropagation()} style={{background:"var(--bg,#fff)",border:"1px solid #e0ddd6",borderRadius:16,padding:"1.5rem",width:360,boxShadow:"0 20px 60px rgba(0,0,0,.15)"}}>
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

function AddMaterialModal({ onClose, onAdd }) {
  const [codigo, setCodigo] = useState("");
  const [resina, setResina] = useState("");
  const [aplicavel, setAplicavel] = useState(["injecao","fusao","densidade","tracao","flexao","charpy_c","izod_c"]);

  function toggleEnsaio(id) {
    setAplicavel(p => p.includes(id)?p.filter(x=>x!==id):[...p,id]);
  }

  function add() {
    if (!codigo.trim()) return;
    const cells = {};
    ENSAIOS_DEFAULT.forEach(e=>{
      cells[e.id] = aplicavel.includes(e.id) ? makeCell("pendente") : {status:"na"};
    });
    onAdd({ id:crypto.randomUUID(), codigo:codigo.trim(), nome:codigo.trim(), resina:resina.trim(), obs:"", cells });
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
          <button onClick={add} disabled={!codigo.trim()} style={{flex:2,padding:"10px",borderRadius:8,border:"none",background:codigo.trim()?"#1a3a2a":"#ccc",color:"#fff",cursor:codigo.trim()?"pointer":"default",fontSize:13,fontWeight:600}}>Adicionar Material</button>
        </div>
      </div>
    </div>
  );
}

// ─── Edit Material Modal ──────────────────────────────────────────────────────
function EditMaterialModal({ material, onClose, onSave, onRemove }) {
  const [codigo, setCodigo] = useState(material.codigo);
  const [resina, setResina] = useState(material.resina);
  const [aplicavel, setAplicavel] = useState(
    ENSAIOS_DEFAULT.filter(e => material.cells[e.id]?.status !== "na").map(e => e.id)
  );
  const [confirmRemove, setConfirmRemove] = useState(false);

  function toggleEnsaio(id) {
    setAplicavel(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }

  function save() {
    if (!codigo.trim()) return;
    const newCells = {};
    ENSAIOS_DEFAULT.forEach(e => {
      if (!aplicavel.includes(e.id)) {
        newCells[e.id] = { status: "na" };
      } else {
        const existing = material.cells[e.id];
        newCells[e.id] = (existing && existing.status !== "na") ? existing : makeCell("pendente");
      }
    });
    onSave({ ...material, codigo: codigo.trim(), nome: codigo.trim(), resina: resina.trim(), cells: newCells });
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
            const temDados = material.cells[e.id]?.status === "concluido" || material.cells[e.id]?.status === "andamento";
            return (
              <label key={e.id} style={{display:"flex",alignItems:"center",gap:8,cursor:"pointer",fontSize:12,color:"#444",padding:"5px 8px",borderRadius:6,background:ativo?"#d4f5e0":"#f7f5f2",border:ativo?"1px solid #86d9a8":"1px solid transparent",transition:"all .12s",position:"relative"}}>
                <input type="checkbox" checked={ativo} onChange={()=>toggleEnsaio(e.id)} style={{accentColor:"#2eaa5f"}} />
                {e.label}
                {temDados && <span title="Tem dados registrados" style={{marginLeft:"auto",fontSize:9,background:"#fff3c4",color:"#8a6800",padding:"1px 5px",borderRadius:4,fontWeight:700}}>dados</span>}
              </label>
            );
          })}
        </div>

        <div style={{borderTop:"1px solid #f0eeea",paddingTop:"1rem",display:"flex",gap:8,flexWrap:"wrap"}}>
          {confirmRemove ? (
            <>
              <div style={{width:"100%",background:"#fef2f2",border:"1px solid #fca5a5",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#991b1b",marginBottom:4}}>
                ⚠️ Remover <strong>{material.codigo}</strong> do dashboard? Esta ação não pode ser desfeita.
              </div>
              <button onClick={()=>setConfirmRemove(false)} style={{flex:1,padding:"9px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13,color:"#888"}}>Cancelar</button>
              <button onClick={()=>{onRemove(material.id);onClose();}} style={{flex:2,padding:"9px",borderRadius:8,border:"none",background:"#dc2626",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Confirmar Remoção</button>
            </>
          ) : (
            <>
              <button onClick={()=>setConfirmRemove(true)} style={{padding:"9px 14px",borderRadius:8,border:"1px solid #fca5a5",background:"#fef2f2",cursor:"pointer",fontSize:13,color:"#dc2626",fontWeight:600}}>🗑 Remover</button>
              <div style={{flex:1}} />
              <button onClick={onClose} style={{padding:"9px 16px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13,color:"#888"}}>Cancelar</button>
              <button onClick={save} disabled={!codigo.trim()} style={{padding:"9px 20px",borderRadius:8,border:"none",background:codigo.trim()?"#1a3a2a":"#ccc",color:"#fff",cursor:codigo.trim()?"pointer":"default",fontSize:13,fontWeight:600}}>Salvar</button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard Grid ────────────────────────────────────────────────────────────
function DashboardGrid({ materiais, onUpdateCell, onEditMaterial, readonly }) {
  const [activeCell, setActiveCell] = useState(null);
  const scrollRef = useRef(null);

  const COL_W = 130;
  const ROW_H = 44;

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
                {!readonly && (
                  <button onClick={()=>onEditMaterial(m)}
                    title="Editar material"
                    style={{marginTop:5,padding:"2px 8px",borderRadius:5,border:"1px solid rgba(123,201,154,.35)",background:"rgba(123,201,154,.12)",color:"#7bc99a",cursor:"pointer",fontSize:10,fontWeight:600,letterSpacing:".04em",transition:"all .15s"}}
                    onMouseEnter={e=>{e.currentTarget.style.background="rgba(123,201,154,.28)";}}
                    onMouseLeave={e=>{e.currentTarget.style.background="rgba(123,201,154,.12)";}}>
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
              <td style={{padding:"0 16px",height:ROW_H,fontSize:12,fontWeight:500,color:"#3d3d3a",borderRight:"1px solid #e8e5de",whiteSpace:"nowrap"}}>
                {ensaio.label}
              </td>
              {materiais.map(mat=>{
                const cell = mat.cells[ensaio.id];
                const isNA = !cell || cell.status==="na";
                const clickable = !isNA && !readonly;
                return (
                  <td key={mat.id} title={isNA?"N/A":`${STATUS_CONFIG[cell.status]?.label}${cell.operador?" — "+cell.operador:""}${cell.hora?" ("+cell.hora+")":""}`}
                    onClick={()=>handleCell(mat,ensaio)}
                    style={{height:ROW_H,padding:0,borderRight:"1px solid #e8e5de",cursor:clickable?"pointer":"default",transition:"opacity .1s",position:"relative"}}
                  >
                    <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                      {isNA ? (
                        <div style={{width:"100%",height:"100%",background:"repeating-linear-gradient(-45deg,#ebe9e3,#ebe9e3 4px,#e2e0da 4px,#e2e0da 8px)"}} />
                      ) : (
                        <div style={{width:"100%",height:"100%",background:STATUS_CONFIG[cell.status]?.bg,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2}}>
                          <div style={{width:8,height:8,borderRadius:4,background:STATUS_CONFIG[cell.status]?.dot}} />
                          {cell.operador&&<div style={{fontSize:9,color:STATUS_CONFIG[cell.status]?.txt,fontWeight:600,maxWidth:90,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cell.operador}</div>}
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
          cell={activeCell.cell}
          ensaio={activeCell.ensaio}
          material={activeCell.mat}
          onClose={()=>setActiveCell(null)}
          onSave={(data)=>{
            onUpdateCell(activeCell.mat.id, activeCell.ensaio.id, data);
            setActiveCell(null);
          }}
        />
      )}
    </div>
  );
}

// ─── Stats Bar ─────────────────────────────────────────────────────────────────
function StatsBar({ progress }) {
  const { total, done, wip, pending, pct } = progress;
  return (
    <div style={{display:"flex",gap:12,flexWrap:"wrap",marginBottom:"1.25rem"}}>
      {[
        {label:"Concluídos", val:done, color:"#2eaa5f",bg:"#d4f5e0"},
        {label:"Em Andamento", val:wip, color:"#f0b429",bg:"#fff3c4"},
        {label:"Pendentes", val:pending, color:"#888",bg:"#f0eeea"},
        {label:"Progresso", val:pct+"%", color:"#185fa5",bg:"#e6f1fb"},
      ].map(s=>(
        <div key={s.label} style={{background:s.bg,borderRadius:10,padding:"10px 18px",display:"flex",alignItems:"center",gap:10,border:"1px solid transparent"}}>
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

// ─── Dashboard Page ────────────────────────────────────────────────────────────
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
            {dia.finalizado && <span style={{background:"#1a3a2a",color:"#7bc99a",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20,letterSpacing:".06em"}}>FINALIZADO</span>}
          </div>
          <p style={{margin:"4px 0 0",fontSize:15,color:"#888"}}>{fmtDate(dia.date)} — {dia.materiais.length} {dia.materiais.length===1?"material":"materiais"}</p>
        </div>
        {!dia.finalizado && (
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={()=>setShowLimpar(true)}
              style={{padding:"9px 16px",borderRadius:9,border:"1.5px solid #fca5a5",background:"#fef2f2",cursor:"pointer",fontSize:13,fontWeight:600,color:"#dc2626",display:"flex",alignItems:"center",gap:6}}>
              🗑 Limpar Dashboard
            </button>
            <button onClick={()=>setShowAdd(true)}
              style={{padding:"9px 18px",borderRadius:9,border:"1.5px solid #e0ddd6",background:"#fff",cursor:"pointer",fontSize:13,fontWeight:600,color:"#444",display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontSize:16,lineHeight:1}}>+</span> Adicionar Material
            </button>
            <button onClick={()=>setShowFinalizar(true)}
              style={{padding:"9px 20px",borderRadius:9,border:"none",background:"#1a3a2a",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>
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
        <DashboardGrid
          materiais={dia.materiais}
          onUpdateCell={onUpdateCell}
          onEditMaterial={setEditingMaterial}
          readonly={dia.finalizado}
        />
      )}

      {/* Modal: Adicionar */}
      {showAdd && (
        <AddMaterialModal
          onClose={()=>setShowAdd(false)}
          onAdd={mat=>{onAddMaterial(mat);setShowAdd(false);}}
        />
      )}

      {/* Modal: Editar material */}
      {editingMaterial && (
        <EditMaterialModal
          material={editingMaterial}
          onClose={()=>setEditingMaterial(null)}
          onSave={mat=>{onEditMaterial(mat);setEditingMaterial(null);}}
          onRemove={id=>{onRemoveMaterial(id);setEditingMaterial(null);}}
        />
      )}

      {/* Modal: Limpar dashboard */}
      {showLimpar && (
        <div onClick={()=>setShowLimpar(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:"2rem",width:400,boxShadow:"0 20px 60px rgba(0,0,0,.2)"}}>
            <div style={{width:48,height:48,borderRadius:24,background:"#fef2f2",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,marginBottom:"1rem"}}>🗑</div>
            <h3 style={{margin:"0 0 .75rem",fontSize:18,fontWeight:700,color:"#1a1a18"}}>Limpar o dashboard?</h3>
            <p style={{color:"#666",fontSize:14,margin:"0 0 .75rem",lineHeight:1.6}}>
              Todos os <strong>{dia.materiais.length} materiais</strong> e seus ensaios serão removidos permanentemente.
            </p>
            <p style={{color:"#dc2626",fontSize:13,margin:"0 0 1.5rem",fontWeight:600}}>
              ⚠️ Esta ação não pode ser desfeita e os dados não serão salvos no histórico.
            </p>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setShowLimpar(false)} style={{flex:1,padding:"10px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13,color:"#888"}}>Cancelar</button>
              <button onClick={()=>{onLimparDashboard();setShowLimpar(false);}} style={{flex:2,padding:"10px",borderRadius:8,border:"none",background:"#dc2626",color:"#fff",cursor:"pointer",fontSize:13,fontWeight:700}}>Limpar Tudo</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Finalizar dia */}
      {showFinalizar && (
        <div onClick={()=>setShowFinalizar(false)} style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center"}}>
          <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:16,padding:"2rem",width:400,boxShadow:"0 20px 60px rgba(0,0,0,.18)"}}>
            <div style={{width:48,height:48,borderRadius:24,background:"#d4f5e0",display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,marginBottom:"1rem"}}>✓</div>
            <h3 style={{margin:"0 0 .75rem",fontSize:18,fontWeight:700}}>Finalizar o dia?</h3>
            <p style={{color:"#666",fontSize:14,margin:"0 0 .75rem",lineHeight:1.6}}>
              O dashboard de <strong>{fmtDate(dia.date)}</strong> será salvo no histórico e o dashboard será limpo para um novo dia.
            </p>
            {progress.pct<100 && (
              <div style={{background:"#fff3c4",border:"1px solid #f0b429",borderRadius:8,padding:"10px 14px",fontSize:13,color:"#8a6800",marginBottom:"1.25rem"}}>
                ⚠️ Ainda há <strong>{progress.pending}</strong> ensaio{progress.pending!==1?"s":""} pendente{progress.pending!==1?"s":""}.
              </div>
            )}
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

// ─── Historico Page ────────────────────────────────────────────────────────────
function HistoricoPage({ historico }) {
  const [busca, setBusca] = useState("");
  const [buscaMat, setBuscaMat] = useState("");
  const [selecionado, setSelecionado] = useState(null);

  const filtrado = historico.filter(h=>{
    const byDate = !busca || h.date.includes(busca) || fmtDate(h.date).includes(busca);
    const byCod = !buscaMat || h.materiais.some(m=>m.codigo.toLowerCase().includes(buscaMat.toLowerCase())||m.resina.toLowerCase().includes(buscaMat.toLowerCase()));
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
          <button onClick={()=>setSelecionado(null)} style={{display:"flex",alignItems:"center",gap:6,marginBottom:"1rem",padding:"7px 14px",borderRadius:8,border:"1px solid #e0ddd6",background:"transparent",cursor:"pointer",fontSize:13,color:"#444"}}>
            ← Voltar
          </button>
          <div style={{marginBottom:"1rem"}}>
            <h2 style={{margin:"0 0 4px",fontSize:18,fontWeight:700}}>{fmtDate(selecionado.date)}</h2>
            <p style={{margin:0,color:"#888",fontSize:13}}>{selecionado.materiais.length} materiais — {calcProgress(selecionado.materiais).pct}% concluído</p>
          </div>
          <StatsBar progress={calcProgress(selecionado.materiais)} />
          <DashboardGrid materiais={selecionado.materiais} onUpdateCell={()=>{}} readonly={true} />
        </div>
      ) : (
        <div>
          <p style={{fontSize:13,color:"#aaa",margin:"0 0 12px"}}>{filtrado.length} registro{filtrado.length!==1?"s":""}</p>
          <div style={{display:"grid",gap:8}}>
            {filtrado.map(h=>{
              const prog = calcProgress(h.materiais);
              return (
                <div key={h.id} onClick={()=>setSelecionado(h)} style={{background:"#fff",borderRadius:12,border:"1px solid #e8e5de",padding:"14px 18px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,transition:"box-shadow .15s,border-color .15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.borderColor="#1a3a2a";e.currentTarget.style.boxShadow="0 4px 16px rgba(26,58,42,.08)";}}
                  onMouseLeave={e=>{e.currentTarget.style.borderColor="#e8e5de";e.currentTarget.style.boxShadow="none";}}>
                  <div>
                    <div style={{fontWeight:700,fontSize:15,color:"#1a1a18"}}>{fmtDate(h.date)}</div>
                    <div style={{fontSize:12,color:"#888",marginTop:2}}>{h.materiais.length} materiais — {h.materiais.map(m=>m.resina).filter((v,i,a)=>a.indexOf(v)===i).join(", ")}</div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontSize:18,fontWeight:800,color:prog.pct>=100?"#2eaa5f":prog.pct>=60?"#f0b429":"#888"}}>{prog.pct}%</div>
                      <div style={{fontSize:10,color:"#aaa",textTransform:"uppercase",letterSpacing:".05em"}}>Concluído</div>
                    </div>
                    <div style={{width:48,height:48,borderRadius:24,background:"#f0eeea",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
                      <div style={{width:36,height:36,borderRadius:18,background:"conic-gradient(#2eaa5f "+prog.pct+"%, #e8e5de "+prog.pct+"%)",display:"flex",alignItems:"center",justifyContent:"center"}}>
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

// ─── Legend ────────────────────────────────────────────────────────────────────
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

// ─── Indicadores Page ─────────────────────────────────────────────────────────
function IndicadoresPage({ diaAtual, historico }) {
  const [periodo, setPeriodo] = useState("mes");
  const [origem, setOrigem] = useState("historico");

  // Constrói o pool de dias a analisar
  const todosDias = [diaAtual, ...historico];

  const diasFiltrados = todosDias.filter(d => {
    if (origem === "hoje") return d.date === today();
    if (periodo === "semana") {
      const ref = new Date(); ref.setDate(ref.getDate() - 7);
      return new Date(d.date) >= ref;
    }
    if (periodo === "mes") {
      const ref = new Date(); ref.setDate(ref.getDate() - 30);
      return new Date(d.date) >= ref;
    }
    return true;
  });

  // Contadores por ensaio
  const contadores = ENSAIOS_DEFAULT.map(ensaio => {
    let realizados = 0, pendentes = 0, andamento = 0, naCount = 0;
    diasFiltrados.forEach(dia => {
      dia.materiais.forEach(mat => {
        const cell = mat.cells[ensaio.id];
        if (!cell || cell.status === "na") { naCount++; return; }
        if (cell.status === "concluido") realizados++;
        else if (cell.status === "andamento") andamento++;
        else pendentes++;
      });
    });
    const total = realizados + andamento + pendentes;
    const pct = total > 0 ? Math.round((realizados / total) * 100) : 0;
    return { ...ensaio, realizados, pendentes, andamento, total, pct };
  });

  const ranking = [...contadores].sort((a, b) => b.realizados - a.realizados);
  const maxVal = ranking[0]?.realizados || 1;

  // Contadores por operador
  const porOperador = {};
  diasFiltrados.forEach(dia => {
    dia.materiais.forEach(mat => {
      ENSAIOS_DEFAULT.forEach(e => {
        const cell = mat.cells[e.id];
        if (cell?.status === "concluido" && cell.operador) {
          porOperador[cell.operador] = (porOperador[cell.operador] || 0) + 1;
        }
      });
    });
  });
  const rankingOp = Object.entries(porOperador)
    .map(([nome, count]) => ({ nome, count }))
    .sort((a, b) => b.count - a.count);
  const maxOp = rankingOp[0]?.count || 1;

  // Totais gerais
  const totalRealizados = contadores.reduce((s, e) => s + e.realizados, 0);
  const totalPendentes  = contadores.reduce((s, e) => s + e.pendentes, 0);
  const totalDias       = diasFiltrados.length;
  const mediaHoje       = totalDias > 0 ? Math.round(totalRealizados / totalDias) : 0;

  const PERIODO_OPTS = [
    { id: "hoje",     label: "Hoje" },
    { id: "historico", label: "Últimos 7 dias", periodo: "semana" },
    { id: "historico2", label: "Últimos 30 dias", periodo: "mes" },
    { id: "tudo",     label: "Tudo" },
  ];

  // estado de filtro simplificado
  const [filtro, setFiltro] = useState("mes");
  function getDiasFiltro(f) {
    const all = [diaAtual, ...historico];
    if (f === "hoje") return all.filter(d => d.date === today());
    if (f === "semana") { const r = new Date(); r.setDate(r.getDate()-7); return all.filter(d => new Date(d.date)>=r); }
    if (f === "mes")    { const r = new Date(); r.setDate(r.getDate()-30); return all.filter(d => new Date(d.date)>=r); }
    return all;
  }

  const diasUsados = getDiasFiltro(filtro);

  const rankingFinal = ENSAIOS_DEFAULT.map(ensaio => {
    let realizados = 0, pendentes = 0, andamento = 0;
    diasUsados.forEach(dia => {
      dia.materiais.forEach(mat => {
        const cell = mat.cells[ensaio.id];
        if (!cell || cell.status === "na") return;
        if (cell.status === "concluido") realizados++;
        else if (cell.status === "andamento") andamento++;
        else pendentes++;
      });
    });
    const total = realizados + andamento + pendentes;
    return { ...ensaio, realizados, pendentes, andamento, total, pct: total > 0 ? Math.round((realizados/total)*100) : 0 };
  }).sort((a, b) => b.realizados - a.realizados);

  const maxR = rankingFinal[0]?.realizados || 1;

  const opCount = {};
  diasUsados.forEach(dia => {
    dia.materiais.forEach(mat => {
      ENSAIOS_DEFAULT.forEach(e => {
        const cell = mat.cells[e.id];
        if (cell?.status === "concluido" && cell.operador) {
          opCount[cell.operador] = (opCount[cell.operador] || 0) + 1;
        }
      });
    });
  });
  const rankOp = Object.entries(opCount).map(([nome,count])=>({nome,count})).sort((a,b)=>b.count-a.count);
  const maxOpR = rankOp[0]?.count || 1;

  const totR  = rankingFinal.reduce((s,e)=>s+e.realizados,0);
  const totP  = rankingFinal.reduce((s,e)=>s+e.pendentes,0);
  const totD  = diasUsados.length;
  const media = totD > 0 ? Math.round(totR / totD) : 0;

  const MEDAL = ["🥇","🥈","🥉"];

  return (
    <div>
      {/* Título + filtros */}
      <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:"1.5rem",flexWrap:"wrap",gap:12}}>
        <div>
          <h1 style={{margin:0,fontSize:26,fontWeight:800,color:"#1a1a18",letterSpacing:"-.02em"}}>Indicadores</h1>
          <p style={{margin:"4px 0 0",fontSize:15,color:"#888"}}>Frequência e volume de ensaios realizados</p>
        </div>
        <div style={{display:"flex",gap:6,background:"#eceae5",borderRadius:10,padding:4}}>
          {[
            {id:"hoje",   label:"Hoje"},
            {id:"semana", label:"7 dias"},
            {id:"mes",    label:"30 dias"},
            {id:"tudo",   label:"Tudo"},
          ].map(o=>(
            <button key={o.id} onClick={()=>setFiltro(o.id)}
              style={{padding:"6px 16px",borderRadius:7,border:"none",background:filtro===o.id?"#1a3a2a":"transparent",color:filtro===o.id?"#7bc99a":"#888",cursor:"pointer",fontSize:13,fontWeight:600,transition:"all .15s"}}>
              {o.label}
            </button>
          ))}
        </div>
      </div>

      {/* Cards de resumo */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:12,marginBottom:"1.75rem"}}>
        {[
          {label:"Ensaios Realizados", val:totR,  color:"#2eaa5f", bg:"#d4f5e0"},
          {label:"Ainda Pendentes",    val:totP,  color:"#f0b429", bg:"#fff3c4"},
          {label:"Dias Analisados",    val:totD,  color:"#185fa5", bg:"#e6f1fb"},
          {label:"Média por Dia",      val:media, color:"#7b4fa6", bg:"#ede9fb"},
        ].map(c=>(
          <div key={c.label} style={{background:c.bg,borderRadius:12,padding:"14px 18px"}}>
            <div style={{fontSize:28,fontWeight:800,color:c.color,lineHeight:1}}>{c.val}</div>
            <div style={{fontSize:11,color:c.color,fontWeight:600,textTransform:"uppercase",letterSpacing:".05em",marginTop:4,opacity:.85}}>{c.label}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:20,alignItems:"start"}}>

        {/* Ranking de ensaios — barra horizontal */}
        <div style={{background:"#fff",borderRadius:14,border:"1px solid #e8e5de",padding:"1.5rem"}}>
          <h2 style={{margin:"0 0 1.25rem",fontSize:16,fontWeight:700,color:"#1a1a18"}}>Ranking de Ensaios</h2>
          <div style={{display:"grid",gap:10}}>
            {rankingFinal.map((e, i) => (
              <div key={e.id}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:5}}>
                  <div style={{display:"flex",alignItems:"center",gap:8}}>
                    <span style={{fontSize:14,width:20,textAlign:"center"}}>{i < 3 ? MEDAL[i] : <span style={{fontSize:12,color:"#bbb",fontWeight:700}}>#{i+1}</span>}</span>
                    <span style={{fontSize:13,fontWeight:600,color:"#2a2a28"}}>{e.label}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <div style={{display:"flex",gap:5}}>
                      {e.realizados > 0 && <span style={{fontSize:11,background:"#d4f5e0",color:"#1a6b3a",borderRadius:6,padding:"2px 8px",fontWeight:700}}>{e.realizados} ✓</span>}
                      {e.andamento  > 0 && <span style={{fontSize:11,background:"#fff3c4",color:"#8a6800",borderRadius:6,padding:"2px 8px",fontWeight:700}}>{e.andamento} ⏳</span>}
                      {e.pendentes  > 0 && <span style={{fontSize:11,background:"#f0eeea",color:"#888",borderRadius:6,padding:"2px 8px",fontWeight:700}}>{e.pendentes} ○</span>}
                    </div>
                    <span style={{fontSize:12,color:"#aaa",minWidth:36,textAlign:"right"}}>{e.pct}%</span>
                  </div>
                </div>
                {/* Barra empilhada */}
                <div style={{display:"flex",height:10,borderRadius:5,overflow:"hidden",background:"#f0eeea"}}>
                  {e.realizados > 0 && (
                    <div style={{width:(e.realizados/maxR*100)+"%",background:"#2eaa5f",transition:"width .6s ease",minWidth:e.realizados>0?4:0}} title={`${e.realizados} concluídos`} />
                  )}
                  {e.andamento > 0 && (
                    <div style={{width:(e.andamento/maxR*100)+"%",background:"#f0b429",transition:"width .6s ease",minWidth:e.andamento>0?4:0}} title={`${e.andamento} em andamento`} />
                  )}
                  {e.pendentes > 0 && (
                    <div style={{width:(e.pendentes/maxR*100)+"%",background:"#d0cec8",transition:"width .6s ease",minWidth:e.pendentes>0?4:0}} title={`${e.pendentes} pendentes`} />
                  )}
                </div>
              </div>
            ))}
          </div>
          {/* Legenda da barra */}
          <div style={{display:"flex",gap:16,marginTop:"1.25rem",paddingTop:"1rem",borderTop:"1px solid #f0eeea"}}>
            {[{color:"#2eaa5f",label:"Concluídos"},{color:"#f0b429",label:"Em andamento"},{color:"#d0cec8",label:"Pendentes"}].map(l=>(
              <div key={l.label} style={{display:"flex",alignItems:"center",gap:5}}>
                <div style={{width:10,height:10,borderRadius:2,background:l.color}} />
                <span style={{fontSize:11,color:"#888"}}>{l.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Coluna direita: operadores + ensaio destaque */}
        <div style={{display:"grid",gap:16}}>

          {/* Ensaio mais realizado destaque */}
          {rankingFinal[0]?.realizados > 0 && (
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

          {/* Ensaio menos realizado */}
          {rankingFinal.length > 0 && (() => {
            const c = [...rankingFinal].sort((a,b)=>a.realizados-b.realizados).find(e=>e.total>0);
            if (!c) return null;
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

// ─── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("dashboard");
  const [historico, setHistorico] = useState(MOCK_HISTORICO);
  const [dia, setDia] = useState({
    id: "hoje",
    date: today(),
    materiais: [],
    finalizado: false,
  });

  function handleUpdateCell(matId, ensaioId, data) {
    setDia(prev=>({
      ...prev,
      materiais: prev.materiais.map(m=>
        m.id!==matId ? m : {...m, cells:{...m.cells,[ensaioId]:{...m.cells[ensaioId],...data}}}
      )
    }));
  }

  function handleAddMaterial(mat) {
    setDia(prev=>({...prev, materiais:[...prev.materiais, mat]}));
  }

  function handleEditMaterial(mat) {
    setDia(prev=>({...prev, materiais: prev.materiais.map(m=> m.id===mat.id ? mat : m)}));
  }

  function handleRemoveMaterial(id) {
    setDia(prev=>({...prev, materiais: prev.materiais.filter(m=> m.id!==id)}));
  }

  function handleLimparDashboard() {
    setDia(prev=>({...prev, materiais: [], finalizado: false}));
  }

  function handleFinalizarDia() {
    // Save current day to history
    const diaFinalizado = {...dia, finalizado: true};
    setHistorico(prev=>[diaFinalizado, ...prev]);
    // Reset dashboard to a fresh new day
    setDia({
      id: crypto.randomUUID(),
      date: today(),
      materiais: [],
      finalizado: false,
    });
  }

  const NAV = [
    {id:"dashboard",   label:"Dashboard",  icon:"📊"},
    {id:"indicadores", label:"Indicadores",icon:"📈"},
    {id:"historico",   label:"Histórico",  icon:"📁"},
  ];

  const progress = calcProgress(dia.materiais);

  return (
    <div style={{minHeight:"100vh",background:"#f5f3ef",fontFamily:"system-ui,-apple-system,sans-serif"}}>
      {/* Header */}
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
          {!dia.finalizado&&(
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              <div style={{width:80,height:4,background:"rgba(255,255,255,.15)",borderRadius:2,overflow:"hidden"}}>
                <div style={{height:"100%",width:progress.pct+"%",background:"#7bc99a",borderRadius:2,transition:"width .4s"}} />
              </div>
              <span style={{fontSize:12,color:"#7bc99a",fontWeight:600}}>{progress.pct}%</span>
            </div>
          )}
          <div style={{fontSize:12,color:"#7bc99a"}}>{fmtDate(today())}</div>
          {dia.finalizado&&<span style={{background:"rgba(123,201,154,.2)",color:"#7bc99a",fontSize:11,fontWeight:700,padding:"3px 10px",borderRadius:20}}>DIA FINALIZADO</span>}
        </div>
      </div>

      {/* Main */}
      <main style={{maxWidth:1400,margin:"0 auto",padding:"2rem 24px"}}>
        <Legend />
        {page==="dashboard" && (
          <DashboardPage
            dia={dia}
            onFinalizarDia={handleFinalizarDia}
            onAddMaterial={handleAddMaterial}
            onUpdateCell={handleUpdateCell}
            onEditMaterial={handleEditMaterial}
            onRemoveMaterial={handleRemoveMaterial}
            onLimparDashboard={handleLimparDashboard}
          />
        )}
        {page==="indicadores" && <IndicadoresPage diaAtual={dia} historico={historico} />}
        {page==="historico" && <HistoricoPage historico={historico} />}
      </main>
    </div>
  );
}

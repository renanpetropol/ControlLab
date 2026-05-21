-- ============================================================
-- LabQuality – Script de criação das tabelas no Supabase
-- Execute no SQL Editor do seu projeto Supabase
-- ============================================================

-- Tabela: dias (cada dia de trabalho)
create table if not exists dias (
  id          uuid primary key default gen_random_uuid(),
  date        date not null unique,
  finalizado  boolean not null default false,
  created_at  timestamptz default now()
);

-- Tabela: materiais (cada material cadastrado em um dia)
create table if not exists materiais (
  id          uuid primary key default gen_random_uuid(),
  dia_id      uuid not null references dias(id) on delete cascade,
  codigo      text not null,
  nome        text,
  resina      text,
  ordem       integer default 0,
  created_at  timestamptz default now()
);

-- Tabela: ensaios (cada célula da grade: material x ensaio)
create table if not exists ensaios (
  id          uuid primary key default gen_random_uuid(),
  material_id uuid not null references materiais(id) on delete cascade,
  ensaio_id   text not null,   -- ex: "injecao", "tracao", etc.
  status      text not null default 'pendente',  -- pendente | andamento | concluido | na
  operador    text,
  hora        text,
  updated_at  timestamptz default now(),
  unique(material_id, ensaio_id)
);

-- Índices para performance
create index if not exists idx_materiais_dia_id  on materiais(dia_id);
create index if not exists idx_ensaios_material  on ensaios(material_id);
create index if not exists idx_dias_date         on dias(date);

-- RLS (Row Level Security) – acesso público para uso interno
-- Se quiser adicionar autenticação no futuro, ajuste aqui.
alter table dias      enable row level security;
alter table materiais enable row level security;
alter table ensaios   enable row level security;

create policy "acesso_total_dias"      on dias      for all using (true) with check (true);
create policy "acesso_total_materiais" on materiais for all using (true) with check (true);
create policy "acesso_total_ensaios"   on ensaios   for all using (true) with check (true);

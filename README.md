# LabQuality — Sistema de Controle de Validações

## Pré-requisitos
- Node.js 18+
- Conta gratuita no [Supabase](https://supabase.com)

---

## 1. Configurar o Supabase

### 1.1 Criar projeto
1. Acesse https://supabase.com e faça login
2. Clique em **"New project"**
3. Dê um nome (ex: `labquality`), escolha uma senha e selecione a região mais próxima (**South America - São Paulo**)
4. Aguarde o projeto iniciar (~2 min)

### 1.2 Criar as tabelas
1. No menu lateral, clique em **SQL Editor**
2. Clique em **"New query"**
3. Cole todo o conteúdo do arquivo `supabase_setup.sql`
4. Clique em **"Run"** (▶)
5. Deve aparecer "Success" para cada comando

### 1.3 Pegar as credenciais
1. No menu lateral, vá em **Settings → API**
2. Copie:
   - **Project URL** → ex: `https://abcdefgh.supabase.co`
   - **anon / public key** → chave longa começando com `eyJ...`

---

## 2. Configurar o projeto local

### 2.1 Criar arquivo .env
Na raiz do projeto, crie um arquivo chamado `.env`:
```
VITE_SUPABASE_URL=https://SEU_PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### 2.2 Instalar dependências e rodar
```bash
npm install
npm run dev
```
Acesse http://localhost:5173

---

## 3. Deploy na Vercel

### 3.1 Subir para o GitHub
```bash
git init
git add .
git commit -m "LabQuality v2 com Supabase"
# Crie um repositório em github.com e siga as instruções para push
```

### 3.2 Conectar na Vercel
1. Acesse https://vercel.com e faça login com GitHub
2. Clique em **"New Project"** e selecione o repositório
3. Em **"Environment Variables"**, adicione:
   - `VITE_SUPABASE_URL` = sua URL do Supabase
   - `VITE_SUPABASE_ANON_KEY` = sua chave anon
4. Clique em **Deploy**

Pronto! Sua URL pública estará disponível em segundos.

---

## Estrutura do banco de dados

```
dias          → cada dia de trabalho (date, finalizado)
 └── materiais → materiais do dia (codigo, resina)
      └── ensaios → células da grade (ensaio_id, status, operador, hora)
```

## Tecnologias
- React 18 + Vite
- Supabase (PostgreSQL)
- Deploy: Vercel

---

## 4. Configurar autenticação (login)

### 4.1 Ativar confirmação de e-mail
1. No Supabase, vá em **Authentication → Providers → Email**
2. Confirme que **"Confirm email"** está **ON**
3. Vá em **Authentication → Email Templates** para personalizar o e-mail se quiser

### 4.2 Restringir domínio
O sistema já bloqueia qualquer e-mail que não seja `@petropol.com.br` diretamente no frontend.

### 4.3 Sessão persistente
A sessão é salva no `localStorage` pelo Supabase automaticamente. O usuário permanece logado mesmo após fechar o navegador, sem timeout por inatividade.

### 4.4 Fluxo do usuário
1. Acessa o sistema → vê tela de login
2. Clica em "Cadastrar", preenche nome + e-mail `@petropol.com.br` + senha
3. Recebe e-mail de confirmação → clica no link
4. Faz login → fica logado permanentemente
5. Botão "Sair" no header para desconectar manualmente

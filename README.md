# LabQuality — Sistema de Controle de Validações

Dashboard web para controle diário de ensaios laboratoriais em compostos plásticos.

## Funcionalidades

- **Dashboard diário** — grade de materiais × ensaios com status visual (pendente / em andamento / concluído)
- **Indicadores** — ranking de ensaios mais realizados com filtros de período
- **Histórico** — consulta de dashboards anteriores por data ou código de material
- **Cadastro de materiais** — código, resina, ensaios aplicáveis
- **Finalizar dia** — salva o dashboard no histórico e abre um novo dia

## Tecnologias

- React 18 + Vite
- TailwindCSS (via inline styles — sem dependência extra)
- Dados mockados em memória (pronto para integrar com API)

## Como rodar localmente

```bash
npm install
npm run dev
```

Acesse http://localhost:5173

## Como fazer build para produção

```bash
npm run build
```

Os arquivos estáticos estarão na pasta `dist/`. Pode ser hospedado em:
- **Vercel**: `vercel --prod` ou conecte o repositório no dashboard
- **Netlify**: arraste a pasta `dist/` ou conecte via Git
- **GitHub Pages**: use o plugin `vite-plugin-gh-pages`

## Estrutura

```
labquality/
├── index.html
├── vite.config.js
├── package.json
├── public/
│   └── favicon.svg
└── src/
    ├── main.jsx       # entry point React
    ├── index.css      # reset global
    └── App.jsx        # aplicação completa
```

## Próximos passos sugeridos

- [ ] Integração com banco de dados (Supabase, Firebase ou API própria)
- [ ] Sistema de login por usuário
- [ ] Exportação de PDF do dashboard do dia
- [ ] Relatórios e KPIs mensais
- [ ] Notificações de ensaios pendentes no final do turno

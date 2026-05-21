import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('⚠️ Variáveis VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY não configuradas no .env')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY)

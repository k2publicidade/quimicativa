import { readFileSync } from "node:fs";

const env = Object.fromEntries(readFileSync(".env.local", "utf8").split(/\r?\n/).filter(line => line && !line.startsWith("#") && line.includes("=")).map(line => { const i = line.indexOf("="); return [line.slice(0, i), line.slice(i + 1)]; }));
const base = env.SUPABASE_URL || env.NEXT_PUBLIC_SUPABASE_URL, key = env.SUPABASE_SECRET_KEY;
if (!base || !key) throw new Error("Supabase não configurado em .env.local");
const catalog = [
  ["Acetona","Matéria-prima","","","Inflamável","Catálogo principal"],
  ["Ácido Acético Glacial","Matéria-prima"], ["Ácido Bórico","Matéria-prima"], ["Ácido Cítrico","Matéria-prima"],
  ["Ácido Clorídrico","Matéria-prima","","1789","Corrosivo"], ["Ácido Fórmico","Matéria-prima"], ["Ácido Fosfórico","Matéria-prima"], ["Ácido Oxálico","Matéria-prima"],
  ["Ácido Sulfúrico","Matéria-prima","","1830","Corrosivo"], ["Álcool 99","Matéria-prima","99%","","Inflamável"], ["Álcool Hidratado","Matéria-prima","","","Inflamável"], ["Álcool Isopropílico","Matéria-prima","","","Inflamável"],
  ["Algicida Manutenção","Tratamento de água"], ["Barrilha Leve (Carbonato de Sódio)","Tratamento de água"], ["Bicarbonato de Sódio","Matéria-prima"],
  ["Cal Hidratado (Hidróxido de Cálcio)","Tratamento de água"], ["Clarificante","Tratamento de água"], ["Cloreto de Metileno","Matéria-prima"], ["Cloreto de Sódio","Matéria-prima"], ["Cloreto Férrico","Tratamento de água"], ["Clorofórmio","Matéria-prima"],
  ["Cromato de Potássio 5% Líquido","Matéria-prima","5%"], ["Dicromato de Sódio","Matéria-prima"], ["EDTA","Matéria-prima"], ["Formol Inibido","Matéria-prima","","2209","Tóxico"], ["Fosfato de Sódio","Matéria-prima"], ["Gluconato de Sódio, Chinês","Matéria-prima"], ["Hidrossulfito de Sódio","Matéria-prima"], ["Hidróxido de Amônia","Matéria-prima"],
  ["Hipoclorito de Sódio","Tratamento de água","","1791","Corrosivo"], ["Limpa Bordas","Limpeza e higiene"], ["Metabissulfito de Sódio","Matéria-prima"], ["Metassilicato de Sódio","Matéria-prima"], ["Monoetileno Glicol","Matéria-prima"], ["Permanganato de Potássio","Tratamento de água"],
  ["Peróxido de Hidrogênio 130 VOL","Matéria-prima","130 VOL","2014","Oxidante"], ["Peróxido de Hidrogênio 200 VOL","Matéria-prima","200 VOL","2014","Oxidante"], ["Policloreto de Alumínio","Tratamento de água"], ["Querosene","Matéria-prima","","","Inflamável"], ["Sal Grosso","Matéria-prima"], ["Sal Refinado","Matéria-prima"],
  ["Silicato de Sódio Alcalino","Matéria-prima"], ["Silicato de Sódio Neutro","Matéria-prima"], ["Soda Cáustica Escama","Matéria-prima","","","Corrosivo"],
  ["Soda Cáustica Líquida 20%","Matéria-prima","20%","","Corrosivo","Catálogo impresso informa ONU 2014; validar dado regulatório antes do uso operacional."],
  ["Soda Cáustica Líquida 42%","Matéria-prima","42%","1824","Corrosivo"], ["Soda Cáustica Líquida 50%","Matéria-prima","50%","1824","Corrosivo"],
  ["Sulfato de Alumínio","Tratamento de água"], ["Sulfato de Amônio","Matéria-prima"], ["Sulfato de Sódio","Matéria-prima"], ["Tripolifosfato de Sódio","Matéria-prima"], ["Ureia Técnica","Matéria-prima"], ["Vaselina Líquida","Matéria-prima"], ["Vaselina Líquida / Óleo Mineral","Matéria-prima"]
];
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", Prefer: "return=representation" };
const normalize = value => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const existing = await fetch(`${base}/rest/v1/products?select=id,name`, { headers }).then(r => r.json());
const names = new Set(existing.map(item => normalize(item.name))); let inserted = 0, skipped = 0;
for (const [name, category, concentration="", un_number="", hazard_class="", notes="Catálogo principal da Quimicativa"] of catalog) {
  if (names.has(normalize(name))) { skipped++; continue; }
  const now = Math.floor(Date.now()/1000), body = { name, category, concentration, un_number, hazard_class, signal_word: hazard_class ? "Perigo" : "", h_phrases:"[]", p_phrases:"[]", controlled:0, control_agency:"", flammable: hazard_class === "Inflamável" ? 1 : 0, storage:"", status:"active", notes, created_by:null, created_at:now, updated_at:now };
  const response = await fetch(`${base}/rest/v1/products`, { method:"POST", headers, body:JSON.stringify(body) });
  if (!response.ok) throw new Error(`${name}: ${await response.text()}`); inserted++; names.add(normalize(name));
}
console.log(JSON.stringify({ catalog: catalog.length, inserted, skipped }));

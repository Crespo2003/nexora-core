'use client';

import { useEffect, useMemo, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

type Property = { id: string; property_name: string; unit_no: string | null; area: string | null; property_type: string | null; };
type Listing = { id: string; listing_type: string | null; property_name: string | null; price: string | null; agent_name: string | null; freshness: string | null; };

export default function Home() {
  const supabase = useMemo(() => createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''), []);
  const [active, setActive] = useState('mission');
  const [properties, setProperties] = useState<Property[]>([]);
  const [listings, setListings] = useState<Listing[]>([]);
  const [raw, setRaw] = useState('');
  const [lang, setLang] = useState<'en' | 'zh'>('en');

  const txt = lang === 'zh' ? {
    subtitle:'V1 Clean · 已连接云端', greeting:'早上好，Ryan', mission:'今日任务、租金跟进与市场机会。', start:'开始今日任务',
    collections:'租金中心', collectionsDesc:'租金跟进指挥中心', memory:'房源记忆库', memoryDesc:'导入 WhatsApp 房源',
    property:'房产360', propertyDesc:'云端房产资料库', agent:'中介中心', agentDesc:'谁手上有什么房源',
    legal:'AI 法务', legalDesc:'上传与生成租约', radar:'机会雷达', radarDesc:'AI 商机引擎',
    importText:'粘贴 WhatsApp WTL / WTS / WTR 信息，NEXORA 会保存到 Supabase。', importBtn:'导入 NEXORA',
    addSample:'添加测试房产', cloud:'云端记录'
  } : {
    subtitle:'V1 Clean · Cloud Connected', greeting:'Good morning, Ryan', mission:'Today’s mission, rental collection and market opportunities.', start:'Start My Day',
    collections:'Collections', collectionsDesc:'Rental command center', memory:'Listing Memory', memoryDesc:'Import WhatsApp listings',
    property:'Property 360', propertyDesc:'Cloud property database', agent:'Agent Centre', agentDesc:'Who has what listing',
    legal:'AI Legal', legalDesc:'TA upload & generator', radar:'Radar', radarDesc:'Opportunity engine',
    importText:'Paste a WhatsApp WTL / WTS / WTR message. NEXORA saves it into Supabase.', importBtn:'Import to NEXORA',
    addSample:'Add Sample Property', cloud:'Cloud record'
  };

  async function loadData() {
    const { data: props } = await supabase.from('properties').select('*').order('created_at', { ascending: false }).limit(20);
    const { data: mem } = await supabase.from('listing_memory').select('*').order('created_at', { ascending: false }).limit(20);
    setProperties((props || []) as Property[]);
    setListings((mem || []) as Listing[]);
  }

  useEffect(() => { loadData(); }, []);

  async function addSampleProperty() {
    await supabase.from('properties').insert({ property_name:'Verticas Residensi', unit_no:'B-16-02', area:'Bukit Ceylon', property_type:'Luxury Condo', category:'Residential' });
    loadData();
  }

  function parseWhatsApp(text: string) {
    const type = (text.match(/WTL|WTS|WTR|WTB/i)?.[0] || 'Listing').toUpperCase();
    const price = text.match(/RM\s?[0-9,.]+\s?k?|[0-9.]+\s?m/i)?.[0] || '';
    const projects = ['Aria Residence','MyHabitat','TRX','One KL','Verticas','United Point','Park 2','The Ruma','Vipod','Dua Residency'];
    const project = projects.find(p => text.toLowerCase().includes(p.toLowerCase())) || 'Unknown Project';
    const agent = text.match(/Catherine|Angelina|Jason|Alex|Ryan|Barn|Cynthia|Kiki/i)?.[0] || 'Detected Agent';
    return { type, price, project, agent };
  }

  async function importListing() {
    const parsed = parseWhatsApp(raw);
    await supabase.from('listing_memory').insert({ source_group:'Manual Import', raw_message:raw, listing_type:parsed.type, property_name:parsed.project, price:parsed.price, agent_name:parsed.agent, freshness:'fresh', ai_confidence:0.82 });
    setRaw('');
    loadData();
  }

  return (
    <>
      <main className="shell">
        <div className="top"><div><div className="logo">NEXORA</div><div className="sub">{txt.subtitle}</div></div><button className="lang" onClick={() => setLang(lang === 'en' ? 'zh' : 'en')}>EN / 中文</button></div>

        {active === 'mission' && <>
          <section className="hero"><div className="muted">{txt.greeting}</div><div className="big">RM38.8k</div><div className="muted">{txt.mission}</div><div className="kpis"><div><b>3</b><span>Overdue</span></div><div><b>{listings.length}</b><span>Listings</span></div><div><b>{properties.length}</b><span>Properties</span></div></div><button className="primary" style={{marginTop:16}} onClick={() => setActive('memory')}>{txt.start}</button></section>
          <section className="grid">
            <button className="tile" onClick={() => setActive('collections')}><div>💰</div><h3>{txt.collections}</h3><p>{txt.collectionsDesc}</p></button>
            <button className="tile" onClick={() => setActive('memory')}><div>🧠</div><h3>{txt.memory}</h3><p>{txt.memoryDesc}</p></button>
            <button className="tile" onClick={() => setActive('properties')}><div>🏢</div><h3>{txt.property}</h3><p>{txt.propertyDesc}</p></button>
            <button className="tile" onClick={() => setActive('agents')}><div>🤝</div><h3>{txt.agent}</h3><p>{txt.agentDesc}</p></button>
            <button className="tile"><div>📄</div><h3>{txt.legal}</h3><p>{txt.legalDesc}</p></button>
            <button className="tile"><div>🎯</div><h3>{txt.radar}</h3><p>{txt.radarDesc}</p></button>
          </section>
        </>}

        {active === 'memory' && <>
          <div className="card"><h2>{txt.memory}</h2><p className="muted">{txt.importText}</p><textarea className="input" rows={6} value={raw} onChange={e => setRaw(e.target.value)} placeholder="WTL Aria Residence RM3900 Catherine..." /><button className="primary" onClick={importListing}>{txt.importBtn}</button></div>
          {listings.map(l => <div className="card" key={l.id}><div className="row"><div><div className="prop">{l.property_name}</div><div className="muted">{l.listing_type} · Agent: {l.agent_name}</div></div><div className="amount">{l.price || 'RM -'}</div></div><span className="pill blue">{l.freshness || 'fresh'}</span></div>)}
        </>}

        {active === 'properties' && <>
          <div className="card"><h2>{txt.property}</h2><p className="muted">Connected to your real Supabase database.</p><button className="primary" onClick={addSampleProperty}>{txt.addSample}</button></div>
          {properties.map(p => <div className="card" key={p.id}><div className="prop">{p.property_name} {p.unit_no || ''}</div><div className="muted">{p.area} · {p.property_type}</div><span className="pill green">{txt.cloud}</span></div>)}
        </>}

        {active === 'collections' && <div className="card"><h2>{txt.collections}</h2><div className="row"><div><div className="prop">Verticas B-16-02</div><div className="muted">Peng Ying · Due 1st</div></div><div className="amount">RM10,000</div></div><span className="pill red">Overdue</span><div className="actions"><button className="primary">Paid</button><button className="secondary">WhatsApp</button></div></div>}

        {active === 'agents' && <div className="card"><h2>{txt.agent}</h2><div className="prop">Catherine</div><div className="muted">KLCC specialist · 12 captured listings</div><button className="primary" style={{marginTop:14}}>WhatsApp Agent</button></div>}
      </main>

      <nav className="nav"><div className="navin"><button onClick={() => setActive('mission')}><span>🚀</span>Home</button><button onClick={() => setActive('collections')}><span>💰</span>Rent</button><button onClick={() => setActive('memory')}><span>🧠</span>Memory</button><button onClick={() => setActive('properties')}><span>🏢</span>Property</button><button onClick={() => setActive('agents')}><span>🤝</span>Agent</button></div></nav>
    </>
  );
}

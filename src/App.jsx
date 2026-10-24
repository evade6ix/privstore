import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Home, Package, Plus, ReceiptText, LogOut, Search, X, ChevronRight, RefreshCw, Trash2, Save } from 'lucide-react';

const money = n => new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD' }).format(Number(n || 0));
const api = async (url, options = {}) => {
  const res = await fetch(url, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || 'Request failed');
  return body;
};

function Login({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async e => {
    e.preventDefault(); setLoading(true); setError('');
    try { const data = await api('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }); onLogin(data); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };
  return <main className="login-shell"><motion.form initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} onSubmit={submit} className="login-card">
    <div className="brand-mark">G</div><p className="eyebrow">GO NEXT HOBBIES</p><h1>Field Sales</h1><p className="muted">Enter the private access password to continue.</p>
    <label>Password<input autoFocus type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" /></label>
    {error && <div className="error">{error}</div>}<button className="primary" disabled={loading || !password}>{loading ? 'Unlocking…' : 'Enter app'}</button>
  </motion.form></main>;
}

function BottomNav({ page, setPage }) {
  const items = [['home', Home, 'Home'], ['inventory', Package, 'Inventory'], ['sale', Plus, 'Sale'], ['sales', ReceiptText, 'Sales']];
  return <nav className="bottom-nav">{items.map(([id, Icon, label]) => <button key={id} className={page === id ? 'active' : ''} onClick={() => setPage(id)}><Icon size={20}/><span>{label}</span></button>)}</nav>;
}

function Dashboard({ data, name, setPage }) {
  if (!data) return <Loading/>;
  return <motion.div className="page" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
    <div className="hero"><div><p className="eyebrow">FIELD SALES</p><h1>Good day, {name}</h1><p className="muted">Live numbers from your private sales ledger.</p></div><button className="circle" onClick={() => setPage('sale')}><Plus/></button></div>
    <div className="metric-grid"><Metric label="Sales today" value={money(data.today.sales)}/><Metric label="Go Next cut" value={money(data.today.cut)}/><Metric label="Units held" value={data.inventoryUnits}/><Metric label="Retail value" value={money(data.inventoryRetailValue)}/></div>
    <section><div className="section-head"><h2>This month</h2></div><div className="wide-card"><div><span>Gross sales</span><strong>{money(data.month.sales)}</strong></div><div><span>Go Next cut</span><strong>{money(data.month.cut)}</strong></div><div><span>Bendo's share</span><strong>{money(data.month.storeShare)}</strong></div></div></section>
    <section><div className="section-head"><h2>Recent sales</h2><button onClick={() => setPage('sales')}>View all</button></div>{data.recent?.length ? data.recent.map(s => <SaleRow key={s._id} sale={s}/>) : <Empty text="No sales yet."/>}</section>
  </motion.div>;
}
const Metric = ({ label, value }) => <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
const SaleRow = ({ sale, onClick }) => <button className="list-card" onClick={onClick}><div><strong>{sale.saleNumber}</strong><span>{new Date(sale.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} · {sale.items?.reduce((a, i) => a + i.quantity, 0)} items</span></div><div className="list-money"><strong>{money(sale.gross)}</strong><span>{sale.status}</span></div><ChevronRight size={18}/></button>;
const Empty = ({ text }) => <div className="empty">{text}</div>;
const Loading = () => <div className="loading"><RefreshCw className="spin"/> Loading…</div>;
const ProductThumb = ({ item }) => <div className="thumb">{item.image ? <img src={item.image} alt=""/> : <Package/>}</div>;

function Inventory({ holdings, reload }) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(null);
  const filtered = holdings.filter(h => h.availableQty > 0 && [h.title, h.variantTitle, h.sku].some(v => String(v).toLowerCase().includes(query.toLowerCase())));
  return <div className="page"><div className="page-title"><div><p className="eyebrow">HOLDING</p><h1>Inventory</h1></div><span className="pill">{holdings.reduce((a,h)=>a+h.availableQty,0)} units</span></div><div className="search"><Search size={18}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search your inventory"/></div>
  <div className="stack">{filtered.map(h => <button className="product-row" key={h._id} onClick={()=>setSelected(h)}><ProductThumb item={h}/><div className="grow"><strong>{h.title}</strong><span>{h.variantTitle || h.sku || 'Default variant'}</span><small>{money(h.defaultPrice)} · Store cut {h.cutType === 'percentage' ? `${h.cutValue}%` : money(h.cutValue)}</small></div><b>{h.availableQty}</b></button>)}</div>
  <AnimatePresence>{selected && <InventorySheet item={selected} close={()=>setSelected(null)} reload={reload}/>}</AnimatePresence></div>;
}
function InventorySheet({ item, close, reload }) {
  const [qty,setQty]=useState(''); const [cut,setCut]=useState(item.cutValue); const [type,setType]=useState(item.cutType); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const saveCut=async()=>{setBusy(true);try{await api(`/api/holdings/${item._id}`,{method:'PATCH',body:JSON.stringify({cutType:type,cutValue:Number(cut)})});await reload();close();}catch(e){setError(e.message)}finally{setBusy(false)}};
  const adjust=async sign=>{setBusy(true);try{await api(`/api/holdings/${item._id}/adjust`,{method:'POST',body:JSON.stringify({quantity:sign*Math.abs(Number(qty)),note:sign<0?'Returned to store':'Manual inventory adjustment'})});await reload();close();}catch(e){setError(e.message)}finally{setBusy(false)}};
  return <Sheet close={close}><h2>{item.title}</h2><p className="muted">{item.variantTitle || item.sku}</p><div className="detail-grid"><Metric label="Held" value={item.availableQty}/><Metric label="Shopify" value={item.shopifyQty}/></div><label>Store cut type<select value={type} onChange={e=>setType(e.target.value)}><option value="fixed">Fixed / unit</option><option value="percentage">Percentage</option></select></label><label>Store cut value<input type="number" step="0.01" value={cut} onChange={e=>setCut(e.target.value)}/></label><button className="primary" onClick={saveCut} disabled={busy}>Save store cut</button><hr/><label>Inventory adjustment<input type="number" inputMode="numeric" value={qty} onChange={e=>setQty(e.target.value)} placeholder="Quantity"/></label><div className="two"><button className="secondary" onClick={()=>adjust(1)}>Add</button><button className="danger-soft" onClick={()=>adjust(-1)}>Return</button></div>{error&&<div className="error">{error}</div>}</Sheet>;
}

function NewSale({ holdings, reload, onDone }) {
  const [q,setQ]=useState(''); const [cart,setCart]=useState([]); const [payment,setPayment]=useState('cash'); const [orderName,setOrderName]=useState(''); const [busy,setBusy]=useState(false); const [error,setError]=useState('');
  const matches=holdings.filter(h=>h.availableQty>0&&[h.title,h.variantTitle,h.sku].some(v=>String(v).toLowerCase().includes(q.toLowerCase()))).slice(0,20);
  const cutPerUnit=i=>Number(i.cutValue||0);
  const add=h=>setCart(c=>{const x=c.find(i=>i.variantId===h.variantId);return x?c.map(i=>i.variantId===h.variantId?{...i,quantity:Math.min(h.availableQty,i.quantity+1)}:i):[...c,{variantId:h.variantId,title:h.title,variantTitle:h.variantTitle,image:h.image,quantity:1,pricePerUnit:h.defaultPrice,max:h.availableQty,cutType:'fixed',cutValue:h.cutType==='percentage'?Number(h.defaultPrice||0)*(Number(h.cutValue||0)/100):Number(h.cutValue||0)}]});
  const update=(id,patch)=>setCart(c=>c.map(i=>i.variantId===id?{...i,...patch}:i)); const remove=id=>setCart(c=>c.filter(i=>i.variantId!==id));
  const units=cart.reduce((a,i)=>a+Number(i.quantity||0),0);
  const total=cart.reduce((a,i)=>a+Number(i.pricePerUnit||0)*Number(i.quantity||0),0);
  const totalCut=cart.reduce((a,i)=>a+cutPerUnit(i)*Number(i.quantity||0),0);
  const bendoShare=Math.max(0,total-totalCut);
  const complete=async()=>{setBusy(true);setError('');try{await api('/api/sales',{method:'POST',body:JSON.stringify({items:cart,paymentMethod:payment,saleNumber:orderName,salespersonCut:Number(totalCut.toFixed(2))})});setCart([]);setOrderName('');await reload();onDone();}catch(e){setError(e.message)}finally{setBusy(false)}};
  return <div className="page sale-page"><div className="page-title"><div><p className="eyebrow">CHECKOUT</p><h1>New sale</h1></div><span className="pill">{units} {units===1?'item':'items'}</span></div><div className="search"><Search size={18}/><input value={q} onChange={e=>setQ(e.target.value)} placeholder="Search holding inventory"/></div>
  {q&&<div className="suggestions">{matches.map(h=><button key={h._id} onClick={()=>{add(h);setQ('')}}><ProductThumb item={h}/><span><strong>{h.title}</strong><small>{h.variantTitle||h.sku} · {h.availableQty} available</small></span><Plus size={18}/></button>)}</div>}
  <div className="stack sale-cart">{cart.map(i=>{const lineCut=cutPerUnit(i)*Number(i.quantity||0);return <div className="cart-row sale-line" key={i.variantId}><div className="sale-line-head"><ProductThumb item={i}/><div className="grow"><strong>{i.title}</strong><span>{i.variantTitle||'Default variant'}</span></div><button className="icon-btn" onClick={()=>remove(i.variantId)}><X size={16}/></button></div><div className="cart-controls sale-controls"><label>Qty<input type="number" min="1" max={i.max} value={i.quantity} onChange={e=>update(i.variantId,{quantity:Math.max(1,Math.min(i.max,Number(e.target.value)||1))})}/></label><label>Price / unit<input type="number" min="0" step="0.01" value={i.pricePerUnit} onChange={e=>update(i.variantId,{pricePerUnit:e.target.value})}/></label><label>Store Cut / unit<input type="number" min="0" step="0.01" value={i.cutValue} onChange={e=>update(i.variantId,{cutType:'fixed',cutValue:e.target.value})}/></label></div><div className="line-summary"><span>Line total <strong>{money(Number(i.pricePerUnit||0)*Number(i.quantity||0))}</strong></span><span>Go Next cut <strong>{money(lineCut)}</strong></span></div></div>})}</div>
  {cart.length?<div className="checkout-card sale-summary"><div className="summary-totals"><div><span>Sale total</span><strong>{money(total)}</strong></div><div><span>Go Next Cut</span><strong>{money(totalCut)}</strong></div><div><span>Bendo's share</span><strong>{money(bendoShare)}</strong></div></div><div className="checkout-fields"><label>Order name<input value={orderName} onChange={e=>setOrderName(e.target.value)} placeholder="Optional order name"/></label><label>Payment<select value={payment} onChange={e=>setPayment(e.target.value)}><option value="cash">Cash</option><option value="etransfer">E-Transfer</option><option value="card">Card</option><option value="other">Other</option></select></label></div>{error&&<div className="error">{error}</div>}<button className="primary" disabled={busy} onClick={complete}>{busy?'Saving…':'Complete sale'}</button></div>:<Empty text="Search above to add products to the sale."/>}</div>;
}

function Sales({ sales, reload }) { const [selected,setSelected]=useState(null); return <div className="page"><div className="page-title"><div><p className="eyebrow">HISTORY</p><h1>Sales</h1></div></div><div className="stack">{sales.map(s=><SaleRow key={s._id} sale={s} onClick={()=>setSelected(s)}/>)}</div><AnimatePresence>{selected&&<SaleSheet sale={selected} close={()=>setSelected(null)} reload={reload}/>}</AnimatePresence></div> }
function SaleSheet({sale,close,reload}){
  const [busy,setBusy]=useState(false);const [error,setError]=useState('');const [orderName,setOrderName]=useState(sale.saleNumber);const [cut,setCut]=useState(String(sale.salespersonCut ?? 0));
  const save=async()=>{setBusy(true);setError('');try{await api(`/api/sales/${sale._id}`,{method:'PATCH',body:JSON.stringify({saleNumber:orderName,salespersonCut:Number(cut)})});await reload();close();}catch(e){setError(e.message)}finally{setBusy(false)}};
  const deleteSale=async()=>{if(!window.confirm(`Delete ${sale.saleNumber}? Inventory will be restored and the sale will be permanently removed.`))return;setBusy(true);setError('');try{await api(`/api/sales/${sale._id}`,{method:'DELETE'});await reload();close();}catch(e){setError(e.message)}finally{setBusy(false)}};
  const bendoShare=Math.max(0,Number(sale.gross||0)-Number(cut||0));
  return <Sheet close={close}><p className="eyebrow">SALE DETAILS</p><h2>{money(sale.gross)}</h2><p className="muted">{new Date(sale.createdAt).toLocaleString()}</p><label>Order name<input value={orderName} onChange={e=>setOrderName(e.target.value)}/></label><label>Go Next cut<input type="number" min="0" max={sale.gross} step="0.01" value={cut} onChange={e=>setCut(e.target.value)}/></label><div className="wide-card"><div><span>Go Next cut</span><strong>{money(cut)}</strong></div><div><span>Bendo's share</span><strong>{money(bendoShare)}</strong></div></div><div className="stack compact">{sale.items.map((i,idx)=><div className="line" key={idx}><span>{i.quantity}× {i.title}</span><strong>{money(i.lineTotal)}</strong></div>)}</div>{error&&<div className="error">{error}</div>}<button className="primary" disabled={busy} onClick={save}><Save size={17}/> Save sale</button><button className="danger-soft" disabled={busy} onClick={deleteSale}><Trash2 size={17}/> Delete sale & restore inventory</button></Sheet>
}

function TransferSheet({ close, reload }) {
  const [q,setQ]=useState('');const[results,setResults]=useState([]);const[selected,setSelected]=useState(null);const[qty,setQty]=useState(1);const[cut,setCut]=useState(0);const[busy,setBusy]=useState(false);const[error,setError]=useState('');
  useEffect(()=>{if(q.length<2){setResults([]);return}const t=setTimeout(()=>api(`/api/catalog?q=${encodeURIComponent(q)}`).then(d=>setResults(d.items)).catch(e=>setError(e.message)),250);return()=>clearTimeout(t)},[q]);
  const submit=async()=>{setBusy(true);setError('');try{await api('/api/holdings/transfer',{method:'POST',body:JSON.stringify({productId:selected.productId,variantId:selected.variantId,title:selected.title,variantTitle:selected.variantTitle,sku:selected.sku,image:selected.image,shopifyQty:selected.quantity,defaultPrice:selected.price,quantity:Number(qty),cutType:'fixed',cutValue:Number(cut)})});await reload();close()}catch(e){setError(e.message)}finally{setBusy(false)}};
  return <Sheet close={close}><h2>Add inventory</h2><p className="muted">Transfers only affect the private MongoDB holding.</p>{!selected?<><div className="search"><Search size={18}/><input autoFocus value={q} onChange={e=>setQ(e.target.value)} placeholder="Search pnlstore products"/></div><div className="stack">{results.map(p=><button className="product-row" key={p.variantId} onClick={()=>setSelected(p)}><ProductThumb item={p}/><div className="grow"><strong>{p.title}</strong><span>{p.variantTitle||p.sku}</span><small>{money(p.price)} · Shopify {p.quantity}</small></div><ChevronRight size={18}/></button>)}</div></>:<><button className="selected-product" onClick={()=>setSelected(null)}><ProductThumb item={selected}/><span><strong>{selected.title}</strong><small>{selected.variantTitle||selected.sku}</small></span></button><label>Quantity to give Bendo<input type="number" min="1" value={qty} onChange={e=>setQty(e.target.value)}/></label><label>Store cut per unit<input type="number" step="0.01" min="0" value={cut} onChange={e=>setCut(e.target.value)}/></label><button className="primary" disabled={busy} onClick={submit}>{busy?'Adding…':'Add to holding'}</button></>}{error&&<div className="error">{error}</div>}</Sheet>;
}
function Sheet({children,close}){return <motion.div className="sheet-backdrop" initial={{opacity:0}} animate={{opacity:1}} exit={{opacity:0}} onMouseDown={e=>e.target===e.currentTarget&&close()}><motion.div className="sheet" initial={{y:'100%'}} animate={{y:0}} exit={{y:'100%'}} transition={{type:'spring',damping:28,stiffness:300}}><div className="grab"/><button className="sheet-close" onClick={close}><X/></button>{children}</motion.div></motion.div>}

export default function App(){const[auth,setAuth]=useState(null);const[name,setName]=useState('Bendo');const[page,setPage]=useState('home');const[dashboard,setDashboard]=useState(null);const[holdings,setHoldings]=useState([]);const[sales,setSales]=useState([]);const[transfer,setTransfer]=useState(false);const[error,setError]=useState('');
  const reload=useCallback(async()=>{try{const[d,h,s]=await Promise.all([api('/api/dashboard'),api('/api/holdings'),api('/api/sales')]);setDashboard(d);setHoldings(h.items);setSales(s.items);setError('')}catch(e){if(e.message==='Password required.')setAuth(false);else setError(e.message)}},[]);
  useEffect(()=>{api('/api/auth/status').then(d=>{setAuth(d.authenticated);setName(d.salespersonName||'Bendo')}).catch(()=>setAuth(false))},[]);
  useEffect(()=>{if(!auth)return;reload();const ev=new EventSource('/api/events');ev.addEventListener('update',reload);return()=>ev.close()},[auth,reload]);
  const logout=async()=>{await api('/api/auth/logout',{method:'POST'});setAuth(false)};
  if(auth===null)return <Loading/>;if(!auth)return <Login onLogin={d=>{setName(d.salespersonName||'Bendo');setAuth(true)}}/>;
  return <div className="app"><header><div className="logo">GN</div><div className="spacer"/><button className="header-add" onClick={()=>setTransfer(true)}><Package size={17}/> Add stock</button><button className="icon-btn" onClick={logout}><LogOut size={18}/></button></header>{error&&<div className="global-error">{error}</div>}<AnimatePresence mode="wait"><motion.div key={page} initial={{opacity:0,x:8}} animate={{opacity:1,x:0}} exit={{opacity:0,x:-8}} transition={{duration:.16}}>{page==='home'&&<Dashboard data={dashboard} name={name} setPage={setPage}/>} {page==='inventory'&&<Inventory holdings={holdings} reload={reload}/>} {page==='sale'&&<NewSale holdings={holdings} reload={reload} onDone={()=>setPage('home')}/>} {page==='sales'&&<Sales sales={sales} reload={reload}/>}</motion.div></AnimatePresence><BottomNav page={page} setPage={setPage}/><AnimatePresence>{transfer&&<TransferSheet close={()=>setTransfer(false)} reload={reload}/>}</AnimatePresence></div>;
}
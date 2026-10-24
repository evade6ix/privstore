import 'dotenv/config';
import express from 'express';
import mongoose from 'mongoose';
import helmet from 'helmet';
import compression from 'compression';
import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { Holding, Sale, InventoryTransaction, Settlement } from './models.js';

const app = express();
const port = Number(process.env.PORT || 3000);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(__dirname, '../dist');
const listeners = new Set();

app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(express.json({ limit: '1mb' }));

const safeEqual = (a = '', b = '') => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
const secret = () => process.env.APP_SECRET || process.env.APP_PASSWORD || 'development-only';
const authToken = () => crypto.createHmac('sha256', secret()).update('privstore-session-v1').digest('hex');
const cookieValue = (req, name) => String(req.headers.cookie || '').split(';').map(v => v.trim()).find(v => v.startsWith(`${name}=`))?.slice(name.length + 1) || '';
const sessionCookie = `privstore_session=${authToken()}; Path=/; HttpOnly; SameSite=Strict${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
const isAuthed = req => safeEqual(cookieValue(req, 'privstore_session'), authToken());
const requireAuth = (req, res, next) => isAuthed(req) ? next() : res.status(401).json({ error: 'Password required.' });
const asyncRoute = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const round = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const publish = (type, data = {}) => {
  const payload = `event: update\ndata: ${JSON.stringify({ type, ...data, at: new Date().toISOString() })}\n\n`;
  for (const res of listeners) res.write(payload);
};

app.get('/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.post('/api/auth/login', (req, res) => {
  const configured = process.env.APP_PASSWORD;
  if (!configured) return res.status(500).json({ error: 'APP_PASSWORD is not configured.' });
  if (!safeEqual(req.body?.password, configured)) return res.status(401).json({ error: 'Incorrect password.' });
  res.setHeader('Set-Cookie', sessionCookie);
  res.json({ ok: true, salespersonName: process.env.SALESPERSON_NAME || 'Karl' });
});
app.post('/api/auth/logout', (req, res) => {
  res.setHeader('Set-Cookie', `privstore_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.get('/api/auth/status', (req, res) => res.json({ authenticated: isAuthed(req), salespersonName: process.env.SALESPERSON_NAME || 'Karl' }));

app.get('/api/events', requireAuth, (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();
  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  listeners.add(res);
  const keepAlive = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(keepAlive); listeners.delete(res); });
});

let catalogCache = { at: 0, items: [] };
async function getCatalog(force = false) {
  const base = String(process.env.PNLSTORE_API_URL || '').replace(/\/$/, '');
  if (!base) throw Object.assign(new Error('PNLSTORE_API_URL is not configured.'), { status: 503 });
  if (!force && Date.now() - catalogCache.at < 30000 && catalogCache.items.length) return catalogCache.items;
  const first = await fetch(`${base}/api/inventory?page=1`, { signal: AbortSignal.timeout(15000) });
  if (!first.ok) throw Object.assign(new Error(`pnlstore catalog request failed (${first.status}).`), { status: 502 });
  const data = await first.json();
  const items = [...(data.items || [])];
  const pages = Math.ceil((data.total || items.length) / (data.limit || 50));
  for (let page = 2; page <= pages; page++) {
    const r = await fetch(`${base}/api/inventory?page=${page}`, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw Object.assign(new Error(`pnlstore catalog page ${page} failed (${r.status}).`), { status: 502 });
    items.push(...((await r.json()).items || []));
  }
  catalogCache = { at: Date.now(), items };
  return items;
}

const normalizedCatalogItem = item => ({
  id: String(item.id || item._id || item.variantId || ''),
  productId: String(item.productId || item.productGid || item.product_id || ''),
  variantId: String(item.variantId || item.variantGid || item.id || item._id || ''),
  title: item.title || 'Untitled product',
  variantTitle: item.variantTitle || '',
  sku: item.sku || '',
  image: item.image || item.imageUrl || '',
  price: Number(item.price || 0),
  cost: Number(item.cost || 0),
  quantity: Number(item.quantity || 0)
});

app.get('/api/catalog', requireAuth, asyncRoute(async (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase();
  const raw = await getCatalog(req.query.refresh === '1');
  let items = raw.map(normalizedCatalogItem);
  if (q) items = items.filter(i => [i.title, i.variantTitle, i.sku].some(v => String(v).toLowerCase().includes(q)));
  res.json({ items: items.slice(0, 100), total: items.length, cachedAt: new Date(catalogCache.at).toISOString() });
}));

app.get('/api/holdings', requireAuth, asyncRoute(async (req, res) => {
  const items = await Holding.find().sort({ title: 1, variantTitle: 1 }).lean();
  res.json({ items });
}));

app.post('/api/holdings/transfer', requireAuth, asyncRoute(async (req, res) => {
  const quantity = Math.floor(Number(req.body?.quantity));
  const cutValue = Number(req.body?.cutValue || 0);
  if (!req.body?.variantId || !req.body?.title || quantity <= 0) return res.status(400).json({ error: 'Product and a positive quantity are required.' });
  if (cutValue < 0) return res.status(400).json({ error: 'Cut cannot be negative.' });
  const item = await Holding.findOneAndUpdate(
    { variantId: String(req.body.variantId) },
    {
      $set: {
        productId: String(req.body.productId || ''),
        title: String(req.body.title),
        variantTitle: String(req.body.variantTitle || ''),
        sku: String(req.body.sku || ''),
        image: String(req.body.image || ''),
        shopifyQty: Number(req.body.shopifyQty || 0),
        defaultPrice: Number(req.body.defaultPrice || 0),
        cutType: req.body.cutType === 'percentage' ? 'percentage' : 'fixed',
        cutValue,
        notes: String(req.body.notes || '')
      },
      $inc: { availableQty: quantity }
    },
    { upsert: true, new: true, runValidators: true }
  );
  await InventoryTransaction.create({ variantId: item.variantId, type: 'TRANSFER_IN', quantity, note: req.body.note || 'Inventory transferred to salesperson' });
  publish('holding', { variantId: item.variantId });
  res.status(201).json(item);
}));

app.patch('/api/holdings/:id', requireAuth, asyncRoute(async (req, res) => {
  const update = {};
  if (req.body.cutType != null) update.cutType = req.body.cutType === 'percentage' ? 'percentage' : 'fixed';
  if (req.body.cutValue != null) update.cutValue = Math.max(0, Number(req.body.cutValue));
  if (req.body.defaultPrice != null) update.defaultPrice = Math.max(0, Number(req.body.defaultPrice));
  if (req.body.notes != null) update.notes = String(req.body.notes);
  const item = await Holding.findByIdAndUpdate(req.params.id, { $set: update }, { new: true, runValidators: true });
  if (!item) return res.sendStatus(404);
  publish('holding', { variantId: item.variantId });
  res.json(item);
}));

app.post('/api/holdings/:id/adjust', requireAuth, asyncRoute(async (req, res) => {
  const quantity = Math.trunc(Number(req.body?.quantity));
  if (!quantity) return res.status(400).json({ error: 'Adjustment quantity cannot be zero.' });
  const item = await Holding.findOneAndUpdate(
    { _id: req.params.id, availableQty: { $gte: Math.max(0, -quantity) } },
    { $inc: { availableQty: quantity } },
    { new: true }
  );
  if (!item) return res.status(400).json({ error: 'Not enough inventory for that adjustment.' });
  await InventoryTransaction.create({ variantId: item.variantId, type: quantity > 0 ? 'ADJUSTMENT' : 'RETURN_TO_STORE', quantity, note: String(req.body.note || '') });
  publish('holding', { variantId: item.variantId });
  res.json(item);
}));

async function nextSaleNumber() {
  const latest = await Sale.findOne().sort({ createdAt: -1 }).select('saleNumber').lean();
  const n = Number(String(latest?.saleNumber || '').replace(/\D/g, '')) || 0;
  return `K-${String(n + 1).padStart(5, '0')}`;
}

app.post('/api/sales', requireAuth, asyncRoute(async (req, res) => {
  const incoming = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!incoming.length) return res.status(400).json({ error: 'Add at least one item.' });
  const holdings = await Holding.find({ variantId: { $in: incoming.map(i => String(i.variantId)) } });
  const byVariant = new Map(holdings.map(h => [h.variantId, h]));
  const items = [];
  for (const row of incoming) {
    const holding = byVariant.get(String(row.variantId));
    const quantity = Math.floor(Number(row.quantity));
    const pricePerUnit = Number(row.pricePerUnit);
    if (!holding || quantity <= 0 || pricePerUnit < 0) return res.status(400).json({ error: 'One or more sale lines are invalid.' });
    if (holding.availableQty < quantity) return res.status(409).json({ error: `Only ${holding.availableQty} ${holding.title} available.` });
    const cutPerUnit = holding.cutType === 'percentage' ? pricePerUnit * (holding.cutValue / 100) : holding.cutValue;
    items.push({
      variantId: holding.variantId,
      productId: holding.productId,
      title: holding.title,
      variantTitle: holding.variantTitle,
      sku: holding.sku,
      quantity,
      standardPrice: holding.defaultPrice,
      pricePerUnit,
      cutType: holding.cutType,
      cutValue: holding.cutValue,
      lineTotal: round(pricePerUnit * quantity),
      salespersonCut: round(cutPerUnit * quantity)
    });
  }
  const changed = [];
  try {
    for (const item of items) {
      const updated = await Holding.findOneAndUpdate({ variantId: item.variantId, availableQty: { $gte: item.quantity } }, { $inc: { availableQty: -item.quantity } }, { new: true });
      if (!updated) throw Object.assign(new Error(`Inventory changed for ${item.title}; refresh and try again.`), { status: 409 });
      changed.push(item);
    }
    const gross = round(items.reduce((a, i) => a + i.lineTotal, 0));
    const salespersonCut = round(items.reduce((a, i) => a + i.salespersonCut, 0));
    const sale = await Sale.create({
      saleNumber: await nextSaleNumber(),
      items,
      customerName: String(req.body.customerName || ''),
      paymentMethod: ['cash', 'etransfer', 'card', 'other'].includes(req.body.paymentMethod) ? req.body.paymentMethod : 'cash',
      notes: String(req.body.notes || ''),
      gross,
      salespersonCut,
      storeShare: round(gross - salespersonCut)
    });
    await InventoryTransaction.insertMany(items.map(i => ({ variantId: i.variantId, type: 'SALE', quantity: -i.quantity, relatedSaleId: sale._id, note: sale.saleNumber })));
    publish('sale', { saleId: sale._id, saleNumber: sale.saleNumber });
    res.status(201).json(sale);
  } catch (error) {
    for (const item of changed) await Holding.updateOne({ variantId: item.variantId }, { $inc: { availableQty: item.quantity } });
    throw error;
  }
}));

app.get('/api/sales', requireAuth, asyncRoute(async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 50)));
  const items = await Sale.find().sort({ createdAt: -1 }).limit(limit).lean();
  res.json({ items });
}));

app.post('/api/sales/:id/void', requireAuth, asyncRoute(async (req, res) => {
  const sale = await Sale.findOneAndUpdate({ _id: req.params.id, status: 'completed' }, { $set: { status: 'voided', voidedAt: new Date() } }, { new: true });
  if (!sale) return res.status(404).json({ error: 'Sale not found or already voided.' });
  for (const item of sale.items) await Holding.updateOne({ variantId: item.variantId }, { $inc: { availableQty: item.quantity } });
  await InventoryTransaction.insertMany(sale.items.map(i => ({ variantId: i.variantId, type: 'SALE_VOID', quantity: i.quantity, relatedSaleId: sale._id, note: `Voided ${sale.saleNumber}` })));
  publish('sale', { saleId: sale._id, saleNumber: sale.saleNumber });
  res.json(sale);
}));

app.get('/api/transactions', requireAuth, asyncRoute(async (req, res) => {
  const filter = req.query.variantId ? { variantId: String(req.query.variantId) } : {};
  res.json({ items: await InventoryTransaction.find(filter).sort({ createdAt: -1 }).limit(150).lean() });
}));

app.get('/api/dashboard', requireAuth, asyncRoute(async (req, res) => {
  const [holdings, sales, openSettlements] = await Promise.all([
    Holding.find().lean(),
    Sale.find({ status: 'completed' }).sort({ createdAt: -1 }).lean(),
    Settlement.find({ status: 'open' }).lean()
  ]);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const today = sales.filter(s => new Date(s.createdAt) >= start);
  const monthStart = new Date(start.getFullYear(), start.getMonth(), 1);
  const month = sales.filter(s => new Date(s.createdAt) >= monthStart);
  const sum = (arr, key) => round(arr.reduce((a, x) => a + Number(x[key] || 0), 0));
  res.json({
    inventoryUnits: holdings.reduce((a, h) => a + h.availableQty, 0),
    inventoryRetailValue: round(holdings.reduce((a, h) => a + h.availableQty * h.defaultPrice, 0)),
    today: { sales: sum(today, 'gross'), cut: sum(today, 'salespersonCut'), storeShare: sum(today, 'storeShare'), count: today.length },
    month: { sales: sum(month, 'gross'), cut: sum(month, 'salespersonCut'), storeShare: sum(month, 'storeShare'), count: month.length },
    unsettled: round(openSettlements.reduce((a, s) => a + s.amountDue, 0)),
    recent: sales.slice(0, 6)
  });
}));

app.get('/api/settlements', requireAuth, asyncRoute(async (req, res) => res.json({ items: await Settlement.find().sort({ createdAt: -1 }).lean() })));
app.post('/api/settlements', requireAuth, asyncRoute(async (req, res) => {
  const periodStart = new Date(req.body.periodStart);
  const periodEnd = new Date(req.body.periodEnd);
  if (Number.isNaN(periodStart.getTime()) || Number.isNaN(periodEnd.getTime())) return res.status(400).json({ error: 'Valid settlement dates are required.' });
  const sales = await Sale.find({ status: 'completed', createdAt: { $gte: periodStart, $lte: periodEnd } }).lean();
  const grossSales = round(sales.reduce((a, s) => a + s.gross, 0));
  const salespersonCut = round(sales.reduce((a, s) => a + s.salespersonCut, 0));
  const settlement = await Settlement.create({ periodStart, periodEnd, saleIds: sales.map(s => s._id), grossSales, salespersonCut, amountDue: round(grossSales - salespersonCut) });
  publish('settlement', { settlementId: settlement._id });
  res.status(201).json(settlement);
}));
app.post('/api/settlements/:id/paid', requireAuth, asyncRoute(async (req, res) => {
  const item = await Settlement.findByIdAndUpdate(req.params.id, { $set: { status: 'paid', paidAt: new Date() } }, { new: true });
  if (!item) return res.sendStatus(404);
  publish('settlement', { settlementId: item._id });
  res.json(item);
}));

if (process.env.NODE_ENV === 'production') {
  app.use(express.static(dist));
  app.get('*', (req, res, next) => req.path.startsWith('/api/') ? next() : res.sendFile(path.join(dist, 'index.html')));
}

app.use((error, req, res, next) => {
  console.error(error);
  res.status(error.status || 500).json({ error: error.message || 'Unexpected server error.' });
});

await mongoose.connect(process.env.MONGODB_URI);
app.listen(port, '0.0.0.0', () => console.log(`Field Sales listening on ${port}`));
